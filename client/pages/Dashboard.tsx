import { useState } from "react";
import { useNavigate } from "react-router";
import { BudgetForm, ContributionForm, TransactionForm } from "../components/forms";
import { WhatIf } from "../components/WhatIf";
import { Icon, Modal, SectionTitle, StateText } from "../components/ui";
import { api } from "../lib/api";
import { formatMoney, monthYear, shortDate, timeAgo } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import type { Account, Bill, Category, Dashboard as DashboardData, Goal, Listing, Post } from "../lib/types";

const PERIODS = [
  ["this_month", "This month"], ["last_month", "Last month"], ["last_3_months", "Last 3 months"], ["this_year", "This year"],
] as const;

const BAR_TONES = ["orange", "blue", "dark", "light"];

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const [period, setPeriod] = useState<string>("this_month");
  const [modal, setModal] = useState<null | "transaction" | "budget" | "contribution">(null);
  const [contributionGoal, setContributionGoal] = useState<string>("");

  const dash = useApi<DashboardData>(`/dashboard?period=${period}`);
  const accounts = useApi<Account[]>("/accounts");
  const categories = useApi<Category[]>("/categories");
  const listings = useApi<{ items: Listing[] }>("/listings?pageSize=2");
  const posts = useApi<{ items: Post[] }>("/posts?sort=popular&pageSize=2");
  const activeGoals = useApi<Goal[]>("/goals?status=active");

  const refreshAll = () => {
    dash.reload();
    accounts.reload();
    listings.reload();
    posts.reload();
    activeGoals.reload();
  };

  const d = dash.data;
  const maxBar = Math.max(1, ...(d?.weeklyFlow.flatMap((w) => [w.income, w.expenses]) ?? [1]));
  const expenseTotal = d?.expenses ?? 0;
  const budgets = d?.budgets ?? [];

  const markPaid = async (bill: Bill) => {
    await api(`/bills/${bill.id}/mark-paid`, { method: "POST" });
    dash.reload();
  };

  return (
    <div className="content">
      <section className="welcome">
        <div>
          <span className="eyebrow">FINANCIAL OVERVIEW</span>
          <h2>Good {greeting()}, {user?.firstName ?? "there"}!</h2>
          <p>Here is your financial overview. {d && d.income >= d.expenses ? "You’re making steady progress this month." : "Expenses are above income this period."}</p>
        </div>
        <div className="welcome-actions">
          <button className="primary" onClick={() => setModal("transaction")}><Icon name="plus" size={18} /> Add transaction</button>
          <button className="secondary" onClick={() => setModal("budget")}>Create budget</button>
          <button className="secondary desktop-only" onClick={() => { setContributionGoal(""); setModal("contribution"); }}>Add to savings</button>
        </div>
      </section>

      <div className="summary-head">
        <p>Synced from your saved records <span>• Updated just now</span></p>
        <label>Period <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>

      <StateText loading={dash.loading} error={dash.error} empty={!d} />

      {d && <>
        <section className="summary-grid">
          {[
            { label: "Total balance", value: d.balance, note: `Across ${d.activeAccounts} active accounts`, icon: "wallet" as const, tone: "dark", path: "/accounts" },
            { label: "Monthly income", value: d.income, note: `${d.incomeCount} income transactions`, icon: "income" as const, tone: "blue", path: "/transactions?type=income" },
            { label: "Monthly expenses", value: d.expenses, note: `${d.expenseCount} expense transactions`, icon: "expense" as const, tone: "red", path: "/transactions?type=expense" },
            { label: "Total saved", value: d.saved, note: `Across ${d.activeGoals} active goals`, icon: "saving" as const, tone: "orange", path: "/goals" },
          ].map((card) => (
            <button className={`summary-card ${card.tone} clickable-card`} key={card.label} onClick={() => navigate(card.path)}>
              <div className="card-top"><span className="summary-icon"><Icon name={card.icon} /></span><span aria-label={`View ${card.label} details`}><Icon name="more" /></span></div>
              <p>{card.label}</p>
              <strong>{formatMoney(card.value, currency)}</strong>
              <small>{card.note}</small>
            </button>
          ))}
        </section>

        <section className="analytics-grid">
          <article className="card chart-card">
            <SectionTitle title="Income vs expenses" subtitle={`Cash flow · ${PERIODS.find(([v]) => v === period)?.[1]}`} />
            <div className="chart-legend"><span><i className="income-dot" />Income</span><span><i className="expense-dot" />Expenses</span></div>
            <div className="bar-chart" aria-label="Bar chart comparing weekly income and expenses">
              <div className="y-axis"><span>{formatMoney(maxBar, currency)}</span><span>{formatMoney(maxBar / 2, currency)}</span><span>0</span></div>
              <div className="chart-area">
                <div className="grid-lines"><i /><i /><i /><i /></div>
                {d.weeklyFlow.map((bar) => (
                  <div className="bar-group" key={bar.label}>
                    <div className="bars">
                      <button className="bar-income" style={{ height: `${(bar.income / maxBar) * 100}%` }} title={`Income · ${bar.label}`} onClick={() => navigate("/transactions?type=income")} />
                      <button className="bar-expense" style={{ height: `${(bar.expenses / maxBar) * 100}%` }} title={`Expenses · ${bar.label}`} onClick={() => navigate("/transactions?type=expense")} />
                    </div>
                    <span>{bar.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="card spending-card">
            <SectionTitle title="Spending by category" subtitle="Where your money goes" action="Details" onAction={() => navigate("/transactions?type=expense")} />
            <div className="spending-content">
              <div className="donut"><div><strong>{formatMoney(expenseTotal, currency)}</strong><span>Total spent</span></div></div>
              <div className="category-list">
                {d.byCategory.length === 0 && <p className="muted-small">No expenses in this period yet.</p>}
                {d.byCategory.map((c, i) => (
                  <button className="category-row" key={c.categoryId} onClick={() => navigate(`/transactions?type=expense&categoryId=${c.categoryId}`)}>
                    <span><i className={`cat-${BAR_TONES[i % BAR_TONES.length]}`} />{c.name}</span>
                    <div><strong>{formatMoney(c.amount, currency)}</strong><small>{c.percent}%</small></div>
                  </button>
                ))}
              </div>
            </div>
          </article>
        </section>

        <section className="split-grid">
          <article className="card">
            <SectionTitle title="My budgets" subtitle="Monthly spending limits" action="View all" onAction={() => navigate("/budgets")} />
            <div className="budget-list">
              {budgets.length === 0 && <p className="muted-small">No budgets yet. Create one to track your limits.</p>}
              {budgets.map((b) => (
                <div className="budget-row" key={b.id}>
                  <span className={`budget-icon ${b.status === "over" ? "red" : ""}`}>{b.name[0]}</span>
                  <div className="budget-data">
                    <div><strong>{b.name}</strong><span className={b.status === "over" ? "danger-text" : ""}>{formatMoney(b.spent, currency)} <small>of {formatMoney(b.limit, currency)}</small></span></div>
                    <div className="progress"><i className={b.status === "over" ? "red" : "orange"} style={{ width: `${Math.min(b.percent, 100)}%` }} /></div>
                    <div className="budget-foot"><span className={b.status === "over" ? "danger-text" : ""}>{b.status === "over" ? `${formatMoney(b.overBy, currency)} over budget` : `${formatMoney(b.remaining, currency)} remaining`}</span><b>{b.percent}%</b></div>
                  </div>
                </div>
              ))}
            </div>
            <button className="outline full-button" onClick={() => setModal("budget")}><Icon name="plus" size={17} /> Create budget</button>
          </article>

          <article className="card">
            <SectionTitle title="Savings goals" subtitle="Keep your dreams moving" action="View all" onAction={() => navigate("/goals")} />
            <div className="goal-list">
              {d.goals.length === 0 && <p className="muted-small">No active goals. Create one to start saving.</p>}
              {d.goals.map((g, i) => (
                <div className="goal-row" key={g.id}>
                  <div className="goal-title">
                    <span className={`goal-icon ${i % 2 ? "orange" : "blue"}`}><Icon name="target" /></span>
                    <div><strong>{g.title}</strong><small>Target · {g.targetDate ? monthYear(g.targetDate) : "No date"}</small></div>
                    <b>{g.progress}%</b>
                  </div>
                  <div className="progress large"><i className={i % 2 ? "orange" : "blue"} style={{ width: `${g.progress}%` }} /></div>
                  <div className="goal-foot"><span><strong>{formatMoney(g.savedAmount, currency)}</strong> saved</span><span>{formatMoney(g.remaining, currency)} to go</span></div>
                  <div className="goal-actions">
                    <button onClick={() => { setContributionGoal(g.id); setModal("contribution"); }}>+ Add contribution</button>
                    <button onClick={() => navigate(`/goals/${g.id}`)}>View goal</button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="card">
          <WhatIf currency={currency} />
        </section>

        <section className="lower-grid">
          <article className="card payments-card">
            <SectionTitle title="Upcoming payments" subtitle="Nothing is paid automatically" action="All bills" onAction={() => navigate("/bills")} />
            {d.upcomingBills.length === 0 && <p className="muted-small">No upcoming bills.</p>}
            {d.upcomingBills.map((b) => (
              <div className="payment-row" key={b.id}>
                <span className="payment-icon">{b.name[0]}</span>
                <div><strong>{b.name}</strong><small>Due {shortDate(b.dueDate)}</small></div>
                <strong>{formatMoney(b.amount, currency)}</strong>
                <em className="soon">Due soon</em>
                <button onClick={() => markPaid(b)}>Mark paid</button>
              </div>
            ))}
          </article>

          <article className="card community-card">
            <SectionTitle title="Community highlights" action="Visit community" onAction={() => navigate("/community")} />
            {(posts.data?.items ?? []).length === 0 && <p className="muted-small">No discussions yet. Start one from the Community page.</p>}
            {(posts.data?.items ?? []).map((post) => (
              <button className="discussion discussion-button" key={post.id} onClick={() => navigate(`/community/${post.id}`)}>
                <span className="avatar peach">{post.author.initials}</span>
                <div>
                  <small>{post.category}</small>
                  <strong>{post.title}</strong>
                  <p>{post.author.name} · {timeAgo(post.createdAt)} <span><Icon name="message" size={14} /> {post.replyCount} replies · ♥ {post.reactionCount}</span></p>
                </div>
              </button>
            ))}
            <button className="outline full-button" onClick={() => navigate("/community")}><Icon name="plus" size={17} /> Create a post</button>
          </article>
        </section>

        <section className="card marketplace-card">
          <SectionTitle title="Marketplace" subtitle="Great finds from the Saviny community" action="Explore marketplace" onAction={() => navigate("/marketplace")} />
          <div className="market-grid">
            {(listings.data?.items ?? []).map((item) => (
              <article className="listing" key={item.id}>
                <div className="listing-image">
                  {item.image ? <img src={item.image} alt={item.title} /> : <span className="listing-placeholder"><Icon name="store" /></span>}
                </div>
                <div>
                  <small>{item.category} · {item.condition}</small>
                  <strong>{item.title}</strong>
                  <p>{formatMoney(item.price, currency)}</p>
                  <button onClick={() => navigate(`/marketplace/${item.id}`)}>View listing <Icon name="arrow" size={14} /></button>
                </div>
              </article>
            ))}
            <div className="sell-card">
              <span><Icon name="store" /></span>
              <div><h3>Give unused items a new home</h3><p>List safely in your local Saviny community.</p><button onClick={() => navigate("/marketplace/my-listings")}>Sell an item</button></div>
            </div>
          </div>
        </section>
      </>}

      {modal === "transaction" && accounts.data && categories.data && (
        <Modal title="Add transaction" onClose={() => setModal(null)}>
          <TransactionForm accounts={accounts.data} categories={categories.data} onSaved={() => { setModal(null); refreshAll(); }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal === "budget" && categories.data && (
        <Modal title="Create budget" onClose={() => setModal(null)}>
          <BudgetForm categories={categories.data} onSaved={() => { setModal(null); refreshAll(); }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal === "contribution" && (
        <Modal title="Add savings contribution" onClose={() => setModal(null)}>
          {(activeGoals.data ?? []).length === 0 ? (
            <div className="placeholder-page"><h3>No active goal</h3><p>Create a savings goal first, then add contributions to it.</p><button className="primary" onClick={() => navigate("/goals")}>Go to savings goals</button></div>
          ) : (
            <>
              <label className="goal-picker">Goal
                <select value={contributionGoal} onChange={(e) => setContributionGoal(e.target.value)}>
                  <option value="">Choose a goal</option>
                  {(activeGoals.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </label>
              {contributionGoal && <ContributionForm goalId={contributionGoal} onSaved={() => { setModal(null); refreshAll(); }} onCancel={() => setModal(null)} />}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}


