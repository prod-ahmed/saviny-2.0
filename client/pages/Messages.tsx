import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { EmptyState, Icon, PageHeader, StateText } from "../components/ui";
import { apiUpload, ApiError, api } from "../lib/api";
import { mediaUrl } from "../lib/media";
import { enableNotifications, notificationPermission } from "../lib/notify";
import { timeAgo } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import { liveSocket, useLiveEvent, useLiveStatus } from "../lib/socket";

export const REACTION_CHOICES = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_VOICE_MS = 5 * 60 * 1000;
const PAGE = 50;

interface Conversation {
  id: string;
  listingId: string;
  listingTitle: string;
  listingStatus: string;
  role: "buyer" | "seller";
  other: { id: string; name: string; initials: string };
  lastMessage: string | null;
  unread: number;
  updatedAt: string;
}

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

interface ServerMessage {
  id: string;
  conversationId: string;
  senderId: string;
  kind: "text" | "image" | "voice";
  body: string;
  media: { id: string; mime: string; size: number } | null;
  durationMs: number | null;
  reactions: Reaction[];
  createdAt: string;
  readAt: string | null;
}

interface Thread {
  conversationId: string;
  listingId: string;
  listingTitle: string;
  listingStatus: string;
  role: "buyer" | "seller";
  other: { id: string; name: string; initials: string };
  items: ServerMessage[];
}

/** A message on screen: confirmed (has an id) or still on its way (has a clientId and a local preview). */
interface Bubble {
  key: string;
  id?: string;
  clientId?: string;
  kind: "text" | "image" | "voice";
  body: string;
  media: { id: string } | null;
  localUrl?: string;
  durationMs: number | null;
  reactions: Reaction[];
  createdAt: string;
  mine: boolean;
  readAt: string | null;
  status: "sending" | "sent" | "failed";
}

