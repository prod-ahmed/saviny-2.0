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
      <PageHeader eyebrow="UPCOMING COMMITMENTS" title="Bills & scheduled payments" description="Pennywise tracks status only and never initiates a bank transfer." action="Add bill" onAction={() => setAdding(true)} />
      <div className="module-tabs">
        <button onClick={() => navigate("/budgets")}>Budgets</button>
        <button className={tab === "upcoming" ? "active" : ""} onClick={() => setTab("upcoming")}>Upcoming</button>
        <button className={tab === "paid" ? "active" : ""} onClick={() => setTab("paid")}>Paid</button>
      </div>

      {/* What-If Simulation Callout for Bills */}
      <div className="my-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-900 dark:text-slate-100">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
              Modélisation
            </span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Simulation d'impact budgétaire</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Une nouvelle dépense récurrente ? Testez son effet sur vos réserves et vos objectifs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const coachBtn = document.querySelector('button[aria-label="Ouvrir Coach Penny"], button[aria-label="Ouvrir Pennywise AI - Smart Savings Coach"]') as HTMLButtonElement;
            if (coachBtn) {
              coachBtn.click();
              setTimeout(() => {
                const whatIfTab = document.querySelectorAll('button[role="tab"]')[1] as HTMLButtonElement;
                if (whatIfTab) whatIfTab.click();
              }, 200);
            }
          }}
          className="shrink-0 px-3.5 py-2 rounded-lg bg-[#0e2422] hover:bg-[#153430] text-white text-xs font-semibold shadow-sm transition active:scale-95 cursor-pointer"
        >
          Simuler l'impact
        </button>
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
