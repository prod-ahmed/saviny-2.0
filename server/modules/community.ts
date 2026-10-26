import { z } from "zod";
import { context } from "../context";
import { author } from "../common/mappers";
import { forbidden, notFound } from "../common/errors";
import { notify, withAuthors } from "../common/domain";
import { removePost } from "../common/cascade";
import { newId, nowIso } from "../common/security";
import { escapeRegex, isDuplicateKey, type Filter, type Store } from "../database/store";
import type { Row } from "../database/types";
import { route, type Route } from "../http/types";
import { text } from "../http/schema";

export const POST_CATEGORIES = ["Saving Tips", "Budgeting", "Financial Goals", "Student Life", "General"] as const;

export const COMMUNITY_RULES = [
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

const db = async (): Promise<Store> => (await context()).store;

/** Number of documents per value of `key`. */
const countBy = (rows: Row[], key: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
  return counts;
};

/** Adds author names, reaction and reply counts, and whether the viewer reacted, to each post. */
async function enrich(store: Store, posts: Row[], viewerId?: string): Promise<Row[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const [reactions, replies, withNames] = await Promise.all([
    store.many("post_reactions", { post_id: { $in: ids } }),
    store.many("comments", { post_id: { $in: ids }, hidden: false }),
    withAuthors(store, posts),
  ]);
  const reactionCounts = countBy(reactions, "post_id");
  const replyCounts = countBy(replies, "post_id");
  const reacted = new Set(reactions.filter((r) => r.user_id === viewerId).map((r) => r.post_id));
  return withNames.map((p) => ({
    ...p,
    reaction_count: reactionCounts.get(p.id) ?? 0,
    reply_count: replyCounts.get(p.id) ?? 0,
    viewer_reacted: reacted.has(p.id),
  }));
}

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
async function findPost(store: Store, id: string, viewer: Viewer): Promise<Row> {
  const post = await store.one("posts", { id });
  if (!post) throw notFound();
  const [row] = await enrich(store, [post], viewer?.id);
  if (row.hidden && !(viewer && (viewer.id === row.user_id || viewer.role === "moderator"))) throw notFound();
  return row;
}

/** Hidden posts are listed only to their author and to moderators. */
function visibleTo(viewer: Viewer): Filter {
  if (viewer?.role === "moderator") return {};
  return { $or: [{ hidden: false }, { user_id: viewer?.id ?? "" }] };
}

/** Most discussed first (reactions plus replies), or newest first when asked for "recent". */
function rank(posts: Row[], sort: string | null): Row[] {
  const score = (p: Row) => p.reaction_count + p.reply_count;
  return [...posts].sort((a, b) => (sort === "recent"
    ? b.created_at.localeCompare(a.created_at)
    : score(b) - score(a) || b.created_at.localeCompare(a.created_at)));
}

function commentView(c: Row, viewer: Viewer) {
  return {
    id: c.id, postId: c.post_id, body: c.body, createdAt: c.created_at,
    author: author(c), isOwner: !!viewer && viewer.id === c.user_id,
  };
}

function notificationView(r: Row) {
  return { id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: !!r.read, createdAt: r.created_at };
}

export const communityRoutes: Route[] = [
  route("GET", "posts", async (ctx) => {
    const q = ctx.query;
    const store = await db();
    const conditions: Filter[] = [visibleTo(ctx.viewer)];
    const category = q.get("category");
    const search = q.get("q")?.trim();
    if (category && category !== "All discussions") conditions.push({ category });
    if (search) {
      const pattern = { $regex: escapeRegex(search), $options: "i" };
      conditions.push({ $or: [{ title: pattern }, { content: pattern }] });
    }
    const posts = await enrich(store, await store.many("posts", { $and: conditions }), ctx.viewer?.id);
    const ranked = rank(posts, q.get("sort"));
    const size = Math.min(50, Math.max(1, Number(q.get("pageSize") ?? 20) || 20));
    const offset = (Math.max(1, Number(q.get("page") ?? 1) || 1) - 1) * size;
    return { items: ranked.slice(offset, offset + size).map((r) => postView(r, ctx.viewer)), total: ranked.length };
  }, { public: true }),

  /** The three most discussed posts of the last 7 days, ranked by real reactions and replies. */
  route("GET", "community/trending", async (ctx) => {
    const store = await db();
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const recent = await store.many("posts", { $and: [visibleTo(ctx.viewer), { created_at: { $gte: since } }] });
    const posts = await enrich(store, recent, ctx.viewer?.id);
    return rank(posts, null).slice(0, 3).map((r) => postView(r, ctx.viewer));
  }, { public: true }),

  route("GET", "community/rules", () => ({ rules: COMMUNITY_RULES }), { public: true }),

  route("POST", "posts", async (ctx) => {
    const dto = await ctx.body(postSchema);
    const store = await db();
    const id = newId();
    await store.insert("posts", {
      id, user_id: ctx.user.id, title: dto.title.trim(), content: dto.content.trim(), category: dto.category, hidden: false, created_at: nowIso(),
    });
    return postView(await findPost(store, id, ctx.user), ctx.user);
  }),

  route("GET", "posts/:id", async (ctx) => postView(await findPost(await db(), ctx.params.id, ctx.viewer), ctx.viewer), { public: true }),

  /** Only the author edits a post. */
  route("PATCH", "posts/:id", async (ctx) => {
    const dto = await ctx.body(postUpdateSchema);
    const store = await db();
    const post = await findPost(store, ctx.params.id, ctx.user);
    if (post.user_id !== ctx.user.id) throw forbidden();
    const set: Row = {};
    if (dto.title !== undefined) set.title = dto.title.trim();
    if (dto.content !== undefined) set.content = dto.content.trim();
    if (dto.category !== undefined) set.category = dto.category;
    if (Object.keys(set).length > 0) await store.update("posts", { id: ctx.params.id }, set);
    return postView(await findPost(store, ctx.params.id, ctx.user), ctx.user);
  }),

  /** The author or a moderator deletes a post; its comments and reactions go with it. */
  route("DELETE", "posts/:id", async (ctx) => {
    const store = await db();
    const post = await findPost(store, ctx.params.id, ctx.user);
    if (post.user_id !== ctx.user.id && ctx.user.role !== "moderator") throw forbidden();
    await removePost(store, ctx.params.id);
  }, { status: 204 }),

  route("GET", "posts/:id/comments", async (ctx) => {
    const store = await db();
    await findPost(store, ctx.params.id, ctx.viewer);
    const comments = await store.many("comments", { post_id: ctx.params.id, hidden: false }, { sort: { created_at: 1 } });
    return (await withAuthors(store, comments)).map((c) => commentView(c, ctx.viewer));
  }, { public: true }),

  route("POST", "posts/:id/comments", async (ctx) => {
    const dto = await ctx.body(commentSchema);
    const store = await db();
    const post = await findPost(store, ctx.params.id, ctx.user);
    const commentId = newId();
    await store.insert("comments", {
      id: commentId, post_id: ctx.params.id, user_id: ctx.user.id, body: dto.body.trim(), hidden: false, created_at: nowIso(),
    });
    await notify(store, post.user_id, ctx.user.id, "community_reply", "New reply to your post", post.title, `/community/${ctx.params.id}`);
    const comment = (await store.one("comments", { id: commentId })) as Row;
    return commentView({ ...comment, first_name: ctx.user.firstName, last_name: ctx.user.lastName }, ctx.user);
  }),

  /** Only the author edits a comment. */
  route("PATCH", "comments/:id", async (ctx) => {
    const dto = await ctx.body(commentSchema);
    const store = await db();
    const c = await store.one("comments", { id: ctx.params.id });
    if (!c) throw notFound();
    if (c.user_id !== ctx.user.id) throw forbidden();
    const body = dto.body.trim();
    await store.update("comments", { id: ctx.params.id }, { body });
    const [named] = await withAuthors(store, [{ ...c, body }]);
    return commentView(named, ctx.user);
  }),

  route("DELETE", "comments/:id", async (ctx) => {
    const store = await db();
    const c = await store.one("comments", { id: ctx.params.id });
    if (!c) throw notFound();
    if (c.user_id !== ctx.user.id && ctx.user.role !== "moderator") throw forbidden();
    await store.remove("comments", { id: ctx.params.id });
  }, { status: 204 }),

  /** One active reaction per user and post; repeating the call is a no-op. */
  route("PUT", "posts/:id/reaction", async (ctx) => {
    const store = await db();
    const post = await findPost(store, ctx.params.id, ctx.user);
    try {
      await store.insert("post_reactions", { post_id: ctx.params.id, user_id: ctx.user.id, created_at: nowIso() });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      return;
    }
    await notify(store, post.user_id, ctx.user.id, "community_interaction", "Your post got a reaction", post.title, `/community/${ctx.params.id}`);
  }, { status: 204 }),

  route("DELETE", "posts/:id/reaction", async (ctx) => {
    const store = await db();
    await findPost(store, ctx.params.id, ctx.user);
    await store.remove("post_reactions", { post_id: ctx.params.id, user_id: ctx.user.id });
  }, { status: 204 }),

  route("POST", "reports", async (ctx) => {
    const dto = await ctx.body(reportSchema);
    const store = await db();
    const target = dto.targetType === "post"
      ? await store.one("posts", { id: dto.targetId })
      : await store.one("comments", { id: dto.targetId });
    if (!target) throw notFound();
    const id = newId();
    await store.insert("reports", {
      id, reporter_id: ctx.user.id, target_type: dto.targetType, target_id: dto.targetId, reason: dto.reason.trim(),
      status: "open", resolved_by: null, created_at: nowIso(),
    });
    return { id, status: "open" };
  }),

  route("GET", "reports", async (ctx) => {
    if (ctx.user.role !== "moderator") throw forbidden();
    return (await db()).many("reports", { status: "open" }, { sort: { created_at: 1 } });
  }),

  route("POST", "reports/:id/resolve", async (ctx) => {
    const dto = await ctx.body(resolveSchema);
    if (ctx.user.role !== "moderator") throw forbidden();
    const store = await db();
    const report = await store.one("reports", { id: ctx.params.id });
    if (!report) throw notFound();
    if (dto.hideContent) {
      const collection = report.target_type === "post" ? "posts" : "comments";
      await store.update(collection, { id: report.target_id }, { hidden: true });
    }
    const status = dto.hideContent ? "content_hidden" : "dismissed";
    await store.update("reports", { id: ctx.params.id }, { status, resolved_by: ctx.user.id });
    return { id: ctx.params.id, status };
  }),

  // Notifications
  route("GET", "notifications", async (ctx) => {
    const store = await db();
    const unreadOnly = ctx.query.get("unreadOnly") === "true";
    const filter = unreadOnly ? { user_id: ctx.user.id, read: false } : { user_id: ctx.user.id };
    const rows = await store.many("notifications", filter, { sort: { created_at: -1 }, limit: 100 });
    const unread = await store.count("notifications", { user_id: ctx.user.id, read: false });
    return { items: rows.map(notificationView), unreadCount: unread };
  }),

  route("POST", "notifications/:id/read", async (ctx) => {
    const matched = await (await db()).update("notifications", { id: ctx.params.id, user_id: ctx.user.id }, { read: true });
    if (matched === 0) throw notFound();
  }, { status: 204 }),

  route("POST", "notifications/read-all", async (ctx) => {
    await (await db()).update("notifications", { user_id: ctx.user.id }, { read: true });
  }, { status: 204 }),
];