const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const formatDuration = (ms: number | null | undefined): string => {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const previewOf = (m: { kind: string; body: string }) => (m.kind === "image" ? "📷 Photo" : m.kind === "voice" ? "🎤 Voice message" : m.body);

export default function Messages() {
  const { id } = useParams();
  return id ? <ThreadView id={id} /> : <Inbox />;
}

function Inbox() {
  const navigate = useNavigate();
  const inbox = useApi<{ items: Conversation[]; unreadCount: number }>("/conversations");
  const live = useLiveStatus();
  const [permission, setPermission] = useState(notificationPermission());
  useLiveEvent("message:new", () => inbox.reload());
  useLiveEvent("message:read", () => inbox.reload());
  // Anything that arrived while the connection was down is fetched again on reconnect.
  useLiveEvent("connect", () => inbox.reload());

  const turnOn = async () => setPermission(await enableNotifications());

  return (
    <div className="content module-page">
      <PageHeader eyebrow="MARKETPLACE" title="Messages" description="Talk with buyers and sellers about listings. Photos, voice notes and reactions arrive instantly." />
      {!live && <p className="offline-banner" role="status">Live messages are paused. Reconnect to send and receive.</p>}
      {permission === "default" && (
        <div className="notify-banner">
          <span>Get a notification when a message arrives while Saviny is in the background.</span>
          <button className="secondary" onClick={turnOn}>Turn on notifications</button>
        </div>
      )}
      <StateText loading={inbox.loading} error={inbox.error} empty={!inbox.data} />
      {inbox.data && inbox.data.items.length === 0 && (
        <EmptyState title="No conversations yet" text="Open a listing and tap Contact seller to start a conversation." action="Browse marketplace" onAction={() => navigate("/marketplace")} />
      )}
      {inbox.data && inbox.data.items.length > 0 && (
        <section className="card conversation-list">
          {inbox.data.items.map((c) => (
            <Link key={c.id} to={`/messages/${c.id}`} className={`conversation-row ${c.unread > 0 ? "unread" : ""}`}>
              <span className="avatar blue">{c.other.initials}</span>
              <div>
                <strong>{c.other.name}</strong>
                <small>{c.role === "seller" ? "Buying from you" : "Selling to you"} · {c.listingTitle}{c.listingStatus !== "available" ? " (no longer available)" : ""}</small>
                <p>{c.lastMessage ?? "No messages yet"}</p>
              </div>
              <span className="conversation-meta">
                <small>{timeAgo(c.updatedAt)}</small>
                {c.unread > 0 && <b>{c.unread}</b>}
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

/** Loads a photo or voice note once and returns a URL the browser can play or show. */
function useMediaUrl(mediaId: string | undefined, localUrl: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(localUrl);
  useEffect(() => {
    if (localUrl) {
      setUrl(localUrl);
      return;
    }
    if (!mediaId) return;
    let active = true;
    mediaUrl(mediaId).then((u) => active && setUrl(u)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mediaId, localUrl]);
  return url;
}

function ImageBubble({ bubble, onOpen }: { bubble: Bubble; onOpen: (src: string) => void }) {
  const src = useMediaUrl(bubble.media?.id, bubble.localUrl);
  return src ? (
    <button className="bubble-photo" onClick={() => onOpen(src)} aria-label="Open photo">
      <img src={src} alt="Shared photo" />
    </button>
  ) : (
    <div className="bubble-photo placeholder">Loading photo…</div>
  );
}

function VoiceNote({ bubble }: { bubble: Bubble }) {
  const src = useMediaUrl(bubble.media?.id, bubble.localUrl);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const toggle = () => {
    const a = audio.current;
    if (!a || !src) return;
    if (a.paused) {
      void a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };
  return (
    <div className="voice-note">
      <button className="voice-play" onClick={toggle} aria-label={playing ? "Pause voice message" : "Play voice message"} disabled={!src}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="voice-track"><i style={{ width: `${progress}%` }} /></div>
      <small>{formatDuration(bubble.durationMs)}</small>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? (e.currentTarget.currentTime / e.currentTarget.duration) * 100 : 0)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
      />
    </div>
  );
}

function ThreadView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { user } = useSession();
  const userId = user?.id ?? "";
  const past = useApi<Thread>(`/conversations/${id}/messages`);
  const live = useLiveStatus();
  const [older, setOlder] = useState<ServerMessage[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState<"typing" | "recording" | null>(null);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  const lastTypingSent = useRef(0);
  const typingTimer = useRef<number | undefined>(undefined);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const cancelled = useRef(false);
  const clock = useRef<number | undefined>(undefined);

  const toBubble = (m: ServerMessage): Bubble => ({
    key: m.id,
    id: m.id,
    kind: m.kind,
    body: m.body,
    media: m.media ? { id: m.media.id } : null,
    durationMs: m.durationMs,
    reactions: m.reactions,
    createdAt: m.createdAt,
    mine: m.senderId === userId,
    readAt: m.readAt,
    status: "sent",
  });

  // Merge loaded history with anything that arrived while it was loading.
  useEffect(() => {
    if (!past.data) return;
    const loaded = [...older, ...past.data.items].map(toBubble);
    setBubbles((prev) => {
      const seen = new Set(loaded.map((b) => b.id));
      return [...loaded, ...prev.filter((b) => !b.id || !seen.has(b.id))];
    });
    // toBubble only depends on the signed-in user, which is stable for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past.data, id, older]);

  // Mark the other person's messages as read once the connection is up (it may not be when the page loads).
  useEffect(() => {
    if (!live || !past.data) return;
    if (past.data.items.some((m) => m.senderId !== userId && !m.readAt)) liveSocket()?.emit("conversation:read", { conversationId: id });
  }, [live, past.data, id, userId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [bubbles.length, typing]);

  useLiveEvent<{ conversationId: string; message: ServerMessage }>("message:new", ({ conversationId, message }) => {
    if (conversationId !== id) return;
    setBubbles((prev) => {
      if (prev.some((b) => b.id === message.id)) return prev.map((b) => (b.id === message.id ? toBubble(message) : b));
      return [...prev, toBubble(message)];
    });
    if (message.senderId !== userId) liveSocket()?.emit("conversation:read", { conversationId: id });
    // toBubble is pure for the signed-in user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  useLiveEvent<{ clientId: string; message: ServerMessage }>("message:sent", ({ clientId, message }) => {
    setBubbles((prev) => {
      // The server already pushed the confirmed message; drop the waiting copy instead of showing it twice.
      if (prev.some((b) => b.id === message.id)) return prev.filter((b) => b.clientId !== clientId);
      return prev.map((b) => (b.clientId === clientId ? toBubble(message) : b));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  useLiveEvent<{ clientId?: string; message: string }>("message:error", ({ clientId, message }) => {
    if (clientId) setBubbles((prev) => prev.map((b) => (b.clientId === clientId ? { ...b, status: "failed" } : b)));
    setError(message);
  });

  useLiveEvent<{ conversationId: string; readAt: string }>("message:read", ({ conversationId, readAt }) => {
    if (conversationId !== id) return;
    setBubbles((prev) => prev.map((b) => (b.mine && !b.readAt ? { ...b, readAt } : b)));
  });

  useLiveEvent<{ conversationId: string; messageId: string; reactions: Reaction[] }>("message:reaction", ({ conversationId, messageId, reactions }) => {
    if (conversationId !== id) return;
    setBubbles((prev) => prev.map((b) => (b.id === messageId ? { ...b, reactions } : b)));
  });

  useLiveEvent<{ conversationId: string; state?: "typing" | "recording" }>("message:typing", ({ conversationId, state }) => {
    if (conversationId !== id) return;
    setTyping(state ?? "typing");
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => setTyping(null), 3000);
  });

  useEffect(
    () => () => {
      window.clearTimeout(typingTimer.current);
      window.clearInterval(clock.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const emitTyping = (state: "typing" | "recording") => liveSocket()?.emit("message:typing", { conversationId: id, state });

  /** Puts a message on screen straight away, then sends it once its file (if any) is uploaded. */
  const addPending = (kind: Bubble["kind"], body: string, localUrl?: string, durationMs: number | null = null): string => {
    const clientId = newClientId();
    setBubbles((prev) => [
      ...prev,
      { key: clientId, clientId, kind, body, media: null, localUrl, durationMs, reactions: [], createdAt: new Date().toISOString(), mine: true, readAt: null, status: "sending" },
    ]);
    return clientId;
  };

  const failPending = (clientId: string, message: string) => {
    setBubbles((prev) => prev.map((b) => (b.clientId === clientId ? { ...b, status: "failed" } : b)));
    setError(message);
  };

  const sendOver = (payload: Record<string, unknown>, clientId: string) => {
    const socket = liveSocket();
    if (!socket) return failPending(clientId, "Connection required — nothing was saved.");
    socket.emit("message:send", { conversationId: id, clientId, ...payload });
  };

  const sendText = (e?: FormEvent) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body) return;
    if (!liveSocket()) {
      setError("Connection required — nothing was saved.");
      return;
    }
    setError("");
    const clientId = addPending("text", body);
    setDraft("");
    sendOver({ kind: "text", body }, clientId);
  };

  const sendFile = async (file: File, kind: "image" | "voice", caption: string, durationMs: number | null, localUrl: string) => {
    if (!liveSocket()) {
      setError("Connection required — nothing was saved.");
      return;
    }
    setError("");
    const clientId = addPending(kind, caption, localUrl, durationMs);
    try {
      const up = await apiUpload<{ mediaId: string }>(`/conversations/${id}/media`, file);
      sendOver({ kind, body: caption, mediaId: up.mediaId, durationMs: durationMs ?? undefined }, clientId);
    } catch (err) {
      failPending(clientId, err instanceof ApiError ? err.message : "The file could not be sent");
    }
  };

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Choose a photo");
    if (file.size > MAX_MEDIA_BYTES) return setError("Photos must be 10 MB or smaller");
    const caption = draft.trim();
    setDraft("");
    void sendFile(file, "image", caption, null, URL.createObjectURL(file));
  };

  const startRecording = async () => {
    if (!liveSocket()) return setError("Connection required — nothing was saved.");
    if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") return setError("Voice messages are not supported in this browser");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError("Allow microphone access to send voice messages");
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    cancelled.current = false;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled.current) return;
      const base = (rec.mimeType || "audio/webm").split(";")[0];
      const blob = new Blob(chunks.current, { type: base });
      const ext = base.includes("mp4") ? "m4a" : base.includes("ogg") ? "ogg" : "webm";
      const file = new File([blob], `voice-message.${ext}`, { type: base });
      void sendFile(file, "voice", "", Date.now() - startedAt.current, URL.createObjectURL(blob));
    };
    rec.start(250);
    recorder.current = rec;
    startedAt.current = Date.now();
    setSeconds(0);
    setRecording(true);
    emitTyping("recording");
    clock.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      setSeconds(Math.floor(elapsed / 1000));
      if (elapsed >= MAX_VOICE_MS) stopRecording(false);
    }, 250);
  };

  const stopRecording = (cancel: boolean) => {
    cancelled.current = cancel;
    window.clearInterval(clock.current);
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  };

  const toggleReaction = (messageId: string, emoji: string) => {
    setPicker(null);
    liveSocket()?.emit("message:react", { messageId, emoji });
  };

  const loadEarlier = async () => {
    const first = bubbles.find((b) => b.id);
    if (!first?.createdAt) return;
    setLoadingOlder(true);
    try {
      const page = await api<Thread>(`/conversations/${id}/messages?before=${encodeURIComponent(first.createdAt)}&limit=${PAGE}`);
      setOlder((prev) => [...page.items, ...prev]);
      if (page.items.length < PAGE) setHasMore(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Earlier messages could not be loaded");
    } finally {
      setLoadingOlder(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    const now = Date.now();
    if (value && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now;
      emitTyping("typing");
    }
  };

  if (past.error) return <div className="content module-page"><StateText loading={false} error={past.error} empty /></div>;
  if (!past.data) return <div className="content module-page"><StateText loading={past.loading} error="" empty /></div>;
  const thread = past.data;
  const canLoadMore = hasMore && past.data.items.length >= PAGE;

  return (
    <div className="content module-page thread-page">
      <div className="thread-head">
        <button className="secondary" onClick={() => navigate("/messages")}>← Inbox</button>
        <span className="avatar blue">{thread.other.initials}</span>
        <div>
          <strong>{thread.other.name}</strong>
          <small><Link to={`/marketplace/${thread.listingId}`}>{thread.listingTitle}</Link>{thread.listingStatus !== "available" ? " · no longer available" : ""}</small>
        </div>
        <span className={`live-dot ${live ? "on" : ""}`}>{live ? "Live" : "Reconnecting…"}</span>
      </div>

      <section className="card thread">
        {canLoadMore && (
          <button className="secondary load-earlier" onClick={loadEarlier} disabled={loadingOlder}>{loadingOlder ? "Loading…" : "Load earlier messages"}</button>
        )}
        {bubbles.length === 0 && <p className="muted-small">No messages yet. Say hello.</p>}
        {bubbles.map((b) => (
          <div key={b.key} className={`bubble-row ${b.mine ? "mine" : ""}`}>
            <div className="bubble-wrap">
              <div className={`bubble ${b.status === "failed" ? "failed" : ""} ${b.kind !== "text" ? "media" : ""}`}>
                {b.kind === "image" && <ImageBubble bubble={b} onOpen={setViewing} />}
                {b.kind === "voice" && <VoiceNote bubble={b} />}
                {b.body && <p>{b.body}</p>}
                <small>
                  {new Date(b.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  {b.mine && (
                    b.status === "sending" ? <span className="tick" title="Sending"> ◷</span>
                    : b.status === "failed" ? <span className="tick failed" title="Not sent"> ! Not sent</span>
                    : b.readAt ? <span className="tick read" title="Read"> ✓✓</span>
                    : <span className="tick" title="Sent"> ✓</span>
                  )}
                </small>
              </div>
              {b.id && (
                <div className="reaction-row">
                  {b.reactions.map((r) => (
                    <button key={r.emoji} className={`reaction-chip ${r.mine ? "mine" : ""}`} onClick={() => toggleReaction(b.id!, r.emoji)} aria-label={`${r.emoji} ${r.count}`}>
                      {r.emoji}{r.count > 1 ? ` ${r.count}` : ""}
                    </button>
                  ))}
                  <button className="reaction-add" onClick={() => setPicker(picker === b.id ? null : b.id!)} aria-label="React">☺</button>
                </div>
              )}
              {picker === b.id && (
                <div className="reaction-picker">
                  {REACTION_CHOICES.map((emoji) => (
                    <button key={emoji} onClick={() => toggleReaction(b.id!, emoji)} aria-label={`React ${emoji}`}>{emoji}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {typing && <p className="typing">{thread.other.name} is {typing === "recording" ? "recording a voice message" : "typing"}…</p>}
        <div ref={bottom} />
      </section>

      {error && <p className="auth-error" role="alert">{error}</p>}
      {recording ? (
        <div className="recording-bar">
          <span className="rec-dot" />
          <span>Recording {formatDuration(seconds * 1000)}</span>
          <button type="button" className="secondary" onClick={() => stopRecording(true)}>Cancel</button>
          <button type="button" className="primary" onClick={() => stopRecording(false)}><Icon name="arrow" size={17} /> Send</button>
        </div>
      ) : (
        <form className="thread-composer" onSubmit={sendText}>
          <label className={`icon-button attach ${live ? "" : "disabled"}`} aria-label="Attach photo">
            <Icon name="plus" size={18} />
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled={!live} onChange={onPickPhoto} />
          </label>
          <textarea
            aria-label="Message"
            rows={2}
            maxLength={1000}
            placeholder={live ? "Write a message…" : "Reconnecting… messages can't be sent right now"}
            value={draft}
            disabled={!live}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onKey}
          />
          {draft.trim() ? (
            <button className="primary" disabled={!live}><Icon name="arrow" size={17} /> Send</button>
          ) : (
            <button type="button" className="icon-button mic" aria-label="Record voice message" onClick={startRecording} disabled={!live}>🎤</button>
          )}
        </form>
      )}

      {viewing && (
        <div className="photo-viewer" role="dialog" aria-label="Photo" onClick={() => setViewing(null)}>
          <img src={viewing} alt="Shared photo" />
        </div>
      )}
    </div>
  );
}
