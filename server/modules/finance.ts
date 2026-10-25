import { z } from "zod";
import { context } from "../context";
import { badRequest } from "../common/errors";
import { defined, isoDate, owned, periodRange } from "../common/domain";
import { removeAccount, removeBudget, removeGoal } from "../common/cascade";
import { newId, nowIso, round2 } from "../common/security";
import { isDuplicateKey, escapeRegex, type Filter, type Store } from "../database/store";
import type { Row } from "../database/types";
import { route, type Route } from "../http/types";
import { isoDateString, money, positiveMoney, text } from "../http/schema";

const DAY_MS = 86_400_000;
const ACCOUNT_TYPES = ["checking", "savings", "cash", "credit"] as const;
const TX_TYPES = ["income", "expense"] as const;
const FREQUENCIES = ["weekly", "monthly", "yearly"] as const;
const PERIODS = ["monthly", "weekly", "custom"] as const;

// ---- Schemas (same rules as the former class-validator DTOs) --------------------

const accountSchema = z.object({ name: text(60), type: z.enum(ACCOUNT_TYPES), initialBalance: money }).strict();
const accountUpdateSchema = z.object({ name: text(60).optional(), type: z.enum(ACCOUNT_TYPES).optional() }).strict();
const categorySchema = z.object({ name: text(40) }).strict();
const transactionSchema = z.object({
  type: z.enum(TX_TYPES),
  amount: positiveMoney,
  date: isoDateString,
  description: z.string().max(120).optional(),
  accountId: z.string(),
  categoryId: z.string(),
}).strict();
const transactionUpdateSchema = z.object({
  type: z.enum(TX_TYPES).optional(),
  amount: positiveMoney.optional(),
  date: isoDateString.optional(),
  description: z.string().max(120).optional(),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
}).strict();
const recurringSchema = z.object({
  type: z.enum(TX_TYPES),
  amount: positiveMoney,
  description: z.string().max(120).optional(),
  accountId: z.string(),
  categoryId: z.string(),
  frequency: z.enum(FREQUENCIES),
  nextDate: isoDateString,
}).strict();
const recurringUpdateSchema = z.object({
  active: z.boolean().optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  nextDate: isoDateString.optional(),
  amount: positiveMoney.optional(),
  description: z.string().max(120).optional(),
}).strict();
const budgetSchema = z.object({
  name: text(60),
  limit: positiveMoney,
  period: z.enum(PERIODS),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  categoryIds: z.array(z.string()).max(20),
}).strict();
const budgetUpdateSchema = z.object({
  name: text(60).optional(),
  limit: positiveMoney.optional(),
  period: z.enum(PERIODS).optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  categoryIds: z.array(z.string()).max(20).optional(),
}).strict();
const billSchema = z.object({
  name: text(80),
  amount: positiveMoney,
  dueDate: isoDateString,
  kind: z.enum(["bill", "scheduled"]),
  accountId: z.string().optional(),
}).strict();
const billUpdateSchema = z.object({
  name: text(80).optional(),
  amount: positiveMoney.optional(),
  dueDate: isoDateString.optional(),
  kind: z.enum(["bill", "scheduled"]).optional(),
}).strict();
const goalSchema = z.object({
  title: text(80),
  description: z.string().max(400).optional(),
  targetAmount: positiveMoney,
  targetDate: isoDateString.optional(),
}).strict();
const goalUpdateSchema = z.object({
  title: text(80).optional(),
  description: z.string().max(400).optional(),
  targetAmount: positiveMoney.optional(),
  targetDate: isoDateString.optional(),
}).strict();
const contributionSchema = z.object({
  amount: positiveMoney,
  date: isoDateString,
  note: z.string().max(200).optional(),
}).strict();

// ---- Helpers ------------------------------------------------------------------

const db = async (): Promise<Store> => (await context()).store;
const day = (value: string) => value.slice(0, 10);
const roundIfSet = (value?: number) => (value === undefined ? undefined : round2(value));

