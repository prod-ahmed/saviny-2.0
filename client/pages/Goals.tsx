import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ContributionForm, GoalForm } from "../components/forms";
import { AiPanel } from "../components/AiPanel";
import { Confirm, EmptyState, Icon, Modal, PageHeader, StateText } from "../components/ui";
import { api } from "../lib/api";
import { formatMoney, longDate, monthYear, shortDate } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import type { Contribution, Goal } from "../lib/types";

export default function Goals() {
  const { id } = useParams();
  return id ? <GoalDetail id={id} /> : <GoalList />;
}

function GoalList() {
  const navigate = useNavigate();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const goals = useApi<Goal[]>("/goals?status=active");
  const [creating, setCreating] = useState(false);

  const list = goals.data ?? [];
  const saved = list.reduce((s, g) => s + g.savedAmount, 0);
  const target = list.reduce((s, g) => s + g.targetAmount, 0);

  return (
    <div className="content module-page">
      <PageHeader eyebrow="DREAMS IN PROGRESS" title="Savings goals" description="Build momentum with transparent contribution history and clear milestones." action="Create goal" onAction={() => setCreating(true)} />
      <StateText loading={goals.loading} error={goals.error} empty={!goals.data} />
      {goals.data && list.length === 0 && (
        <EmptyState title="No savings goals yet" text="Set a target amount and track each contribution until you reach it." action="Create goal" onAction={() => setCreating(true)} />
      )}
      {list.length > 0 && <>
        <div className="module-stats">
          <div><span>Total saved</span><strong>{formatMoney(saved, currency)}</strong></div>
          <div><span>Combined targets</span><strong>{formatMoney(target, currency)}</strong></div>
          <div><span>Overall progress</span><strong>{target ? Math.round((saved / target) * 100) : 0}%</strong></div>
        </div>
        <div className="goals-page-grid">
          {list.map((g, i) => (
            <button className="card goal-page-card" key={g.id} onClick={() => navigate(`/goals/${g.id}`)}>
              <span className={`goal-visual ${i % 2 ? "orange" : "blue"}`}><Icon name="target" size={26} /></span>
              <div>
                <small>Target · {g.targetDate ? monthYear(g.targetDate) : "No date"}</small>
                <h3>{g.title}</h3>
                <p><strong>{formatMoney(g.savedAmount, currency)}</strong> of {formatMoney(g.targetAmount, currency)}</p>
                <div className="progress large"><i className={i % 2 ? "orange" : "blue"} style={{ width: `${g.progress}%` }} /></div>
                <span>{g.progress}% complete</span>
              </div>
            </button>
          ))}
        </div>
      </>}
      {creating && <Modal title="Create savings goal" onClose={() => setCreating(false)}>
        <GoalForm onSaved={() => { setCreating(false); goals.reload(); }} onCancel={() => setCreating(false)} />
      </Modal>}
    </div>
  );
}

function GoalDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const goal = useApi<Goal>(`/goals/${id}`);
  const contributions = useApi<Contribution[]>(`/goals/${id}/contributions`);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const g = goal.data;

  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "archive") await api(`/goals/${id}/archive`, { method: "POST" });
      else await api(`/goals/${id}`, { method: "DELETE" });
      navigate("/goals");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The goal could not be updated");
      setBusy(false);
    }
  };

  const removeContribution = async (c: Contribution) => {
    try {
      await api(`/contributions/${c.id}`, { method: "DELETE" });
      goal.reload();
      contributions.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The contribution could not be deleted");
    }
  };

  return (
    <div className="content module-page">
      <StateText loading={goal.loading} error={goal.error} empty={!g} />
      {g && <>
        <PageHeader eyebrow="DREAMS IN PROGRESS" title={g.title} description={g.description || "Build momentum with transparent contribution history."} action={g.status === "active" ? "Add contribution" : undefined} onAction={() => setAdding(true)} />
        <div className="detail-page-grid">
          <section className="card detail-hero">
            <span className="goal-visual blue"><Icon name="target" /></span>
            <div><small>{g.status === "active" ? "ACTIVE GOAL" : "ARCHIVED GOAL"}</small><h3>{g.title}</h3><p><strong>{formatMoney(g.savedAmount, currency)}</strong> of {formatMoney(g.targetAmount, currency)}</p></div>
            <b>{g.progress}%</b>
            <div className="progress large"><i className="blue" style={{ width: `${g.progress}%` }} /></div>
            <p className="muted-small">{formatMoney(g.remaining, currency)} to go{g.targetDate ? ` · target ${longDate(g.targetDate)}` : ""}</p>
            <p className="muted-small">{g.estimatedCompletionDate ? `Estimated completion: ${longDate(g.estimatedCompletionDate)}. ` : ""}{g.estimationNote}</p>
            {error && <p className="auth-error">{error}</p>}
            <div className="detail-actions">
              {g.status === "active" && <button className="primary" onClick={() => setAdding(true)}>Add contribution</button>}
              <button className="secondary" onClick={() => setEditing(true)}>Edit goal</button>
              {g.status === "active" && <button className="secondary" onClick={() => setConfirm("archive")}>Archive</button>}
              <button className="danger-button" onClick={() => setConfirm("delete")}>Delete</button>
            </div>
          </section>
          <section className="card">
            <AiPanel<{ monthlyTarget: number; milestones: string[]; advice: string }>
              title="Savings plan"
              action="Plan my savings"
              run={() => api(`/ai/goals/${id}/plan`, { method: "POST" })}
              render={(plan) => (
                <>
                  <p><strong>Set aside about {formatMoney(plan.monthlyTarget, currency)} a month.</strong> {plan.advice}</p>
                  {plan.milestones.length > 0 && <ul>{plan.milestones.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                </>
              )}
            />
          </section>

          <section className="card activity-card">
            <div className="section-title"><div><h2>Contribution history</h2><p>Every amount you have added to this goal</p></div></div>
            {(contributions.data ?? []).length === 0 && <p className="muted-small">No contributions yet.</p>}
            {(contributions.data ?? []).map((c) => (
              <div className="mini-activity" key={c.id}>
                <span>{c.note ? c.note[0] : "+"}</span>
                <div><strong>{c.note || "Contribution"}</strong><small>{shortDate(c.date)}</small></div>
                <b>{formatMoney(c.amount, currency)}</b>
                <button className="icon-button small" aria-label="Delete contribution" onClick={() => removeContribution(c)}><Icon name="trash" size={14} /></button>
              </div>
            ))}
          </section>
        </div>
        {adding && <Modal title="Add savings contribution" onClose={() => setAdding(false)}>
          <ContributionForm goalId={id} onSaved={() => { setAdding(false); goal.reload(); contributions.reload(); }} onCancel={() => setAdding(false)} />
        </Modal>}
        {editing && <Modal title="Edit savings goal" onClose={() => setEditing(false)}>
          <GoalForm initial={g} onSaved={() => { setEditing(false); goal.reload(); }} onCancel={() => setEditing(false)} />
        </Modal>}
        {confirm && <Confirm
          title={confirm === "archive" ? "Archive this goal?" : "Delete this goal?"}
          text={confirm === "archive" ? "The goal keeps its history and leaves your active list." : "The goal and all of its contributions are permanently deleted."}
          confirmLabel={confirm === "archive" ? "Archive" : "Delete"}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={act}
        />}
      </>}
    </div>
  );
}
