import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, dropTestDatabase, freshDatabase, register } from "./helpers";

const PASSWORD = "correct-horse-battery";
const today = () => new Date().toISOString().slice(0, 10);

async function category(token: string, name: string) {
  const res = await api("GET", "/api/categories", { token });
  return res.body.find((c: { name: string }) => c.name === name);
}

describe("Brixy API", () => {
  beforeAll(() => freshDatabase("api"));
  afterAll(() => dropTestDatabase());

  it("starts with no data and creates default categories on registration", async () => {
    const { body: { token } } = await register("fresh@example.com");
    const accounts = await api("GET", "/api/accounts", { token });
    expect(accounts.status).toBe(200);
    expect(accounts.body).toEqual([]);
    const categories = await api("GET", "/api/categories", { token });
    expect(categories.body.map((c: { name: string }) => c.name)).toContain("Food");
  });

  it("registers, logs in and revokes the session on logout", async () => {
    const { body: { token } } = await register("session@example.com");
    expect((await api("GET", "/api/auth/me", { token })).status).toBe(200);
    expect((await api("POST", "/api/auth/logout", { token })).status).toBe(204);
    expect((await api("GET", "/api/auth/me", { token })).status).toBe(401);

    const login = await api("POST", "/api/auth/login", { body: { email: "session@example.com", password: PASSWORD } });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe("session@example.com");
    expect(login.body.user).not.toHaveProperty("passwordHash");
  });

  it("rejects a wrong password with a generic message", async () => {
    await register("wrongpw@example.com");
    const res = await api("POST", "/api/auth/login", { body: { email: "wrongpw@example.com", password: "not-the-password" } });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("isolates one user's financial data from another", async () => {
    const { body: a } = await register("owner-a@example.com");
    const { body: b } = await register("owner-b@example.com");
    const account = await api("POST", "/api/accounts", { token: a.token, body: { name: "Private", type: "checking", initialBalance: 100 } });
    expect(account.status).toBe(201);
    const food = await category(a.token, "Food");
    const tx = await api("POST", "/api/transactions", {
      token: a.token, body: { type: "expense", amount: 20, date: today(), accountId: account.body.id, categoryId: food.id },
    });
    expect(tx.status).toBe(201);

    expect((await api("GET", `/api/transactions/${tx.body.id}`, { token: b.token })).status).toBe(404);
    expect((await api("GET", `/api/accounts/${account.body.id}`, { token: b.token })).status).toBe(404);
    const intruder = await api("POST", "/api/transactions", {
      token: b.token, body: { type: "expense", amount: 5, date: today(), accountId: account.body.id, categoryId: food.id },
    });
    expect(intruder.status).toBe(404);
  });

  it("derives balances from transactions", async () => {
    const { body: { token } } = await register("balance@example.com");
    const account = await api("POST", "/api/accounts", { token, body: { name: "Main", type: "checking", initialBalance: 1000 } });
    const food = await category(token, "Food");
    const salary = await category(token, "Income");
    expect((await api("POST", "/api/transactions", { token, body: { type: "income", amount: 500, date: today(), accountId: account.body.id, categoryId: salary.id } })).status).toBe(201);
    expect((await api("POST", "/api/transactions", { token, body: { type: "expense", amount: 120.5, date: today(), accountId: account.body.id, categoryId: food.id } })).status).toBe(201);

    const res = await api("GET", `/api/accounts/${account.body.id}`, { token });
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(1379.5);
  });

  it("calculates budget spending and flags an overrun", async () => {
    const { body: { token } } = await register("budget@example.com");
    const account = await api("POST", "/api/accounts", { token, body: { name: "Main", type: "checking", initialBalance: 500 } });
    const transport = await category(token, "Transport");
    await api("POST", "/api/transactions", { token, body: { type: "expense", amount: 100, date: today(), accountId: account.body.id, categoryId: transport.id } });
    const budget = await api("POST", "/api/budgets", {
      token, body: { name: "Transport", limit: 80, period: "monthly", categoryIds: [transport.id] },
    });

    expect(budget.status).toBe(201);
    expect(budget.body).toMatchObject({ spent: 100, remaining: 0, overBy: 20, status: "over" });
  });

  it("caps goal progress at 100% and never reports a negative remainder", async () => {
    const { body: { token } } = await register("goal@example.com");
    const goal = await api("POST", "/api/goals", { token, body: { title: "Laptop", targetAmount: 1000 } });
    const res = await api("POST", `/api/goals/${goal.body.id}/contributions`, { token, body: { amount: 1500, date: "2026-10-01" } });

    expect(res.status).toBe(201);
    expect(res.body.goal).toMatchObject({ savedAmount: 1500, progress: 100, remaining: 0 });
  });

  it("lets only the seller modify a listing", async () => {
    const { body: seller } = await register("seller@example.com");
    const { body: other } = await register("buyer@example.com");
    const listing = await api("POST", "/api/listings", {
      token: seller.token, body: { title: "Bike", description: "Good shape", price: 120, category: "Transport", condition: "Good" },
    });
    expect(listing.status).toBe(201);

    expect((await api("PATCH", `/api/listings/${listing.body.id}`, { token: other.token, body: { price: 1 } })).status).toBe(403);
    const updated = await api("PATCH", `/api/listings/${listing.body.id}`, { token: seller.token, body: { price: 110 } });
    expect(updated.status).toBe(200);
    expect(updated.body.price).toBe(110);
  });

  it("keeps one reaction per user on a post", async () => {
    const { body: author } = await register("author@example.com");
    const { body: reader } = await register("reader@example.com");
    const post = await api("POST", "/api/posts", { token: author.token, body: { title: "Tip", content: "Save first.", category: "Saving Tips" } });
    expect(post.status).toBe(201);

    expect((await api("PUT", `/api/posts/${post.body.id}/reaction`, { token: reader.token })).status).toBe(204);
    expect((await api("PUT", `/api/posts/${post.body.id}/reaction`, { token: reader.token })).status).toBe(204);
    const res = await api("GET", `/api/posts/${post.body.id}`, { token: reader.token });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reactionCount: 1, viewerReacted: true });
  });

  it("notifies the author of a reply and keeps notifications private", async () => {
    const { body: author } = await register("notify-author@example.com");
    const { body: replier } = await register("notify-replier@example.com");
    const post = await api("POST", "/api/posts", { token: author.token, body: { title: "Question", content: "How?", category: "General" } });
    expect((await api("POST", `/api/posts/${post.body.id}/comments`, { token: replier.token, body: { body: "Like this." } })).status).toBe(201);

    const mine = await api("GET", "/api/notifications", { token: author.token });
    expect(mine.status).toBe(200);
    expect(mine.body.unreadCount).toBe(1);
    const theirs = await api("GET", "/api/notifications", { token: replier.token });
    expect(theirs.body.unreadCount).toBe(0);
  });

  it("refuses unknown fields and bad values with a 400", async () => {
    const res = await api("POST", "/api/accounts", { token: (await register("strict@example.com")).body.token, body: { name: "X", type: "bank", initialBalance: 1, extra: true } });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.message)).toBe(true);
  });
});
