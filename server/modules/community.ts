import { z } from "zod";
import { context } from "../context";
import { author } from "../common/mappers";
import { forbidden, notFound } from "../common/errors";
import { notify } from "../common/domain";
import { newId, nowIso } from "../common/security";
import type { Row } from "../database/types";
import { route, type Route } from "../http/types";
import { text } from "../http/schema";

export const POST_CATEGORIES = ["Saving Tips", "Budgeting", "Financial Goals", "Student Life", "General"] as const;

const COMMUNITY_RULES = [
  "Be respectful: no harassment, insults or discrimination.",
  "Never post account numbers, balances or personal transaction details.",
  "Shared tips are personal experiences, not professional financial advice.",
  "Use the report button for content that breaks these rules; moderators review every report.",
];

const postSchema = z.object({
  title: text(140),
  content: text(4000),
  category: z.enum(POST_CATEGORIES),
}).strict();

const postUpdateSchema = z.object({
  title: text(140).optional(),
  content: text(4000).optional(),
  category: z.enum(POST_CATEGORIES).optional(),
}).strict();

const commentSchema = z.object({ body: text(2000) }).strict();

const reportSchema = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: z.string(),
  reason: text(300),
}).strict();

const resolveSchema = z.object({ hideContent: z.boolean() }).strict();

type Viewer = { id: string; role?: string } | null;

/** SQL for a post with its author, reaction and reply counts. Placeholder 1 is the viewer id. */
const POST_SELECT = `
  SELECT p.*, u.first_name, u.last_name,
    (SELECT COUNT(*) FROM post_reactions r WHERE r.post_id = p.id) AS reaction_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.hidden = 0) AS reply_count,
    (SELECT COUNT(*) FROM post_reactions r WHERE r.post_id = p.id AND r.user_id = ?) AS viewer_reacted
  FROM posts p JOIN users u ON u.id = p.user_id`;

const db = () => context().db;

function postView(r: Row, viewer: Viewer) {
  return {
    id: r.id,
    title: r.title,
    excerpt: String(r.content).slice(0, 160),
    content: r.content,
    category: r.category,
    author: author(r),
    createdAt: r.created_at,
    replyCount: r.reply_count,
    reactionCount: r.reaction_count,
    viewerReacted: !!r.viewer_reacted,
    isOwner: !!viewer && viewer.id === r.user_id,
    hidden: !!r.hidden,
  };
}

/** Hidden content is visible only to its author and to moderators. */
function findPost(id: string, viewer: Viewer): Row {
  const row = db().prepare(`${POST_SELECT} WHERE p.id = ?`).get(viewer?.id ?? "", id) as Row | undefined;
  if (!row) throw notFound();
  if (row.hidden && !(viewer && (viewer.id === row.user_id || viewer.role === "moderator"))) throw notFound();
  return row;
}

/** Hidden posts are listed only to their author and to moderators. */
function visibilityClause(viewer: Viewer): { sql: string; params: unknown[] } {
  if (viewer?.role === "moderator") return { sql: "1 = 1", params: [] };
  return { sql: "(p.hidden = 0 OR p.user_id = ?)", params: [viewer?.id ?? ""] };
}

function commentView(c: Row, viewer: Viewer) {
  return {
    id: c.id, postId: c.post_id, body: c.body, createdAt: c.created_at,
    author: author(c), isOwner: !!viewer && viewer.id === c.user_id,
  };
}

const COMMENT_SELECT = "SELECT c.*, u.first_name, u.last_name FROM comments c JOIN users u ON u.id = c.user_id";

function notificationView(r: Row) {
  return { id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: !!r.read, createdAt: r.created_at };
}

