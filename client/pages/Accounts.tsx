import { useState } from "react";
import { useNavigate } from "react-router";
import { AccountForm } from "../components/forms";
import { AiPanel } from "../components/AiPanel";
import { Confirm, EmptyState, Icon, Modal, PageHeader, StateText } from "../components/ui";
import { api } from "../lib/api";
import { formatMoney } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import type { Account } from "../lib/types";

const TYPE_LABEL: Record<Account["type"], string> = { checking: "Checking", savings: "Savings", cash: "Cash", credit: "Credit card" };

export default function Accounts() {
  const navigate = useNavigate();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const accounts = useApi<Account[]>("/accounts");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const archived = (accounts.data ?? []).filter((a) => a.archived);

  const act = async () => {
    if (!editing || !confirm) return;
    setBusy(true);
    setError("");
    try {
      if (confirm === "archive") await api(`/accounts/${editing.id}/archive`, { method: "POST" });
      else await api(`/accounts/${editing.id}`, { method: "DELETE" });
      setConfirm(null);
      setEditing(null);
      accounts.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action could not be completed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content module-page">
      <PageHeader eyebrow="YOUR MONEY" title="Financial accounts" description="Balances are calculated from your recorded transactions." action="Add account" onAction={() => setAdding(true)} />
      <AiPanel<{ headline: string; tips: string[] }>
        title="Account review"
        action="Review my accounts"
        run={() => api("/ai/accounts/review")}
        render={(result) => (
          <>
            <p>{result.headline}</p>
            {result.tips.length > 0 && <ul>{result.tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>}
          </>
        )}
      />
      <StateText loading={accounts.loading} error={accounts.error} empty={!accounts.data} />
      {accounts.data && active.length === 0 && (
        <EmptyState title="No accounts yet" text="Add a checking, savings, cash or credit account to start recording transactions." action="Add account" onAction={() => setAdding(true)} />
      )}
      <div className="account-grid">
        {active.map((a, i) => (
          <div className="account-card" key={a.id}>
            <button className="account-open" onClick={() => navigate(`/transactions?accountId=${a.id}`)}>
              <span className={`account-mark tone-${i % 3}`}><Icon name="wallet" /></span>
              <small>{TYPE_LABEL[a.type]}</small>
              <strong>{formatMoney(a.balance, currency)}</strong>
              <p>Available balance</p>
              <span className="account-link">View activity <Icon name="arrow" size={14} /></span>
            </button>
            <button className="card-edit" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}><Icon name="edit" size={16} /></button>
            <h3 className="account-name">{a.name}</h3>
          </div>
        ))}
      </div>

      {archived.length > 0 && <section className="card info-banner">
        <Icon name="sparkle" />
        <div><strong>{archived.length} archived {archived.length === 1 ? "account" : "accounts"}</strong><p>Archived accounts keep their history and are excluded from totals.</p></div>
      </section>}

      {adding && <Modal title="Add account" onClose={() => setAdding(false)}>
        <AccountForm onSaved={() => { setAdding(false); accounts.reload(); }} onCancel={() => setAdding(false)} />
      </Modal>}
      {editing && !confirm && <Modal title="Edit account" onClose={() => setEditing(null)}>
        <AccountForm initial={editing} onSaved={() => { setEditing(null); accounts.reload(); }} onCancel={() => setEditing(null)} />
        <div className="detail-actions account-actions">
          <button className="secondary" onClick={() => setConfirm("archive")}>Archive account</button>
          <button className="danger-button" onClick={() => setConfirm("delete")}>Delete account</button>
        </div>
        {error && <p className="auth-error">{error}</p>}
      </Modal>}
      {editing && confirm && (
        <Confirm
          title={confirm === "archive" ? "Archive this account?" : "Delete this account?"}
          text={confirm === "archive" ? "Its history is kept and it leaves your active totals." : "The account and all of its transactions are permanently deleted."}
          confirmLabel={confirm === "archive" ? "Archive" : "Delete"}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={act}
        />
      )}
    </div>
  );
}
