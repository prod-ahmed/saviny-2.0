import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseService } from "../database/database.module";
import { Row } from "../database/types";
import { newId, nowIso } from "../common/security";
import { notify } from "../common/domain";
import { MessageHub } from "./message.hub";
import { MEDIA_MAX_BYTES, REACTIONS, VOICE_MAX_MS, mediaKindFor } from "./media.rules";

export const MESSAGE_MAX_LENGTH = 1000;

export type MessageKind = "text" | "image" | "voice";

export interface SendInput {
  kind?: unknown;
  body?: unknown;
  mediaId?: unknown;
  durationMs?: unknown;
}

/** Trimmed text, or a 400 when empty or too long. Captions are optional, so this is only used for text. */
export function cleanBody(raw: unknown, required = true): string {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (required && !body) throw new BadRequestException("Message cannot be empty");
  if (body.length > MESSAGE_MAX_LENGTH) throw new BadRequestException(`Message must be ${MESSAGE_MAX_LENGTH} characters or fewer`);
  return body;
}

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/**
 * Buyer and seller conversations about a listing: text, photos, voice notes, reactions.
 * The REST endpoints and the WebSocket gateway both go through here, so the rules are the same.
 */
@Injectable()
export class MessagesService {
  private readonly mediaDir: string;

  constructor(private readonly database: DatabaseService, private readonly hub: MessageHub) {
    this.mediaDir = resolve(process.env.MEDIA_DIR ?? join(dirname(database.file), "media"));
    mkdirSync(this.mediaDir, { recursive: true });
  }

  private get db() {
    return this.database.db;
  }

  /** A conversation the user takes part in, or 404 (never reveals other people's threads). */
  private participantConversation(userId: string, conversationId: string): Row {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ? AND (buyer_id = ? OR seller_id = ?)")
      .get(conversationId, userId, userId) as Row | undefined;
    if (!row) throw new NotFoundException();
    return row;
  }

  private otherId(conversation: Row, userId: string): string {
    return conversation.buyer_id === userId ? conversation.seller_id : conversation.buyer_id;
  }

