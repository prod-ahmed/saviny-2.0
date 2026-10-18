import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_FILE = join(mkdtempSync(join(tmpdir(), "saviny-")), "test.db");
process.env.WEB_DIST = join(tmpdir(), "no-web-dist");
process.env.NODE_ENV = "test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require("../src/app.module");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { configureApp } = require("../src/app.setup");

const PASSWORD = "correct-horse-battery";
const today = () => new Date().toISOString().slice(0, 10);

describe("Saviny API (SQLite)", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const register = async (email: string) => {
    const res = await http().post("/api/auth/register").send({
      firstName: "Test", lastName: "User", email, password: PASSWORD, confirmPassword: PASSWORD,
    }).expect(201);
    return res.body as { token: string; user: { id: string } };
  };
  const category = async (token: string, name: string) =>
    (await http().get("/api/categories").set(auth(token)).expect(200)).body.find((c: { name: string }) => c.name === name);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("starts with no data and creates default categories on registration", async () => {
    const { token } = await register("fresh@example.com");
    const accounts = await http().get("/api/accounts").set(auth(token)).expect(200);
    expect(accounts.body).toEqual([]);
    const categories = await http().get("/api/categories").set(auth(token)).expect(200);
    expect(categories.body.map((c: { name: string }) => c.name)).toContain("Food");
  });

  it("registers, logs in and revokes the session on logout", async () => {
    const { token } = await register("session@example.com");
    await http().get("/api/auth/me").set(auth(token)).expect(200);
    await http().post("/api/auth/logout").set(auth(token)).expect(204);
    await http().get("/api/auth/me").set(auth(token)).expect(401);

    const login = await http().post("/api/auth/login").send({ email: "session@example.com", password: PASSWORD }).expect(200);
    expect(login.body.user.email).toBe("session@example.com");
    expect(login.body.user).not.toHaveProperty("passwordHash");
  });

  it("rejects a wrong password with a generic message", async () => {
    await register("wrongpw@example.com");
    const res = await http().post("/api/auth/login").send({ email: "wrongpw@example.com", password: "not-the-password" }).expect(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("isolates one user's financial data from another", async () => {
    const a = await register("owner-a@example.com");
    const b = await register("owner-b@example.com");
    const account = await http().post("/api/accounts").set(auth(a.token))
      .send({ name: "Private", type: "checking", initialBalance: 100 }).expect(201);
    const food = await category(a.token, "Food");
    const tx = await http().post("/api/transactions").set(auth(a.token)).send({
      type: "expense", amount: 20, date: today(), accountId: account.body.id, categoryId: food.id,
    }).expect(201);

    await http().get(`/api/transactions/${tx.body.id}`).set(auth(b.token)).expect(404);
    await http().get(`/api/accounts/${account.body.id}`).set(auth(b.token)).expect(404);
    await http().post("/api/transactions").set(auth(b.token)).send({
      type: "expense", amount: 5, date: today(), accountId: account.body.id, categoryId: food.id,
    }).expect(404);
  });

  it("derives balances from transactions", async () => {
    const { token } = await register("balance@example.com");
    const account = await http().post("/api/accounts").set(auth(token))
      .send({ name: "Main", type: "checking", initialBalance: 1000 }).expect(201);
    const food = await category(token, "Food");
    const salary = await category(token, "Income");
    await http().post("/api/transactions").set(auth(token)).send({ type: "income", amount: 500, date: today(), accountId: account.body.id, categoryId: salary.id }).expect(201);
    await http().post("/api/transactions").set(auth(token)).send({ type: "expense", amount: 120.5, date: today(), accountId: account.body.id, categoryId: food.id }).expect(201);

    const res = await http().get(`/api/accounts/${account.body.id}`).set(auth(token)).expect(200);
    expect(res.body.balance).toBe(1379.5);
  });

  it("calculates budget spending and flags an overrun", async () => {
    const { token } = await register("budget@example.com");
    const account = await http().post("/api/accounts").set(auth(token))
      .send({ name: "Main", type: "checking", initialBalance: 500 }).expect(201);
    const transport = await category(token, "Transport");
    await http().post("/api/transactions").set(auth(token)).send({
      type: "expense", amount: 100, date: today(), accountId: account.body.id, categoryId: transport.id,
    }).expect(201);
    const budget = await http().post("/api/budgets").set(auth(token)).send({
      name: "Transport", limit: 80, period: "monthly", categoryIds: [transport.id],
    }).expect(201);

    expect(budget.body).toMatchObject({ spent: 100, remaining: 0, overBy: 20, status: "over" });
  });

  it("caps goal progress at 100% and never reports a negative remainder", async () => {
    const { token } = await register("goal@example.com");
    const goal = await http().post("/api/goals").set(auth(token))
      .send({ title: "Laptop", targetAmount: 1000 }).expect(201);
    const res = await http().post(`/api/goals/${goal.body.id}/contributions`).set(auth(token))
      .send({ amount: 1500, date: "2026-10-01" }).expect(201);

    expect(res.body.goal).toMatchObject({ savedAmount: 1500, progress: 100, remaining: 0 });
  });

  it("lets only the seller modify a listing", async () => {
    const seller = await register("seller@example.com");
    const other = await register("buyer@example.com");
    const listing = await http().post("/api/listings").set(auth(seller.token)).send({
      title: "Bike", description: "Good shape", price: 120, category: "Transport", condition: "Good",
    }).expect(201);

    await http().patch(`/api/listings/${listing.body.id}`).set(auth(other.token)).send({ price: 1 }).expect(403);
    const updated = await http().patch(`/api/listings/${listing.body.id}`).set(auth(seller.token)).send({ price: 110 }).expect(200);
    expect(updated.body.price).toBe(110);
  });

  it("keeps one reaction per user on a post", async () => {
    const author = await register("author@example.com");
    const reader = await register("reader@example.com");
    const post = await http().post("/api/posts").set(auth(author.token))
      .send({ title: "Tip", content: "Save first.", category: "Saving Tips" }).expect(201);

    await http().put(`/api/posts/${post.body.id}/reaction`).set(auth(reader.token)).expect(204);
    await http().put(`/api/posts/${post.body.id}/reaction`).set(auth(reader.token)).expect(204);
    const res = await http().get(`/api/posts/${post.body.id}`).set(auth(reader.token)).expect(200);

    expect(res.body).toMatchObject({ reactionCount: 1, viewerReacted: true });
  });

  it("notifies the author of a reply and keeps notifications private", async () => {
    const author = await register("notify-author@example.com");
    const replier = await register("notify-replier@example.com");
    const post = await http().post("/api/posts").set(auth(author.token))
      .send({ title: "Question", content: "How?", category: "General" }).expect(201);
    await http().post(`/api/posts/${post.body.id}/comments`).set(auth(replier.token)).send({ body: "Like this." }).expect(201);

    const mine = await http().get("/api/notifications").set(auth(author.token)).expect(200);
    expect(mine.body.unreadCount).toBe(1);
    const theirs = await http().get("/api/notifications").set(auth(replier.token)).expect(200);
    expect(theirs.body.unreadCount).toBe(0);
  });
});
