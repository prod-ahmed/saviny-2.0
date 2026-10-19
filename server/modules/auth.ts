import { z } from "zod";
import { context } from "../context";
import { badRequest, forbidden, HttpError } from "../common/errors";
import { DEFAULT_CATEGORIES, moderatorEmails } from "../common/domain";
import { toUser } from "../common/mappers";
import { hashPassword, newId, newToken, nowIso, sha256, verifyPassword } from "../common/security";
import { CURRENCY_CODES } from "../common/currencies";
import type { Row } from "../database/types";
import { route, type Route } from "../http/types";
import { text } from "../http/schema";

const registerSchema = z.object({
  firstName: text(60),
  lastName: text(60),
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  confirmPassword: z.string(),
}).strict();

const loginSchema = z.object({
  email: z.email(),
  password: z.string().max(128),
}).strict();

const profileSchema = z.object({
  firstName: text(60).optional(),
  lastName: text(60).optional(),
  email: z.email().max(254).optional(),
  currency: z.enum(CURRENCY_CODES as [string, ...string[]]).optional(),
}).strict();

const passwordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(128),
}).strict();

const notificationsSchema = z.object({
  budgetAlerts: z.boolean().optional(),
  upcomingBills: z.boolean().optional(),
  savingsMilestones: z.boolean().optional(),
  communityReplies: z.boolean().optional(),
  marketplaceMessages: z.boolean().optional(),
}).strict();

const deleteRequestSchema = z.object({
  confirmation: z.literal("DELETE"),
}).strict();

const NOTIFICATION_COLUMNS: Record<string, string> = {
  budgetAlerts: "notify_budget_alerts",
  upcomingBills: "notify_upcoming_bills",
  savingsMilestones: "notify_savings_milestones",
  communityReplies: "notify_community_replies",
  marketplaceMessages: "notify_marketplace_messages",
};

const findUser = (id: string): Row => context().db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row;

export function openSession(userId: string): string {
  const token = newToken();
  context().db.prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)").run(sha256(token), userId, nowIso());
  return token;
}

async function register(body: z.infer<typeof registerSchema>) {
  if (body.password !== body.confirmPassword) throw badRequest("Passwords do not match");
  const db = context().db;
  const email = body.email.toLowerCase();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw badRequest("This email cannot be used");

  const id = newId();
  const role = moderatorEmails().includes(email) ? "moderator" : "member";
  const passwordHash = await hashPassword(body.password);
  db.transaction(() => {
    db.prepare("INSERT INTO users (id, first_name, last_name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, body.firstName.trim(), body.lastName.trim(), email, passwordHash, role, nowIso());
    const insertCategory = db.prepare("INSERT INTO categories (id, user_id, name) VALUES (?, ?, ?)");
    for (const name of DEFAULT_CATEGORIES) insertCategory.run(newId(), id, name);
  })();

  const token = openSession(id);
  return { token, user: toUser(findUser(id)) };
}

async function login(body: z.infer<typeof loginSchema>) {
  const row = context().db.prepare("SELECT * FROM users WHERE email = ?").get(body.email.toLowerCase()) as Row | undefined;
  const valid = row && (await verifyPassword(body.password, row.password_hash));
  if (!row || !valid) throw new HttpError(401, "Invalid email or password");
  const token = openSession(row.id);
  return { token, user: toUser(row) };
}

export const authRoutes: Route[] = [
  route("POST", "auth/register", (ctx) => ctx.body(registerSchema).then(register), { public: true, limit: { max: 10, windowMs: 60_000 } }),
  route("POST", "auth/login", (ctx) => ctx.body(loginSchema).then(login), { public: true, status: 200, limit: { max: 5, windowMs: 60_000 } }),
  route("POST", "auth/logout", (ctx) => {
    context().db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(ctx.tokenHash);
  }, { status: 204 }),
  route("GET", "auth/me", (ctx) => toUser(findUser(ctx.user.id))),

  route("PATCH", "users/me", async (ctx) => {
    const dto = await ctx.body(profileSchema);
    const db = context().db;
    const email = dto.email?.toLowerCase();
    if (email && db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, ctx.user.id)) {
      throw badRequest("This email cannot be used");
    }
    db.prepare(`
      UPDATE users SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        email = COALESCE(?, email),
        currency = COALESCE(?, currency)
      WHERE id = ?`).run(dto.firstName?.trim() ?? null, dto.lastName?.trim() ?? null, email ?? null, dto.currency ?? null, ctx.user.id);
    return toUser(findUser(ctx.user.id));
  }),

  /** Changing the password revokes every other session of the user. */
  route("POST", "users/me/password", async (ctx) => {
    const dto = await ctx.body(passwordSchema);
    const db = context().db;
    const row = findUser(ctx.user.id);
    if (!(await verifyPassword(dto.currentPassword, row.password_hash))) throw forbidden("Current password is incorrect");
    const newHash = await hashPassword(dto.newPassword);
    db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, ctx.user.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(ctx.user.id, ctx.tokenHash);
    })();
  }, { status: 204 }),

  route("PATCH", "users/me/notifications", async (ctx) => {
    const dto = await ctx.body(notificationsSchema);
    const db = context().db;
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) db.prepare(`UPDATE users SET ${NOTIFICATION_COLUMNS[key]} = ? WHERE id = ?`).run(value ? 1 : 0, ctx.user.id);
    }
    return toUser(findUser(ctx.user.id));
  }),

  /** Records a deletion request for review; nothing is deleted here. */
  route("POST", "users/me/delete-request", async (ctx) => {
    await ctx.body(deleteRequestSchema);
    const at = nowIso();
    context().db.prepare("UPDATE users SET deletion_requested_at = ? WHERE id = ?").run(at, ctx.user.id);
    return { deletionRequestedAt: at };
  }, { status: 202 }),
];
