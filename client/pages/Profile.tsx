import { useEffect, useState, type FormEvent } from "react";
import { Confirm, FormError, Modal, PageHeader } from "../components/ui";
import { AiPanel } from "../components/AiPanel";
import { CurrencySelect } from "../components/CurrencySelect";
import { PasswordForm } from "../components/forms";
import { api } from "../lib/api";
import { longDate } from "../lib/format";
import { useSession } from "../lib/hooks";
import type { Currency, User } from "../lib/types";
import { THEMES, saveTheme, storedTheme, type Theme } from "../lib/theme";

export function Profile() {
  const { user, refresh } = useSession();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setEmail(user.email);
    setCurrency(user.currency);
  }, [user]);

  if (!user) return null;

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api("/users/me", { method: "PATCH", json: { firstName, lastName, email, currency } });
      refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your profile could not be saved");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content module-page">
      <PageHeader eyebrow="YOUR ACCOUNT" title="My profile" description="Manage the information connected to your personal Brixy account." />
      <section className="card">
        <AiPanel<{ profile: string; strengths: string[]; nextSteps: string[] }>
          title="My money profile"
          action="Describe my habits"
          run={() => api("/ai/profile/summary")}
          render={(result) => (
            <>
              <p><strong>{result.profile}</strong></p>
              {result.strengths.length > 0 && <p>Strengths</p>}
              {result.strengths.length > 0 && <ul>{result.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>}
              {result.nextSteps.length > 0 && <p>Next steps</p>}
              {result.nextSteps.length > 0 && <ul>{result.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul>}
            </>
          )}
        />
      </section>
      <div className="settings-layout">
        <section className="card profile-summary">
          <span className="profile-avatar">{(user.firstName[0] ?? "") + (user.lastName[0] ?? "")}</span>
          <h3>{user.firstName} {user.lastName}</h3>
          <p>{user.email}</p>
          <small>Member since {longDate(user.memberSince)}</small>
        </section>
        <section className="card settings-panel">
          <h3>Personal information</h3>
          <form className="flow-form" onSubmit={save}>
            <div className="form-row">
              <label>First name<input required value={firstName} maxLength={60} onChange={(e) => setFirstName(e.target.value)} /></label>
              <label>Last name<input required value={lastName} maxLength={60} onChange={(e) => setLastName(e.target.value)} /></label>
            </div>
            <label>Email address<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>Preferred currency</label>
            <CurrencySelect value={currency} onChange={setCurrency} />
            <FormError message={error} />
            {saved && <p className="state-text">Changes saved.</p>}
            <div className="form-actions"><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
          </form>
          <hr />
          <h3>Security</h3>
          <button className="secondary" onClick={() => setChangingPassword(true)}>Change password</button>
        </section>
      </div>
      {changingPassword && <Modal title="Change password" onClose={() => setChangingPassword(false)}>
        <PasswordForm onSaved={() => setChangingPassword(false)} onCancel={() => setChangingPassword(false)} />
      </Modal>}
    </div>
  );
}

const TABS = ["Notifications", "Display & currency", "Privacy & security", "Data & account"] as const;
type Tab = (typeof TABS)[number];

const NOTICES: { key: keyof User["notifications"]; label: string; text: string }[] = [
  { key: "budgetAlerts", label: "Budget alerts", text: "When spending approaches or exceeds a limit" },
  { key: "upcomingBills", label: "Upcoming bills", text: "Reminders before scheduled due dates" },
  { key: "savingsMilestones", label: "Savings milestones", text: "Progress updates on active goals" },
  { key: "communityReplies", label: "Community replies", text: "Replies and reactions to your posts" },
  { key: "marketplaceMessages", label: "Marketplace messages", text: "Updates from buyers and sellers" },
];

