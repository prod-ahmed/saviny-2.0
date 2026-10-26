import { z } from "zod";
import { context } from "../context";
import { badRequest, notFound } from "../common/errors";
import { owned, isoDate } from "../common/domain";
import { round2 } from "../common/security";
import { dashboardFor, goalView, listBudgetViews, nextOccurrence } from "../modules/finance";
import { COMMUNITY_RULES } from "../modules/community";
import { participantConversation } from "../messages/service";
import { CONDITIONS } from "../modules/market";
import { route, type Route } from "../http/types";
import { positiveMoney, text } from "../http/schema";
import { askObject, askText, AI_NOTICE, dataBlock, streamChat, UNTRUSTED_RULE } from "./model";

/*
 * Every AI feature, grouped by the module it belongs to. Paths start with "ai/" so they never
 * collide with the module routes. Each answer is checked against a schema, and the model only ever
 * sees the signed-in user's own data. Nothing an AI feature returns is saved: the user keeps the
 * final say, and every answer is shown next to AI_NOTICE in the browser.
 */

const AI_LIMIT = { max: 20, windowMs: 60_000 };
const FREQUENCIES = ["weekly", "monthly", "yearly"] as const;

const db = async () => (await context()).store;

/** Finances as plain text for the model: the same numbers the dashboard shows. */
async function financeText(userId: string, currency: string): Promise<string> {
  const d = await dashboardFor(await db(), userId, "this_month");
  const budgets = d.budgets.map((b) => `${b.name}: spent ${b.spent} of ${b.limit} (${b.status})`).join("\n") || "none";
  const goals = d.goals.map((g) => `${g.title}: saved ${g.savedAmount} of ${g.targetAmount}`).join("\n") || "none";
  const bills = d.upcomingBills.map((b) => `${b.name}: ${b.amount} due ${b.dueDate}`).join("\n") || "none";
  const top = d.byCategory.slice(0, 5).map((c) => `${c.name} ${c.amount}`).join(", ") || "none";
  return [
    `Currency: ${currency}`,
    `Balance: ${d.balance}`,
    `Income this month: ${d.income}`,
    `Expenses this month: ${d.expenses}`,
    `Top spending: ${top}`,
    dataBlock("budgets", budgets),
    dataBlock("goals", goals),
    dataBlock("upcoming bills", bills),
  ].join("\n");
}

const categoryNames = async (userId: string) =>
  (await (await db()).many("categories", { user_id: userId, archived: false })).map((c) => ({ id: c.id, name: c.name as string }));

/** Matches a name the model chose against the user's own categories, ignoring case. */
const findCategory = (list: { id: string; name: string }[], name: string) =>
  list.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

const isoOrToday = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : isoDate(new Date()));

const receiptTypes = ["image/jpeg", "image/png", "image/webp"];
const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;

