import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Post, Put, Query,
} from "@nestjs/common";
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, Public } from "../common/auth";
import { notify } from "../common/domain";
import { author } from "../common/mappers";
import { newId, nowIso } from "../common/security";
import { DatabaseService } from "../database/database.module";
import { Row } from "../database/types";

export const POST_CATEGORIES = ["Saving Tips", "Budgeting", "Financial Goals", "Student Life", "General"];

const COMMUNITY_RULES = [
  "Be respectful: no harassment, insults or discrimination.",
  "Never post account numbers, balances or personal transaction details.",
  "Shared tips are personal experiences, not professional financial advice.",
  "Use the report button for content that breaks these rules; moderators review every report.",
];

class PostDto {
  @IsString() @IsNotEmpty() @MaxLength(140) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) content!: string;
  @IsIn(POST_CATEGORIES) category!: string;
}

class PostUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(140) title?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(4000) content?: string;
  @IsOptional() @IsIn(POST_CATEGORIES) category?: string;
}

class CommentDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) body!: string;
}

class ReportDto {
  @IsIn(["post", "comment"]) targetType!: string;
  @IsString() targetId!: string;
  @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

class ResolveDto {
  @IsBoolean() hideContent!: boolean;
}

/** SQL for a post with its author, reaction and reply counts. Placeholder 1 is the viewer id. */
const POST_SELECT = `
  SELECT p.*, u.first_name, u.last_name,
    (SELECT COUNT(*) FROM post_reactions r WHERE r.post_id = p.id) AS reaction_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.hidden = 0) AS reply_count,
    (SELECT COUNT(*) FROM post_reactions r WHERE r.post_id = p.id AND r.user_id = ?) AS viewer_reacted
  FROM posts p JOIN users u ON u.id = p.user_id`;

@Controller()
export class CommunityController {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  private postView(r: Row, viewer?: { id: string; role?: string }) {
    return {
      id: r.id,
      title: r.title,
      excerpt: String(r.content).slice(0, 160),
      content: r.content,
      category: r.category,
      author: author({ ...r, user_id: r.user_id }),
      createdAt: r.created_at,
      replyCount: r.reply_count,
      reactionCount: r.reaction_count,
      viewerReacted: !!r.viewer_reacted,
      isOwner: !!viewer && viewer.id === r.user_id,
      hidden: !!r.hidden,
    };
  }

  /** Hidden content is visible only to its author and to moderators. */
  private findPost(id: string, viewer?: { id: string; role?: string }): Row {
    const row = this.db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(viewer?.id ?? "", id) as Row | undefined;
    if (!row) throw new NotFoundException();
    if (row.hidden && !(viewer && (viewer.id === row.user_id || viewer.role === "moderator"))) throw new NotFoundException();
    return row;
  }

  private visibilityClause(viewer?: { id: string; role?: string }): { sql: string; params: unknown[] } {
    if (viewer?.role === "moderator") return { sql: "1 = 1", params: [] };
    return { sql: "(p.hidden = 0 OR p.user_id = ?)", params: [viewer?.id ?? ""] };
  }

  @Public()
  @Get("posts")
  list(
    @CurrentUser() viewer: { id: string; role?: string } | undefined,
    @Query("category") category?: string,
    @Query("q") q?: string,
    @Query("sort") sort = "popular",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    const vis = this.visibilityClause(viewer);
    const where = [vis.sql];
    const params: unknown[] = [viewer?.id ?? "", ...vis.params];
    if (category && category !== "All discussions") { where.push("p.category = ?"); params.push(category); }
    if (q?.trim()) {
      where.push("(LOWER(p.title) LIKE ? OR LOWER(p.content) LIKE ?)");
      const term = `%${q.trim().toLowerCase()}%`;
      params.push(term, term);
    }
    const order = sort === "recent" ? "p.created_at DESC" : "(reaction_count + reply_count) DESC, p.created_at DESC";
    const size = Math.min(50, Math.max(1, Number(pageSize) || 20));
    const offset = (Math.max(1, Number(page) || 1) - 1) * size;
    const base = `${POST_SELECT} WHERE ${where.join(" AND ")}`;
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM (${base})`).get(...params) as { n: number }).n;
    const rows = this.db.prepare(`${base} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, size, offset) as Row[];
    return { items: rows.map((r) => this.postView(r, viewer)), total };
  }

