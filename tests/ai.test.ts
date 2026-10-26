import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, dropTestDatabase, freshDatabase, register } from "./helpers";

// The model is replaced with a stub: the tests check how Saviny reads and checks the answers, not the answers themselves.
const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateText }));
vi.mock("@ai-sdk/google", () => ({ google: () => ({ modelId: "stub" }) }));

describe("AI assistants", () => {
  let token: string;

  beforeAll(async () => {
    await freshDatabase("ai");
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
    token = (await register("ai@example.com")).body.token;
  });

  beforeEach(() => {
    generateText.mockReset();
  });

  afterAll(async () => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    await dropTestDatabase();
  });

  it("refuses AI requests without a session", async () => {
    const res = await api("GET", "/api/ai/profile/summary");
    expect(res.status).toBe(401);
  });

  it("says the assistant is not configured when no key is set", async () => {
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    try {
      const res = await api("GET", "/api/ai/profile/summary", { token });
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/not configured/);
      expect(generateText).not.toHaveBeenCalled();
    } finally {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = key;
    }
  });

  it("maps the model's category name to one of the user's own categories", async () => {
    generateText.mockResolvedValue({ output: { category: "food", confidence: "high" } });
    const categories = (await api("GET", "/api/categories", { token })).body;
    const food = categories.find((c: { name: string }) => c.name === "Food");

    const res = await api("POST", "/api/ai/finance/categorize", {
      token, body: { description: "Lunch at the canteen", type: "expense", amount: 8.5 },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ categoryId: food.id, categoryName: "Food", confidence: "high" });
  });

  it("returns no category rather than inventing one", async () => {
    generateText.mockResolvedValue({ output: { category: "Yachts", confidence: "low" } });
    const res = await api("POST", "/api/ai/finance/categorize", {
      token, body: { description: "Something odd", type: "expense" },
    });
    expect(res.body.categoryId).toBeNull();
  });

  it("refuses a scenario that is too short or unknown fields", async () => {
    expect((await api("POST", "/api/ai/finance/what-if", { token, body: { scenario: "" } })).status).toBe(400);
    expect((await api("POST", "/api/ai/finance/what-if", { token, body: { scenario: "buy a car", extra: 1 } })).status).toBe(400);
  });

  it("passes the what-if estimate through, with its checked shape", async () => {
    const estimate = {
      summary: "A rough estimate.", monthlyChange: -120, effects: [{ area: "Budget", effect: "Food spending rises." }], risks: ["Rent is tight."],
    };
    generateText.mockResolvedValue({ output: estimate });
    const res = await api("POST", "/api/ai/finance/what-if", { token, body: { scenario: "Move to a flat that costs 120 more" } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(estimate);
    expect(generateText.mock.calls[0][0].system).toMatch(/estimate/);
  });

  it("keeps the suggested price inside the range the model gave", async () => {
    generateText.mockResolvedValue({ output: { suggestedPrice: 500, low: 80, high: 60, reasoning: "Used prices." } });
    const res = await api("POST", "/api/ai/market/price", {
      token, body: { title: "Desk lamp", category: "Home", condition: "Good" },
    });
    expect(res.body).toEqual({ suggestedPrice: 80, low: 60, high: 80, reasoning: "Used prices." });
  });

  it("does not call the model when there is nothing to summarise", async () => {
    const res = await api("GET", "/api/ai/notifications/digest", { token });
    expect(res.body.digest).toBe("You have no unread notifications.");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("answers sign-in questions without a session and without any account data", async () => {
    generateText.mockResolvedValue({ text: "Try resetting your password from the login page." });
    const res = await api("POST", "/api/ai/auth/help", { body: { question: "I forgot my password" } });
    expect(res.status).toBe(201);
    expect(res.body.answer).toBe("Try resetting your password from the login page.");
    const prompt = generateText.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("I forgot my password");
    expect(prompt).not.toContain("ai@example.com");
  });
});
