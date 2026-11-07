import Database from "better-sqlite3";
import { join } from "node:path";
import { connectStore, isDuplicateKey } from "../server/database/store";
import type { Row } from "../server/database/types";

/**
 * One-time copy of the former SQLite database into MongoDB.
 * Run with `npm run migrate:mongo`. The SQLite file is only read, never changed, so it stays a backup.
 * Documents that already exist in MongoDB are skipped, so the script can be run again safely.
 */
const file = process.env.DATABASE_FILE ?? join(process.cwd(), "data", "saviny.db");
const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
const database = process.env.MONGODB_DB ?? "saviny";

const TABLES = [
  "users", "sessions", "accounts", "categories", "transactions", "recurring_transactions", "budgets", "budget_categories",
  "bills", "goals", "contributions", "listings", "listing_photos", "favorites", "sales", "conversations", "media", "messages",
  "message_reactions", "posts", "comments", "post_reactions", "reports", "notifications", "oauth_identities", "oauth_states",
  "login_handoffs",
];

/** SQLite stored flags as 0 and 1. MongoDB stores them as booleans. */
const BOOLEAN_COLUMNS: Record<string, string[]> = {
  users: ["notify_budget_alerts", "notify_upcoming_bills", "notify_savings_milestones", "notify_community_replies", "notify_marketplace_messages"],
  accounts: ["archived"],
  categories: ["archived"],
  recurring_transactions: ["active"],
  posts: ["hidden"],
  comments: ["hidden"],
  notifications: ["read"],
};

function convert(table: string, row: Row): Row {
  for (const column of BOOLEAN_COLUMNS[table] ?? []) {
    if (column in row) row[column] = !!row[column];
  }
  return row;
}

async function main(): Promise<void> {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  const existing = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
  const store = await connectStore(uri, database);
  try {
    for (const table of TABLES) {
      if (!existing.has(table)) {
        console.log(`${table}: not in the SQLite file, skipped`);
        continue;
      }
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[];
      let copied = 0;
      let skipped = 0;
      for (const row of rows) {
        try {
          await store.insert(table, convert(table, row));
          copied += 1;
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
          skipped += 1;
        }
      }
      console.log(`${table}: ${copied} copied, ${skipped} already present`);
    }
  } finally {
    await store.close();
    sqlite.close();
  }
}

await main();
