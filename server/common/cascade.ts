import type { Store } from "../database/store";

/*
 * MongoDB has no ON DELETE CASCADE, so the related documents are removed here, in the same
 * order the former foreign keys implied: children first, then the parent.
 */

/** Removes conversations with their messages, reactions and uploaded media records. */
export async function removeConversations(store: Store, conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  const messages = await store.many("messages", { conversation_id: { $in: conversationIds } });
  await store.remove("message_reactions", { message_id: { $in: messages.map((m) => m.id) } });
  await store.remove("messages", { conversation_id: { $in: conversationIds } });
  await store.remove("media", { conversation_id: { $in: conversationIds } });
  await store.remove("conversations", { id: { $in: conversationIds } });
}

/** Removes a listing with its photos, favourites, sales and conversations. */
export async function removeListing(store: Store, listingId: string): Promise<void> {
  const conversations = await store.many("conversations", { listing_id: listingId });
  await removeConversations(store, conversations.map((c) => c.id));
  await store.remove("listing_photos", { listing_id: listingId });
  await store.remove("favorites", { listing_id: listingId });
  await store.remove("sales", { listing_id: listingId });
  await store.remove("listings", { id: listingId });
}

/** Removes an account with its transactions and recurring items. Bills stay, unlinked from the account. */
export async function removeAccount(store: Store, accountId: string): Promise<void> {
  await store.remove("transactions", { account_id: accountId });
  await store.remove("recurring_transactions", { account_id: accountId });
  await store.update("bills", { account_id: accountId }, { account_id: null });
  await store.remove("accounts", { id: accountId });
}

/** Removes a savings goal with its contributions. */
export async function removeGoal(store: Store, goalId: string): Promise<void> {
  await store.remove("contributions", { goal_id: goalId });
  await store.remove("goals", { id: goalId });
}

/** Removes a budget with its category links. */
export async function removeBudget(store: Store, budgetId: string): Promise<void> {
  await store.remove("budget_categories", { budget_id: budgetId });
  await store.remove("budgets", { id: budgetId });
}

/** Removes a post with its comments and reactions. Reports about it are kept for the moderation record. */
export async function removePost(store: Store, postId: string): Promise<void> {
  await store.remove("comments", { post_id: postId });
  await store.remove("post_reactions", { post_id: postId });
  await store.remove("posts", { id: postId });
}
