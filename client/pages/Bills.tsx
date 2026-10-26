import { useState } from "react";
import { useNavigate } from "react-router";
import { BillForm } from "../components/forms";
import { Confirm, EmptyState, Icon, Modal, PageHeader, StateText } from "../components/ui";
import { api } from "../lib/api";
import { formatMoney, shortDate } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import type { Account, Bill } from "../lib/types";

type Tab = "upcoming" | "paid";

export default function Bills() {
  const navigate = useNavigate();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const bills = useApi<Bill[]>("/bills");
  const accounts = useApi<Account[]>("/accounts");
  const [tab, setTab] = useState<Tab>("upcoming");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Bill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const shown = (bills.data ?? []).filter((b) => b.status === tab);

  const markPaid = async (bill: Bill) => {
    setError("");
    try {
      await api(`/bills/${bill.id}/mark-paid`, { method: "POST" });
      bills.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The bill could not be updated");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/bills/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      bills.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The bill could not be deleted");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content module-page">
      <PageHeader eyebrow="UPCOMING COMMITMENTS" title="Bills & scheduled payments" description="Brixy tracks status only and never initiates a bank transfer." action="Add bill" onAction={() => setAdding(true)} />
      <div className="module-tabs">
        <button onClick={() => navigate("/budgets")}>Budgets</button>
        <button className={tab === "upcoming" ? "active" : ""} onClick={() => setTab("upcoming")}>Upcoming</button>
        <button className={tab === "paid" ? "active" : ""} onClick={() => setTab("paid")}>Paid</button>
      </div>
      <StateText loading={bills.loading} error={bills.error} empty={!bills.data} />
      {error && <p className="auth-error" role="alert">{error}</p>}
      {bills.data && shown.length === 0 && (
        <EmptyState title={tab === "upcoming" ? "Nothing upcoming" : "No paid bills yet"} text="Add a bill or scheduled payment to keep its due date in view." action="Add bill" onAction={() => setAdding(true)} />
      )}
      {shown.length > 0 && (
        <section className="card bills-list">
          {shown.map((bill) => (
            <div className="bill-item" key={bill.id}>
              <span className="payment-icon">{bill.name[0]}</span>
              <div><strong>{bill.name}</strong><small>Due {shortDate(bill.dueDate)} · {bill.kind === "bill" ? "Bill" : "Scheduled payment"}</small></div>
              <strong>{formatMoney(bill.amount, currency)}</strong>
              <em className={bill.status === "paid" ? "status success" : "status"}>{bill.status === "paid" ? "Paid" : "Upcoming"}</em>
              <span className="bill-actions">
                {bill.status === "upcoming" && <button className="text-link" onClick={() => markPaid(bill)}>Mark paid</button>}
                <button className="icon-button small" aria-label={`Delete ${bill.name}`} onClick={() => setDeleting(bill)}><Icon name="trash" size={15} /></button>
              </span>
            </div>
          ))}
        </section>
      )}
      {adding && <Modal title="Add bill" onClose={() => setAdding(false)}>
        <BillForm accounts={accounts.data ?? []} onSaved={() => { setAdding(false); bills.reload(); }} onCancel={() => setAdding(false)} />
      </Modal>}
      {deleting && <Confirm title="Delete this bill?" text="The bill is removed from your list. Nothing is paid or cancelled with your bank." confirmLabel="Delete" busy={busy} onCancel={() => setDeleting(null)} onConfirm={remove} />}
    </div>
  );
}
