import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_FILE = join(mkdtempSync(join(tmpdir(), "saviny-msg-")), "test.db");
process.env.WEB_DIST = join(tmpdir(), "no-web-dist");
process.env.NODE_ENV = "test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require("../src/app.module");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { configureApp } = require("../src/app.setup");

const PASSWORD = "correct-horse-battery";

describe("Marketplace messages (REST + WebSocket)", () => {
  let app: INestApplication;
  let url: string;
  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const register = async (email: string) => {
    const res = await http().post("/api/auth/register").send({
      firstName: "Test", lastName: "User", email, password: PASSWORD, confirmPassword: PASSWORD,
    }).expect(201);
    return res.body as { token: string; user: { id: string } };
  };

  const connect = (token: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket = io(url, { path: "/api/socket.io", auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
      sockets.push(socket);
      socket.on("connect", () => resolve(socket));
      socket.on("connect_error", reject);
    });

  const once = <T>(socket: Socket, event: string): Promise<T> =>
    new Promise((resolve) => socket.once(event, resolve));

  let seller: { token: string; user: { id: string } };
  let buyer: { token: string; user: { id: string } };
  let listingId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0);
    const port = (app.getHttpServer().address() as { port: number }).port;
    url = `http://localhost:${port}`;

    seller = await register("seller@example.com");
    buyer = await register("buyer@example.com");
    const listing = await http().post("/api/listings").set(auth(seller.token)).send({
      title: "Desk lamp", description: "Works well", price: 15, category: "Home", condition: "Good", photos: [],
    }).expect(201);
    listingId = listing.body.id;
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app.close();
  });

  it("refuses a socket without a valid session", async () => {
    await expect(connect("not-a-real-token")).rejects.toThrow(/Sign in/);
  });

  it("starts a conversation over REST and delivers messages live to both people", async () => {
    const sellerSocket = await connect(seller.token);
    const buyerSocket = await connect(buyer.token);

    const started = await http().post(`/api/listings/${listingId}/messages`).set(auth(buyer.token))
      .send({ body: "Is it still available?" }).expect(201);
    const conversationId: string = started.body.conversationId;
    expect(conversationId).toBeTruthy();

    const received = once<{ conversationId: string; message: { body: string } }>(sellerSocket, "message:new");
    const echoed = once<{ clientId: string; message: { body: string } }>(buyerSocket, "message:sent");
    buyerSocket.emit("message:send", { conversationId, body: "Can we meet nearby?", clientId: "c1" });

    expect((await received).message.body).toBe("Can we meet nearby?");
    expect((await echoed).clientId).toBe("c1");

    const inbox = await http().get("/api/conversations").set(auth(seller.token)).expect(200);
    expect(inbox.body.unreadCount).toBe(2);
    expect(inbox.body.items[0].other.name).toBe("Test U.");
  });

  it("tells the sender when the other person reads their messages", async () => {
    const sellerSocket = await connect(seller.token);
    const conversationId = (await http().get("/api/conversations").set(auth(seller.token))).body.items[0].id;
    const buyerSocket = await connect(buyer.token);

    const readEvent = once<{ conversationId: string; readAt: string }>(buyerSocket, "message:read");
    sellerSocket.emit("conversation:read", { conversationId });
    const event = await readEvent;
    expect(event.conversationId).toBe(conversationId);

    const inbox = await http().get("/api/conversations").set(auth(seller.token)).expect(200);
    expect(inbox.body.unreadCount).toBe(0);
  });

  it("keeps conversations private to their two participants", async () => {
    const outsider = await register("outsider@example.com");
    const conversationId = (await http().get("/api/conversations").set(auth(seller.token))).body.items[0].id;

    await http().get(`/api/conversations/${conversationId}/messages`).set(auth(outsider.token)).expect(404);

    const outsiderSocket = await connect(outsider.token);
    const error = once<{ message: string }>(outsiderSocket, "message:error");
    outsiderSocket.emit("message:send", { conversationId, body: "hello", clientId: "x" });
    expect((await error).message).toMatch(/not found/i);
  });

  it("does not let a seller message their own listing", async () => {
    await http().post(`/api/listings/${listingId}/messages`).set(auth(seller.token)).send({ body: "hi" }).expect(403);
  });

  it("limits how fast one socket can send", async () => {
    const conversationId = (await http().get("/api/conversations").set(auth(buyer.token))).body.items[0].id;
    const socket = await connect(buyer.token);
    const errors: string[] = [];
    socket.on("message:error", (e: { message: string }) => errors.push(e.message));
    for (let i = 0; i < 22; i++) socket.emit("message:send", { conversationId, body: `m${i}`, clientId: `m${i}` });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(errors.some((m) => /too quickly/.test(m))).toBe(true);
  });

  describe("photos, voice notes and reactions", () => {
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

    const upload = (token: string, conversationId: string, buffer: Buffer, mime: string, filename: string) =>
      http().post(`/api/conversations/${conversationId}/media`).set(auth(token)).attach("file", buffer, { filename, contentType: mime });

    const firstConversation = async (token: string) =>
      (await http().get("/api/conversations").set(auth(token)).expect(200)).body.items[0].id as string;

    it("sends a photo live and lets only participants download it", async () => {
      const conversationId = await firstConversation(buyer.token);
      const sellerSocket = await connect(seller.token);
      const up = await upload(buyer.token, conversationId, PNG, "image/png", "lamp.png").expect(201);
      expect(up.body.kind).toBe("image");

      const received = once<{ message: { kind: string; media: { id: string } | null; body: string } }>(sellerSocket, "message:new");
      const buyerSocket = await connect(buyer.token);
      buyerSocket.emit("message:send", { conversationId, kind: "image", mediaId: up.body.mediaId, body: "Like this one", clientId: "img1" });
      const event = await received;
      expect(event.message.kind).toBe("image");
      expect(event.message.media?.id).toBe(up.body.mediaId);
      expect(event.message.body).toBe("Like this one");

      const download = await http().get(`/api/media/${up.body.mediaId}`).set(auth(seller.token)).expect(200);
      expect(download.headers["content-type"]).toMatch(/image\/png/);
      const outsider = await register("snoop@example.com");
      await http().get(`/api/media/${up.body.mediaId}`).set(auth(outsider.token)).expect(404);
    });

    it("refuses reuse, wrong types and unsupported files", async () => {
      const conversationId = await firstConversation(buyer.token);
      const up = await upload(buyer.token, conversationId, PNG, "image/png", "again.png").expect(201);
      const socket = await connect(buyer.token);

      const sent = once<{ clientId: string }>(socket, "message:sent");
      socket.emit("message:send", { conversationId, kind: "image", mediaId: up.body.mediaId, clientId: "r0" });
      expect((await sent).clientId).toBe("r0");

      const reused = once<{ message: string }>(socket, "message:error");
      socket.emit("message:send", { conversationId, kind: "image", mediaId: up.body.mediaId, clientId: "r1" });
      expect((await reused).message).toMatch(/already sent/);

      const asVoice = once<{ message: string }>(socket, "message:error");
      const fresh = await upload(buyer.token, conversationId, PNG, "image/png", "fresh.png").expect(201);
      socket.emit("message:send", { conversationId, kind: "voice", mediaId: fresh.body.mediaId, clientId: "r2" });
      expect((await asVoice).message).toMatch(/does not match/);

      await upload(buyer.token, conversationId, Buffer.from("MZ"), "application/x-msdownload", "evil.exe").expect(400);
    });

    it("sends a voice note with its duration", async () => {
      const conversationId = await firstConversation(buyer.token);
      const up = await upload(buyer.token, conversationId, Buffer.from("OggS-fake-audio"), "audio/ogg", "voice.ogg").expect(201);
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
      const history = (await http().get(`/api/conversations/${conversationId}/messages`).set(auth(buyer.token)).expect(200)).body;
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