export const communityRoutes: Route[] = [
  route("GET", "posts", (ctx) => {
    const q = ctx.query;
    const viewer = ctx.viewer;
    const vis = visibilityClause(viewer);
    const where = [vis.sql];
    const params: unknown[] = [viewer?.id ?? "", ...vis.params];
    const category = q.get("category");
    const search = q.get("q")?.trim();
    if (category && category !== "All discussions") { where.push("p.category = ?"); params.push(category); }
    if (search) {
      where.push("(LOWER(p.title) LIKE ? OR LOWER(p.content) LIKE ?)");
      const term = `%${search.toLowerCase()}%`;
      params.push(term, term);
    }
    const order = q.get("sort") === "recent" ? "p.created_at DESC" : "(reaction_count + reply_count) DESC, p.created_at DESC";
    const size = Math.min(50, Math.max(1, Number(q.get("pageSize") ?? 20) || 20));
    const offset = (Math.max(1, Number(q.get("page") ?? 1) || 1) - 1) * size;
    const base = `${POST_SELECT} WHERE ${where.join(" AND ")}`;
    const total = (db().prepare(`SELECT COUNT(*) AS n FROM (${base})`).get(...params) as { n: number }).n;
    const rows = db().prepare(`${base} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, size, offset) as Row[];
    return { items: rows.map((r) => postView(r, viewer)), total };
  }, { public: true }),

  /** The three most discussed posts of the last 7 days, ranked by real reactions and replies. */
  route("GET", "community/trending", (ctx) => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const vis = visibilityClause(ctx.viewer);
    const rows = db().prepare(`${POST_SELECT} WHERE ${vis.sql} AND p.created_at >= ?
      ORDER BY (reaction_count + reply_count) DESC, p.created_at DESC LIMIT 3`)
      .all(ctx.viewer?.id ?? "", ...vis.params, since) as Row[];
    return rows.map((r) => postView(r, ctx.viewer));
  }, { public: true }),

  route("GET", "community/rules", () => ({ rules: COMMUNITY_RULES }), { public: true }),

  route("POST", "posts", async (ctx) => {
    const dto = await ctx.body(postSchema);
    const id = newId();
    db().prepare("INSERT INTO posts (id, user_id, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, ctx.user.id, dto.title.trim(), dto.content.trim(), dto.category, nowIso());
    return postView(findPost(id, ctx.user), ctx.user);
  }),

  route("GET", "posts/:id", (ctx) => postView(findPost(ctx.params.id, ctx.viewer), ctx.viewer), { public: true }),

  /** Only the author edits a post. */
  route("PATCH", "posts/:id", async (ctx) => {
    const dto = await ctx.body(postUpdateSchema);
    const post = findPost(ctx.params.id, ctx.user);
    if (post.user_id !== ctx.user.id) throw forbidden();
    db().prepare("UPDATE posts SET title = COALESCE(?, title), content = COALESCE(?, content), category = COALESCE(?, category) WHERE id = ?")
      .run(dto.title?.trim() ?? null, dto.content?.trim() ?? null, dto.category ?? null, ctx.params.id);
    return postView(findPost(ctx.params.id, ctx.user), ctx.user);
  }),

  /** The author or a moderator deletes a post; its comments and reactions go with it. */
  route("DELETE", "posts/:id", (ctx) => {
    const post = findPost(ctx.params.id, ctx.user);
    if (post.user_id !== ctx.user.id && ctx.user.role !== "moderator") throw forbidden();
    db().prepare("DELETE FROM posts WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  route("GET", "posts/:id/comments", (ctx) => {
    findPost(ctx.params.id, ctx.viewer);
    const rows = db().prepare(`${COMMENT_SELECT} WHERE c.post_id = ? AND c.hidden = 0 ORDER BY c.created_at`).all(ctx.params.id) as Row[];
    return rows.map((c) => commentView(c, ctx.viewer));
  }, { public: true }),

  route("POST", "posts/:id/comments", async (ctx) => {
    const dto = await ctx.body(commentSchema);
    const post = findPost(ctx.params.id, ctx.user);
    const commentId = newId();
    db().transaction(() => {
      db().prepare("INSERT INTO comments (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(commentId, ctx.params.id, ctx.user.id, dto.body.trim(), nowIso());
      notify(db(), post.user_id, ctx.user.id, "community_reply", "New reply to your post", post.title, `/community/${ctx.params.id}`);
    })();
    return commentView(db().prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(commentId) as Row, ctx.user);
  }),

  /** Only the author edits a comment. */
  route("PATCH", "comments/:id", async (ctx) => {
    const dto = await ctx.body(commentSchema);
    const c = db().prepare("SELECT user_id FROM comments WHERE id = ?").get(ctx.params.id) as { user_id: string } | undefined;
    if (!c) throw notFound();
    if (c.user_id !== ctx.user.id) throw forbidden();
    db().prepare("UPDATE comments SET body = ? WHERE id = ?").run(dto.body.trim(), ctx.params.id);
    return commentView(db().prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(ctx.params.id) as Row, ctx.user);
  }),

  route("DELETE", "comments/:id", (ctx) => {
    const c = db().prepare("SELECT user_id FROM comments WHERE id = ?").get(ctx.params.id) as { user_id: string } | undefined;
    if (!c) throw notFound();
    if (c.user_id !== ctx.user.id && ctx.user.role !== "moderator") throw forbidden();
    db().prepare("DELETE FROM comments WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  /** One active reaction per user and post; repeating the call is a no-op. */
  route("PUT", "posts/:id/reaction", (ctx) => {
    const post = findPost(ctx.params.id, ctx.user);
    const inserted = db().prepare("INSERT OR IGNORE INTO post_reactions (post_id, user_id, created_at) VALUES (?, ?, ?)")
      .run(ctx.params.id, ctx.user.id, nowIso());
    if (inserted.changes > 0) {
      notify(db(), post.user_id, ctx.user.id, "community_interaction", "Your post got a reaction", post.title, `/community/${ctx.params.id}`);
    }
  }, { status: 204 }),

  route("DELETE", "posts/:id/reaction", (ctx) => {
    findPost(ctx.params.id, ctx.user);
    db().prepare("DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?").run(ctx.params.id, ctx.user.id);
  }, { status: 204 }),

  route("POST", "reports", async (ctx) => {
    const dto = await ctx.body(reportSchema);
    const exists = dto.targetType === "post"
      ? db().prepare("SELECT 1 FROM posts WHERE id = ?").get(dto.targetId)
      : db().prepare("SELECT 1 FROM comments WHERE id = ?").get(dto.targetId);
    if (!exists) throw notFound();
    const id = newId();
    db().prepare("INSERT INTO reports (id, reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, ctx.user.id, dto.targetType, dto.targetId, dto.reason.trim(), nowIso());
    return { id, status: "open" };
  }),

  route("GET", "reports", (ctx) => {
    if (ctx.user.role !== "moderator") throw forbidden();
    return db().prepare("SELECT * FROM reports WHERE status = 'open' ORDER BY created_at").all();
  }),

  route("POST", "reports/:id/resolve", async (ctx) => {
    const dto = await ctx.body(resolveSchema);
    if (ctx.user.role !== "moderator") throw forbidden();
    const report = db().prepare("SELECT * FROM reports WHERE id = ?").get(ctx.params.id) as Row | undefined;
    if (!report) throw notFound();
    db().transaction(() => {
      if (dto.hideContent) {
        const table = report.target_type === "post" ? "posts" : "comments";
        db().prepare(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(report.target_id);
      }
      db().prepare("UPDATE reports SET status = ?, resolved_by = ? WHERE id = ?")
        .run(dto.hideContent ? "content_hidden" : "dismissed", ctx.user.id, ctx.params.id);
    })();
    return { id: ctx.params.id, status: dto.hideContent ? "content_hidden" : "dismissed" };
  }),

  // Notifications
  route("GET", "notifications", (ctx) => {
    const unreadOnly = ctx.query.get("unreadOnly") === "true";
    const rows = db().prepare(`SELECT * FROM notifications WHERE user_id = ?
      ${unreadOnly ? "AND read = 0" : ""} ORDER BY created_at DESC LIMIT 100`).all(ctx.user.id) as Row[];
    const unread = (db().prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0").get(ctx.user.id) as { n: number }).n;
    return { items: rows.map(notificationView), unreadCount: unread };
  }),

  route("POST", "notifications/:id/read", (ctx) => {
    const r = db().prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(ctx.params.id, ctx.user.id);
    if (r.changes === 0) throw notFound();
  }, { status: 204 }),

  route("POST", "notifications/read-all", (ctx) => {
    db().prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(ctx.user.id);
  }, { status: 204 }),
];
