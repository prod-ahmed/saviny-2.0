import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/auth";
import { isoDate, owned, periodRange } from "../common/domain";
import { newId, nowIso, round2 } from "../common/security";
import { DatabaseService } from "../database/database.module";
import { Row } from "../database/types";
import {
  AccountDto, AccountUpdateDto, BillDto, BillUpdateDto, BudgetDto, BudgetUpdateDto, CategoryDto, ContributionDto, GoalDto,
  GoalUpdateDto, RecurringDto, RecurringUpdateDto, TransactionDto, TransactionUpdateDto,
} from "./finance.dto";

type User = { id: string };

const DAY_MS = 86_400_000;

@Controller()
export class FinanceController {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  // ---- Views -----------------------------------------------------------------

  private accountBalance(accountId: string): number {
    const r = this.db.prepare(`
      SELECT a.initial_balance + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0) AS balance
      FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
      WHERE a.id = ? GROUP BY a.id`).get(accountId) as { balance: number } | undefined;
    return round2(r?.balance ?? 0);
  }

  private accountView(r: Row) {
    return {
      id: r.id, name: r.name, type: r.type, initialBalance: r.initial_balance, archived: !!r.archived,
      createdAt: r.created_at, balance: this.accountBalance(r.id),
    };
  }

  private txView(r: Row) {
    return {
      id: r.id, type: r.type, amount: r.amount, date: r.date, description: r.description,
      accountId: r.account_id, accountName: r.account_name, categoryId: r.category_id, categoryName: r.category_name,
      createdAt: r.created_at,
    };
  }

  private readonly txSelect = `
    SELECT t.*, a.name AS account_name, c.name AS category_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN categories c ON c.id = t.category_id`;

  private budgetCategoryIds(budgetId: string): string[] {
    return (this.db.prepare("SELECT category_id FROM budget_categories WHERE budget_id = ?").all(budgetId) as { category_id: string }[])
      .map((r) => r.category_id);
  }

  private budgetRange(b: Row): { from: string; to: string } {
    if (b.period === "custom" && b.start_date && b.end_date) return { from: b.start_date, to: b.end_date };
    if (b.period === "weekly") {
      const to = new Date();
      return { from: isoDate(new Date(to.getTime() - 6 * DAY_MS)), to: isoDate(to) };
    }
    return periodRange("this_month");
  }

