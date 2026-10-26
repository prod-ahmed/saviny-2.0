import { mkdirSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { context } from "../context";
import { badRequest, forbidden, notFound } from "../common/errors";
import { notify } from "../common/domain";
import { newId, nowIso } from "../common/security";
import type { Store } from "../database/store";
import type { Row } from "../database/types";
import { MEDIA_MAX_BYTES, REACTIONS, VOICE_MAX_MS, mediaKindFor } from "./media.rules";

export const MESSAGE_MAX_LENGTH = 1000;

export type MessageKind = "text" | "image" | "voice";

export interface SendInput {
  kind?: unknown;
  body?: unknown;
  mediaId?: unknown;
  durationMs?: unknown;
}

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/** Trimmed text, or a 400 when empty or too long. Captions are optional, so this is only used for text. */
export function cleanBody(raw: unknown, required = true): string {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (required && !body) throw badRequest("Message cannot be empty");
  if (body.length > MESSAGE_MAX_LENGTH) throw badRequest(`Message must be ${MESSAGE_MAX_LENGTH} characters or fewer`);
  return body;
}

/** The media folder, created on first use. */
function mediaFolder(mediaDir: string): string {
  mkdirSync(mediaDir, { recursive: true });
  return mediaDir;
}

/** A conversation the user takes part in, or 404 (never reveals other people's threads). */
export async function participantConversation(store: Store, userId: string, conversationId: string): Promise<Row> {
  const row = await store.one("conversations", { id: conversationId, $or: [{ buyer_id: userId }, { seller_id: userId }] });
  if (!row) throw notFound();
  return row;
}

const otherId = (conversation: Row, userId: string): string =>
  conversation.buyer_id === userId ? conversation.seller_id : conversation.buyer_id;

const displayName = (first: string, last: string) => `${first} ${String(last).charAt(0)}.`;
const initialsFor = (first: string, last: string) => `${String(first).charAt(0)}${String(last).charAt(0)}`;

/** Checks an uploaded file can be attached now: same conversation, same uploader, right type, not used before. */
async function attachable(store: Store, senderId: string, conversationId: string, rawId: unknown, kind: "image" | "voice"): Promise<string> {
  const mediaId = typeof rawId === "string" ? rawId : "";
  const media = await store.one("media", { id: mediaId, conversation_id: conversationId, uploader_id: senderId });
  if (!media) throw badRequest("Attachment not found");
  if (mediaKindFor(media.mime) !== kind) throw badRequest("Attachment type does not match the message");
  if (await store.one("messages", { media_id: mediaId })) throw badRequest("Attachment was already sent");
  return mediaId;
}

function preview(kind: string | null, body: string | null): string | null {
  if (kind === "image") return body ? `📷 ${body}` : "📷 Photo";
  if (kind === "voice") return "🎤 Voice message";
  return body ?? null;
}

/** Reactions for a set of messages, grouped by emoji, with whether the viewer reacted. */
async function reactionsFor(store: Store, messageIds: string[], viewerId: string): Promise<Map<string, Reaction[]>> {
  const result = new Map<string, Reaction[]>();
  if (messageIds.length === 0) return result;
  const rows = await store.many("message_reactions", { message_id: { $in: messageIds } }, { sort: { created_at: 1 } });
  const grouped = new Map<string, Map<string, Reaction>>();
  for (const r of rows) {
    const byEmoji = grouped.get(r.message_id) ?? new Map<string, Reaction>();
    const entry = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    entry.count += 1;
    if (r.user_id === viewerId) entry.mine = true;
    byEmoji.set(r.emoji, entry);
    grouped.set(r.message_id, byEmoji);
  }
  for (const [id, byEmoji] of grouped) result.set(id, [...byEmoji.values()]);
  return result;
}

/** Message documents as the API returns them, with reactions and attachment details. */
async function messageViews(store: Store, rows: Row[], viewerId: string) {
  const reactions = await reactionsFor(store, rows.map((r) => r.id), viewerId);
  const mediaIds = rows.map((r) => r.media_id).filter((id): id is string => !!id);
  const media = new Map((await store.many("media", { id: { $in: mediaIds } })).map((m) => [m.id, m]));
  return rows.map((row) => {
    const attachment = row.media_id ? media.get(row.media_id) : undefined;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      kind: (row.kind ?? "text") as MessageKind,
      body: row.body ?? "",
      media: attachment ? { id: attachment.id, mime: attachment.mime, size: attachment.size } : null,
      durationMs: row.duration_ms ?? null,
      reactions: reactions.get(row.id) ?? [],
      createdAt: row.created_at,
      readAt: row.read_at ?? null,
    };
  });
}

