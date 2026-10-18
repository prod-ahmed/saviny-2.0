import { z } from "zod";
import { context } from "../context";
import { badRequest } from "../common/errors";
import { isoDate, owned, periodRange } from "../common/domain";
import { newId, nowIso, round2 } from "../common/security";
import type { Db } from "../database/open";
import type { Row } from "../database/types";
import { route, type Ctx, type Route } from "../http/types";
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

const db = (): Db => context().db;
const txSelect = `
    SELECT t.*, a.name AS account_name, c.name AS category_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN categories c ON c.id = t.category_id`;

function accountBalance(accountId: string): number {
  const r = db().prepare(`
    SELECT a.initial_balance + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0) AS balance
    FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
    WHERE a.id = ? GROUP BY a.id`).get(accountId) as { balance: number } | undefined;
  return round2(r?.balance ?? 0);
}

function accountView(r: Row) {
  return {
    id: r.id, name: r.name, type: r.type, initialBalance: r.initial_balance, archived: !!r.archived,
    createdAt: r.created_at, balance: accountBalance(r.id),
  };
}

function txView(r: Row) {
  return {
    id: r.id, type: r.type, amount: r.amount, date: r.date, description: r.description,
    accountId: r.account_id, accountName: r.account_name, categoryId: r.category_id, categoryName: r.category_name,
    createdAt: r.created_at,
  };
}

function findTx(userId: string, id: string): Row {
  return db().prepare(`${txSelect} WHERE t.id = ? AND t.user_id = ?`).get(id, userId) as Row;
}

function budgetCategoryIds(budgetId: string): string[] {
  return (db().prepare("SELECT category_id FROM budget_categories WHERE budget_id = ?").all(budgetId) as { category_id: string }[])
    .map((r) => r.category_id);
}

function budgetRange(b: Row): { from: string; to: string } {
  if (b.period === "custom" && b.start_date && b.end_date) return { from: b.start_date, to: b.end_date };
  if (b.period === "weekly") {
    const to = new Date();
    return { from: isoDate(new Date(to.getTime() - 6 * DAY_MS)), to: isoDate(to) };
  }
  return periodRange("this_month");
}

function budgetView(b: Row) {
  const range = budgetRange(b);
  const spent = round2(
    (db().prepare(`
      SELECT COALESCE(SUM(amount), 0) AS spent FROM transactions
      WHERE user_id = ? AND type = 'expense' AND date BETWEEN ? AND ?
        AND category_id IN (SELECT category_id FROM budget_categories WHERE budget_id = ?)`)
      .get(b.user_id, range.from, range.to, b.id) as { spent: number }).spent,
  );
  const percent = Math.round((spent / b.limit_amount) * 100);
  return {
    id: b.id,
    name: b.name,
    limit: b.limit_amount,
    period: b.period,
    startDate: b.start_date,
    endDate: b.end_date,
    categoryIds: budgetCategoryIds(b.id),
    spent,
    remaining: round2(Math.max(0, b.limit_amount - spent)),
    overBy: round2(Math.max(0, spent - b.limit_amount)),
    percent,
    status: percent > 100 ? "over" : percent >= 80 ? "near_limit" : "on_track",
    range,
  };
}