  private budgetView(b: Row) {
    const range = this.budgetRange(b);
    const categoryIds = this.budgetCategoryIds(b.id);
    const spent = round2(
      (this.db.prepare(`
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
      categoryIds,
      spent,
      remaining: round2(Math.max(0, b.limit_amount - spent)),
      overBy: round2(Math.max(0, spent - b.limit_amount)),
      percent,
      status: percent > 100 ? "over" : percent >= 80 ? "near_limit" : "on_track",
      range,
    };
  }

  private goalView(g: Row) {
    const contributions = this.db.prepare("SELECT amount, date FROM contributions WHERE goal_id = ?").all(g.id) as { amount: number; date: string }[];
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

  private billView(b: Row) {
    return {
      id: b.id, name: b.name, amount: b.amount, dueDate: b.due_date, kind: b.kind, status: b.status,
      accountId: b.account_id, createdAt: b.created_at,
    };
  }

  private assertAccount(user: User, id?: string | null) {
    if (id) owned(this.db, "accounts", id, user.id);
  }

  private assertCategory(user: User, id: string) {
    owned(this.db, "categories", id, user.id);
  }

  // ---- Accounts --------------------------------------------------------------

  @Get("accounts")
  listAccounts(@CurrentUser() user: User) {
    const rows = this.db.prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at").all(user.id) as Row[];
    return rows.map((r) => this.accountView(r));
  }

  @Post("accounts")
  createAccount(@CurrentUser() user: User, @Body() dto: AccountDto) {
    const id = newId();
    this.db.prepare("INSERT INTO accounts (id, user_id, name, type, initial_balance, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, user.id, dto.name.trim(), dto.type, round2(dto.initialBalance), nowIso());
    return this.accountView(owned(this.db, "accounts", id, user.id));
  }

  @Get("accounts/:id")
  getAccount(@CurrentUser() user: User, @Param("id") id: string) {
    return this.accountView(owned(this.db, "accounts", id, user.id));
  }

  @Patch("accounts/:id")
  updateAccount(@CurrentUser() user: User, @Param("id") id: string, @Body() dto: AccountUpdateDto) {
    owned(this.db, "accounts", id, user.id);
    this.db.prepare("UPDATE accounts SET name = COALESCE(?, name), type = COALESCE(?, type) WHERE id = ?")
      .run(dto.name?.trim() ?? null, dto.type ?? null, id);
    return this.accountView(owned(this.db, "accounts", id, user.id));
  }

  /** Archiving keeps history but removes the account from active totals. */
  @Post("accounts/:id/archive")
  archiveAccount(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "accounts", id, user.id);
    this.db.prepare("UPDATE accounts SET archived = 1 WHERE id = ?").run(id);
    return { archived: true };
  }

  /** Deletes the account and, through ON DELETE CASCADE, its transactions. */
  @Delete("accounts/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAccount(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "accounts", id, user.id);
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  }

  // ---- Categories ------------------------------------------------------------

  @Get("categories")
  listCategories(@CurrentUser() user: User) {
    return this.db.prepare("SELECT id, name, archived FROM categories WHERE user_id = ? ORDER BY name").all(user.id)
      .map((c: any) => ({ ...c, archived: !!c.archived }));
  }

  @Post("categories")
  createCategory(@CurrentUser() user: User, @Body() dto: CategoryDto) {
    const id = newId();
    try {
      this.db.prepare("INSERT INTO categories (id, user_id, name) VALUES (?, ?, ?)").run(id, user.id, dto.name.trim());
    } catch {
      throw new BadRequestException("A category with this name already exists");
    }
    return { id, name: dto.name.trim(), archived: false };
  }

  @Patch("categories/:id")
  renameCategory(@CurrentUser() user: User, @Param("id") id: string, @Body() dto: CategoryDto) {
    owned(this.db, "categories", id, user.id);
    try {
      this.db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(dto.name.trim(), id);
    } catch {
      throw new BadRequestException("A category with this name already exists");
    }
    return { id, name: dto.name.trim() };
  }

  /** A category in use is archived so past transactions keep their label; an unused one is removed. */
  @Delete("categories/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "categories", id, user.id);
    const used = this.db.prepare(`
      SELECT 1 FROM transactions WHERE category_id = ? UNION SELECT 1 FROM budget_categories WHERE category_id = ?
      UNION SELECT 1 FROM recurring_transactions WHERE category_id = ?`).get(id, id, id);
    if (used) this.db.prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(id);
    else this.db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  }

  // ---- Transactions ----------------------------------------------------------

  @Get("transactions")
  listTransactions(
    @CurrentUser() user: User,
    @Query("type") type?: string,
    @Query("accountId") accountId?: string,
    @Query("categoryId") categoryId?: string,
    @Query("search") search?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "50",
  ) {
    const where = ["t.user_id = ?"];
    const params: unknown[] = [user.id];
    if (type) { where.push("t.type = ?"); params.push(type); }
    if (accountId) { where.push("t.account_id = ?"); params.push(accountId); }
    if (categoryId) { where.push("t.category_id = ?"); params.push(categoryId); }
    if (from) { where.push("t.date >= ?"); params.push(from); }
    if (to) { where.push("t.date <= ?"); params.push(to); }
    if (search?.trim()) {
      where.push("(LOWER(t.description) LIKE ? OR LOWER(c.name) LIKE ?)");
      const term = `%${search.trim().toLowerCase()}%`;
      params.push(term, term);
    }
    const clause = where.join(" AND ");
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id WHERE ${clause}`)
      .get(...params) as { n: number }).n;
    const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
    const offset = (Math.max(1, Number(page) || 1) - 1) * size;
    const rows = this.db.prepare(`${this.txSelect} WHERE ${clause} ORDER BY t.date DESC, t.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, size, offset) as Row[];
    return { items: rows.map((r) => this.txView(r)), total };
  }

  @Post("transactions")
  createTransaction(@CurrentUser() user: User, @Body() dto: TransactionDto) {
    this.assertAccount(user, dto.accountId);
    this.assertCategory(user, dto.categoryId);
    const id = newId();
    this.db.prepare(`INSERT INTO transactions (id, user_id, type, amount, date, description, account_id, category_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, user.id, dto.type, round2(dto.amount), dto.date.slice(0, 10), dto.description?.trim() ?? "", dto.accountId, dto.categoryId, nowIso());
    return this.txView(this.findTx(user, id));
  }

  private findTx(user: User, id: string): Row {
    return this.db.prepare(`${this.txSelect} WHERE t.id = ? AND t.user_id = ?`).get(id, user.id) as Row;
  }

  @Get("transactions/:id")
  getTransaction(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "transactions", id, user.id);
    return this.txView(this.findTx(user, id));
  }

  @Patch("transactions/:id")
  updateTransaction(@CurrentUser() user: User, @Param("id") id: string, @Body() dto: TransactionUpdateDto) {
    owned(this.db, "transactions", id, user.id);
    this.assertAccount(user, dto.accountId);
    if (dto.categoryId) this.assertCategory(user, dto.categoryId);
    this.db.prepare(`UPDATE transactions SET
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
    return this.txView(this.findTx(user, id));
  }

  @Delete("transactions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTransaction(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "transactions", id, user.id);
    this.db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  }

  // ---- Recurring transactions ------------------------------------------------

  private nextOccurrence(date: string, frequency: string): string {
    const d = new Date(`${date}T00:00:00Z`);
    if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
    else if (frequency === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  }

  private recurringView(r: Row) {
    return {
      id: r.id, type: r.type, amount: r.amount, description: r.description, accountId: r.account_id,
      categoryId: r.category_id, frequency: r.frequency, nextDate: r.next_date, active: !!r.active,
    };
  }

  @Get("recurring")
  listRecurring(@CurrentUser() user: User) {
    return (this.db.prepare("SELECT * FROM recurring_transactions WHERE user_id = ? ORDER BY next_date").all(user.id) as Row[])
      .map((r) => this.recurringView(r));
  }

  @Post("recurring")
  createRecurring(@CurrentUser() user: User, @Body() dto: RecurringDto) {
    this.assertAccount(user, dto.accountId);
    this.assertCategory(user, dto.categoryId);
    const id = newId();
    this.db.prepare(`INSERT INTO recurring_transactions
      (id, user_id, type, amount, description, account_id, category_id, frequency, next_date, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .run(id, user.id, dto.type, round2(dto.amount), dto.description?.trim() ?? "", dto.accountId, dto.categoryId, dto.frequency, dto.nextDate.slice(0, 10), nowIso());
    return this.recurringView(owned(this.db, "recurring_transactions", id, user.id));
  }

  @Patch("recurring/:id")
  updateRecurring(@CurrentUser() user: User, @Param("id") id: string, @Body() dto: RecurringUpdateDto) {
    owned(this.db, "recurring_transactions", id, user.id);
    this.db.prepare(`UPDATE recurring_transactions SET
        active = COALESCE(?, active), frequency = COALESCE(?, frequency), next_date = COALESCE(?, next_date),
        amount = COALESCE(?, amount), description = COALESCE(?, description)
      WHERE id = ?`).run(
      dto.active === undefined ? null : dto.active ? 1 : 0,
      dto.frequency ?? null,
      dto.nextDate?.slice(0, 10) ?? null,
      dto.amount === undefined ? null : round2(dto.amount),
      dto.description?.trim() ?? null,
      id,
    );
    return this.recurringView(owned(this.db, "recurring_transactions", id, user.id));
  }

  /** Confirms one occurrence: creates the transaction and moves the schedule forward. Nothing is automatic. */
  @Post("recurring/:id/confirm")
  confirmRecurring(@CurrentUser() user: User, @Param("id") id: string) {
    const r = owned(this.db, "recurring_transactions", id, user.id);
    const txId = newId();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO transactions (id, user_id, type, amount, date, description, account_id, category_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(txId, user.id, r.type, r.amount, r.next_date, r.description, r.account_id, r.category_id, nowIso());
      this.db.prepare("UPDATE recurring_transactions SET next_date = ? WHERE id = ?").run(this.nextOccurrence(r.next_date, r.frequency), id);
    })();
    return this.txView(this.findTx(user, txId));
  }

  @Delete("recurring/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRecurring(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "recurring_transactions", id, user.id);
    this.db.prepare("DELETE FROM recurring_transactions WHERE id = ?").run(id);
  }

  // ---- Budgets ---------------------------------------------------------------

  private setBudgetCategories(budgetId: string, user: User, categoryIds: string[]) {
    this.db.prepare("DELETE FROM budget_categories WHERE budget_id = ?").run(budgetId);
    for (const categoryId of categoryIds) {
      this.assertCategory(user, categoryId);
      this.db.prepare("INSERT INTO budget_categories (budget_id, category_id) VALUES (?, ?)").run(budgetId, categoryId);
    }
  }

  @Get("budgets")
  listBudgets(@CurrentUser() user: User) {
    return (this.db.prepare("SELECT * FROM budgets WHERE user_id = ? ORDER BY created_at").all(user.id) as Row[])
      .map((b) => this.budgetView(b));
  }

  @Post("budgets")
  createBudget(@CurrentUser() user: User, @Body() dto: BudgetDto) {
    const id = newId();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO budgets (id, user_id, name, limit_amount, period, start_date, end_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.id, dto.name.trim(), round2(dto.limit), dto.period, dto.startDate?.slice(0, 10) ?? null, dto.endDate?.slice(0, 10) ?? null, nowIso());
      this.setBudgetCategories(id, user, dto.categoryIds);
    })();
    return this.budgetView(owned(this.db, "budgets", id, user.id));
  }

