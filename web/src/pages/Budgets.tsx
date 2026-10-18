import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BudgetForm } from "../components/forms";
import { Confirm, EmptyState, Icon, Modal, PageHeader, StateText } from "../components/ui";
import { api } from "../lib/api";
import { formatMoney, shortDate } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import type { Budget, Category, Transaction } from "../lib/types";

export default function Budgets() {
  const { id } = useParams();
  return id ? <BudgetDetail id={id} /> : <BudgetList />;
}

function BudgetList() {
  const navigate = useNavigate();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const budgets = useApi<Budget[]>("/budgets");
  const categories = useApi<Category[]>("/categories");
  const [creating, setCreating] = useState(false);

  return (
    <div className="content module-page">
      <PageHeader eyebrow="PLAN WITH CONFIDENCE" title="Budget management" description="Set thoughtful limits and stay ahead of upcoming commitments." action="Create budget" onAction={() => setCreating(true)} />
      <div className="module-tabs"><button className="active">Active budgets</button><button onClick={() => navigate("/bills")}>Bills &amp; scheduled payments</button></div>
      <StateText loading={budgets.loading} error={budgets.error} empty={!budgets.data} />
      {budgets.data && budgets.data.length === 0 && (
        <EmptyState title="No budgets yet" text="A budget limits how much you spend in one or more categories each period." action="Create budget" onAction={() => setCreating(true)} />
      )}
      <div className="budget-page-grid">
        {(budgets.data ?? []).map((b) => (
          <button className="card budget-page-card" key={b.id} onClick={() => navigate(`/budgets/${b.id}`)}>
            <div><span className={`budget-icon ${b.status === "over" ? "red" : "orange"}`}>{b.name[0]}</span><em className={b.status === "over" ? "status danger" : "status success"}>{b.status === "over" ? "Over budget" : b.status === "near_limit" ? "Near limit" : "On track"}</em></div>
            <h3>{b.name}</h3>
            <p><strong>{formatMoney(b.spent, currency)}</strong> of {formatMoney(b.limit, currency)}</p>
            <div className="progress large"><i className={b.status === "over" ? "red" : "orange"} style={{ width: `${Math.min(b.percent, 100)}%` }} /></div>
            <small>{b.percent}% used · {b.status === "over" ? `${formatMoney(b.overBy, currency)} over` : `${formatMoney(b.remaining, currency)} remaining`}</small>
          </button>
        ))}
      </div>
      {creating && categories.data && <Modal title="Create budget" onClose={() => setCreating(false)}>
        <BudgetForm categories={categories.data} onSaved={() => { setCreating(false); budgets.reload(); }} onCancel={() => setCreating(false)} />
      </Modal>}
    </div>
  );
}

function BudgetDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const budget = useApi<Budget>(`/budgets/${id}`);
  const categories = useApi<Category[]>("/categories");
  const b = budget.data;
  const txs = useApi<{ items: Transaction[] }>(b ? `/transactions?type=expense&from=${b.range.from}&to=${b.range.to}&pageSize=100` : null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/budgets/${id}`, { method: "DELETE" });
      navigate("/budgets");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The budget could not be deleted");
      setBusy(false);
    }
  };

  const related = (txs.data?.items ?? []).filter((t) => b?.categoryIds.includes(t.categoryId));

  return (
    <div className="content module-page">
      <StateText loading={budget.loading} error={budget.error} empty={!b} />
      {b && <>
        <PageHeader eyebrow="PLAN WITH CONFIDENCE" title={b.name} description={`${b.period === "custom" ? "Custom period" : b.period === "weekly" ? "Last 7 days" : "Monthly budget"} · ${shortDate(b.range.from)} – ${shortDate(b.range.to)}`} />
        <div className="detail-page-grid">
          <section className="card detail-hero">
            <span className={`goal-visual ${b.status === "over" ? "orange" : "blue"}`}><Icon name="budget" /></span>
            <div><small>ACTIVE BUDGET</small><h3>{b.name}</h3><p><strong>{formatMoney(b.spent, currency)}</strong> of {formatMoney(b.limit, currency)} limit</p></div>
            <b>{b.percent}%</b>
            <div className="progress large"><i className={b.status === "over" ? "red" : "blue"} style={{ width: `${Math.min(b.percent, 100)}%` }} /></div>
            <p className="muted-small">{b.status === "over" ? `${formatMoney(b.overBy, currency)} over budget.` : `${formatMoney(b.remaining, currency)} remaining.`}</p>
            {error && <p className="auth-error">{error}</p>}
            <div className="detail-actions">
              <button className="primary" onClick={() => setEditing(true)}>Edit budget</button>
              <button className="danger-button" onClick={() => setConfirmDelete(true)}>Delete budget</button>
            </div>
          </section>
          <section className="card activity-card">
            <div className="section-title"><div><h2>Related transactions</h2><p>Expenses in this budget&apos;s categories and period</p></div></div>
            {related.length === 0 && <p className="muted-small">No expenses yet in this period.</p>}
            {related.map((tx) => (
              <div className="mini-activity" key={tx.id}>
                <span>{(tx.description || tx.categoryName)[0]}</span>
                <div><strong>{tx.description || tx.categoryName}</strong><small>{shortDate(tx.date)} · {tx.categoryName}</small></div>
                <b>{formatMoney(tx.amount, currency)}</b>
              </div>
            ))}
          </section>
        </div>
        {editing && categories.data && <Modal title="Edit budget" onClose={() => setEditing(false)}>
          <BudgetForm initial={b} categories={categories.data} onSaved={() => { setEditing(false); budget.reload(); }} onCancel={() => setEditing(false)} />
        </Modal>}
        {confirmDelete && <Confirm title="Delete this budget?" text="The budget is removed. Your transactions are not affected." confirmLabel="Delete" busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={remove} />}
      </>}
    </div>
  );
}