export const aiRoutes: Route[] = [
  // ---- Finance: transactions --------------------------------------------------

  route("POST", "ai/finance/categorize", async (ctx) => {
    const dto = await ctx.body(z.object({
      description: text(120),
      type: z.enum(["income", "expense"]),
      amount: positiveMoney.optional(),
    }).strict());
    const categories = await categoryNames(ctx.user.id);
    const answer = await askObject({
      system: `You file personal finance transactions into the user's categories. Pick exactly one name from the list. ${UNTRUSTED_RULE}`,
      prompt: `Categories: ${categories.map((c) => c.name).join(", ")}\n${dataBlock("transaction", `${dto.type}, ${dto.amount ?? "unknown amount"}, ${dto.description}`)}`,
      schema: z.object({ category: z.string().max(40), confidence: z.enum(["low", "medium", "high"]) }),
    });
    const match = findCategory(categories, answer.category);
    return { categoryId: match?.id ?? null, categoryName: match?.name ?? null, confidence: answer.confidence };
  }, { limit: AI_LIMIT }),

  /** Reads a receipt photo. The result pre-fills the transaction form; the user checks it before saving. */
  route("POST", "ai/finance/receipt", async (ctx) => {
    const form = await ctx.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw badRequest("Choose a receipt photo");
    if (!receiptTypes.includes(file.type)) throw badRequest("Receipts must be JPEG, PNG or WebP photos");
    if (file.size > RECEIPT_MAX_BYTES) throw badRequest("The receipt photo must be 4 MB or smaller");
    const image = Buffer.from(await file.arrayBuffer());
    const categories = await categoryNames(ctx.user.id);
    const answer = await askObject({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `Read this receipt. Return the merchant, the purchase date as YYYY-MM-DD, the total paid, a short description and the best category from: ${categories.map((c) => c.name).join(", ")}. ${UNTRUSTED_RULE}` },
          { type: "image", image, mediaType: file.type },
        ],
      }],
      system: "You extract data from receipts. If a value is unreadable, return an empty string or 0.",
      schema: z.object({
        merchant: z.string().max(80),
        date: z.string().max(10),
        amount: z.number().min(0).max(10_000_000),
        description: z.string().max(120),
        category: z.string().max(40),
      }),
    });
    const match = findCategory(categories, answer.category);
    return {
      type: "expense",
      amount: round2(answer.amount),
      date: isoOrToday(answer.date),
      description: (answer.description || answer.merchant).slice(0, 120),
      categoryId: match?.id ?? null,
    };
  }, { limit: AI_LIMIT }),

  /** Looks through the last year of expenses for repeated payments. Each suggestion can be added as a recurring item. */
  route("GET", "ai/finance/subscriptions", async (ctx) => {
    const store = await db();
    const since = isoDate(new Date(Date.now() - 365 * 86_400_000));
    const expenses = (await store.many("transactions", { user_id: ctx.user.id, type: "expense", date: { $gte: since } }, { sort: { date: -1 }, limit: 400 }));
    if (expenses.length === 0) return { subscriptions: [] };
    const names = new Map((await store.many("categories", { user_id: ctx.user.id })).map((c) => [c.id, c.name]));
    const lines = expenses.map((t) => `${t.date} | ${t.amount} | ${t.description || "(no description)"} | ${names.get(t.category_id) ?? ""}`).join("\n");
    const answer = await askObject({
      system: `You detect recurring payments such as subscriptions, rent or memberships in a list of expenses. Only report payments that repeat at a regular interval. ${UNTRUSTED_RULE}`,
      prompt: dataBlock("expenses: date | amount | description | category", lines),
      schema: z.object({
        subscriptions: z.array(z.object({
          description: z.string().max(120),
          amount: z.number().min(0),
          frequency: z.enum(FREQUENCIES),
        })).max(10),
      }),
    });

    const result = [];
    for (const item of answer.subscriptions) {
      const last = expenses.find((t) => t.description?.toLowerCase() === item.description.toLowerCase() && Math.abs(t.amount - item.amount) < 0.01);
      if (!last) continue;
      result.push({
        description: last.description,
        amount: round2(last.amount),
        frequency: item.frequency,
        categoryId: last.category_id,
        accountId: last.account_id,
        lastDate: last.date,
        nextDate: nextOccurrence(last.date, item.frequency),
      });
    }
    return { subscriptions: result };
  }, { limit: AI_LIMIT }),

  // ---- Finance: dashboard -----------------------------------------------------

  /** Estimates what a scenario would do to the budget and goals. Changes nothing. */
  route("POST", "ai/finance/what-if", async (ctx) => {
    const dto = await ctx.body(z.object({ scenario: text(500) }).strict());
    const finances = await financeText(ctx.user.id, ctx.user.currency);
    return askObject({
      system: `You estimate the effect of a money scenario on a personal budget. Give rough estimates, not advice, and say so in the summary. ${UNTRUSTED_RULE}`,
      prompt: `${dataBlock("scenario", dto.scenario)}\n${finances}`,
      schema: z.object({
        summary: z.string().max(500),
        monthlyChange: z.number(),
        effects: z.array(z.object({ area: z.string().max(40), effect: z.string().max(200) })).max(6),
        risks: z.array(z.string().max(200)).max(5),
      }),
    });
  }, { limit: AI_LIMIT }),

  // ---- Budgets and bills ------------------------------------------------------

  route("GET", "ai/budgets/insights", async (ctx) => {
    const store = await db();
    const budgets = await listBudgetViews(store, ctx.user.id);
    const bills = await store.many("bills", { user_id: ctx.user.id, status: "upcoming" }, { sort: { due_date: 1 }, limit: 10 });
    if (budgets.length === 0 && bills.length === 0) {
      return { headline: "Create a budget or add a bill to get insights.", tips: [] };
    }
    const budgetLines = budgets.map((b) => `${b.name}: spent ${b.spent} of ${b.limit} (${b.status}), ${b.percent}% used`).join("\n") || "none";
    const billLines = bills.map((b) => `${b.name}: ${b.amount} due ${b.due_date}`).join("\n") || "none";
    return askObject({
      system: `You review a user's budgets and upcoming bills and point out what needs attention. Never suggest a payment will be made automatically. ${UNTRUSTED_RULE}`,
      prompt: `Currency: ${ctx.user.currency}\n${dataBlock("budgets", budgetLines)}\n${dataBlock("upcoming bills", billLines)}`,
      schema: z.object({ headline: z.string().max(200), tips: z.array(z.string().max(200)).max(3) }),
    });
  }, { limit: AI_LIMIT }),

  // ---- Savings goals ----------------------------------------------------------

  route("POST", "ai/goals/:id/plan", async (ctx) => {
    const store = await db();
    const goal = await goalView(store, await owned(store, "goals", ctx.params.id, ctx.user.id));
    const monthsLeft = goal.targetDate ? Math.max(1, Math.ceil((Date.parse(goal.targetDate) - Date.now()) / (30 * 86_400_000))) : null;
    const answer = await askObject({
      system: `You help a user plan a savings goal. Base every number on the figures given. ${UNTRUSTED_RULE}`,
      prompt: `Currency: ${ctx.user.currency}\n${dataBlock("goal", [
        `title: ${goal.title}`,
        `target: ${goal.targetAmount}`,
        `saved so far: ${goal.savedAmount}`,
        `remaining: ${goal.remaining}`,
        `target date: ${goal.targetDate ?? "none"}`,
        `months left: ${monthsLeft ?? "unknown"}`,
        `contributions made: ${goal.contributionCount}`,
      ].join("\n"))}`,
      schema: z.object({
        monthlyTarget: z.number().min(0),
        milestones: z.array(z.string().max(160)).max(4),
        advice: z.string().max(400),
      }),
    });
    return { ...answer, monthlyTarget: round2(answer.monthlyTarget) };
  }, { limit: AI_LIMIT }),

  // ---- Marketplace ------------------------------------------------------------

  route("POST", "ai/market/description", async (ctx) => {
    const dto = await ctx.body(z.object({
      title: text(80),
      category: text(40),
      condition: z.enum(CONDITIONS),
      notes: z.string().max(300).optional(),
    }).strict());
    return askObject({
      system: `You write short, honest product descriptions for a second-hand marketplace. 1 to 2 sentences, no markdown, no price. ${UNTRUSTED_RULE}`,
      prompt: dataBlock("listing", `title: ${dto.title}\ncategory: ${dto.category}\ncondition: ${dto.condition}\nseller notes: ${dto.notes ?? "none"}`),
      schema: z.object({ description: z.string().max(400) }),
    });
  }, { limit: AI_LIMIT }),

  route("POST", "ai/market/price", async (ctx) => {
    const dto = await ctx.body(z.object({
      title: text(80),
      category: text(40),
      condition: z.enum(CONDITIONS),
      description: z.string().max(2000).optional(),
    }).strict());
    const answer = await askObject({
      system: `You estimate a fair resale price for a used item in ${ctx.user.currency}. Give a range and a short reason. ${UNTRUSTED_RULE}`,
      prompt: dataBlock("listing", `title: ${dto.title}\ncategory: ${dto.category}\ncondition: ${dto.condition}\ndescription: ${dto.description ?? "none"}`),
      schema: z.object({
        suggestedPrice: z.number().positive(),
        low: z.number().positive(),
        high: z.number().positive(),
        reasoning: z.string().max(300),
      }),
    });
    const low = Math.min(answer.low, answer.high);
    const high = Math.max(answer.low, answer.high);
    return {
      suggestedPrice: round2(Math.min(high, Math.max(low, answer.suggestedPrice))),
      low: round2(low),
      high: round2(high),
      reasoning: answer.reasoning,
    };
  }, { limit: AI_LIMIT }),

  // ---- Messages ---------------------------------------------------------------

  /** Three short replies for the signed-in person, based on the last messages of one conversation. */
  route("POST", "ai/messages/:id/replies", async (ctx) => {
    const store = await db();
    const conversation = await participantConversation(store, ctx.user.id, ctx.params.id);
    const listing = await store.one("listings", { id: conversation.listing_id });
    const recent = (await store.many("messages", { conversation_id: ctx.params.id }, { sort: { created_at: -1 }, limit: 12 })).reverse();
    if (recent.length === 0) throw notFound();
    const transcript = recent.map((m) => {
      const who = m.sender_id === ctx.user.id ? "Me" : "Them";
      const content = m.kind === "text" ? m.body : m.kind === "image" ? "[photo]" : "[voice message]";
      return `${who}: ${content}`;
    }).join("\n");
    const answer = await askObject({
      system: `You suggest three short, polite replies for a marketplace chat, written as "Me". Keep them under 200 characters each. ${UNTRUSTED_RULE}`,
      prompt: `Item: ${listing?.title ?? "unknown"}\n${dataBlock("conversation", transcript)}`,
      schema: z.object({ replies: z.array(z.string().max(200)).length(3) }),
    });
    return answer;
  }, { limit: AI_LIMIT }),

  // ---- Community --------------------------------------------------------------

  /** Checks a draft post against the community rules before it is published. Warns only; the user decides. */
  route("POST", "ai/community/draft-check", async (ctx) => {
    const dto = await ctx.body(z.object({
      title: text(140),
      content: text(4000),
      category: z.string().max(40),
    }).strict());
    return askObject({
      system: `You check a community post against house rules and flag any breach. Be brief. ${UNTRUSTED_RULE}`,
      prompt: `Rules:\n${COMMUNITY_RULES.map((r) => `- ${r}`).join("\n")}\n${dataBlock("draft", `title: ${dto.title}\n${dto.content}`)}`,
      schema: z.object({
        issues: z.array(z.object({ rule: z.string().max(200), message: z.string().max(200) })).max(5),
        suggestedTitle: z.string().max(140),
      }),
    });
  }, { limit: AI_LIMIT }),

  route("POST", "ai/community/posts/:id/summary", async (ctx) => {
    const store = await db();
    const post = await store.one("posts", { id: ctx.params.id });
    if (!post || (post.hidden && post.user_id !== ctx.user.id && ctx.user.role !== "moderator")) throw notFound();
    const comments = await store.many("comments", { post_id: ctx.params.id, hidden: false }, { sort: { created_at: 1 }, limit: 40 });
    const thread = [`${post.title}`, post.content, ...comments.map((c) => `Reply: ${c.body}`)].join("\n");
    return askObject({
      system: `You summarise a community discussion about personal finance in a few neutral sentences. ${UNTRUSTED_RULE}`,
      prompt: dataBlock("thread", thread),
      schema: z.object({ summary: z.string().max(500), keyPoints: z.array(z.string().max(160)).max(4) }),
    });
  }, { limit: AI_LIMIT }),

  // ---- Notifications ----------------------------------------------------------

  route("GET", "ai/notifications/digest", async (ctx) => {
    const unread = await (await db()).many("notifications", { user_id: ctx.user.id, read: false }, { sort: { created_at: -1 }, limit: 30 });
    if (unread.length === 0) return { digest: "You have no unread notifications." };
    const lines = unread.map((n) => `${n.title}${n.body ? `: ${n.body}` : ""}`).join("\n");
    return askObject({
      system: `You summarise a user's unread notifications into one short paragraph, most urgent first. ${UNTRUSTED_RULE}`,
      prompt: dataBlock("notifications", lines),
      schema: z.object({ digest: z.string().max(400) }),
    });
  }, { limit: AI_LIMIT }),

  // ---- Profile ----------------------------------------------------------------

  /** A short money profile for the profile page, from the same figures as the dashboard. */
  route("GET", "ai/profile/summary", async (ctx) => {
    const finances = await financeText(ctx.user.id, ctx.user.currency);
    return askObject({
      system: `You describe a person's money habits in friendly, non-judgemental language. ${UNTRUSTED_RULE}`,
      prompt: finances,
      schema: z.object({
        profile: z.string().max(60),
        strengths: z.array(z.string().max(160)).max(3),
        nextSteps: z.array(z.string().max(160)).max(3),
      }),
    });
  }, { limit: AI_LIMIT }),

  /** Streamed chat with the financial assistant. It answers from the user's own figures and never sees other users. */
  route("POST", "ai/profile/chat", async (ctx) => {
    const dto = await ctx.body(z.object({
      messages: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: text(1000),
      })).min(1).max(20),
    }).strict());
    const finances = await financeText(ctx.user.id, ctx.user.currency);
    const system = `You are Saviny's financial assistant. Answer in the language of the user's last message. Use only the figures below, suggest ways to save, and say when you are estimating. You cannot move money or change data. ${UNTRUSTED_RULE}\n${finances}`;
    return streamChat(system, dto.messages);
  }, { limit: AI_LIMIT }),

  // ---- Sign-in help -----------------------------------------------------------

  /** Help on the login page. Public, so it sees no account and never asks for a password. */
  route("POST", "ai/auth/help", async (ctx) => {
    const dto = await ctx.body(z.object({ question: text(500) }).strict());
    const answer = await askText({
      system: "You help people who use the Saviny personal finance app with signing in and creating an account. Never ask for a password or a code. Keep answers short and answer in the language of the question.",
      prompt: dataBlock("question", dto.question),
    });
    return { answer, notice: AI_NOTICE };
  }, { public: true, limit: { max: 10, windowMs: 60_000 } }),
];