  @Get("budgets/:id")
  getBudget(@CurrentUser() user: User, @Param("id") id: string) {
    return this.budgetView(owned(this.db, "budgets", id, user.id));
  }

  @Patch("budgets/:id")
  updateBudget(@CurrentUser() user: User, @Param("id") id: string, @Body() dto: BudgetUpdateDto) {
    owned(this.db, "budgets", id, user.id);
    this.db.transaction(() => {
      this.db.prepare(`UPDATE budgets SET
          name = COALESCE(?, name), limit_amount = COALESCE(?, limit_amount), period = COALESCE(?, period),
          start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date)
        WHERE id = ?`).run(
        dto.name?.trim() ?? null, dto.limit === undefined ? null : round2(dto.limit), dto.period ?? null,
        dto.startDate?.slice(0, 10) ?? null, dto.endDate?.slice(0, 10) ?? null, id,
      );
      if (dto.categoryIds) this.setBudgetCategories(id, user, dto.categoryIds);
    })();
    return this.budgetView(owned(this.db, "budgets", id, user.id));
  }

  @Delete("budgets/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBudget(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "budgets", id, user.id);
    this.db.prepare("DELETE FROM budgets WHERE id = ?").run(id);
  }

  // ---- Bills and scheduled payments ------------------------------------------