  /** The three most discussed posts of the last 7 days, ranked by real reactions and replies. */
  @Public()
  @Get("community/trending")
  trending(@CurrentUser() viewer: { id: string; role?: string } | undefined) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const vis = this.visibilityClause(viewer);
    const rows = this.db.prepare(`${POST_SELECT} WHERE ${vis.sql} AND p.created_at >= ?
      ORDER BY (reaction_count + reply_count) DESC, p.created_at DESC LIMIT 3`)
      .all(viewer?.id ?? "", ...vis.params, since) as Row[];
    return rows.map((r) => this.postView(r, viewer));
  }

  @Public()
  @Get("community/rules")
  rules() {
    return { rules: COMMUNITY_RULES };
  }

  @Post("posts")
  create(@CurrentUser() user: { id: string }, @Body() dto: PostDto) {
    const id = newId();
    this.db.prepare("INSERT INTO posts (id, user_id, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, user.id, dto.title.trim(), dto.content.trim(), dto.category, nowIso());
    return this.postView(this.findPost(id, user), user);
  }

  @Public()
  @Get("posts/:id")
  get(@CurrentUser() viewer: { id: string; role?: string } | undefined, @Param("id") id: string) {
    return this.postView(this.findPost(id, viewer), viewer);
  }

  /** Only the author edits a post. */
  @Patch("posts/:id")
  update(@CurrentUser() user: { id: string; role?: string }, @Param("id") id: string, @Body() dto: PostUpdateDto) {
    const post = this.findPost(id, user);
    if (post.user_id !== user.id) throw new ForbiddenException();
    this.db.prepare(`UPDATE posts SET title = COALESCE(?, title), content = COALESCE(?, content), category = COALESCE(?, category) WHERE id = ?`)
      .run(dto.title?.trim() ?? null, dto.content?.trim() ?? null, dto.category ?? null, id);
    return this.postView(this.findPost(id, user), user);
  }

  /** The author or a moderator deletes a post; its comments and reactions go with it. */
  @Delete("posts/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: { id: string; role?: string }, @Param("id") id: string) {
    const post = this.findPost(id, user);
    if (post.user_id !== user.id && user.role !== "moderator") throw new ForbiddenException();
    this.db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  }

  @Public()
  @Get("posts/:id/comments")
  comments(@CurrentUser() viewer: { id: string; role?: string } | undefined, @Param("id") id: string) {
    this.findPost(id, viewer);
    const rows = this.db.prepare(`
      SELECT c.*, u.first_name, u.last_name FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? AND c.hidden = 0 ORDER BY c.created_at`).all(id) as Row[];
    return rows.map((c) => this.commentView(c, viewer));
  }

  private commentView(c: Row, viewer?: { id: string }) {
    return {
      id: c.id, postId: c.post_id, body: c.body, createdAt: c.created_at,
      author: author({ ...c, user_id: c.user_id }), isOwner: !!viewer && viewer.id === c.user_id,
    };
  }

  @Post("posts/:id/comments")
  addComment(@CurrentUser() user: { id: string; firstName?: string }, @Param("id") id: string, @Body() dto: CommentDto) {
    const post = this.findPost(id, user);
    const commentId = newId();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO comments (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(commentId, id, user.id, dto.body.trim(), nowIso());
      notify(this.db, post.user_id, user.id, "community_reply", "New reply to your post", post.title, `/community/${id}`);
    })();
    const row = this.db.prepare(`SELECT c.*, u.first_name, u.last_name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(commentId) as Row;
    return this.commentView(row, user);
  }

  /** Only the author edits a comment. */
  @Patch("comments/:id")
  editComment(@CurrentUser() user: { id: string }, @Param("id") id: string, @Body() dto: CommentDto) {
    const c = this.db.prepare("SELECT user_id FROM comments WHERE id = ?").get(id) as { user_id: string } | undefined;
    if (!c) throw new NotFoundException();
    if (c.user_id !== user.id) throw new ForbiddenException();
    this.db.prepare("UPDATE comments SET body = ? WHERE id = ?").run(dto.body.trim(), id);
    const row = this.db.prepare(`SELECT c.*, u.first_name, u.last_name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(id) as Row;
    return this.commentView(row, user);
  }

  @Delete("comments/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeComment(@CurrentUser() user: { id: string; role?: string }, @Param("id") id: string) {
    const c = this.db.prepare("SELECT user_id FROM comments WHERE id = ?").get(id) as { user_id: string } | undefined;
    if (!c) throw new NotFoundException();
    if (c.user_id !== user.id && user.role !== "moderator") throw new ForbiddenException();
    this.db.prepare("DELETE FROM comments WHERE id = ?").run(id);
  }

  /** One active reaction per user and post; repeating the call is a no-op. */
  @Put("posts/:id/reaction")
  @HttpCode(HttpStatus.NO_CONTENT)
  react(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    const post = this.findPost(id, user);
    const inserted = this.db.prepare("INSERT OR IGNORE INTO post_reactions (post_id, user_id, created_at) VALUES (?, ?, ?)")
      .run(id, user.id, nowIso());
    if (inserted.changes > 0) {
      notify(this.db, post.user_id, user.id, "community_interaction", "Your post got a reaction", post.title, `/community/${id}`);
    }
  }

  @Delete("posts/:id/reaction")
  @HttpCode(HttpStatus.NO_CONTENT)
  unreact(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    this.findPost(id, user);
    this.db.prepare("DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?").run(id, user.id);
  }

  @Post("reports")
  report(@CurrentUser() user: { id: string }, @Body() dto: ReportDto) {
    const exists = dto.targetType === "post"
      ? this.db.prepare("SELECT 1 FROM posts WHERE id = ?").get(dto.targetId)
      : this.db.prepare("SELECT 1 FROM comments WHERE id = ?").get(dto.targetId);
    if (!exists) throw new NotFoundException();
    const id = newId();
    this.db.prepare("INSERT INTO reports (id, reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, user.id, dto.targetType, dto.targetId, dto.reason.trim(), nowIso());
    return { id, status: "open" };
  }

  @Get("reports")
  listReports(@CurrentUser() user: { role?: string }) {
    if (user.role !== "moderator") throw new ForbiddenException();
    return this.db.prepare("SELECT * FROM reports WHERE status = 'open' ORDER BY created_at").all();
  }

  @Post("reports/:id/resolve")
  resolve(@CurrentUser() user: { id: string; role?: string }, @Param("id") id: string, @Body() dto: ResolveDto) {
    if (user.role !== "moderator") throw new ForbiddenException();
    const report = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as Row | undefined;
    if (!report) throw new NotFoundException();
    this.db.transaction(() => {
      if (dto.hideContent) {
        const table = report.target_type === "post" ? "posts" : "comments";
        this.db.prepare(`UPDATE ${table} SET hidden = 1 WHERE id = ?`).run(report.target_id);
      }
      this.db.prepare("UPDATE reports SET status = ?, resolved_by = ? WHERE id = ?")
        .run(dto.hideContent ? "content_hidden" : "dismissed", user.id, id);
    })();
    return { id, status: dto.hideContent ? "content_hidden" : "dismissed" };
  }
}

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  private mapRow(r: Row) {
    return { id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: !!r.read, createdAt: r.created_at };
  }

  @Get()
  list(@CurrentUser() user: { id: string }, @Query("unreadOnly") unreadOnly?: string) {
    const rows = this.db.prepare(`SELECT * FROM notifications WHERE user_id = ?
      ${unreadOnly === "true" ? "AND read = 0" : ""} ORDER BY created_at DESC LIMIT 100`).all(user.id) as Row[];
    const unread = (this.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0").get(user.id) as { n: number }).n;
    return { items: rows.map((r) => this.mapRow(r)), unreadCount: unread };
  }

  @Post(":id/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    const r = this.db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").run(id, user.id);
    if (r.changes === 0) throw new NotFoundException();
  }

  @Post("read-all")
  @HttpCode(HttpStatus.NO_CONTENT)
  readAll(@CurrentUser() user: { id: string }) {
    this.db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(user.id);
  }
}
