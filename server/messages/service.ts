import { mkdirSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { context } from "../context";
import { badRequest, forbidden, notFound } from "../common/errors";
import { notify } from "../common/domain";
import { newId, nowIso } from "../common/security";
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

const db = () => context().db;

/** Trimmed text, or a 400 when empty or too long. Captions are optional, so this is only used for text. */
export function cleanBody(raw: unknown, required = true): string {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (required && !body) throw badRequest("Message cannot be empty");
  if (body.length > MESSAGE_MAX_LENGTH) throw badRequest(`Message must be ${MESSAGE_MAX_LENGTH} characters or fewer`);
  return body;
}

/** The media folder, created on first use. */
function mediaFolder(): string {
  const dir = context().mediaDir;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A conversation the user takes part in, or 404 (never reveals other people's threads). */
function participantConversation(userId: string, conversationId: string): Row {
  const row = db().prepare("SELECT * FROM conversations WHERE id = ? AND (buyer_id = ? OR seller_id = ?)")
    .get(conversationId, userId, userId) as Row | undefined;
  if (!row) throw notFound();
  return row;
}

const otherId = (conversation: Row, userId: string): string =>
  conversation.buyer_id === userId ? conversation.seller_id : conversation.buyer_id;

const displayName = (first: string, last: string) => `${first} ${String(last).charAt(0)}.`;
const initialsFor = (first: string, last: string) => `${String(first).charAt(0)}${String(last).charAt(0)}`;

/** Checks an uploaded file can be attached now: same conversation, same uploader, right type, not used before. */
function attachable(senderId: string, conversationId: string, rawId: unknown, kind: "image" | "voice"): string {
  const mediaId = typeof rawId === "string" ? rawId : "";
  const media = db().prepare("SELECT * FROM media WHERE id = ? AND conversation_id = ? AND uploader_id = ?")
    .get(mediaId, conversationId, senderId) as Row | undefined;
  if (!media) throw badRequest("Attachment not found");
  if (mediaKindFor(media.mime) !== kind) throw badRequest("Attachment type does not match the message");
  if (db().prepare("SELECT 1 FROM messages WHERE media_id = ?").get(mediaId)) throw badRequest("Attachment was already sent");
  return mediaId;
}

function preview(kind: string | null, body: string | null): string | null {
  if (kind === "image") return body ? `📷 ${body}` : "📷 Photo";
  if (kind === "voice") return "🎤 Voice message";
  return body ?? null;
}

/** Reactions for a set of messages, grouped by emoji, with whether the viewer reacted. */
function reactionsFor(messageIds: string[], viewerId: string): Map<string, Reaction[]> {
  const result = new Map<string, Reaction[]>();
  if (messageIds.length === 0) return result;
  const marks = messageIds.map(() => "?").join(",");
  const rows = db().prepare(`SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN (${marks}) ORDER BY created_at`)
    .all(...messageIds) as { message_id: string; emoji: string; user_id: string }[];
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

function messageView(row: Row, reactions: Reaction[]) {
  const media = row.media_id ? (db().prepare("SELECT id, mime, size FROM media WHERE id = ?").get(row.media_id) as Row | undefined) : undefined;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    kind: (row.kind ?? "text") as MessageKind,
    body: row.body ?? "",
    media: media ? { id: media.id, mime: media.mime, size: media.size } : null,
    durationMs: row.duration_ms ?? null,
    reactions,
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
  };
}

/** Buyer starts (or continues) the conversation about a listing. Sellers cannot message their own listing. */
export function startFromListing(userId: string, listingId: string, input: SendInput) {
  const listing = db().prepare("SELECT * FROM listings WHERE id = ? AND status = 'available'").get(listingId) as Row | undefined;
  if (!listing) throw notFound();
  if (listing.user_id === userId) throw forbidden("You cannot message your own listing");

  const existing = db().prepare("SELECT id FROM conversations WHERE listing_id = ? AND buyer_id = ?").get(listingId, userId) as { id: string } | undefined;
  const conversationId = existing?.id ?? newId();
  if (!existing) {
    db().prepare("INSERT INTO conversations (id, listing_id, buyer_id, seller_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(conversationId, listingId, userId, listing.user_id, nowIso(), nowIso());
  }
  const message = sendMessage(userId, conversationId, input);
  return { conversationId, message };
}

/** Stores a message (text, image or voice), pushes it to both participants and notifies the other one if they have nothing unread. */
export function sendMessage(senderId: string, conversationId: string, input: SendInput) {
  const conversation = participantConversation(senderId, conversationId);
  const kind: MessageKind = input.kind === undefined ? "text" : (input.kind as MessageKind);
  if (!["text", "image", "voice"].includes(kind)) throw badRequest("Unknown message type");

  let body = "";
  let mediaId: string | null = null;
  let durationMs: number | null = null;
  if (kind === "text") {
    body = cleanBody(input.body);
  } else {
    mediaId = attachable(senderId, conversationId, input.mediaId, kind);
    body = cleanBody(input.body, false);
    if (kind === "voice") {
      const ms = Number(input.durationMs);
      durationMs = Number.isFinite(ms) ? Math.min(Math.max(Math.round(ms), 0), VOICE_MAX_MS) : 0;
    }
  }

  const message = { id: newId(), conversation_id: conversationId, sender_id: senderId, kind, body, media_id: mediaId, duration_ms: durationMs, created_at: nowIso(), read_at: null };
  const recipientId = otherId(conversation, senderId);

  db().transaction(() => {
    db().prepare("INSERT INTO messages (id, conversation_id, sender_id, kind, body, media_id, duration_ms, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(message.id, conversationId, senderId, kind, body, mediaId, durationMs, message.created_at, null);
    db().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(message.created_at, conversationId);
    const unreadFromSender = (db().prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id = ? AND read_at IS NULL")
      .get(conversationId, senderId) as { n: number }).n;
    if (unreadFromSender === 1) {
      const listing = db().prepare("SELECT title FROM listings WHERE id = ?").get(conversation.listing_id) as { title: string };
      const text = kind === "image" ? "Sent a photo" : kind === "voice" ? "Sent a voice message" : body;
      notify(db(), recipientId, senderId, "marketplace_message", `New message about ${listing.title}`, text, `/messages/${conversationId}`);
    }
  })();

  const view = messageView(message, []);
  const hub = context().hub;
  hub.toUser(senderId, "message:new", { conversationId, message: view });
  hub.toUser(recipientId, "message:new", { conversationId, message: view });
  return view;
}

/** Stores an uploaded photo or voice note under a random id. Only participants can upload, and only the sender can attach it. */
export async function uploadMedia(userId: string, conversationId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
  participantConversation(userId, conversationId);
  const kind = mediaKindFor(file.mimetype);
  if (!kind) throw badRequest("This file type is not supported");
  if (file.size > MEDIA_MAX_BYTES) throw badRequest("File is larger than 10 MB");
  if (file.size === 0) throw badRequest("File is empty");

  const id = newId();
  await writeFile(join(mediaFolder(), id), file.buffer);
  db().prepare("INSERT INTO media (id, conversation_id, uploader_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, conversationId, userId, file.mimetype, file.size, nowIso());
  return { mediaId: id, kind, mime: file.mimetype, size: file.size };
}

/** The stored file, if the user is one of the two people in its conversation. */
export async function mediaContent(userId: string, mediaId: string): Promise<{ body: Buffer; mime: string }> {
  const row = db().prepare(`
    SELECT m.* FROM media m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = ? AND (c.buyer_id = ? OR c.seller_id = ?)`).get(mediaId, userId, userId) as Row | undefined;
  if (!row) throw notFound();
  return { body: await readFile(join(mediaFolder(), row.id)), mime: row.mime };
}

/** Adds or removes one reaction from one person; both participants are told the new totals. */
export function react(userId: string, messageId: string, emoji: unknown): Reaction[] {
  if (typeof emoji !== "string" || !REACTIONS.includes(emoji)) throw badRequest("That reaction is not available");
  const message = db().prepare("SELECT m.*, c.buyer_id, c.seller_id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ? AND (c.buyer_id = ? OR c.seller_id = ?)")
    .get(messageId, userId, userId) as Row | undefined;
  if (!message) throw notFound();

  const exists = db().prepare("SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").get(messageId, userId, emoji);
  if (exists) db().prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").run(messageId, userId, emoji);
  else db().prepare("INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)").run(messageId, userId, emoji, nowIso());

  const reactions = reactionsFor([messageId], userId).get(messageId) ?? [];
  const payload = { conversationId: message.conversation_id, messageId, reactions };
  const hub = context().hub;
  hub.toUser(message.buyer_id, "message:reaction", payload);
  hub.toUser(message.seller_id, "message:reaction", payload);
  return reactions;
}

/** Marks the other person's messages as read and tells them when it happened. */
export function markRead(userId: string, conversationId: string): { updated: number } {
  const conversation = participantConversation(userId, conversationId);
  const readAt = nowIso();
  const result = db().prepare("UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL")
    .run(readAt, conversationId, userId);
  if (result.changes > 0) context().hub.toUser(otherId(conversation, userId), "message:read", { conversationId, readAt });
  return { updated: result.changes };
}

/** Someone is typing or recording; relayed only to the other participant and not stored. */
export function typing(userId: string, conversationId: string, state: "typing" | "recording" = "typing"): void {
  const conversation = participantConversation(userId, conversationId);
  context().hub.toUser(otherId(conversation, userId), "message:typing", { conversationId, userId, state });
}

/** The user's conversations, newest first, with the other person, last message and unread count. */
export function listConversations(userId: string) {
  const rows = db().prepare(`
    SELECT c.id, c.listing_id AS listingId, l.title AS listingTitle, l.status AS listingStatus,
           c.buyer_id AS buyerId, c.seller_id AS sellerId, c.updated_at AS updatedAt,
           o.first_name AS otherFirstName, o.last_name AS otherLastName, o.id AS otherId,
           (SELECT kind FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS lastKind,
           (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS lastBody,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> ? AND m.read_at IS NULL) AS unread
    FROM conversations c
    JOIN listings l ON l.id = c.listing_id
    JOIN users o ON o.id = CASE WHEN c.buyer_id = ? THEN c.seller_id ELSE c.buyer_id END
    WHERE c.buyer_id = ? OR c.seller_id = ?
    ORDER BY c.updated_at DESC LIMIT 200`).all(userId, userId, userId, userId) as Row[];

  const items = rows.map((r) => ({
    id: r.id,
    listingId: r.listingId,
    listingTitle: r.listingTitle,
    listingStatus: r.listingStatus,
    role: r.buyerId === userId ? "buyer" : "seller",
    other: { id: r.otherId, name: displayName(r.otherFirstName, r.otherLastName), initials: initialsFor(r.otherFirstName, r.otherLastName) },
    lastMessage: preview(r.lastKind, r.lastBody),
    unread: Number(r.unread),
    updatedAt: r.updatedAt,
  }));
  return { items, unreadCount: items.reduce((sum, c) => sum + c.unread, 0) };
}

/** Messages in a conversation, oldest first, newest page by default. */
export function listMessages(userId: string, conversationId: string, before?: string, limit = 50) {
  const conversation = participantConversation(userId, conversationId);
  const size = Math.min(Math.max(limit, 1), 100);
  const rows = (before
    ? db().prepare("SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?").all(conversationId, before, size)
    : db().prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?").all(conversationId, size)) as Row[];
  const reactions = reactionsFor(rows.map((r) => r.id), userId);
  const listing = db().prepare("SELECT title, status FROM listings WHERE id = ?").get(conversation.listing_id) as Row;
  const other = db().prepare("SELECT id, first_name, last_name FROM users WHERE id = ?").get(otherId(conversation, userId)) as Row;
  return {
    conversationId,
    listingId: conversation.listing_id,
    listingTitle: listing.title,
    listingStatus: listing.status,
    role: conversation.buyer_id === userId ? "buyer" : "seller",
    other: { id: other.id, name: displayName(other.first_name, other.last_name), initials: initialsFor(other.first_name, other.last_name) },
    items: rows.reverse().map((r) => messageView(r, reactions.get(r.id) ?? [])),
  };
}
