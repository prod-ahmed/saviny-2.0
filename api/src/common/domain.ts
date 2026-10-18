import { NotFoundException } from "@nestjs/common";
import { Db } from "../database/database.module";
import { newId, nowIso } from "./security";

export const DEFAULT_CATEGORIES = ["Food", "Transport", "Housing", "Leisure", "Health", "Education", "Income", "Savings"];

export const moderatorEmails = (): string[] =>
  (process.env.MODERATOR_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const OWNED_TABLES = new Set([
  "accounts", "categories", "transactions", "recurring_transactions", "budgets", "bills", "goals", "contributions",
  "listings", "posts", "comments",
]);

/** Fetches one row only if the user owns it; otherwise 404, so existence is not leaked. */
export function owned(db: Db, table: string, id: string, userId: string): Record<string, any> {
  if (!OWNED_TABLES.has(table)) throw new Error(`Table ${table} is not ownable`);
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId) as Record<string, any> | undefined;
  if (!row) throw new NotFoundException();
  return row;
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
export function notify(db: Db, userId: string, actorId: string, kind: string, title: string, body: string, link: string): void {
  if (userId === actorId) return;
  db.prepare(
    "INSERT INTO notifications (id, user_id, kind, title, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
  ).run(newId(), userId, kind, title, body, link, nowIso());
}
