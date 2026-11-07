import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { PostForm } from "../components/forms";
import { AiPanel } from "../components/AiPanel";
import { Confirm, EmptyState, FormError, Icon, Modal, PageHeader, StateText } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import type { Comment, Post } from "../lib/types";

export default function Community() {
  const { id } = useParams();
  return id ? <Discussion id={id} /> : <Feed />;
}

function Feed() {
  const navigate = useNavigate();
  const [sort, setSort] = useState<"popular" | "recent">("popular");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const params = new URLSearchParams({ sort, pageSize: "20" });
  if (q.trim()) params.set("q", q.trim());
  const posts = useApi<{ items: Post[]; total: number }>(`/posts?${params}`);
  const trending = useApi<Post[]>("/community/trending");
  const rules = useApi<{ rules: string[] }>("/community/rules");

  return (
    <div className="content module-page">
      <PageHeader eyebrow="LEARN TOGETHER" title="Community" description="Share practical ideas without ever sharing private financial records automatically." action="Create a post" onAction={() => setCreating(true)} />
      <div className="community-toolbar">
        <div className="transaction-search"><Icon name="search" size={17} /><input aria-label="Search discussions" placeholder="Search discussions" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="module-tabs compact-tabs">
          <button className={sort === "popular" ? "active" : ""} onClick={() => setSort("popular")}>Popular</button>
          <button className={sort === "recent" ? "active" : ""} onClick={() => setSort("recent")}>Recent</button>
        </div>
      </div>
      <div className="community-layout">
        <section>
          <StateText loading={posts.loading} error={posts.error} empty={!posts.data} />
          {posts.data && posts.data.items.length === 0 && <EmptyState title="No discussions yet" text="Start the first conversation about saving, budgeting or your goals." action="Create a post" onAction={() => setCreating(true)} />}
          {(posts.data?.items ?? []).map((post) => (
            <button className="card feed-post" key={post.id} onClick={() => navigate(`/community/${post.id}`)}>
              <div className="feed-author">
                <span className="avatar peach">{post.author.initials}</span>
                <div><strong>{post.author.name}</strong><small>{timeAgo(post.createdAt)} · {post.category}</small></div>
              </div>
              <h3>{post.title}</h3>
              <p>{post.excerpt}</p>
              <div><span><Icon name="message" size={15} /> {post.replyCount} replies</span><span>♡ {post.reactionCount} reactions</span></div>
            </button>
          ))}
        </section>
        <aside className="card community-rules">
          <span><Icon name="users" /></span>
          <h3>Trending this week</h3>
          {(trending.data ?? []).length === 0 && <p>Nothing is trending yet. Discussions appear here as members reply and react.</p>}
          {(trending.data ?? []).map((post) => (
            <button className="trend-item" key={post.id} onClick={() => navigate(`/community/${post.id}`)}>
              <strong>{post.title}</strong><small>{post.replyCount} replies · ♡ {post.reactionCount}</small>
            </button>
          ))}
          <button className="text-link" onClick={() => setRulesOpen(true)}>Read community guidelines <Icon name="arrow" size={15} /></button>
        </aside>
      </div>
      {creating && <Modal title="Create a post" onClose={() => setCreating(false)}>
        <PostForm onSaved={() => { setCreating(false); posts.reload(); trending.reload(); }} onCancel={() => setCreating(false)} />
      </Modal>}
      {rulesOpen && <Modal title="Community guidelines" onClose={() => setRulesOpen(false)}>
        <ul className="rules-list">{(rules.data?.rules ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
      </Modal>}
    </div>
  );
}

function Discussion({ id }: { id: string }) {
  const navigate = useNavigate();
  const { user } = useSession();
  const post = useApi<Post>(`/posts/${id}`);
  const comments = useApi<Comment[]>(`/posts/${id}/comments`);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingPost, setEditingPost] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reported, setReported] = useState(false);
  const p = post.data;

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError("");
    try {
      await action();
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The change could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const toggleReaction = () => run(
    () => api(`/posts/${id}/reaction`, { method: p?.viewerReacted ? "DELETE" : "PUT" }),
    () => { post.reload(); },
  );

  const sendComment = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!body.trim()) return;
    run(() => api(`/posts/${id}/comments`, { method: "POST", json: { body: body.trim() } }), () => {
      setBody("");
      comments.reload();
      post.reload();
    });
  };

  const removeComment = (c: Comment) => run(() => api(`/comments/${c.id}`, { method: "DELETE" }), () => { comments.reload(); post.reload(); });

  const report = (targetType: "post" | "comment", targetId: string) => run(
    () => api("/reports", { method: "POST", json: { targetType, targetId, reason: reportReason.trim() } }),
    () => { setReporting(false); setReported(true); setReportReason(""); },
  );

  const [reportTarget, setReportTarget] = useState<{ type: "post" | "comment"; id: string } | null>(null);

  return (
    <div className="content module-page">
      <StateText loading={post.loading} error={post.error} empty={!p} />
      {p && <div className="discussion-detail">
        <article className="card post-detail">
          <div className="feed-author">
            <span className="avatar peach">{p.author.initials}</span>
            <div><strong>{p.author.name}</strong><small>{timeAgo(p.createdAt)} · {p.category}</small></div>
          </div>
          <h2>{p.title}</h2>
          <p>{p.content}</p>
          {error && <p className="auth-error" role="alert">{error}</p>}
          {reported && <p className="state-text">Thanks. A moderator will review this report.</p>}
          <div className="post-reactions">
            <button onClick={toggleReaction} disabled={busy} className={p.viewerReacted ? "liked-text" : ""}>{p.viewerReacted ? "♥" : "♡"} {p.reactionCount} reactions</button>
            <button><Icon name="message" size={15} /> {p.replyCount} replies</button>
            {p.isOwner ? <>
              <button onClick={() => setEditingPost(true)}>Edit</button>
              <button onClick={() => setConfirmPost(true)}>Delete</button>
            </> : <button onClick={() => { setReportTarget({ type: "post", id: p.id }); setReporting(true); }}>Report</button>}
          </div>
        </article>

        <section className="card">
          <AiPanel<{ summary: string; keyPoints: string[] }>
            title="Discussion summary"
            action="Summarise"
            run={() => api(`/ai/community/posts/${id}/summary`, { method: "POST" })}
            render={(result) => (
              <>
                <p>{result.summary}</p>
                {result.keyPoints.length > 0 && <ul>{result.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>}
              </>
            )}
          />
        </section>

        <section className="card comment-box">
          <h3>Replies</h3>
          <StateText loading={comments.loading} error={comments.error} empty={!comments.data} />
          {(comments.data ?? []).length === 0 && <p className="muted-small">No replies yet. Be the first to share something useful.</p>}
          {(comments.data ?? []).map((c) => (
            <div className="reply" key={c.id}>
              <span className="avatar blue">{c.author.initials}</span>
              <div>
                <strong>{c.author.name}</strong><small>{timeAgo(c.createdAt)}</small>
                <p>{c.body}</p>
                <div className="reply-actions">
                  {c.isOwner && <button onClick={() => removeComment(c)}>Delete</button>}
                  {!c.isOwner && user && <button onClick={() => { setReportTarget({ type: "comment", id: c.id }); setReporting(true); }}>Report</button>}
                </div>
              </div>
            </div>
          ))}
          <form onSubmit={sendComment} className="reply-form">
            <textarea aria-label="Reply" placeholder="Share a thoughtful reply..." maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
            <div><small>Never share private financial information.</small><button className="primary" disabled={busy || !body.trim()}>Post reply</button></div>
          </form>
          <button className="text-link" onClick={() => navigate("/community")}>Back to discussions</button>
        </section>

        {editingPost && <Modal title="Edit post" onClose={() => setEditingPost(false)}>
          <EditPost post={p} onSaved={() => { setEditingPost(false); post.reload(); }} onCancel={() => setEditingPost(false)} />
        </Modal>}
        {confirmPost && <Confirm title="Delete this post?" text="The post and its replies are removed for everyone." confirmLabel="Delete" busy={busy}
          onCancel={() => setConfirmPost(false)}
          onConfirm={() => run(() => api(`/posts/${id}`, { method: "DELETE" }), () => navigate("/community"))} />}
        {reporting && reportTarget && <Modal title="Report content" onClose={() => setReporting(false)}>
          <form className="flow-form" onSubmit={(e) => { e.preventDefault(); report(reportTarget.type, reportTarget.id); }}>
            <label>Why are you reporting this?<textarea required maxLength={300} value={reportReason} onChange={(e) => setReportReason(e.target.value)} placeholder="Describe the problem" /></label>
            <FormError message={error} />
            <div className="form-actions"><button type="button" className="secondary" onClick={() => setReporting(false)}>Cancel</button><button className="danger-button" disabled={busy}>Send report</button></div>
          </form>
        </Modal>}
      </div>}
    </div>
  );
}

function EditPost({ post, onSaved, onCancel }: { post: Post; onSaved: () => void; onCancel: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api(`/posts/${post.id}`, { method: "PATCH", json: { title: String(form.get("title")), content: String(form.get("content")) } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The post could not be saved");
      setBusy(false);
    }
  };
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Title<input required name="title" maxLength={140} defaultValue={post.title} /></label>
      <label>Content<textarea required name="content" maxLength={4000} defaultValue={post.content} /></label>
      <FormError message={error} />
      <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
    </form>
  );
}