/** Net effect of each account's transactions on its balance, for one user. */
async function netByAccount(store: Store, userId: string): Promise<Map<string, number>> {
  const net = new Map<string, number>();
  for (const t of await store.many("transactions", { user_id: userId })) {
    net.set(t.account_id, (net.get(t.account_id) ?? 0) + (t.type === "income" ? t.amount : -t.amount));
  }
  return net;
}

function accountView(r: Row, net: Map<string, number>) {
  return {
    id: r.id, name: r.name, type: r.type, initialBalance: r.initial_balance, archived: !!r.archived,
    createdAt: r.created_at, balance: round2(r.initial_balance + (net.get(r.id) ?? 0)),
  };
}

/** Transactions with the names of their account and category, in the order given. */
async function txViews(store: Store, rows: Row[]) {
  const accounts = new Map((await store.many("accounts", { id: { $in: rows.map((r) => r.account_id) } })).map((a) => [a.id, a.name]));
  const categories = new Map((await store.many("categories", { id: { $in: rows.map((r) => r.category_id) } })).map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    id: r.id, type: r.type, amount: r.amount, date: r.date, description: r.description,
    accountId: r.account_id, accountName: accounts.get(r.account_id), categoryId: r.category_id, categoryName: categories.get(r.category_id),
    createdAt: r.created_at,
  }));
}

async function findTx(store: Store, userId: string, id: string) {
  const row = await store.one("transactions", { id, user_id: userId });
  return (await txViews(store, [row as Row]))[0];
}

function budgetRange(b: Row): { from: string; to: string } {
  if (b.period === "custom" && b.start_date && b.end_date) return { from: b.start_date, to: b.end_date };
  if (b.period === "weekly") {
    const to = new Date();
    return { from: isoDate(new Date(to.getTime() - 6 * DAY_MS)), to: isoDate(to) };
  }
  return periodRange("this_month");
}

async function budgetView(store: Store, b: Row) {
  const range = budgetRange(b);
  const categoryIds = (await store.many("budget_categories", { budget_id: b.id })).map((r) => r.category_id);
  const spent = round2(
    (await store.many("transactions", {
      user_id: b.user_id, type: "expense", date: { $gte: range.from, $lte: range.to }, category_id: { $in: categoryIds },
    })).reduce((sum, t) => sum + t.amount, 0),
  );
  const percent = Math.round((spent / b.limit_amount) * 100);
  return {
    id: b.id,
    name: b.name,
    limit: b.limit_amount,
    period: b.period,
    startDate: b.start_date,
    endDate: b.end_date,
    categoryIds,
    spent,
    remaining: round2(Math.max(0, b.limit_amount - spent)),
    overBy: round2(Math.max(0, spent - b.limit_amount)),
    percent,
    status: percent > 100 ? "over" : percent >= 80 ? "near_limit" : "on_track",
    range,
  };
}

export async function goalView(store: Store, g: Row) {
  const contributions = await store.many("contributions", { goal_id: g.id });
  const saved = round2(contributions.reduce((sum, c) => sum + c.amount, 0));
  const remaining = round2(Math.max(0, g.target_amount - saved));
  const progress = Math.min(100, Math.round((saved / g.target_amount) * 100));

  let estimatedCompletionDate: string | null = null;
  let estimationNote = "Add contributions to see an estimate.";
  if (remaining === 0) {
    estimationNote = "Goal reached.";
  } else if (saved > 0) {
    const first = contributions.reduce((min, c) => (c.date < min ? c.date : min), contributions[0].date);
    const months = Math.max(1, (Date.now() - new Date(first).getTime()) / (30 * DAY_MS));
    const monthly = saved / months;
    estimatedCompletionDate = isoDate(new Date(Date.now() + (remaining / monthly) * 30 * DAY_MS));
    estimationNote = "Estimate depends on future contributions.";
  }

  return {
    id: g.id, title: g.title, description: g.description, targetAmount: g.target_amount, targetDate: g.target_date,
    status: g.status, createdAt: g.created_at, savedAmount: saved, remaining, progress,
    estimatedCompletionDate, estimationNote, contributionCount: contributions.length,
  };
}

