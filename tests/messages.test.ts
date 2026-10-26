import type { Server } from "node:http";
import type { Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, connectSocket, dropTestDatabase, freshDatabase, once, register, startSocketServer, waitFor } from "./helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("Marketplace messages (REST + WebSocket)", () => {
  let server: Server;
  let url: string;
  const sockets: Socket[] = [];
  let seller: { token: string; user: { id: string } };
  let buyer: { token: string; user: { id: string } };
  let listingId: string;

  const connect = async (token: string) => {
    const socket = await connectSocket(url, token);
    sockets.push(socket);
    return socket;
  };

  const firstConversation = async (token: string) =>
    (await api("GET", "/api/conversations", { token })).body.items[0].id as string;

  const upload = (token: string, conversationId: string, buffer: Buffer, mime: string, filename: string) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
    return api("POST", `/api/conversations/${conversationId}/media`, { token, form });
  };

  beforeAll(async () => {
    freshDatabase("messages");
    ({ server, url } = await startSocketServer());

    seller = (await register("seller@example.com")).body;
    buyer = (await register("buyer@example.com")).body;
    const listing = await api("POST", "/api/listings", {
      token: seller.token,
      body: { title: "Desk lamp", description: "Works well", price: 15, category: "Home", condition: "Good", photos: [] },
    });
    listingId = listing.body.id;
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await new Promise((resolve) => server.close(resolve));
    await dropTestDatabase();
  });

  it("refuses a socket without a valid session", async () => {
    await expect(connect("not-a-real-token")).rejects.toThrow(/Sign in/);
  });

  it("starts a conversation over REST and delivers messages live to both people", async () => {
    const sellerSocket = await connect(seller.token);
    const buyerSocket = await connect(buyer.token);

    const started = await api("POST", `/api/listings/${listingId}/messages`, { token: buyer.token, body: { body: "Is it still available?" } });
    expect(started.status).toBe(201);
    const conversationId: string = started.body.conversationId;
    expect(conversationId).toBeTruthy();

    const received = waitFor<{ conversationId: string; message: { body: string } }>(
      sellerSocket, "message:new", (e) => e.message.body === "Can we meet nearby?",
    );
    const echoed = once<{ clientId: string; message: { body: string } }>(buyerSocket, "message:sent");
    buyerSocket.emit("message:send", { conversationId, body: "Can we meet nearby?", clientId: "c1" });

    expect((await received).message.body).toBe("Can we meet nearby?");
    expect((await echoed).clientId).toBe("c1");

    const inbox = await api("GET", "/api/conversations", { token: seller.token });
    expect(inbox.body.unreadCount).toBe(2);
    expect(inbox.body.items[0].other.name).toBe("Test U.");
  });

  it("tells the sender when the other person reads their messages", async () => {
    const sellerSocket = await connect(seller.token);
    const conversationId = await firstConversation(seller.token);
    const buyerSocket = await connect(buyer.token);

    const readEvent = once<{ conversationId: string; readAt: string }>(buyerSocket, "message:read");
    sellerSocket.emit("conversation:read", { conversationId });
    const event = await readEvent;
    expect(event.conversationId).toBe(conversationId);

    const inbox = await api("GET", "/api/conversations", { token: seller.token });
    expect(inbox.body.unreadCount).toBe(0);
  });

  it("keeps conversations private to their two participants", async () => {
    const outsider = (await register("outsider@example.com")).body;
    const conversationId = await firstConversation(seller.token);

    expect((await api("GET", `/api/conversations/${conversationId}/messages`, { token: outsider.token })).status).toBe(404);

    const outsiderSocket = await connect(outsider.token);
    const error = once<{ message: string }>(outsiderSocket, "message:error");
    outsiderSocket.emit("message:send", { conversationId, body: "hello", clientId: "x" });
    expect((await error).message).toMatch(/not found/i);
  });

  it("does not let a seller message their own listing", async () => {
    expect((await api("POST", `/api/listings/${listingId}/messages`, { token: seller.token, body: { body: "hi" } })).status).toBe(403);
  });

  it("limits how fast one socket can send", async () => {
    const conversationId = await firstConversation(buyer.token);
    const socket = await connect(buyer.token);
    const errors: string[] = [];
    socket.on("message:error", (e: { message: string }) => errors.push(e.message));
    for (let i = 0; i < 22; i++) socket.emit("message:send", { conversationId, body: `m${i}`, clientId: `m${i}` });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(errors.some((m) => /too quickly/.test(m))).toBe(true);
  });

  describe("photos, voice notes and reactions", () => {
    it("sends a photo live and lets only participants download it", async () => {
      const conversationId = await firstConversation(buyer.token);
      const sellerSocket = await connect(seller.token);
      const up = await upload(buyer.token, conversationId, PNG, "image/png", "lamp.png");
      expect(up.status).toBe(201);
      expect(up.body.kind).toBe("image");

      const received = once<{ message: { kind: string; media: { id: string } | null; body: string } }>(sellerSocket, "message:new");
      const buyerSocket = await connect(buyer.token);
      buyerSocket.emit("message:send", { conversationId, kind: "image", mediaId: up.body.mediaId, body: "Like this one", clientId: "img1" });
      const event = await received;
      expect(event.message.kind).toBe("image");
      expect(event.message.media?.id).toBe(up.body.mediaId);
      expect(event.message.body).toBe("Like this one");

      const download = await api("GET", `/api/media/${up.body.mediaId}`, { token: seller.token });
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toMatch(/image\/png/);
      const outsider = (await register("snoop@example.com")).body;
      expect((await api("GET", `/api/media/${up.body.mediaId}`, { token: outsider.token })).status).toBe(404);
    });

    it("refuses reuse, wrong types and unsupported files", async () => {
      const conversationId = await firstConversation(buyer.token);
      const up = await upload(buyer.token, conversationId, PNG, "image/png", "again.png");
      expect(up.status).toBe(201);
      const socket = await connect(buyer.token);

      const sent = once<{ clientId: string }>(socket, "message:sent");
      socket.emit("message:send", { conversationId, kind: "image", mediaId: up.body.mediaId, clientId: "r0" });
      expect((await sent).clientId).toBe("r0");

      const reused = once<{ message: string }>(socket, "message:error");
      socket.emit("message:send", { conversationId, kind: "image", mediaId: up.body.mediaId, clientId: "r1" });
      expect((await reused).message).toMatch(/already sent/);

      const asVoice = once<{ message: string }>(socket, "message:error");
      const fresh = await upload(buyer.token, conversationId, PNG, "image/png", "fresh.png");
      socket.emit("message:send", { conversationId, kind: "voice", mediaId: fresh.body.mediaId, clientId: "r2" });
      expect((await asVoice).message).toMatch(/does not match/);

      expect((await upload(buyer.token, conversationId, Buffer.from("MZ"), "application/x-msdownload", "evil.exe")).status).toBe(400);
    });

    it("sends a voice note with its duration", async () => {
      const conversationId = await firstConversation(buyer.token);
      const up = await upload(buyer.token, conversationId, Buffer.from("OggS-fake-audio"), "audio/ogg", "voice.ogg");
      expect(up.status).toBe(201);
      expect(up.body.kind).toBe("voice");

      const sellerSocket = await connect(seller.token);
      const received = once<{ message: { kind: string; durationMs: number } }>(sellerSocket, "message:new");
      const socket = await connect(buyer.token);
      socket.emit("message:send", { conversationId, kind: "voice", mediaId: up.body.mediaId, durationMs: 4200, clientId: "v1" });
      const event = await received;
      expect(event.message.kind).toBe("voice");
      expect(event.message.durationMs).toBe(4200);
    });

    it("toggles one reaction per person and tells both participants", async () => {
      const conversationId = await firstConversation(buyer.token);
      const sellerSocket = await connect(seller.token);
      const buyerSocket = await connect(buyer.token);
      const history = (await api("GET", `/api/conversations/${conversationId}/messages`, { token: buyer.token })).body;
      const messageId: string = history.items[0].id;

      const first = once<{ messageId: string; reactions: { emoji: string; count: number; mine: boolean }[] }>(sellerSocket, "message:reaction");
      sellerSocket.emit("message:react", { messageId, emoji: "👍" });
      const added = await first;
      expect(added.reactions).toEqual([{ emoji: "👍", count: 1, mine: true }]);

      const removed = once<{ reactions: unknown[] }>(buyerSocket, "message:reaction");
      sellerSocket.emit("message:react", { messageId, emoji: "👍" });
      expect((await removed).reactions).toEqual([]);

      const error = once<{ message: string }>(sellerSocket, "message:error");
      sellerSocket.emit("message:react", { messageId, emoji: "💩" });
      expect((await error).message).toMatch(/not available/);
    });
  });
});