  @Get("bills")
  listBills(@CurrentUser() user: User) {
    return (this.db.prepare("SELECT * FROM bills WHERE user_id = ? ORDER BY due_date").all(user.id) as Row[]).map((b) => this.billView(b));
  }

  @Post("bills")
  createBill(@CurrentUser() user: User, @Body() dto: BillDto) {
    this.assertAccount(user, dto.accountId);
    const id = newId();
    this.db.prepare(`INSERT INTO bills (id, user_id, name, amount, due_date, kind, status, account_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'upcoming', ?, ?)`)
      .run(id, user.id, dto.name.trim(), round2(dto.amount), dto.dueDate.slice(0, 10), dto.kind, dto.accountId ?? null, nowIso());
    return this.billView(owned(this.db, "bills", id, user.id));
  }

  @Patch("bills/:id")
  updateBill(@CurrentUser() user: User, @Param("id") id: string, @Body() dto: BillUpdateDto) {
    owned(this.db, "bills", id, user.id);
    this.db.prepare(`UPDATE bills SET name = COALESCE(?, name), amount = COALESCE(?, amount),
        due_date = COALESCE(?, due_date), kind = COALESCE(?, kind) WHERE id = ?`)
      .run(dto.name?.trim() ?? null, dto.amount === undefined ? null : round2(dto.amount), dto.dueDate?.slice(0, 10) ?? null, dto.kind ?? null, id);
    return this.billView(owned(this.db, "bills", id, user.id));
  }