function billView(b: Row) {
  return {
    id: b.id, name: b.name, amount: b.amount, dueDate: b.due_date, kind: b.kind, status: b.status,
    accountId: b.account_id, createdAt: b.created_at,
  };
}

function recurringView(r: Row) {
  return {
    id: r.id, type: r.type, amount: r.amount, description: r.description, accountId: r.account_id,
    categoryId: r.category_id, frequency: r.frequency, nextDate: r.next_date, active: !!r.active,
  };
}

async function assertAccount(store: Store, userId: string, id?: string | null): Promise<void> {
  if (id) await owned(store, "accounts", id, userId);
}

async function assertCategory(store: Store, userId: string, id: string): Promise<void> {
  await owned(store, "categories", id, userId);
}

export function nextOccurrence(date: string, frequency: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/** Checks every category first, then replaces the budget's links, so a bad id changes nothing. */
async function setBudgetCategories(store: Store, budgetId: string, userId: string, categoryIds: string[]): Promise<void> {
  for (const categoryId of categoryIds) await assertCategory(store, userId, categoryId);
  await store.remove("budget_categories", { budget_id: budgetId });
  if (categoryIds.length > 0) {
    await store.insert("budget_categories", categoryIds.map((category_id) => ({ budget_id: budgetId, category_id })));
  }
}

export async function listBudgetViews(store: Store, userId: string) {
  const budgets = await store.many("budgets", { user_id: userId }, { sort: { created_at: 1 } });
  return Promise.all(budgets.map((b) => budgetView(store, b)));
}

// ---- Routes ---------------------------------------------------------------------

export const financeRoutes: Route[] = [
  // Accounts
  route("GET", "accounts", async (ctx) => {
    const store = await db();
    const net = await netByAccount(store, ctx.user.id);
    return (await store.many("accounts", { user_id: ctx.user.id }, { sort: { created_at: 1 } })).map((a) => accountView(a, net));
  }),
  route("POST", "accounts", async (ctx) => {
    const dto = await ctx.body(accountSchema);
    const store = await db();
    const id = newId();
    await store.insert("accounts", {
      id, user_id: ctx.user.id, name: dto.name.trim(), type: dto.type, initial_balance: round2(dto.initialBalance), archived: false, created_at: nowIso(),
    });
    return accountView(await owned(store, "accounts", id, ctx.user.id), await netByAccount(store, ctx.user.id));
  }),
  route("GET", "accounts/:id", async (ctx) => {
    const store = await db();
    const account = await owned(store, "accounts", ctx.params.id, ctx.user.id);
    return accountView(account, await netByAccount(store, ctx.user.id));
  }),
  route("PATCH", "accounts/:id", async (ctx) => {
    const dto = await ctx.body(accountUpdateSchema);
    const store = await db();
    await owned(store, "accounts", ctx.params.id, ctx.user.id);
    await store.update("accounts", { id: ctx.params.id }, defined({ name: dto.name?.trim(), type: dto.type }));
    return accountView(await owned(store, "accounts", ctx.params.id, ctx.user.id), await netByAccount(store, ctx.user.id));
  }),
  /** Archiving keeps history but removes the account from active totals. */
  route("POST", "accounts/:id/archive", async (ctx) => {
    const store = await db();
    await owned(store, "accounts", ctx.params.id, ctx.user.id);
    await store.update("accounts", { id: ctx.params.id }, { archived: true });
    return { archived: true };
  }),
  /** Deletes the account with its transactions and recurring items. */
  route("DELETE", "accounts/:id", async (ctx) => {
    const store = await db();
    await owned(store, "accounts", ctx.params.id, ctx.user.id);
    await removeAccount(store, ctx.params.id);
  }, { status: 204 }),

  // Categories
  route("GET", "categories", async (ctx) =>
    (await (await db()).many("categories", { user_id: ctx.user.id }, { sort: { name: 1 } }))
      .map((c) => ({ id: c.id, name: c.name, archived: !!c.archived }))),
  route("POST", "categories", async (ctx) => {
    const dto = await ctx.body(categorySchema);
    const id = newId();
    try {
      await (await db()).insert("categories", { id, user_id: ctx.user.id, name: dto.name.trim(), archived: false });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      throw badRequest("A category with this name already exists");
    }
    return { id, name: dto.name.trim(), archived: false };
  }),
  route("PATCH", "categories/:id", async (ctx) => {
    const dto = await ctx.body(categorySchema);
    const store = await db();
    await owned(store, "categories", ctx.params.id, ctx.user.id);
    try {
      await store.update("categories", { id: ctx.params.id }, { name: dto.name.trim() });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      throw badRequest("A category with this name already exists");
    }
    return { id: ctx.params.id, name: dto.name.trim() };
  }),
  /** A category in use is archived so past transactions keep their label; an unused one is removed. */
  route("DELETE", "categories/:id", async (ctx) => {
    const store = await db();
    await owned(store, "categories", ctx.params.id, ctx.user.id);
    const categoryId = ctx.params.id;
    const used = (await store.one("transactions", { category_id: categoryId }))
      ?? (await store.one("budget_categories", { category_id: categoryId }))
      ?? (await store.one("recurring_transactions", { category_id: categoryId }));
    if (used) await store.update("categories", { id: categoryId }, { archived: true });
    else await store.remove("categories", { id: categoryId });
  }, { status: 204 }),

  // Transactions
  route("GET", "transactions", async (ctx) => {
    const q = ctx.query;
    const store = await db();
    const filter: Filter = { user_id: ctx.user.id };
    if (q.get("type")) filter.type = q.get("type");
    if (q.get("accountId")) filter.account_id = q.get("accountId");
    if (q.get("categoryId")) filter.category_id = q.get("categoryId");
    const date: Filter = {};
    if (q.get("from")) date.$gte = q.get("from");
    if (q.get("to")) date.$lte = q.get("to");
    if (Object.keys(date).length > 0) filter.date = date;
    const search = q.get("search")?.trim();
    if (search) {
      const term = search.toLowerCase();
      const categoryIds = (await store.many("categories", { user_id: ctx.user.id }))
        .filter((c) => c.name.toLowerCase().includes(term)).map((c) => c.id);
      filter.$or = [
        { description: { $regex: escapeRegex(search), $options: "i" } },
        { category_id: { $in: categoryIds } },
      ];
    }
    const total = await store.count("transactions", filter);
    const size = Math.min(200, Math.max(1, Number(q.get("pageSize") ?? 50) || 50));
    const skip = (Math.max(1, Number(q.get("page") ?? 1) || 1) - 1) * size;
    const rows = await store.many("transactions", filter, { sort: { date: -1, created_at: -1 }, skip, limit: size });
    return { items: await txViews(store, rows), total };
  }),
  route("POST", "transactions", async (ctx) => {
    const dto = await ctx.body(transactionSchema);
    const store = await db();
    await assertAccount(store, ctx.user.id, dto.accountId);
    await assertCategory(store, ctx.user.id, dto.categoryId);
    const id = newId();
    await store.insert("transactions", {
      id, user_id: ctx.user.id, type: dto.type, amount: round2(dto.amount), date: day(dto.date),
      description: dto.description?.trim() ?? "", account_id: dto.accountId, category_id: dto.categoryId, created_at: nowIso(),
    });
    return findTx(store, ctx.user.id, id);
  }),
  route("GET", "transactions/:id", async (ctx) => {
    const store = await db();
    await owned(store, "transactions", ctx.params.id, ctx.user.id);
    return findTx(store, ctx.user.id, ctx.params.id);
  }),
  route("PATCH", "transactions/:id", async (ctx) => {
    const dto = await ctx.body(transactionUpdateSchema);
    const store = await db();
    const id = ctx.params.id;
    await owned(store, "transactions", id, ctx.user.id);
    await assertAccount(store, ctx.user.id, dto.accountId);
    if (dto.categoryId) await assertCategory(store, ctx.user.id, dto.categoryId);
    await store.update("transactions", { id }, defined({
      type: dto.type,
      amount: roundIfSet(dto.amount),
      date: dto.date ? day(dto.date) : undefined,
      description: dto.description?.trim(),
      account_id: dto.accountId,
      category_id: dto.categoryId,
    }));
    return findTx(store, ctx.user.id, id);
  }),
  route("DELETE", "transactions/:id", async (ctx) => {
    const store = await db();
    await owned(store, "transactions", ctx.params.id, ctx.user.id);
    await store.remove("transactions", { id: ctx.params.id });
  }, { status: 204 }),

  // Recurring transactions: listed and confirmable, never created automatically
  route("GET", "recurring", async (ctx) =>
    (await (await db()).many("recurring_transactions", { user_id: ctx.user.id }, { sort: { next_date: 1 } })).map(recurringView)),
  route("POST", "recurring", async (ctx) => {
    const dto = await ctx.body(recurringSchema);
    const store = await db();
    await assertAccount(store, ctx.user.id, dto.accountId);
    await assertCategory(store, ctx.user.id, dto.categoryId);
    const id = newId();
    await store.insert("recurring_transactions", {
      id, user_id: ctx.user.id, type: dto.type, amount: round2(dto.amount), description: dto.description?.trim() ?? "",
      account_id: dto.accountId, category_id: dto.categoryId, frequency: dto.frequency, next_date: day(dto.nextDate), active: true, created_at: nowIso(),
    });
    return recurringView(await owned(store, "recurring_transactions", id, ctx.user.id));
  }),
  route("PATCH", "recurring/:id", async (ctx) => {
    const dto = await ctx.body(recurringUpdateSchema);
    const store = await db();
    await owned(store, "recurring_transactions", ctx.params.id, ctx.user.id);
    await store.update("recurring_transactions", { id: ctx.params.id }, defined({
      active: dto.active,
      frequency: dto.frequency,
      next_date: dto.nextDate ? day(dto.nextDate) : undefined,
      amount: roundIfSet(dto.amount),
      description: dto.description?.trim(),
    }));
    return recurringView(await owned(store, "recurring_transactions", ctx.params.id, ctx.user.id));
  }),
  /** Confirms one occurrence: creates the transaction and moves the schedule forward. Nothing is automatic. */
  route("POST", "recurring/:id/confirm", async (ctx) => {
    const store = await db();
    const r = await owned(store, "recurring_transactions", ctx.params.id, ctx.user.id);
    const txId = newId();
    await store.insert("transactions", {
      id: txId, user_id: ctx.user.id, type: r.type, amount: r.amount, date: r.next_date, description: r.description,
      account_id: r.account_id, category_id: r.category_id, created_at: nowIso(),
    });
    await store.update("recurring_transactions", { id: ctx.params.id }, { next_date: nextOccurrence(r.next_date, r.frequency) });
    return findTx(store, ctx.user.id, txId);
  }),
  route("DELETE", "recurring/:id", async (ctx) => {
    const store = await db();
    await owned(store, "recurring_transactions", ctx.params.id, ctx.user.id);
    await store.remove("recurring_transactions", { id: ctx.params.id });
  }, { status: 204 }),

  // Budgets
  route("GET", "budgets", async (ctx) => listBudgetViews(await db(), ctx.user.id)),
  route("POST", "budgets", async (ctx) => {
    const dto = await ctx.body(budgetSchema);
    const store = await db();
    for (const categoryId of dto.categoryIds) await assertCategory(store, ctx.user.id, categoryId);
    const id = newId();
    await store.insert("budgets", {
      id, user_id: ctx.user.id, name: dto.name.trim(), limit_amount: round2(dto.limit), period: dto.period,
      start_date: dto.startDate ? day(dto.startDate) : null, end_date: dto.endDate ? day(dto.endDate) : null, created_at: nowIso(),
    });
    await setBudgetCategories(store, id, ctx.user.id, dto.categoryIds);
    return budgetView(store, await owned(store, "budgets", id, ctx.user.id));
  }),
  route("GET", "budgets/:id", async (ctx) => {
    const store = await db();
    return budgetView(store, await owned(store, "budgets", ctx.params.id, ctx.user.id));
  }),
  route("PATCH", "budgets/:id", async (ctx) => {
    const dto = await ctx.body(budgetUpdateSchema);
    const store = await db();
    const id = ctx.params.id;
    await owned(store, "budgets", id, ctx.user.id);
    await store.update("budgets", { id }, defined({
      name: dto.name?.trim(),
      limit_amount: roundIfSet(dto.limit),
      period: dto.period,
      start_date: dto.startDate ? day(dto.startDate) : undefined,
      end_date: dto.endDate ? day(dto.endDate) : undefined,
    }));
    if (dto.categoryIds) await setBudgetCategories(store, id, ctx.user.id, dto.categoryIds);
    return budgetView(store, await owned(store, "budgets", id, ctx.user.id));
  }),
  route("DELETE", "budgets/:id", async (ctx) => {
    const store = await db();
    await owned(store, "budgets", ctx.params.id, ctx.user.id);
    await removeBudget(store, ctx.params.id);
  }, { status: 204 }),

  // Bills and scheduled payments
  route("GET", "bills", async (ctx) =>
    (await (await db()).many("bills", { user_id: ctx.user.id }, { sort: { due_date: 1 } })).map(billView)),
  route("POST", "bills", async (ctx) => {
    const dto = await ctx.body(billSchema);
    const store = await db();
    await assertAccount(store, ctx.user.id, dto.accountId);
    const id = newId();
    await store.insert("bills", {
      id, user_id: ctx.user.id, name: dto.name.trim(), amount: round2(dto.amount), due_date: day(dto.dueDate), kind: dto.kind,
      status: "upcoming", account_id: dto.accountId ?? null, created_at: nowIso(),
    });
    return billView(await owned(store, "bills", id, ctx.user.id));
  }),
  route("PATCH", "bills/:id", async (ctx) => {
    const dto = await ctx.body(billUpdateSchema);
    const store = await db();
    await owned(store, "bills", ctx.params.id, ctx.user.id);
    await store.update("bills", { id: ctx.params.id }, defined({
      name: dto.name?.trim(), amount: roundIfSet(dto.amount), due_date: dto.dueDate ? day(dto.dueDate) : undefined, kind: dto.kind,
    }));
    return billView(await owned(store, "bills", ctx.params.id, ctx.user.id));
  }),
  /** Only records the status: Saviny never initiates a payment. */
  route("POST", "bills/:id/mark-paid", async (ctx) => {
    const store = await db();
    await owned(store, "bills", ctx.params.id, ctx.user.id);
    await store.update("bills", { id: ctx.params.id }, { status: "paid" });
    return billView(await owned(store, "bills", ctx.params.id, ctx.user.id));
  }),
  route("DELETE", "bills/:id", async (ctx) => {
    const store = await db();
    await owned(store, "bills", ctx.params.id, ctx.user.id);
    await store.remove("bills", { id: ctx.params.id });
  }, { status: 204 }),

  // Savings goals
  route("GET", "goals", async (ctx) => {
    const store = await db();
    const status = ctx.query.get("status");
    const goals = await store.many("goals", status ? { user_id: ctx.user.id, status } : { user_id: ctx.user.id }, { sort: { created_at: 1 } });
    return Promise.all(goals.map((g) => goalView(store, g)));
  }),
  route("POST", "goals", async (ctx) => {
    const dto = await ctx.body(goalSchema);
    const store = await db();
    const id = newId();
    await store.insert("goals", {
      id, user_id: ctx.user.id, title: dto.title.trim(), description: dto.description?.trim() ?? "", target_amount: round2(dto.targetAmount),
      target_date: dto.targetDate ? day(dto.targetDate) : null, status: "active", created_at: nowIso(),
    });
    return goalView(store, await owned(store, "goals", id, ctx.user.id));
  }),
  route("GET", "goals/:id", async (ctx) => {
    const store = await db();
    return goalView(store, await owned(store, "goals", ctx.params.id, ctx.user.id));
  }),
  route("PATCH", "goals/:id", async (ctx) => {
    const dto = await ctx.body(goalUpdateSchema);
    const store = await db();
    await owned(store, "goals", ctx.params.id, ctx.user.id);
    await store.update("goals", { id: ctx.params.id }, defined({
      title: dto.title?.trim(),
      description: dto.description?.trim(),
      target_amount: roundIfSet(dto.targetAmount),
      target_date: dto.targetDate ? day(dto.targetDate) : undefined,
    }));
    return goalView(store, await owned(store, "goals", ctx.params.id, ctx.user.id));
  }),
  route("POST", "goals/:id/archive", async (ctx) => {
    const store = await db();
    await owned(store, "goals", ctx.params.id, ctx.user.id);
    await store.update("goals", { id: ctx.params.id }, { status: "archived" });
    return { status: "archived" };
  }),
  route("DELETE", "goals/:id", async (ctx) => {
    const store = await db();
    await owned(store, "goals", ctx.params.id, ctx.user.id);
    await removeGoal(store, ctx.params.id);
  }, { status: 204 }),
  route("GET", "goals/:id/contributions", async (ctx) => {
    const store = await db();
    await owned(store, "goals", ctx.params.id, ctx.user.id);
    return (await store.many("contributions", { goal_id: ctx.params.id }, { sort: { date: -1, created_at: -1 } }))
      .map((c) => ({ id: c.id, goalId: c.goal_id, amount: c.amount, date: c.date, note: c.note }));
  }),
  route("POST", "goals/:id/contributions", async (ctx) => {
    const dto = await ctx.body(contributionSchema);
    const store = await db();
    const goal = await owned(store, "goals", ctx.params.id, ctx.user.id);
    if (goal.status !== "active") throw badRequest("Only active goals accept contributions");
    const contributionId = newId();
    await store.insert("contributions", {
      id: contributionId, user_id: ctx.user.id, goal_id: ctx.params.id, amount: round2(dto.amount), date: day(dto.date),
      note: dto.note?.trim() ?? "", created_at: nowIso(),
    });
    return { contributionId, goal: await goalView(store, goal) };
  }),
  route("PATCH", "contributions/:id", async (ctx) => {
    const dto = await ctx.body(contributionSchema);
    const store = await db();
    await owned(store, "contributions", ctx.params.id, ctx.user.id);
    await store.update("contributions", { id: ctx.params.id }, defined({
      amount: round2(dto.amount), date: day(dto.date), note: dto.note?.trim(),
    }));
    return { id: ctx.params.id };
  }),
  route("DELETE", "contributions/:id", async (ctx) => {
    const store = await db();
    await owned(store, "contributions", ctx.params.id, ctx.user.id);
    await store.remove("contributions", { id: ctx.params.id });
  }, { status: 204 }),

  // Dashboard
  route("GET", "dashboard", async (ctx) => dashboardFor(await db(), ctx.user.id, ctx.query.get("period") ?? "this_month")),
];

/** The dashboard figures for one user and period. The AI assistants read the same numbers the screens show. */
export async function dashboardFor(store: Store, userId: string, period: string) {
  const range = periodRange(period);

  const accounts = await store.many("accounts", { user_id: userId });
  const activeIds = new Set(accounts.filter((a) => !a.archived).map((a) => a.id));
  const transactions = await store.many("transactions", { user_id: userId });
  const inRange = transactions.filter((t) => t.date >= range.from && t.date <= range.to);

  const sum = (type: string) => round2(inRange.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0));
  const count = (type: string) => inRange.filter((t) => t.type === type).length;

  const net = await netByAccount(store, userId);
  const balance = round2(
    accounts.filter((a) => activeIds.has(a.id)).reduce((s, a) => s + a.initial_balance, 0)
    + [...net].filter(([accountId]) => activeIds.has(accountId)).reduce((s, [, value]) => s + value, 0),
  );

  const income = sum("income");
  const expenses = sum("expense");
  const categoryNames = new Map((await store.many("categories", { user_id: userId })).map((c) => [c.id, c.name]));
  const spendByCategory = new Map<string, number>();
  for (const t of inRange) {
    if (t.type !== "expense") continue;
    spendByCategory.set(t.category_id, (spendByCategory.get(t.category_id) ?? 0) + t.amount);
  }
  const byCategory = [...spendByCategory]
    .map(([categoryId, amount]) => ({
      categoryId, name: categoryNames.get(categoryId), amount: round2(amount),
      percent: expenses ? Math.round((amount / expenses) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const start = new Date(`${range.from}T00:00:00Z`).getTime();
  const weeklyFlow = [0, 1, 2, 3].map((i) => ({ label: `Week ${i + 1}`, income: 0, expenses: 0 }));
  for (const t of inRange) {
    const bucket = weeklyFlow[Math.min(3, Math.max(0, Math.floor((new Date(`${t.date}T00:00:00Z`).getTime() - start) / (7 * DAY_MS))))];
    if (t.type === "income") bucket.income = round2(bucket.income + t.amount);
    else bucket.expenses = round2(bucket.expenses + t.amount);
  }

  const budgets = await listBudgetViews(store, userId);
  const activeGoals = await store.many("goals", { user_id: userId, status: "active" }, { sort: { created_at: 1 } });
  const goals = await Promise.all(activeGoals.map((g) => goalView(store, g)));
  const upcomingBills = (await store.many("bills", { user_id: userId, status: "upcoming" }, { sort: { due_date: 1 }, limit: 5 })).map(billView);
  const recentTransactions = await txViews(store, await store.many("transactions", { user_id: userId }, { sort: { date: -1, created_at: -1 }, limit: 5 }));

  const today = isoDate(new Date());
  const in7Days = isoDate(new Date(Date.now() + 7 * DAY_MS));
  const alerts = [
    ...budgets.filter((b) => b.status !== "on_track").map((b) => ({
      kind: "budget",
      title: b.status === "over" ? `${b.name} budget exceeded` : `${b.name} budget almost reached`,
      body: b.status === "over" ? `You are ${b.overBy.toFixed(2)} over your limit.` : `${b.percent}% of your limit is used.`,
    })),
    ...upcomingBills.filter((b) => b.dueDate >= today && b.dueDate <= in7Days).map((b) => ({
      kind: "bill",
      title: `${b.name} is due soon`,
      body: `Payment of ${b.amount.toFixed(2)} due ${b.dueDate}. Nothing is paid automatically.`,
    })),
  ];

  return {
    period,
    range,
    balance,
    income,
    expenses,
    saved: round2(goals.reduce((s, g) => s + g.savedAmount, 0)),
    activeAccounts: activeIds.size,
    activeGoals: goals.length,
    incomeCount: count("income"),
    expenseCount: count("expense"),
    byCategory,
    weeklyFlow,
    budgets,
    goals,
    recentTransactions,
    upcomingBills,
    alerts,
  };
}