/** Buyer starts (or continues) the conversation about a listing. Sellers cannot message their own listing. */
export async function startFromListing(userId: string, listingId: string, input: SendInput) {
  const { store } = await context();
  const listing = await store.one("listings", { id: listingId, status: "available" });
  if (!listing) throw notFound();
  if (listing.user_id === userId) throw forbidden("You cannot message your own listing");

  let conversation = await store.one("conversations", { listing_id: listingId, buyer_id: userId });
  if (!conversation) {
    const now = nowIso();
    conversation = { id: newId(), listing_id: listingId, buyer_id: userId, seller_id: listing.user_id, created_at: now, updated_at: now };
    await store.insert("conversations", conversation);
  }
  const message = await sendMessage(userId, conversation.id, input);
  return { conversationId: conversation.id, message };
}

/** Stores a message (text, image or voice), pushes it to both participants and notifies the other one if they have nothing unread. */
export async function sendMessage(senderId: string, conversationId: string, input: SendInput) {
  const { store, hub } = await context();
  const conversation = await participantConversation(store, senderId, conversationId);
  const kind: MessageKind = input.kind === undefined ? "text" : (input.kind as MessageKind);
  if (!["text", "image", "voice"].includes(kind)) throw badRequest("Unknown message type");

  let body = "";
  let mediaId: string | null = null;
  let durationMs: number | null = null;
  if (kind === "text") {
    body = cleanBody(input.body);
  } else {
    mediaId = await attachable(store, senderId, conversationId, input.mediaId, kind);
    body = cleanBody(input.body, false);
    if (kind === "voice") {
      const ms = Number(input.durationMs);
      durationMs = Number.isFinite(ms) ? Math.min(Math.max(Math.round(ms), 0), VOICE_MAX_MS) : 0;
    }
  }

  const message = {
    id: newId(), conversation_id: conversationId, sender_id: senderId, kind, body, media_id: mediaId,
    duration_ms: durationMs, created_at: nowIso(), read_at: null,
  };
  const recipientId = otherId(conversation, senderId);

  await store.insert("messages", message);
  await store.update("conversations", { id: conversationId }, { updated_at: message.created_at });
  const unreadFromSender = await store.count("messages", { conversation_id: conversationId, sender_id: senderId, read_at: null });
  if (unreadFromSender === 1) {
    const listing = (await store.one("listings", { id: conversation.listing_id })) as Row;
    const text = kind === "image" ? "Sent a photo" : kind === "voice" ? "Sent a voice message" : body;
    await notify(store, recipientId, senderId, "marketplace_message", `New message about ${listing.title}`, text, `/messages/${conversationId}`);
  }

  const [view] = await messageViews(store, [message], senderId);
  hub.toUser(senderId, "message:new", { conversationId, message: view });
  hub.toUser(recipientId, "message:new", { conversationId, message: view });
  return view;
}

/** Stores an uploaded photo or voice note under a random id. Only participants can upload, and only the sender can attach it. */
export async function uploadMedia(userId: string, conversationId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
  const { store, mediaDir } = await context();
  await participantConversation(store, userId, conversationId);
  const kind = mediaKindFor(file.mimetype);
  if (!kind) throw badRequest("This file type is not supported");
  if (file.size > MEDIA_MAX_BYTES) throw badRequest("File is larger than 10 MB");
  if (file.size === 0) throw badRequest("File is empty");

  const id = newId();
  await writeFile(join(mediaFolder(mediaDir), id), file.buffer);
  await store.insert("media", { id, conversation_id: conversationId, uploader_id: userId, mime: file.mimetype, size: file.size, created_at: nowIso() });
  return { mediaId: id, kind, mime: file.mimetype, size: file.size };
}

/** The stored file, if the user is one of the two people in its conversation. */
export async function mediaContent(userId: string, mediaId: string): Promise<{ body: Buffer; mime: string }> {
  const { store, mediaDir } = await context();
  const media = await store.one("media", { id: mediaId });
  if (!media) throw notFound();
  await participantConversation(store, userId, media.conversation_id);
  return { body: await readFile(join(mediaFolder(mediaDir), media.id)), mime: media.mime };
}

