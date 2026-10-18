import { Injectable } from "@nestjs/common";
import type { Server } from "socket.io";

/** Lets the service push events to a user's sockets without depending on the gateway. */
@Injectable()
export class MessageHub {
  private server?: Server;

  attach(server: Server): void {
    this.server = server;
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }
}
