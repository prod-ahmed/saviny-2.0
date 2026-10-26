import type { Db } from "mongodb";

type Key = Record<string, 1 | -1>;

/** Collections whose documents are found by their own `id`. */
const ID_COLLECTIONS = [
  "users", "accounts", "categories", "transactions", "recurring_transactions", "budgets", "bills", "goals",
  "contributions", "listings", "sales", "conversations", "media", "messages", "posts", "comments", "reports", "notifications",
];

/** Lookup and uniqueness rules that replace the former SQL keys and indexes. */
const INDEXES: { collection: string; key: Key; unique?: boolean }[] = [
  { collection: "users", key: { email: 1 }, unique: true },
  { collection: "sessions", key: { token_hash: 1 }, unique: true },
  { collection: "sessions", key: { user_id: 1 } },
  { collection: "categories", key: { user_id: 1, name: 1 }, unique: true },
  { collection: "accounts", key: { user_id: 1, created_at: 1 } },
  { collection: "transactions", key: { user_id: 1, date: 1 } },
  { collection: "transactions", key: { account_id: 1 } },
  { collection: "transactions", key: { category_id: 1 } },
  { collection: "recurring_transactions", key: { user_id: 1, next_date: 1 } },
  { collection: "recurring_transactions", key: { account_id: 1 } },
  { collection: "budgets", key: { user_id: 1, created_at: 1 } },
  { collection: "budget_categories", key: { budget_id: 1, category_id: 1 }, unique: true },
  { collection: "budget_categories", key: { category_id: 1 } },
  { collection: "bills", key: { user_id: 1, due_date: 1 } },
  { collection: "bills", key: { account_id: 1 } },
  { collection: "goals", key: { user_id: 1, created_at: 1 } },
  { collection: "contributions", key: { goal_id: 1, date: 1 } },
  { collection: "contributions", key: { user_id: 1 } },
  { collection: "listings", key: { status: 1, created_at: -1 } },
  { collection: "listings", key: { user_id: 1 } },
  { collection: "listing_photos", key: { listing_id: 1, position: 1 }, unique: true },
  { collection: "favorites", key: { user_id: 1, listing_id: 1 }, unique: true },
  { collection: "favorites", key: { listing_id: 1 } },
  { collection: "sales", key: { listing_id: 1 } },
  { collection: "conversations", key: { listing_id: 1, buyer_id: 1 }, unique: true },
  { collection: "conversations", key: { buyer_id: 1, updated_at: -1 } },
  { collection: "conversations", key: { seller_id: 1, updated_at: -1 } },
  { collection: "media", key: { conversation_id: 1 } },
  { collection: "messages", key: { conversation_id: 1, created_at: 1 } },
  { collection: "messages", key: { media_id: 1 } },
  { collection: "message_reactions", key: { message_id: 1, user_id: 1, emoji: 1 }, unique: true },
  { collection: "posts", key: { created_at: -1 } },
  { collection: "posts", key: { category: 1 } },
  { collection: "comments", key: { post_id: 1, created_at: 1 } },
  { collection: "comments", key: { user_id: 1 } },
  { collection: "post_reactions", key: { post_id: 1, user_id: 1 }, unique: true },
  { collection: "reports", key: { status: 1, created_at: 1 } },
  { collection: "notifications", key: { user_id: 1, created_at: -1 } },
  { collection: "oauth_identities", key: { provider: 1, provider_user_id: 1 }, unique: true },
  { collection: "oauth_identities", key: { user_id: 1 } },
  { collection: "oauth_states", key: { state_hash: 1 }, unique: true },
  { collection: "login_handoffs", key: { code_hash: 1 }, unique: true },
];

/** Creates every index the app relies on. Safe on each start: indexes that already exist are left alone. */
export async function ensureIndexes(db: Db): Promise<void> {
  for (const name of ID_COLLECTIONS) await db.collection(name).createIndex({ id: 1 }, { unique: true });
  for (const index of INDEXES) await db.collection(index.collection).createIndex(index.key, { unique: index.unique ?? false });
}
