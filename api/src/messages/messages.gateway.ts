import { Logger } from "@nestjs/common";
import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { DatabaseService } from "../database/database.module";
import { userFromToken } from "../common/auth";
import { MessageHub } from "./message.hub";
import { MessagesService } from "./messages.service";

const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 20;

/**
 * Live direct messages for the marketplace. Each socket authenticates with its session token and
 * joins a private room, so events reach only the two people in a conversation.
 */
@WebSocketGateway({
  path: "/api/socket.io",
  cors: { origin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","), credentials: true },
})
export class MessagesGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(MessagesGateway.name);

  constructor(private readonly database: DatabaseService, private readonly hub: MessageHub, private readonly messages: MessagesService) {}

  /** Runs before the connection opens: an unknown or revoked token never gets a socket. */
  afterInit(server: Server): void {
    this.hub.attach(server);
    server.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      const session = typeof token === "string" ? userFromToken(this.database, token) : null;
      if (!session) return next(new Error("Sign in to use messages"));
      socket.data.userId = session.user.id;
      socket.data.sent = [] as number[];
      socket.join(`user:${session.user.id}`);
      next();
    });
  }

  @SubscribeMessage("message:send")
  send(@ConnectedSocket() client: Socket, @MessageBody() payload: Record<string, unknown>): void {
    const clientId = payload?.clientId;
    if (!this.allowed(client)) {
      client.emit("message:error", { clientId, message: "You are sending messages too quickly" });
      return;
    }
    try {
      const message = this.messages.send(client.data.userId, String(payload?.conversationId ?? ""), {
        kind: payload?.kind ?? "text",
        body: payload?.body,
        mediaId: payload?.mediaId,
        durationMs: payload?.durationMs,
      });
      client.emit("message:sent", { clientId, message });
    } catch (err) {
      client.emit("message:error", { clientId, message: err instanceof Error ? err.message : "Message could not be sent" });
    }
  }

  @SubscribeMessage("message:react")
  react(@ConnectedSocket() client: Socket, @MessageBody() payload: { messageId?: unknown; emoji?: unknown }): void {
    try {
      this.messages.react(client.data.userId, String(payload?.messageId ?? ""), payload?.emoji);
    } catch (err) {
      client.emit("message:error", { message: err instanceof Error ? err.message : "Reaction could not be saved" });
    }
  }

  @SubscribeMessage("conversation:read")
  read(@ConnectedSocket() client: Socket, @MessageBody() payload: { conversationId?: unknown }): void {
    try {
      this.messages.markRead(client.data.userId, String(payload?.conversationId ?? ""));
    } catch (err) {
      this.logger.debug(`read failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  @SubscribeMessage("message:typing")
  typing(@ConnectedSocket() client: Socket, @MessageBody() payload: { conversationId?: unknown; state?: unknown }): void {
    try {
      const state = payload?.state === "recording" ? "recording" : "typing";
      this.messages.typing(client.data.userId, String(payload?.conversationId ?? ""), state);
    } catch {
      /* typing is best-effort */
    }
  }

  /** At most RATE_LIMIT sends in RATE_WINDOW_MS per socket. */
  private allowed(client: Socket): boolean {
    const now = Date.now();
    const recent = (client.data.sent as number[]).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      client.data.sent = recent;
      return false;
    }
    recent.push(now);
    client.data.sent = recent;
    return true;
  }
}
