import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA } from "./schema";

export type Db = Database.Database;

/** Opens the database file, applies the schema and upgrades tables created by older versions. */
export function openDatabase(file: string): Db {
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrateMessages(db);
  return db;
}

/**
 * Messages used to be one row per contact with from/to columns and no thread. Each old row now
 * belongs to a conversation between the buyer (sender) and the seller (recipient).
 */
function migrateMessages(db: Db): void {
  const columns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (columns.some((c) => c.name === "from_user_id")) {
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(`INSERT OR IGNORE INTO conversations (id, listing_id, buyer_id, seller_id, created_at, updated_at)
          SELECT lower(hex(randomblob(16))), listing_id, from_user_id, to_user_id, MIN(created_at), MAX(created_at)
          FROM messages GROUP BY listing_id, from_user_id, to_user_id`);
        db.exec(`CREATE TABLE messages_new (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          read_at TEXT
        )`);
        db.exec(`INSERT INTO messages_new (id, conversation_id, sender_id, body, created_at, read_at)
          SELECT m.id, c.id, m.from_user_id, m.body, m.created_at, NULL FROM messages m
          JOIN conversations c ON c.listing_id = m.listing_id AND c.buyer_id = m.from_user_id AND c.seller_id = m.to_user_id`);
        db.exec("DROP TABLE messages");
        db.exec("ALTER TABLE messages_new RENAME TO messages");
      })();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
  // Columns added for images and voice notes; older message tables get them here.
  const current = (db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).map((c) => c.name);
  if (!current.includes("kind")) db.exec("ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'");
  if (!current.includes("media_id")) db.exec("ALTER TABLE messages ADD COLUMN media_id TEXT REFERENCES media(id) ON DELETE SET NULL");
  if (!current.includes("duration_ms")) db.exec("ALTER TABLE messages ADD COLUMN duration_ms INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)");
  migrate(db);
}

/**
 * Older databases limited users.currency to three codes. SQLite cannot drop a CHECK in place,
 * so the users table is rebuilt without it, keeping every row and every foreign key.
 */
function migrate(db: Db): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { sql: string };
  if (!/CHECK \(currency IN/.test(row.sql)) return;
  const rebuilt = row.sql
    .replace(/^CREATE TABLE (IF NOT EXISTS )?users \(/, "CREATE TABLE users_new (")
    .replace(/\s+CHECK \(currency IN \([^)]*\)\)/, "");
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(rebuilt);
      db.exec("INSERT INTO users_new SELECT * FROM users");
      db.exec("DROP TABLE users");
      db.exec("ALTER TABLE users_new RENAME TO users");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