export function Settings() {
  const { user, refresh, logout } = useSession();
  const [tab, setTab] = useState<Tab>("Notifications");
  const [prefs, setPrefs] = useState<User["notifications"] | null>(null);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    if (!user) return;
    setPrefs(user.notifications);
    setCurrency(user.currency);
  }, [user]);

  if (!user || !prefs) return null;

  const savePrefs = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/users/me/notifications", { method: "PATCH", json: prefs });
      refresh();
      setMessage("Preferences saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preferences could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const saveCurrency = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/users/me", { method: "PATCH", json: { currency } });
      refresh();
      setMessage("Currency saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Currency could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const requestDeletion = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/users/me/delete-request", { method: "POST", json: { confirmation: "DELETE" }, requireOnline: true });
      setDeleting(false);
      refresh();
      setMessage("Deletion requested. Your account will be reviewed before anything is removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request could not be sent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content module-page">
      <PageHeader eyebrow="MAKE BRIXY YOURS" title="Settings" description="Control notifications, display, privacy, and account security." />
      <div className="settings-layout">
        <nav className="card settings-nav">
          {TABS.map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setMessage(""); setError(""); }}>{t}</button>)}
        </nav>
        <section className="card settings-panel">
          {tab === "Notifications" && <>
            <h3>Notification preferences</h3>
            <p>Choose which updates deserve your attention.</p>
            {NOTICES.map((s) => (
              <label className="toggle-row" key={s.key}>
                <span><strong>{s.label}</strong><small>{s.text}</small></span>
                <input type="checkbox" checked={prefs[s.key]} onChange={(e) => setPrefs({ ...prefs, [s.key]: e.target.checked })} />
                <i />
              </label>
            ))}
            <div className="form-actions"><button className="primary" disabled={busy} onClick={savePrefs}>Save preferences</button></div>
          </>}

          {tab === "Display & currency" && <>
            <h3>Appearance</h3>
            <p>Choose the palette for this device. Dark mode keeps the same layout.</p>
            <div className="theme-options" role="group" aria-label="Appearance">
              {THEMES.map((t) => (
                <button key={t.value} className={`theme-option${theme === t.value ? " active" : ""}`} aria-pressed={theme === t.value}
                  onClick={() => { setTheme(t.value); saveTheme(t.value); }}>
                  <strong>{t.label}</strong>
                  <small>{t.text}</small>
                </button>
              ))}
            </div>
            <h3>Display &amp; currency</h3>
            <p>Amounts across Brixy are shown in this currency.</p>
            <label>Currency</label>
            <CurrencySelect value={currency} onChange={setCurrency} />
            <div className="form-actions"><button className="primary" disabled={busy} onClick={saveCurrency}>Save currency</button></div>
          </>}

          {tab === "Privacy & security" && <>
            <h3>Privacy &amp; security</h3>
            <p>Your financial records are private by default and never shown to other members.</p>
            <button className="secondary" onClick={() => setChangingPassword(true)}>Change password</button>
            <hr />
            <button className="secondary" onClick={logout}>Sign out of this device</button>
          </>}

          {tab === "Data & account" && <>
            <h3>Data &amp; account</h3>
            <p>Your records stay in your Brixy account until you ask for them to be deleted.</p>
            <div className="danger-zone">
              <h3>Delete account</h3>
              <p>Request permanent deletion of your profile and associated data.</p>
              {user.deletionRequestedAt
                ? <p className="state-text">Deletion requested on {longDate(user.deletionRequestedAt)}.</p>
                : <button className="danger-button" onClick={() => setDeleting(true)}>Request account deletion</button>}
            </div>
          </>}

          {message && <p className="state-text">{message}</p>}
          <FormError message={error} />
        </section>
      </div>
      {changingPassword && <Modal title="Change password" onClose={() => setChangingPassword(false)}>
        <PasswordForm onSaved={() => { setChangingPassword(false); setMessage("Password changed."); }} onCancel={() => setChangingPassword(false)} />
      </Modal>}
      {deleting && <Confirm title="Request account deletion?" text="We will review the request before anything is removed. Financial records may remain where the law requires it." confirmLabel="Send request" busy={busy} onCancel={() => setDeleting(false)} onConfirm={requestDeletion} />}
    </div>
  );
}