/** Adds or removes one reaction from one person; both participants are told the new totals. */
export async function react(userId: string, messageId: string, emoji: unknown): Promise<Reaction[]> {
  if (typeof emoji !== "string" || !REACTIONS.includes(emoji)) throw badRequest("That reaction is not available");
  const { store, hub } = await context();
  const message = await store.one("messages", { id: messageId });
  if (!message) throw notFound();
  const conversation = await participantConversation(store, userId, message.conversation_id);

  const existing = await store.one("message_reactions", { message_id: messageId, user_id: userId, emoji });
  if (existing) await store.remove("message_reactions", { message_id: messageId, user_id: userId, emoji });
  else await store.insert("message_reactions", { message_id: messageId, user_id: userId, emoji, created_at: nowIso() });

  const reactions = (await reactionsFor(store, [messageId], userId)).get(messageId) ?? [];
  const payload = { conversationId: message.conversation_id, messageId, reactions };
  hub.toUser(conversation.buyer_id, "message:reaction", payload);
  hub.toUser(conversation.seller_id, "message:reaction", payload);
  return reactions;
}

/** Marks the other person's messages as read and tells them when it happened. */
export async function markRead(userId: string, conversationId: string): Promise<{ updated: number }> {
  const { store, hub } = await context();
  const conversation = await participantConversation(store, userId, conversationId);
  const readAt = nowIso();
  const updated = await store.update("messages", { conversation_id: conversationId, sender_id: { $ne: userId }, read_at: null }, { read_at: readAt });
  if (updated > 0) hub.toUser(otherId(conversation, userId), "message:read", { conversationId, readAt });
  return { updated };
}

/** Someone is typing or recording; relayed only to the other participant and not stored. */
export async function typing(userId: string, conversationId: string, state: "typing" | "recording" = "typing"): Promise<void> {
  const { store, hub } = await context();
  const conversation = await participantConversation(store, userId, conversationId);
  hub.toUser(otherId(conversation, userId), "message:typing", { conversationId, userId, state });
}

/** The user's conversations, newest first, with the other person, last message and unread count. */
export async function listConversations(userId: string) {
  const { store } = await context();
  const conversations = await store.many(
    "conversations",
    { $or: [{ buyer_id: userId }, { seller_id: userId }] },
    { sort: { updated_at: -1 }, limit: 200 },
  );
  const listings = new Map((await store.many("listings", { id: { $in: conversations.map((c) => c.listing_id) } })).map((l) => [l.id, l]));
  const people = new Map((await store.many("users", {
    id: { $in: conversations.map((c) => otherId(c, userId)) },
  })).map((u) => [u.id, u]));

  const items = await Promise.all(conversations.map(async (c) => {
    const listing = listings.get(c.listing_id);
    const other = people.get(otherId(c, userId));
    if (!listing || !other) return null;
    const last = await store.one("messages", { conversation_id: c.id }, { created_at: -1 });
    const unread = await store.count("messages", { conversation_id: c.id, sender_id: { $ne: userId }, read_at: null });
    return {
      id: c.id,
      listingId: c.listing_id,
      listingTitle: listing.title,
      listingStatus: listing.status,
      role: c.buyer_id === userId ? "buyer" : "seller",
      other: { id: other.id, name: displayName(other.first_name, other.last_name), initials: initialsFor(other.first_name, other.last_name) },
      lastMessage: last ? preview(last.kind ?? null, last.body ?? null) : null,
      unread,
      updatedAt: c.updated_at,
    };
  }));
  const visible = items.filter((item): item is NonNullable<typeof item> => item !== null);
  return { items: visible, unreadCount: visible.reduce((sum, c) => sum + c.unread, 0) };
}

/** Messages in a conversation, oldest first, newest page by default. */
export async function listMessages(userId: string, conversationId: string, before?: string, limit = 50) {
  const { store } = await context();
  const conversation = await participantConversation(store, userId, conversationId);
  const size = Math.min(Math.max(limit, 1), 100);
  const rows = await store.many(
    "messages",
    before ? { conversation_id: conversationId, created_at: { $lt: before } } : { conversation_id: conversationId },
    { sort: { created_at: -1 }, limit: size },
  );
  const listing = (await store.one("listings", { id: conversation.listing_id })) as Row;
  const other = (await store.one("users", { id: otherId(conversation, userId) })) as Row;
  return {
    conversationId,
    listingId: conversation.listing_id,
    listingTitle: listing.title,
    listingStatus: listing.status,
    role: conversation.buyer_id === userId ? "buyer" : "seller",
    other: { id: other.id, name: displayName(other.first_name, other.last_name), initials: initialsFor(other.first_name, other.last_name) },
    items: (await messageViews(store, rows, userId)).reverse(),
  };
}

