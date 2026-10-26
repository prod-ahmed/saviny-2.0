import type { Server } from "socket.io";

/** Lets services push events to a user's sockets without importing the socket server. */
export class MessageHub {
  private io?: Server;

  attach(io: Server): void {
    this.io = io;
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.io?.to(`user:${userId}`).emit(event, payload);
  }
}