  /** Buyer starts (or continues) the conversation about a listing. Sellers cannot message their own listing. */
  startFromListing(user: { id: string }, listingId: string, input: SendInput): { conversationId: string; message: Record<string, unknown> } {
    const listing = this.db.prepare("SELECT * FROM listings WHERE id = ? AND status = 'available'").get(listingId) as Row | undefined;
    if (!listing) throw new NotFoundException();
    if (listing.user_id === user.id) throw new ForbiddenException("You cannot message your own listing");

    const existing = this.db.prepare("SELECT id FROM conversations WHERE listing_id = ? AND buyer_id = ?").get(listingId, user.id) as { id: string } | undefined;
    const conversationId = existing?.id ?? newId();
    if (!existing) {
      this.db.prepare("INSERT INTO conversations (id, listing_id, buyer_id, seller_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(conversationId, listingId, user.id, listing.user_id, nowIso(), nowIso());
    }
    const message = this.send(user.id, conversationId, input);
    return { conversationId, message };
  }

  /** Stores a message (text, image or voice), pushes it to both participants and notifies the other one if they have nothing unread. */
  send(senderId: string, conversationId: string, input: SendInput): Record<string, unknown> {
    const conversation = this.participantConversation(senderId, conversationId);
    const kind: MessageKind = input.kind === undefined ? "text" : (input.kind as MessageKind);
    if (!["text", "image", "voice"].includes(kind)) throw new BadRequestException("Unknown message type");

    let body = "";
    let mediaId: string | null = null;
    let durationMs: number | null = null;
    if (kind === "text") {
      body = cleanBody(input.body);
    } else {
      mediaId = this.attachable(senderId, conversationId, input.mediaId, kind);
      body = cleanBody(input.body, false);
      if (kind === "voice") {
        const ms = Number(input.durationMs);
        durationMs = Number.isFinite(ms) ? Math.min(Math.max(Math.round(ms), 0), VOICE_MAX_MS) : 0;
      }
    }

    const message = { id: newId(), conversation_id: conversationId, sender_id: senderId, kind, body, media_id: mediaId, duration_ms: durationMs, created_at: nowIso(), read_at: null };
    const recipientId = this.otherId(conversation, senderId);

    this.db.transaction(() => {
      this.db.prepare("INSERT INTO messages (id, conversation_id, sender_id, kind, body, media_id, duration_ms, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(message.id, conversationId, senderId, kind, body, mediaId, durationMs, message.created_at, null);
      this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(message.created_at, conversationId);
      const unreadFromSender = (this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id = ? AND read_at IS NULL")
        .get(conversationId, senderId) as { n: number }).n;
      if (unreadFromSender === 1) {
        const listing = this.db.prepare("SELECT title FROM listings WHERE id = ?").get(conversation.listing_id) as { title: string };
        const preview = kind === "image" ? "Sent a photo" : kind === "voice" ? "Sent a voice message" : body;
        notify(this.db, recipientId, senderId, "marketplace_message", `New message about ${listing.title}`, preview, `/messages/${conversationId}`);
      }
    })();

    const view = this.messageView(message, []);
    this.hub.toUser(senderId, "message:new", { conversationId, message: view });
    this.hub.toUser(recipientId, "message:new", { conversationId, message: view });
    return view;
  }

  /** Checks an uploaded file can be attached now: same conversation, same uploader, right type, not used before. */
  private attachable(senderId: string, conversationId: string, rawId: unknown, kind: "image" | "voice"): string {
    const mediaId = typeof rawId === "string" ? rawId : "";
    const media = this.db.prepare("SELECT * FROM media WHERE id = ? AND conversation_id = ? AND uploader_id = ?")
      .get(mediaId, conversationId, senderId) as Row | undefined;
    if (!media) throw new BadRequestException("Attachment not found");
    if (mediaKindFor(media.mime) !== kind) throw new BadRequestException("Attachment type does not match the message");
    const used = this.db.prepare("SELECT 1 FROM messages WHERE media_id = ?").get(mediaId);
    if (used) throw new BadRequestException("Attachment was already sent");
    return mediaId;
  }

  /** Stores an uploaded photo or voice note under a random id. Only participants can upload, and only the sender can attach it. */
  async uploadMedia(userId: string, conversationId: string, file: { buffer: Buffer; mimetype: string; size: number }) {
    this.participantConversation(userId, conversationId);
    const kind = mediaKindFor(file.mimetype);
    if (!kind) throw new BadRequestException("This file type is not supported");
    if (file.size > MEDIA_MAX_BYTES) throw new BadRequestException("File is larger than 10 MB");
    if (file.size === 0) throw new BadRequestException("File is empty");

    const id = newId();
    await writeFile(join(this.mediaDir, id), file.buffer);
    this.db.prepare("INSERT INTO media (id, conversation_id, uploader_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, conversationId, userId, file.mimetype, file.size, nowIso());
    return { mediaId: id, kind, mime: file.mimetype, size: file.size };
  }

  /** The stored file, if the user is one of the two people in its conversation. */
  mediaFile(userId: string, mediaId: string): { path: string; mime: string } {
    const row = this.db.prepare(`
      SELECT m.* FROM media m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = ? AND (c.buyer_id = ? OR c.seller_id = ?)`).get(mediaId, userId, userId) as Row | undefined;
    if (!row) throw new NotFoundException();
    return { path: join(this.mediaDir, row.id), mime: row.mime };
  }

  /** Adds or removes one reaction from one person; both participants are told the new totals. */
  react(userId: string, messageId: string, emoji: unknown): Reaction[] {
    if (typeof emoji !== "string" || !REACTIONS.includes(emoji)) throw new BadRequestException("That reaction is not available");
    const message = this.db.prepare("SELECT m.*, c.buyer_id, c.seller_id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ? AND (c.buyer_id = ? OR c.seller_id = ?)")
      .get(messageId, userId, userId) as Row | undefined;
    if (!message) throw new NotFoundException();

    const exists = this.db.prepare("SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").get(messageId, userId, emoji);
    if (exists) this.db.prepare("DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").run(messageId, userId, emoji);
    else this.db.prepare("INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)").run(messageId, userId, emoji, nowIso());

    const reactions = this.reactionsFor([messageId], userId).get(messageId) ?? [];
    const payload = { conversationId: message.conversation_id, messageId, reactions };
    this.hub.toUser(message.buyer_id, "message:reaction", payload);
    this.hub.toUser(message.seller_id, "message:reaction", payload);
    return reactions;
  }

  /** Marks the other person's messages as read and tells them when it happened. */
  markRead(userId: string, conversationId: string): { updated: number } {
    const conversation = this.participantConversation(userId, conversationId);
    const readAt = nowIso();
    const result = this.db.prepare("UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL")
      .run(readAt, conversationId, userId);
    if (result.changes > 0) this.hub.toUser(this.otherId(conversation, userId), "message:read", { conversationId, readAt });
    return { updated: result.changes };
  }

  /** Someone is typing or recording; relayed only to the other participant and not stored. */
  typing(userId: string, conversationId: string, state: "typing" | "recording" = "typing"): void {
    const conversation = this.participantConversation(userId, conversationId);
    this.hub.toUser(this.otherId(conversation, userId), "message:typing", { conversationId, userId, state });
  }

  /** The user's conversations, newest first, with the other person, last message and unread count. */
  listConversations(user: { id: string }) {
    const rows = this.db.prepare(`
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
      ORDER BY c.updated_at DESC LIMIT 200`).all(user.id, user.id, user.id, user.id) as Row[];

    const items = rows.map((r) => ({
      id: r.id,
      listingId: r.listingId,
      listingTitle: r.listingTitle,
      listingStatus: r.listingStatus,
      role: r.buyerId === user.id ? "buyer" : "seller",
      other: { id: r.otherId, name: `${r.otherFirstName} ${String(r.otherLastName).charAt(0)}.`, initials: `${String(r.otherFirstName).charAt(0)}${String(r.otherLastName).charAt(0)}` },
      lastMessage: this.preview(r.lastKind, r.lastBody),
      unread: Number(r.unread),
      updatedAt: r.updatedAt,
    }));
    return { items, unreadCount: items.reduce((sum, c) => sum + c.unread, 0) };
  }

  /** Messages in a conversation, oldest first, newest page by default. */
  listMessages(user: { id: string }, conversationId: string, before?: string, limit = 50) {
    const conversation = this.participantConversation(user.id, conversationId);
    const size = Math.min(Math.max(limit, 1), 100);
    const rows = (before
      ? this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?").all(conversationId, before, size)
      : this.db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?").all(conversationId, size)) as Row[];
    const reactions = this.reactionsFor(rows.map((r) => r.id), user.id);
    const listing = this.db.prepare("SELECT title, status FROM listings WHERE id = ?").get(conversation.listing_id) as Row;
    const other = this.db.prepare("SELECT id, first_name, last_name FROM users WHERE id = ?").get(this.otherId(conversation, user.id)) as Row;
    return {
      conversationId,
      listingId: conversation.listing_id,
      listingTitle: listing.title,
      listingStatus: listing.status,
      role: conversation.buyer_id === user.id ? "buyer" : "seller",
      other: { id: other.id, name: `${other.first_name} ${String(other.last_name).charAt(0)}.`, initials: `${String(other.first_name).charAt(0)}${String(other.last_name).charAt(0)}` },
      items: rows.reverse().map((r) => this.messageView(r, reactions.get(r.id) ?? [])),
    };
  }

  unreadCount(userId: string): number {
    return this.listConversations({ id: userId }).unreadCount;
  }

  /** Reactions for a set of messages, grouped by emoji, with whether the viewer reacted. */
  private reactionsFor(messageIds: string[], viewerId: string): Map<string, Reaction[]> {
    const result = new Map<string, Reaction[]>();
    if (messageIds.length === 0) return result;
    const marks = messageIds.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN (${marks}) ORDER BY created_at`)
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

  private preview(kind: string | null, body: string | null): string | null {
    if (kind === "image") return body ? `📷 ${body}` : "📷 Photo";
    if (kind === "voice") return "🎤 Voice message";
    return body ?? null;
  }

  private messageView(row: Row, reactions: Reaction[]) {
    const media = row.media_id ? (this.db.prepare("SELECT id, mime, size FROM media WHERE id = ?").get(row.media_id) as Row | undefined) : undefined;
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
}
