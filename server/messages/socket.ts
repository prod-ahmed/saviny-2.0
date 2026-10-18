import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { allowedOrigins, context } from "../context";
import { userFromToken } from "../http/session";
import { markRead, react, sendMessage, typing } from "./service";

const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 20;

type Payload = Record<string, unknown> | undefined;

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** At most RATE_LIMIT sends in RATE_WINDOW_MS per connection. */
function withinSendRate(sent: number[]): boolean {
  const now = Date.now();
  const recent = sent.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    sent.splice(0, sent.length, ...recent);
    return false;
  }
  recent.push(now);
  sent.splice(0, sent.length, ...recent);
  return true;
}

/**
 * Live direct messages for the marketplace. Each socket authenticates with its session token and
 * joins a private room, so events reach only the two people in a conversation.
 */
export function attachSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/api/socket.io",
    cors: { origin: allowedOrigins(), credentials: true },
  });
  context().hub.attach(io);

  // Runs before the connection opens: an unknown or revoked token never gets a socket.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const session = typeof token === "string" ? userFromToken(token) : null;
    if (!session) return next(new Error("Sign in to use messages"));
    socket.data.userId = session.user.id;
    socket.join(`user:${session.user.id}`);
    next();
  });

  io.on("connection", (socket: Socket) => {
    const userId: string = socket.data.userId;
    const sent: number[] = [];

    socket.on("message:send", (payload: Payload) => {
      const clientId = payload?.clientId;
      if (!withinSendRate(sent)) {
        socket.emit("message:error", { clientId, message: "You are sending messages too quickly" });
        return;
      }
      try {
        const message = sendMessage(userId, String(payload?.conversationId ?? ""), {
          kind: payload?.kind ?? "text",
          body: payload?.body,
          mediaId: payload?.mediaId,
          durationMs: payload?.durationMs,
        });
        socket.emit("message:sent", { clientId, message });
      } catch (err) {
        socket.emit("message:error", { clientId, message: errorText(err, "Message could not be sent") });
      }
    });

    socket.on("message:react", (payload: Payload) => {
      try {
        react(userId, String(payload?.messageId ?? ""), payload?.emoji);
      } catch (err) {
        socket.emit("message:error", { message: errorText(err, "Reaction could not be saved") });
      }
    });

    socket.on("conversation:read", (payload: Payload) => {
      try {
        markRead(userId, String(payload?.conversationId ?? ""));
      } catch {
        /* a read receipt for a conversation the user no longer has is ignored */
      }
    });

    socket.on("message:typing", (payload: Payload) => {
      try {
        typing(userId, String(payload?.conversationId ?? ""), payload?.state === "recording" ? "recording" : "typing");
      } catch {
        /* typing is best-effort */
      }
    });
  });

  return io;
}
