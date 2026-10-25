import { newId, nowIso } from "./security";
import { notFound } from "./errors";
import type { Store } from "../database/store";
import type { Row } from "../database/types";

export const DEFAULT_CATEGORIES = ["Food", "Transport", "Housing", "Leisure", "Health", "Education", "Income", "Savings"];

export const moderatorEmails = (): string[] =>
  (process.env.MODERATOR_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const OWNED_COLLECTIONS = new Set([
  "accounts", "categories", "transactions", "recurring_transactions", "budgets", "bills", "goals", "contributions",
  "listings", "posts", "comments",
]);

/** Fetches one document only if the user owns it; otherwise 404, so existence is not leaked. */
export async function owned(store: Store, collection: string, id: string, userId: string): Promise<Row> {
  if (!OWNED_COLLECTIONS.has(collection)) throw new Error(`Collection ${collection} is not ownable`);
  const row = await store.one(collection, { id, user_id: userId });
  if (!row) throw notFound();
  return row;
}

/** Drops the keys whose value is undefined, so an update only touches the fields that were sent. */
export const defined = (fields: Row): Row => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

/** Adds first_name and last_name from each row's author, found through `userKey`. */
export async function withAuthors(store: Store, rows: Row[], userKey = "user_id"): Promise<Row[]> {
  const ids = [...new Set(rows.map((r) => r[userKey]))];
  const users = new Map((await store.many("users", { id: { $in: ids } })).map((u) => [u.id, u]));
  return rows.map((r) => {
    const author = users.get(r[userKey]);
    return { ...r, first_name: author?.first_name ?? "", last_name: author?.last_name ?? "" };
  });
}

/** A new user document with the defaults the former table declared. */
export function newUser(fields: { firstName: string; lastName: string; email: string; passwordHash: string; role: string }): Row {
  return {
    id: newId(),
    first_name: fields.firstName,
    last_name: fields.lastName,
    email: fields.email,
    password_hash: fields.passwordHash,
    role: fields.role,
    currency: "USD",
    notify_budget_alerts: true,
    notify_upcoming_bills: true,
    notify_savings_milestones: true,
    notify_community_replies: true,
    notify_marketplace_messages: true,
    deletion_requested_at: null,
    created_at: nowIso(),
  };
}

/** Inclusive YYYY-MM-DD range for dashboard periods. */
export function periodRange(period: string, now = new Date()): { from: string; to: string } {
  const to = isoDate(now);
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case "last_month":
      return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) };
    case "last_3_months":
      return { from: isoDate(new Date(y, m - 2, 1)), to };
    case "this_year":
      return { from: isoDate(new Date(y, 0, 1)), to };
    default:
      return { from: isoDate(new Date(y, m, 1)), to };
  }
}

/** Stores a notification for another user. Users are never notified about their own actions. */
export async function notify(store: Store, userId: string, actorId: string, kind: string, title: string, body: string, link: string): Promise<void> {
  if (userId === actorId) return;
  await store.insert("notifications", { id: newId(), user_id: userId, kind, title, body, link, read: false, created_at: nowIso() });
}
