import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Confirm, EmptyState, Icon, Modal, PageHeader, StateText } from "../components/ui";
import { TransactionForm } from "../components/forms";
import { AiPanel } from "../components/AiPanel";
import { api } from "../lib/api";
import { formatMoney, longDate, shortDate } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import type { Account, Category, Dashboard, Transaction } from "../lib/types";

interface TxPage { items: Transaction[]; total: number }

interface Subscription {
  description: string;
  amount: number;
  frequency: "weekly" | "monthly" | "yearly";
  categoryId: string;
  accountId: string;
  nextDate: string;
}

/** Repeating payments the assistant found. Adding one creates a recurring item the user confirms later; nothing is paid. */
function Subscriptions({ items, currency }: { items: Subscription[]; currency: string }) {
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState("");

  const add = async (item: Subscription) => {
    setError("");
    try {
      await api("/recurring", {
        method: "POST",
        json: { type: "expense", amount: item.amount, description: item.description, accountId: item.accountId, categoryId: item.categoryId, frequency: item.frequency, nextDate: item.nextDate },
      });
      setAdded((list) => [...list, item.description]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The recurring item could not be added");
    }
  };

  if (items.length === 0) return <p>No repeating payments found in the last year.</p>;
  return (
    <div className="ai-subs">
      {items.map((item) => (
        <div key={`${item.description}-${item.amount}`}>
          <span>{item.description} · {formatMoney(item.amount, currency)} · {item.frequency}</span>
          {added.includes(item.description) ? <em>Added</em> : <button type="button" className="secondary" onClick={() => add(item)}>Add as recurring</button>}
        </div>
      ))}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  );
}

export default function Transactions() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const type = params.get("type") ?? "";
  const accountId = params.get("accountId") ?? "";
  const categoryId = params.get("categoryId") ?? "";

  const query = useMemo(() => {
    const q = new URLSearchParams({ pageSize: "100" });
    if (type) q.set("type", type);
    if (accountId) q.set("accountId", accountId);
    if (categoryId) q.set("categoryId", categoryId);
    if (search.trim()) q.set("search", search.trim());
    return `/transactions?${q.toString()}`;
  }, [type, accountId, categoryId, search]);

  const txs = useApi<TxPage>(query);
  const accounts = useApi<Account[]>("/accounts");
  const categories = useApi<Category[]>("/categories");
  const stats = useApi<Dashboard>("/dashboard?period=this_month");

  const selected = txs.data?.items.find((t) => t.id === selectedId) ?? null;
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    setActionError("");
    try {
      await api(`/transactions/${selected.id}`, { method: "DELETE" });
      setConfirmDelete(false);
      setSelectedId(null);
      txs.reload();
      stats.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The transaction could not be deleted");
    } finally {
      setBusy(false);
    }
  };

  const onSaved = () => {
    setAdding(false);
    setEditing(null);
    txs.reload();
    stats.reload();
  };

  const s = stats.data;
  return (
    <div className="content module-page">
      <PageHeader eyebrow="MONEY IN MOTION" title="Transactions" description="Review every movement across your accounts." action="Add transaction" onAction={() => setAdding(true)} />
      <div className="module-stats">
        <div><span>Income this month</span><strong className="income-text">+{formatMoney(s?.income ?? 0, currency)}</strong></div>
        <div><span>Expenses this month</span><strong>{formatMoney(s?.expenses ?? 0, currency)}</strong></div>
        <div><span>Net cash flow</span><strong>{formatMoney((s?.income ?? 0) - (s?.expenses ?? 0), currency)}</strong></div>
      </div>

      <section className="card module-card">
        <div className="page-toolbar">
          <div className="transaction-search"><Icon name="search" size={17} /><input aria-label="Search transactions" placeholder="Search by name or category" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <select aria-label="Type" value={type} onChange={(e) => setFilter("type", e.target.value)}>
            <option value="">All types</option><option value="income">Income</option><option value="expense">Expenses</option>
          </select>
          <select aria-label="Account" value={accountId} onChange={(e) => setFilter("accountId", e.target.value)}>
            <option value="">All accounts</option>
            {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select aria-label="Category" value={categoryId} onChange={(e) => setFilter("categoryId", e.target.value)}>
            <option value="">All categories</option>
            {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <StateText loading={txs.loading} error={txs.error} empty={!txs.data} />
        {txs.data && txs.data.items.length === 0 && (
          <EmptyState title="No transactions yet" text="Add your first income or expense to start tracking your money." action="Add transaction" onAction={() => setAdding(true)} />
        )}
        {txs.data && txs.data.items.length > 0 && (
          <div className="transaction-table module-table">
            <div className="table-row table-head"><span>Description</span><span>Category</span><span>Account</span><span>Date</span><span>Amount</span><span /></div>
            {txs.data.items.map((tx) => (
              <button className="table-row" key={tx.id} onClick={() => setSelectedId(tx.id)}>
                <span className="tx-name"><i>{(tx.description || tx.categoryName)[0]}</i><strong>{tx.description || tx.categoryName}<small>{tx.type === "income" ? "Income" : "Expense"}</small></strong></span>
                <span><em>{tx.categoryName}</em></span>
                <span>{tx.accountName}</span>
                <span>{shortDate(tx.date)}</span>
                <span className={tx.type === "income" ? "income-text" : "expense-text"}>{tx.type === "income" ? "+" : "−"}{formatMoney(tx.amount, currency)}</span>
                <span><Icon name="chevron" size={16} /></span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card module-card">
        <AiPanel<{ subscriptions: Subscription[] }>
          title="Repeating payments"
          action="Find subscriptions"
          run={() => api("/ai/finance/subscriptions")}
          render={(result) => <Subscriptions items={result.subscriptions} currency={currency} />}
        />
      </section>

      {selected && (
        <section className="card detail-drawer">
          <button className="icon-button" aria-label="Close details" onClick={() => setSelectedId(null)}><Icon name="close" /></button>
          <span className="eyebrow">TRANSACTION DETAIL</span>
          <h3>{selected.description || selected.categoryName}</h3>
          <div className={`detail-amount ${selected.type === "income" ? "income-text" : ""}`}>{selected.type === "income" ? "+" : "−"}{formatMoney(selected.amount, currency)}</div>
          <dl>
            <div><dt>Type</dt><dd>{selected.type === "income" ? "Income" : "Expense"}</dd></div>
            <div><dt>Account</dt><dd>{selected.accountName}</dd></div>
            <div><dt>Category</dt><dd>{selected.categoryName}</dd></div>
            <div><dt>Date</dt><dd>{longDate(selected.date)}</dd></div>
          </dl>
          {actionError && <p className="auth-error" role="alert">{actionError}</p>}
          <div className="detail-actions">
            <button className="secondary" onClick={() => setEditing(selected)}>Edit</button>
            <button className="danger-button" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
          <button className="text-link" onClick={() => navigate("/dashboard")}>Back to dashboard</button>
        </section>
      )}

      {(adding || editing) && accounts.data && categories.data && (
        <Modal title={editing ? "Edit transaction" : "Add transaction"} onClose={() => { setAdding(false); setEditing(null); }}>
          <TransactionForm accounts={accounts.data} categories={categories.data} initial={editing ?? undefined} onSaved={onSaved} onCancel={() => { setAdding(false); setEditing(null); }} />
        </Modal>
      )}
      {confirmDelete && selected && (
        <Confirm title="Delete this transaction?" text="The transaction is removed and balances are recalculated. This cannot be undone." confirmLabel="Delete" busy={busy} onCancel={() => setConfirmDelete(false)} onConfirm={remove} />
      )}
    </div>
  );
}
