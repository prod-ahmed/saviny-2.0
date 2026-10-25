import { z } from "zod";
import { context } from "../context";
import { badRequest, forbidden, HttpError } from "../common/errors";
import { DEFAULT_CATEGORIES, moderatorEmails, newUser } from "../common/domain";
import { toUser } from "../common/mappers";
import { hashPassword, newId, newToken, nowIso, sha256, verifyPassword } from "../common/security";
import { CURRENCY_CODES } from "../common/currencies";
import type { Store } from "../database/store";
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

const NOTIFICATION_FIELDS: Record<string, string> = {
  budgetAlerts: "notify_budget_alerts",
  upcomingBills: "notify_upcoming_bills",
  savingsMilestones: "notify_savings_milestones",
  communityReplies: "notify_community_replies",
  marketplaceMessages: "notify_marketplace_messages",
};

const findUser = async (store: Store, id: string): Promise<Row> => (await store.one("users", { id })) as Row;

export async function openSession(userId: string): Promise<string> {
  const { store } = await context();
  const token = newToken();
  await store.insert("sessions", { token_hash: sha256(token), user_id: userId, created_at: nowIso() });
  return token;
}

/** Stores the default categories every new account starts with. */
async function addDefaultCategories(store: Store, userId: string): Promise<void> {
  await store.insert("categories", DEFAULT_CATEGORIES.map((name) => ({ id: newId(), user_id: userId, name, archived: false })));
}

async function register(body: z.infer<typeof registerSchema>) {
  if (body.password !== body.confirmPassword) throw badRequest("Passwords do not match");
  const { store } = await context();
  const email = body.email.toLowerCase();
  if (await store.one("users", { email })) throw badRequest("This email cannot be used");

  const role = moderatorEmails().includes(email) ? "moderator" : "member";
  const user = newUser({
    firstName: body.firstName.trim(),
    lastName: body.lastName.trim(),
    email,
    passwordHash: await hashPassword(body.password),
    role,
  });
  await store.insert("users", user);
  await addDefaultCategories(store, user.id);

  const token = await openSession(user.id);
  return { token, user: toUser(await findUser(store, user.id)) };
}

async function login(body: z.infer<typeof loginSchema>) {
  const { store } = await context();
  const row = await store.one("users", { email: body.email.toLowerCase() });
  const valid = row && (await verifyPassword(body.password, row.password_hash));
  if (!row || !valid) throw new HttpError(401, "Invalid email or password");
  const token = await openSession(row.id);
  return { token, user: toUser(row) };
}

export const authRoutes: Route[] = [
  route("POST", "auth/register", (ctx) => ctx.body(registerSchema).then(register), { public: true, limit: { max: 10, windowMs: 60_000 } }),
  route("POST", "auth/login", (ctx) => ctx.body(loginSchema).then(login), { public: true, status: 200, limit: { max: 5, windowMs: 60_000 } }),
  route("POST", "auth/logout", async (ctx) => {
    const { store } = await context();
    await store.remove("sessions", { token_hash: ctx.tokenHash });
  }, { status: 204 }),
  route("GET", "auth/me", async (ctx) => toUser(await findUser((await context()).store, ctx.user.id))),

  route("PATCH", "users/me", async (ctx) => {
    const dto = await ctx.body(profileSchema);
    const { store } = await context();
    const email = dto.email?.toLowerCase();
    if (email && (await store.one("users", { email, id: { $ne: ctx.user.id } }))) {
      throw badRequest("This email cannot be used");
    }
    const set: Row = {};
    if (dto.firstName !== undefined) set.first_name = dto.firstName.trim();
    if (dto.lastName !== undefined) set.last_name = dto.lastName.trim();
    if (email !== undefined) set.email = email;
    if (dto.currency !== undefined) set.currency = dto.currency;
    if (Object.keys(set).length > 0) await store.update("users", { id: ctx.user.id }, set);
    return toUser(await findUser(store, ctx.user.id));
  }),

  /** Changing the password revokes every other session of the user. */
  route("POST", "users/me/password", async (ctx) => {
    const dto = await ctx.body(passwordSchema);
    const { store } = await context();
    const row = await findUser(store, ctx.user.id);
    if (!(await verifyPassword(dto.currentPassword, row.password_hash))) throw forbidden("Current password is incorrect");
    await store.update("users", { id: ctx.user.id }, { password_hash: await hashPassword(dto.newPassword) });
    await store.remove("sessions", { user_id: ctx.user.id, token_hash: { $ne: ctx.tokenHash } });
  }, { status: 204 }),

  route("PATCH", "users/me/notifications", async (ctx) => {
    const dto = await ctx.body(notificationsSchema);
    const { store } = await context();
    const set: Row = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) set[NOTIFICATION_FIELDS[key]] = value;
    }
    if (Object.keys(set).length > 0) await store.update("users", { id: ctx.user.id }, set);
    return toUser(await findUser(store, ctx.user.id));
  }),

  /** Records a deletion request for review; nothing is deleted here. */
  route("POST", "users/me/delete-request", async (ctx) => {
    await ctx.body(deleteRequestSchema);
    const { store } = await context();
    const at = nowIso();
    await store.update("users", { id: ctx.user.id }, { deletion_requested_at: at });
    return { deletionRequestedAt: at };
  }, { status: 202 }),
];