  /** Only records the status: Saviny never initiates a payment. */
  @Post("bills/:id/mark-paid")
  markBillPaid(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "bills", id, user.id);
    this.db.prepare("UPDATE bills SET status = 'paid' WHERE id = ?").run(id);
    return this.billView(owned(this.db, "bills", id, user.id));
  }

  @Delete("bills/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBill(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "bills", id, user.id);
    this.db.prepare("DELETE FROM bills WHERE id = ?").run(id);
  }

  // ---- Savings goals ---------------------------------------------------------

  @Get("goals")
  listGoals(@CurrentUser() user: User, @Query("status") status?: string) {
    const rows = status
      ? (this.db.prepare("SELECT * FROM goals WHERE user_id = ? AND status = ? ORDER BY created_at").all(user.id, status) as Row[])
      : (this.db.prepare("SELECT * FROM goals WHERE user_id = ? ORDER BY created_at").all(user.id) as Row[]);
    return rows.map((g) => this.goalView(g));
  }

  @Post("goals")
  createGoal(@CurrentUser() user: User, @Body() dto: GoalDto) {
    const id = newId();
    this.db.prepare(`INSERT INTO goals (id, user_id, title, description, target_amount, target_date, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`)
      .run(id, user.id, dto.title.trim(), dto.description?.trim() ?? "", round2(dto.targetAmount), dto.targetDate?.slice(0, 10) ?? null, nowIso());
    return this.goalView(owned(this.db, "goals", id, user.id));
  }

  @Get("goals/:id")
  getGoal(@CurrentUser() user: User, @Param("id") id: string) {
    return this.goalView(owned(this.db, "goals", id, user.id));
  }

  @Patch("goals/:id")
  updateGoal(@CurrentUser() user: User, @Param("id") id: string, @Body() dto: GoalUpdateDto) {
    owned(this.db, "goals", id, user.id);
    this.db.prepare(`UPDATE goals SET title = COALESCE(?, title), description = COALESCE(?, description),
        target_amount = COALESCE(?, target_amount), target_date = COALESCE(?, target_date) WHERE id = ?`)
      .run(dto.title?.trim() ?? null, dto.description?.trim() ?? null, dto.targetAmount === undefined ? null : round2(dto.targetAmount),
        dto.targetDate?.slice(0, 10) ?? null, id);
    return this.goalView(owned(this.db, "goals", id, user.id));
  }

  @Post("goals/:id/archive")
  archiveGoal(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "goals", id, user.id);
    this.db.prepare("UPDATE goals SET status = 'archived' WHERE id = ?").run(id);
    return { status: "archived" };
  }

  @Delete("goals/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteGoal(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "goals", id, user.id);
    this.db.prepare("DELETE FROM goals WHERE id = ?").run(id);
  }

  @Get("goals/:id/contributions")
  listContributions(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "goals", id, user.id);
    return this.db.prepare("SELECT * FROM contributions WHERE goal_id = ? ORDER BY date DESC, created_at DESC").all(id)
      .map((c: any) => ({ id: c.id, goalId: c.goal_id, amount: c.amount, date: c.date, note: c.note }));
  }

  @Post("goals/:id/contributions")
  addContribution(@CurrentUser() user: User, @Param("id") id: string, @Body() dto: ContributionDto) {
    const goal = owned(this.db, "goals", id, user.id);
    if (goal.status !== "active") throw new BadRequestException("Only active goals accept contributions");
    const contributionId = newId();
    this.db.prepare("INSERT INTO contributions (id, user_id, goal_id, amount, date, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(contributionId, user.id, id, round2(dto.amount), dto.date.slice(0, 10), dto.note?.trim() ?? "", nowIso());
    return { contributionId, goal: this.goalView(goal) };
  }

  @Patch("contributions/:id")
  updateContribution(@CurrentUser() user: User, @Param("id") id: string, @Body() dto: ContributionDto) {
    owned(this.db, "contributions", id, user.id);
    this.db.prepare("UPDATE contributions SET amount = ?, date = ?, note = COALESCE(?, note) WHERE id = ?")
      .run(round2(dto.amount), dto.date.slice(0, 10), dto.note?.trim() ?? null, id);
    return { id };
  }

  @Delete("contributions/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteContribution(@CurrentUser() user: User, @Param("id") id: string) {
    owned(this.db, "contributions", id, user.id);
    this.db.prepare("DELETE FROM contributions WHERE id = ?").run(id);
  }

  // ---- Dashboard -------------------------------------------------------------

  @Get("dashboard")
  dashboard(@CurrentUser() user: User, @Query("period") period = "this_month") {
    const range = periodRange(period);
    const sum = (type: string) => round2(
      (this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE user_id = ? AND type = ? AND date BETWEEN ? AND ?")
        .get(user.id, type, range.from, range.to) as { s: number }).s,
    );
    const count = (type: string) =>
      (this.db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = ? AND date BETWEEN ? AND ?")
        .get(user.id, type, range.from, range.to) as { n: number }).n;

    const balance = round2(
      (this.db.prepare(`
        SELECT COALESCE(SUM(a.initial_balance), 0) + COALESCE((
          SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END)
          FROM transactions t JOIN accounts a2 ON a2.id = t.account_id
          WHERE a2.user_id = ? AND a2.archived = 0), 0) AS balance
        FROM accounts a WHERE a.user_id = ? AND a.archived = 0`).get(user.id, user.id) as { balance: number }).balance,
    );
    const activeAccounts = (this.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE user_id = ? AND archived = 0").get(user.id) as { n: number }).n;

    const income = sum("income");
    const expenses = sum("expense");
    const byCategory = (this.db.prepare(`
      SELECT t.category_id AS categoryId, c.name AS name, SUM(t.amount) AS amount
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND t.type = 'expense' AND t.date BETWEEN ? AND ?
      GROUP BY t.category_id ORDER BY amount DESC`).all(user.id, range.from, range.to) as { categoryId: string; name: string; amount: number }[])
      .map((c) => ({ ...c, amount: round2(c.amount), percent: expenses ? Math.round((c.amount / expenses) * 100) : 0 }));

    const flow = this.db.prepare("SELECT date, type, amount FROM transactions WHERE user_id = ? AND date BETWEEN ? AND ?")
      .all(user.id, range.from, range.to) as { date: string; type: string; amount: number }[];
    const start = new Date(`${range.from}T00:00:00Z`).getTime();
    const weeklyFlow = [0, 1, 2, 3].map((i) => ({ label: `Week ${i + 1}`, income: 0, expenses: 0 }));
    for (const t of flow) {
      const bucket = weeklyFlow[Math.min(3, Math.max(0, Math.floor((new Date(`${t.date}T00:00:00Z`).getTime() - start) / (7 * DAY_MS))))];
      if (t.type === "income") bucket.income = round2(bucket.income + t.amount);
      else bucket.expenses = round2(bucket.expenses + t.amount);
    }

    const budgets = this.listBudgets(user);
    const goals = (this.db.prepare("SELECT * FROM goals WHERE user_id = ? AND status = 'active' ORDER BY created_at").all(user.id) as Row[])
      .map((g) => this.goalView(g));
    const upcomingBills = (this.db.prepare("SELECT * FROM bills WHERE user_id = ? AND status = 'upcoming' ORDER BY due_date LIMIT 5").all(user.id) as Row[])
      .map((b) => this.billView(b));
    const recentTransactions = (this.db.prepare(`${this.txSelect} WHERE t.user_id = ? ORDER BY t.date DESC, t.created_at DESC LIMIT 5`)
      .all(user.id) as Row[]).map((r) => this.txView(r));

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
}