function goalView(g: Row) {
  const contributions = db().prepare("SELECT amount, date FROM contributions WHERE goal_id = ?").all(g.id) as { amount: number; date: string }[];
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

function assertAccount(userId: string, id?: string | null): void {
  if (id) owned(db(), "accounts", id, userId);
}

function assertCategory(userId: string, id: string): void {
  owned(db(), "categories", id, userId);
}

function nextOccurrence(date: string, frequency: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function setBudgetCategories(budgetId: string, userId: string, categoryIds: string[]): void {
  db().prepare("DELETE FROM budget_categories WHERE budget_id = ?").run(budgetId);
  for (const categoryId of categoryIds) {
    assertCategory(userId, categoryId);
    db().prepare("INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)").run(budgetId, categoryId);
  }
}

const listBudgetViews = (userId: string) =>
  (db().prepare("SELECT * FROM budgets WHERE user_id = ? ORDER BY created_at").all(userId) as Row[]).map((b) => budgetView(b));

// ---- Routes ---------------------------------------------------------------------

export const financeRoutes: Route[] = [
  // Accounts
  route("GET", "accounts", (ctx) =>
    (db().prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at").all(ctx.user.id) as Row[]).map(accountView)),
  route("POST", "accounts", async (ctx) => {
    const dto = await ctx.body(accountSchema);
    const id = newId();
    db().prepare("INSERT INTO accounts (id, user_id, name, type, initial_balance, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, ctx.user.id, dto.name.trim(), dto.type, round2(dto.initialBalance), nowIso());
    return accountView(owned(db(), "accounts", id, ctx.user.id));
  }),
  route("GET", "accounts/:id", (ctx) => accountView(owned(db(), "accounts", ctx.params.id, ctx.user.id))),
  route("PATCH", "accounts/:id", async (ctx) => {
    const dto = await ctx.body(accountUpdateSchema);
    owned(db(), "accounts", ctx.params.id, ctx.user.id);
    db().prepare("UPDATE accounts SET name = COALESCE(?, name), type = COALESCE(?, type) WHERE id = ?")
      .run(dto.name?.trim() ?? null, dto.type ?? null, ctx.params.id);
    return accountView(owned(db(), "accounts", ctx.params.id, ctx.user.id));
  }),
  /** Archiving keeps history but removes the account from active totals. */
  route("POST", "accounts/:id/archive", (ctx) => {
    owned(db(), "accounts", ctx.params.id, ctx.user.id);
    db().prepare("UPDATE accounts SET archived = 1 WHERE id = ?").run(ctx.params.id);
    return { archived: true };
  }),
  /** Deletes the account and, through ON DELETE CASCADE, its transactions. */
  route("DELETE", "accounts/:id", (ctx) => {
    owned(db(), "accounts", ctx.params.id, ctx.user.id);
    db().prepare("DELETE FROM accounts WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  // Categories
  route("GET", "categories", (ctx) =>
    (db().prepare("SELECT id, name, archived FROM categories WHERE user_id = ? ORDER BY name").all(ctx.user.id) as Row[])
      .map((c) => ({ ...c, archived: !!c.archived }))),
  route("POST", "categories", async (ctx) => {
    const dto = await ctx.body(categorySchema);
    const id = newId();
    try {
      db().prepare("INSERT INTO categories (id, user_id, name) VALUES (?, ?, ?)").run(id, ctx.user.id, dto.name.trim());
    } catch {
      throw badRequest("A category with this name already exists");
    }
    return { id, name: dto.name.trim(), archived: false };
  }),
  route("PATCH", "categories/:id", async (ctx) => {
    const dto = await ctx.body(categorySchema);
    owned(db(), "categories", ctx.params.id, ctx.user.id);
    try {
      db().prepare("UPDATE categories SET name = ? WHERE id = ?").run(dto.name.trim(), ctx.params.id);
    } catch {
      throw badRequest("A category with this name already exists");
    }
    return { id: ctx.params.id, name: dto.name.trim() };
  }),
  /** A category in use is archived so past transactions keep their label; an unused one is removed. */
  route("DELETE", "categories/:id", (ctx) => {
    owned(db(), "categories", ctx.params.id, ctx.user.id);
    const used = db().prepare(`
      SELECT 1 FROM transactions WHERE category_id = ? UNION SELECT 1 FROM budget_categories WHERE category_id = ?
      UNION SELECT 1 FROM recurring_transactions WHERE category_id = ?`).get(ctx.params.id, ctx.params.id, ctx.params.id);
    if (used) db().prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(ctx.params.id);
    else db().prepare("DELETE FROM categories WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  // Transactions
  route("GET", "transactions", (ctx) => {
    const q = ctx.query;
    const where = ["t.user_id = ?"];
    const params: unknown[] = [ctx.user.id];
    if (q.get("type")) { where.push("t.type = ?"); params.push(q.get("type")); }
    if (q.get("accountId")) { where.push("t.account_id = ?"); params.push(q.get("accountId")); }
    if (q.get("categoryId")) { where.push("t.category_id = ?"); params.push(q.get("categoryId")); }
    if (q.get("from")) { where.push("t.date >= ?"); params.push(q.get("from")); }
    if (q.get("to")) { where.push("t.date <= ?"); params.push(q.get("to")); }
    const search = q.get("search")?.trim();
    if (search) {
      where.push("(LOWER(t.description) LIKE ? OR LOWER(c.name) LIKE ?)");
      const term = `%${search.toLowerCase()}%`;
      params.push(term, term);
    }
    const clause = where.join(" AND ");
    const total = (db().prepare(`SELECT COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id WHERE ${clause}`)
      .get(...params) as { n: number }).n;
    const size = Math.min(200, Math.max(1, Number(q.get("pageSize") ?? 50) || 50));
    const offset = (Math.max(1, Number(q.get("page") ?? 1) || 1) - 1) * size;
    const rows = db().prepare(`${txSelect} WHERE ${clause} ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, size, offset) as Row[];
    return { items: rows.map(txView), total };
  }),
  route("POST", "transactions", async (ctx) => {
    const dto = await ctx.body(transactionSchema);
    assertAccount(ctx.user.id, dto.accountId);
    assertCategory(ctx.user.id, dto.categoryId);
    const id = newId();
    db().prepare(`INSERT INTO transactions (id, user_id, type, amount, date, description, account_id, category_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ctx.user.id, dto.type, round2(dto.amount), dto.date.slice(0, 10), dto.description?.trim() ?? "", dto.accountId, dto.categoryId, nowIso());
    return txView(findTx(ctx.user.id, id));
  }),
  route("GET", "transactions/:id", (ctx) => {
    owned(db(), "transactions", ctx.params.id, ctx.user.id);
    return txView(findTx(ctx.user.id, ctx.params.id));
  }),
  route("PATCH", "transactions/:id", async (ctx) => {
    const dto = await ctx.body(transactionUpdateSchema);
    const id = ctx.params.id;
    owned(db(), "transactions", id, ctx.user.id);
    assertAccount(ctx.user.id, dto.accountId);
    if (dto.categoryId) assertCategory(ctx.user.id, dto.categoryId);
    db().prepare(`UPDATE transactions SET
        type = COALESCE(?, type), amount = COALESCE(?, amount), date = COALESCE(?, date),
        description = COALESCE(?, description), account_id = COALESCE(?, account_id), category_id = COALESCE(?, category_id)
      WHERE id = ?`).run(
      dto.type ?? null,
      dto.amount === undefined ? null : round2(dto.amount),
      dto.date?.slice(0, 10) ?? null,
      dto.description?.trim() ?? null,
      dto.accountId ?? null,
      dto.categoryId ?? null,
      id,
    );
    return txView(findTx(ctx.user.id, id));
  }),
  route("DELETE", "transactions/:id", (ctx) => {
    owned(db(), "transactions", ctx.params.id, ctx.user.id);
    db().prepare("DELETE FROM transactions WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  // Recurring transactions: listed and confirmable, never created automatically
  route("GET", "recurring", (ctx) =>
    (db().prepare("SELECT * FROM recurring_transactions WHERE user_id = ? ORDER BY next_date").all(ctx.user.id) as Row[]).map(recurringView)),
  route("POST", "recurring", async (ctx) => {
    const dto = await ctx.body(recurringSchema);
    assertAccount(ctx.user.id, dto.accountId);
    assertCategory(ctx.user.id, dto.categoryId);
    const id = newId();
    db().prepare(`INSERT INTO recurring_transactions
      (id, user_id, type, amount, description, account_id, category_id, frequency, next_date, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .run(id, ctx.user.id, dto.type, round2(dto.amount), dto.description?.trim() ?? "", dto.accountId, dto.categoryId, dto.frequency, dto.nextDate.slice(0, 10), nowIso());
    return recurringView(owned(db(), "recurring_transactions", id, ctx.user.id));
  }),
  route("PATCH", "recurring/:id", async (ctx) => {
    const dto = await ctx.body(recurringUpdateSchema);
    owned(db(), "recurring_transactions", ctx.params.id, ctx.user.id);
    db().prepare(`UPDATE recurring_transactions SET
        active = COALESCE(?, active), frequency = COALESCE(?, frequency), next_date = COALESCE(?, next_date),
        amount = COALESCE(?, amount), description = COALESCE(?, description)
      WHERE id = ?`).run(
      dto.active === undefined ? null : dto.active ? 1 : 0,
      dto.frequency ?? null,
      dto.nextDate?.slice(0, 10) ?? null,
      dto.amount === undefined ? null : round2(dto.amount),
      dto.description?.trim() ?? null,
      ctx.params.id,
    );
    return recurringView(owned(db(), "recurring_transactions", ctx.params.id, ctx.user.id));
  }),
  /** Confirms one occurrence: creates the transaction and moves the schedule forward. Nothing is automatic. */
  route("POST", "recurring/:id/confirm", (ctx) => {
    const r = owned(db(), "recurring_transactions", ctx.params.id, ctx.user.id);
    const txId = newId();
    db().transaction(() => {
      db().prepare(`INSERT INTO transactions (id, user_id, type, amount, date, description, account_id, category_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(txId, ctx.user.id, r.type, r.amount, r.next_date, r.description, r.account_id, r.category_id, nowIso());
      db().prepare("UPDATE recurring_transactions SET next_date = ? WHERE id = ?").run(nextOccurrence(r.next_date, r.frequency), ctx.params.id);
    })();
    return txView(findTx(ctx.user.id, txId));
  }),
  route("DELETE", "recurring/:id", (ctx) => {
    owned(db(), "recurring_transactions", ctx.params.id, ctx.user.id);
    db().prepare("DELETE FROM recurring_transactions WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  // Budgets
  route("GET", "budgets", (ctx) => listBudgetViews(ctx.user.id)),
  route("POST", "budgets", async (ctx) => {
    const dto = await ctx.body(budgetSchema);
    const id = newId();
    db().transaction(() => {
      db().prepare(`INSERT INTO budgets (id, user_id, name, limit_amount, period, start_date, end_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, ctx.user.id, dto.name.trim(), round2(dto.limit), dto.period, dto.startDate?.slice(0, 10) ?? null, dto.endDate?.slice(0, 10) ?? null, nowIso());
      setBudgetCategories(id, ctx.user.id, dto.categoryIds);
    })();
    return budgetView(owned(db(), "budgets", id, ctx.user.id));
  }),
  route("GET", "budgets/:id", (ctx) => budgetView(owned(db(), "budgets", ctx.params.id, ctx.user.id))),
  route("PATCH", "budgets/:id", async (ctx) => {
    const dto = await ctx.body(budgetUpdateSchema);
    const id = ctx.params.id;
    owned(db(), "budgets", id, ctx.user.id);
    db().transaction(() => {
      db().prepare(`UPDATE budgets SET
          name = COALESCE(?, name), limit_amount = COALESCE(?, limit_amount), period = COALESCE(?, period),
          start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date)
        WHERE id = ?`).run(
        dto.name?.trim() ?? null, dto.limit === undefined ? null : round2(dto.limit), dto.period ?? null,
        dto.startDate?.slice(0, 10) ?? null, dto.endDate?.slice(0, 10) ?? null, id,
      );
      if (dto.categoryIds) setBudgetCategories(id, ctx.user.id, dto.categoryIds);
    })();
    return budgetView(owned(db(), "budgets", id, ctx.user.id));
  }),
  route("DELETE", "budgets/:id", (ctx) => {
    owned(db(), "budgets", ctx.params.id, ctx.user.id);
    db().prepare("DELETE FROM budgets WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  // Bills and scheduled payments
  route("GET", "bills", (ctx) =>
    (db().prepare("SELECT * FROM bills WHERE user_id = ? ORDER BY due_date").all(ctx.user.id) as Row[]).map(billView)),
  route("POST", "bills", async (ctx) => {
    const dto = await ctx.body(billSchema);
    assertAccount(ctx.user.id, dto.accountId);
    const id = newId();
    db().prepare(`INSERT INTO bills (id, user_id, name, amount, due_date, kind, status, account_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'upcoming', ?, ?)`)
      .run(id, ctx.user.id, dto.name.trim(), round2(dto.amount), dto.dueDate.slice(0, 10), dto.kind, dto.accountId ?? null, nowIso());
    return billView(owned(db(), "bills", id, ctx.user.id));
  }),
  route("PATCH", "bills/:id", async (ctx) => {
    const dto = await ctx.body(billUpdateSchema);
    owned(db(), "bills", ctx.params.id, ctx.user.id);
    db().prepare(`UPDATE bills SET name = COALESCE(?, name), amount = COALESCE(?, amount),
        due_date = COALESCE(?, due_date), kind = COALESCE(?, kind) WHERE id = ?`)
      .run(dto.name?.trim() ?? null, dto.amount === undefined ? null : round2(dto.amount), dto.dueDate?.slice(0, 10) ?? null, dto.kind ?? null, ctx.params.id);
    return billView(owned(db(), "bills", ctx.params.id, ctx.user.id));
  }),
  /** Only records the status: Saviny never initiates a payment. */
  route("POST", "bills/:id/mark-paid", (ctx) => {
    owned(db(), "bills", ctx.params.id, ctx.user.id);
    db().prepare("UPDATE bills SET status = 'paid' WHERE id = ?").run(ctx.params.id);
    return billView(owned(db(), "bills", ctx.params.id, ctx.user.id));
  }),
  route("DELETE", "bills/:id", (ctx) => {
    owned(db(), "bills", ctx.params.id, ctx.user.id);
    db().prepare("DELETE FROM bills WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  // Savings goals
  route("GET", "goals", (ctx) => {
    const status = ctx.query.get("status");
    const rows = status
      ? (db().prepare("SELECT * FROM goals WHERE user_id = ? AND status = ? ORDER BY created_at").all(ctx.user.id, status) as Row[])
      : (db().prepare("SELECT * FROM goals WHERE user_id = ? ORDER BY created_at").all(ctx.user.id) as Row[]);
    return rows.map(goalView);
  }),
  route("POST", "goals", async (ctx) => {
    const dto = await ctx.body(goalSchema);
    const id = newId();
    db().prepare(`INSERT INTO goals (id, user_id, title, description, target_amount, target_date, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`)
      .run(id, ctx.user.id, dto.title.trim(), dto.description?.trim() ?? "", round2(dto.targetAmount), dto.targetDate?.slice(0, 10) ?? null, nowIso());
    return goalView(owned(db(), "goals", id, ctx.user.id));
  }),
  route("GET", "goals/:id", (ctx) => goalView(owned(db(), "goals", ctx.params.id, ctx.user.id))),
  route("PATCH", "goals/:id", async (ctx) => {
    const dto = await ctx.body(goalUpdateSchema);
    owned(db(), "goals", ctx.params.id, ctx.user.id);
    db().prepare(`UPDATE goals SET title = COALESCE(?, title), description = COALESCE(?, description),
        target_amount = COALESCE(?, target_amount), target_date = COALESCE(?, target_date) WHERE id = ?`)
      .run(dto.title?.trim() ?? null, dto.description?.trim() ?? null, dto.targetAmount === undefined ? null : round2(dto.targetAmount),
        dto.targetDate?.slice(0, 10) ?? null, ctx.params.id);
    return goalView(owned(db(), "goals", ctx.params.id, ctx.user.id));
  }),
  route("POST", "goals/:id/archive", (ctx) => {
    owned(db(), "goals", ctx.params.id, ctx.user.id);
    db().prepare("UPDATE goals SET status = 'archived' WHERE id = ?").run(ctx.params.id);
    return { status: "archived" };
  }),
  route("DELETE", "goals/:id", (ctx) => {
    owned(db(), "goals", ctx.params.id, ctx.user.id);
    db().prepare("DELETE FROM goals WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),
  route("GET", "goals/:id/contributions", (ctx) => {
    owned(db(), "goals", ctx.params.id, ctx.user.id);
    return (db().prepare("SELECT * FROM contributions WHERE goal_id = ? ORDER BY date DESC, created_at DESC").all(ctx.params.id) as Row[])
      .map((c) => ({ id: c.id, goalId: c.goal_id, amount: c.amount, date: c.date, note: c.note }));
  }),
  route("POST", "goals/:id/contributions", async (ctx) => {
    const dto = await ctx.body(contributionSchema);
    const goal = owned(db(), "goals", ctx.params.id, ctx.user.id);
    if (goal.status !== "active") throw badRequest("Only active goals accept contributions");
    const contributionId = newId();
    db().prepare("INSERT INTO contributions (id, user_id, goal_id, amount, date, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(contributionId, ctx.user.id, ctx.params.id, round2(dto.amount), dto.date.slice(0, 10), dto.note?.trim() ?? "", nowIso());
    return { contributionId, goal: goalView(goal) };
  }),
  route("PATCH", "contributions/:id", async (ctx) => {
    const dto = await ctx.body(contributionSchema);
    owned(db(), "contributions", ctx.params.id, ctx.user.id);
    db().prepare("UPDATE contributions SET amount = ?, date = ?, note = COALESCE(?, note) WHERE id = ?")
      .run(round2(dto.amount), dto.date.slice(0, 10), dto.note?.trim() ?? null, ctx.params.id);
    return { id: ctx.params.id };
  }),
  route("DELETE", "contributions/:id", (ctx) => {
    owned(db(), "contributions", ctx.params.id, ctx.user.id);
    db().prepare("DELETE FROM contributions WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  // Dashboard
  route("GET", "dashboard", (ctx) => dashboard(ctx)),
];

function dashboard(ctx: Ctx) {
  const userId = ctx.user.id;
  const period = ctx.query.get("period") ?? "this_month";
  const range = periodRange(period);
  const sum = (type: string) => round2(
    (db().prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE user_id = ? AND type = ? AND date BETWEEN ? AND ?")
      .get(userId, type, range.from, range.to) as { s: number }).s,
  );
  const count = (type: string) =>
    (db().prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = ? AND date BETWEEN ? AND ?")
      .get(userId, type, range.from, range.to) as { n: number }).n;

  const balance = round2(
    (db().prepare(`
      SELECT COALESCE(SUM(a.initial_balance), 0) + COALESCE((
        SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END)
        FROM transactions t JOIN accounts a2 ON a2.id = t.account_id
        WHERE a2.user_id = ? AND a2.archived = 0), 0) AS balance
      FROM accounts a WHERE a.user_id = ? AND a.archived = 0`).get(userId, userId) as { balance: number }).balance,
  );
  const activeAccounts = (db().prepare("SELECT COUNT(*) AS n FROM accounts WHERE user_id = ? AND archived = 0").get(userId) as { n: number }).n;

  const income = sum("income");
  const expenses = sum("expense");
  const byCategory = (db().prepare(`
    SELECT t.category_id AS categoryId, c.name AS name, SUM(t.amount) AS amount
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ? AND t.type = 'expense' AND t.date BETWEEN ? AND ?
    GROUP BY t.category_id ORDER BY amount DESC`).all(userId, range.from, range.to) as { categoryId: string; name: string; amount: number }[])
    .map((c) => ({ ...c, amount: round2(c.amount), percent: expenses ? Math.round((c.amount / expenses) * 100) : 0 }));

  const flow = db().prepare("SELECT date, type, amount FROM transactions WHERE user_id = ? AND date BETWEEN ? AND ?")
    .all(userId, range.from, range.to) as { date: string; type: string; amount: number }[];
  const start = new Date(`${range.from}T00:00:00Z`).getTime();
  const weeklyFlow = [0, 1, 2, 3].map((i) => ({ label: `Week ${i + 1}`, income: 0, expenses: 0 }));
  for (const t of flow) {
    const bucket = weeklyFlow[Math.min(3, Math.max(0, Math.floor((new Date(`${t.date}T00:00:00Z`).getTime() - start) / (7 * DAY_MS))))];
    if (t.type === "income") bucket.income = round2(bucket.income + t.amount);
    else bucket.expenses = round2(bucket.expenses + t.amount);
  }

  const budgets = listBudgetViews(userId);
  const goals = (db().prepare("SELECT * FROM goals WHERE user_id = ? AND status = 'active' ORDER BY created_at").all(userId) as Row[])
    .map(goalView);
  const upcomingBills = (db().prepare("SELECT * FROM bills WHERE user_id = ? AND status = 'upcoming' ORDER BY due_date LIMIT 5").all(userId) as Row[])
    .map(billView);
  const recentTransactions = (db().prepare(`${txSelect} WHERE t.user_id = ? ORDER BY t.date DESC, t.created_at DESC LIMIT 5`)
    .all(userId) as Row[]).map(txView);

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
    activeAccounts,
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

