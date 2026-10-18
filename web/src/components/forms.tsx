import { useState, type FormEvent } from "react";
import { api, readAsDataUrl } from "../lib/api";
import { todayIso } from "../lib/format";
import type { Account, Bill, Budget, Category, Goal, Listing, Transaction } from "../lib/types";
import { FormError } from "./ui";

/** Runs a submit action, tracks busy state and surfaces the server's message. */
function useSubmit(action: (form: FormData, el: HTMLFormElement) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await action(new FormData(e.currentTarget), e.currentTarget);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => (text(form, key) === "" ? undefined : text(form, key));
const num = (form: FormData, key: string) => Number(form.get(key));

interface FormProps<T = undefined> {
  initial?: T;
  onSaved: () => void;
  onCancel: () => void;
}

function Actions({ busy, onCancel, label, danger }: { busy: boolean; onCancel: () => void; label: string; danger?: boolean }) {
  return (
    <div className="form-actions">
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      <button className={danger ? "danger-button" : "primary"} disabled={busy} type="submit">{busy ? "Saving…" : label}</button>
    </div>
  );
}

export function TransactionForm({ accounts, categories, initial, onSaved, onCancel }: FormProps<Transaction> & { accounts: Account[]; categories: Category[] }) {
  const { busy, error, submit } = useSubmit(async (form) => {
    const body = {
      type: text(form, "type"),
      amount: num(form, "amount"),
      date: text(form, "date"),
      description: text(form, "description"),
      accountId: text(form, "accountId"),
      categoryId: text(form, "categoryId"),
    };
    if (initial) await api(`/transactions/${initial.id}`, { method: "PATCH", json: body });
    else await api("/transactions", { method: "POST", json: body });
    onSaved();
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <div className="type-choice">
        <label><input type="radio" name="type" value="expense" defaultChecked={!initial || initial.type === "expense"} /> Expense</label>
        <label><input type="radio" name="type" value="income" defaultChecked={initial?.type === "income"} /> Income</label>
      </div>
      <div className="form-row">
        <label>Amount<input required name="amount" type="number" min="0.01" step="0.01" defaultValue={initial?.amount} placeholder="0.00" /></label>
        <label>Date<input required name="date" type="date" defaultValue={initial?.date ?? todayIso()} /></label>
      </div>
      <div className="form-row">
        <label>Account<select required name="accountId" defaultValue={initial?.accountId}>
          <option value="">Choose account</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select></label>
        <label>Category<select required name="categoryId" defaultValue={initial?.categoryId}>
          <option value="">Choose category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
      </div>
      <label>Description<input name="description" maxLength={120} defaultValue={initial?.description} placeholder="What was this for?" /></label>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label={initial ? "Save changes" : "Save transaction"} />
    </form>
  );
}

export function AccountForm({ initial, onSaved, onCancel }: FormProps<Account>) {
  const { busy, error, submit } = useSubmit(async (form) => {
    if (initial) {
      await api(`/accounts/${initial.id}`, { method: "PATCH", json: { name: text(form, "name"), type: text(form, "type") } });
    } else {
      await api("/accounts", { method: "POST", json: { name: text(form, "name"), type: text(form, "type"), initialBalance: num(form, "initialBalance") || 0 } });
    }
    onSaved();
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Account name<input required name="name" maxLength={60} defaultValue={initial?.name} placeholder="e.g. Main account" /></label>
      <div className="form-row">
        <label>Type<select name="type" defaultValue={initial?.type ?? "checking"}>
          <option value="checking">Checking</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="credit">Credit card</option>
        </select></label>
        {!initial && <label>Opening balance<input name="initialBalance" type="number" step="0.01" defaultValue="0" /></label>}
      </div>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label={initial ? "Save account" : "Create account"} />
    </form>
  );
}

export function BudgetForm({ categories, initial, onSaved, onCancel }: FormProps<Budget> & { categories: Category[] }) {
  const [period, setPeriod] = useState(initial?.period ?? "monthly");
  const [picked, setPicked] = useState<string[]>(initial?.categoryIds ?? []);
  const { busy, error, submit } = useSubmit(async (form) => {
    if (picked.length === 0) throw new Error("Choose at least one category");
    const body = {
      name: text(form, "name"),
      limit: num(form, "limit"),
      period,
      startDate: optional(form, "startDate"),
      endDate: optional(form, "endDate"),
      categoryIds: picked,
    };
    if (initial) await api(`/budgets/${initial.id}`, { method: "PATCH", json: body });
    else await api("/budgets", { method: "POST", json: body });
    onSaved();
  });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Budget name<input required name="name" maxLength={60} defaultValue={initial?.name} placeholder="e.g. Transport" /></label>
      <div className="form-row">
        <label>Spending limit<input required name="limit" type="number" min="0.01" step="0.01" defaultValue={initial?.limit} placeholder="0.00" /></label>
        <label>Period<select value={period} onChange={(e) => setPeriod(e.target.value as Budget["period"])}>
          <option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="custom">Custom dates</option>
        </select></label>
      </div>
      {period === "custom" && <div className="form-row">
        <label>Start<input required name="startDate" type="date" defaultValue={initial?.startDate ?? undefined} /></label>
        <label>End<input required name="endDate" type="date" defaultValue={initial?.endDate ?? undefined} /></label>
      </div>}
      <fieldset className="check-list">
        <legend>Categories</legend>
        {categories.length === 0 && <p className="muted-small">Create a category first.</p>}
        {categories.map((c) => (
          <label key={c.id}><input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>
        ))}
      </fieldset>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label={initial ? "Save budget" : "Create budget"} />
    </form>
  );
}

export function BillForm({ accounts, initial, onSaved, onCancel }: FormProps<Bill> & { accounts: Account[] }) {
  const { busy, error, submit } = useSubmit(async (form) => {
    const body = { name: text(form, "name"), amount: num(form, "amount"), dueDate: text(form, "dueDate"), kind: text(form, "kind") };
    if (initial) await api(`/bills/${initial.id}`, { method: "PATCH", json: body });
    else await api("/bills", { method: "POST", json: { ...body, accountId: optional(form, "accountId") } });
    onSaved();
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Name<input required name="name" maxLength={80} defaultValue={initial?.name} placeholder="e.g. Internet & Wi-Fi" /></label>
      <div className="form-row">
        <label>Amount<input required name="amount" type="number" min="0.01" step="0.01" defaultValue={initial?.amount} /></label>
        <label>Due date<input required name="dueDate" type="date" defaultValue={initial?.dueDate ?? todayIso()} /></label>
      </div>
      <div className="form-row">
        <label>Kind<select name="kind" defaultValue={initial?.kind ?? "bill"}><option value="bill">Bill</option><option value="scheduled">Scheduled payment</option></select></label>
        {!initial && <label>Account (optional)<select name="accountId" defaultValue=""><option value="">None</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      </div>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label={initial ? "Save bill" : "Add bill"} />
    </form>
  );
}

export function GoalForm({ initial, onSaved, onCancel }: FormProps<Goal>) {
  const { busy, error, submit } = useSubmit(async (form) => {
    const body = {
      title: text(form, "title"),
      description: text(form, "description"),
      targetAmount: num(form, "targetAmount"),
      targetDate: optional(form, "targetDate"),
    };
    if (initial) await api(`/goals/${initial.id}`, { method: "PATCH", json: body });
    else await api("/goals", { method: "POST", json: body });
    onSaved();
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Goal title<input required name="title" maxLength={80} defaultValue={initial?.title} placeholder="e.g. Emergency Fund" /></label>
      <div className="form-row">
        <label>Target amount<input required name="targetAmount" type="number" min="0.01" step="0.01" defaultValue={initial?.targetAmount} /></label>
        <label>Target date (optional)<input name="targetDate" type="date" defaultValue={initial?.targetDate ?? undefined} /></label>
      </div>
      <label>Notes<textarea name="description" maxLength={400} defaultValue={initial?.description} placeholder="Why this goal matters" /></label>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label={initial ? "Save goal" : "Create goal"} />
    </form>
  );
}

export function ContributionForm({ goalId, onSaved, onCancel }: { goalId: string; onSaved: () => void; onCancel: () => void }) {
  const { busy, error, submit } = useSubmit(async (form) => {
    await api(`/goals/${goalId}/contributions`, {
      method: "POST",
      json: { amount: num(form, "amount"), date: text(form, "date"), note: optional(form, "note") },
    });
    onSaved();
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <div className="form-row">
        <label>Amount<input required name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" /></label>
        <label>Date<input required name="date" type="date" defaultValue={todayIso()} /></label>
      </div>
      <label>Note (optional)<input name="note" maxLength={200} placeholder="e.g. Monthly transfer" /></label>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label="Add contribution" />
    </form>
  );
}

const CONDITIONS = ["New", "Like new", "Good", "Fair"] as const;
export const LISTING_CATEGORIES = ["Electronics", "Home", "Clothing", "Books", "Sports", "Other"];

export function ListingForm({ initial, onSaved, onCancel }: FormProps<Listing>) {
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? []);
  const [photoError, setPhotoError] = useState("");
  const { busy, error, submit } = useSubmit(async (form) => {
    const body = {
      title: text(form, "title"),
      description: text(form, "description"),
      price: num(form, "price"),
      category: text(form, "category"),
      condition: text(form, "condition"),
      photos,
    };
    if (initial) await api(`/listings/${initial.id}`, { method: "PATCH", json: body });
    else await api("/listings", { method: "POST", json: body });
    onSaved();
  });

  const addPhoto = async (files: FileList | null) => {
    setPhotoError("");
    const file = files?.[0];
    if (!file) return;
    if (file.size > 400 * 1024) return setPhotoError("Choose a photo under 400 KB");
    try {
      const url = await readAsDataUrl(file);
      setPhotos((p) => [...p, url].slice(0, 5));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "The photo could not be added");
    }
  };

  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Title<input required name="title" maxLength={80} defaultValue={initial?.title} placeholder="e.g. Wireless Headphones" /></label>
      <div className="form-row">
        <label>Price<input required name="price" type="number" min="0.01" step="0.01" defaultValue={initial?.price} /></label>
        <label>Category<select name="category" defaultValue={initial?.category ?? "Other"}>
          {LISTING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select></label>
      </div>
      <label>Condition<select name="condition" defaultValue={initial?.condition ?? "Good"}>
        {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
      </select></label>
      <label>Description<textarea required name="description" maxLength={2000} defaultValue={initial?.description} placeholder="Describe the item honestly" /></label>
      <div className="photo-picker">
        <span>Photos (up to 5)</span>
        <div className="photo-row">
          {photos.map((src, i) => (
            <button type="button" key={i} className="photo-thumb" aria-label="Remove photo" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
              <img src={src} alt="" />
            </button>
          ))}
          {photos.length < 5 && <label className="photo-add"><span aria-hidden="true">+</span> Add<input type="file" accept="image/*" onChange={(e) => addPhoto(e.target.files)} /></label>}
        </div>
        {photoError && <p className="auth-error">{photoError}</p>}
      </div>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label={initial ? "Save listing" : "Publish listing"} />
    </form>
  );
}

export function PostForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { busy, error, submit } = useSubmit(async (form) => {
    await api("/posts", { method: "POST", json: { title: text(form, "title"), content: text(form, "content"), category: text(form, "category") } });
    onSaved();
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Title<input required name="title" maxLength={140} placeholder="A clear question or tip" /></label>
      <label>Category<select name="category" defaultValue="General">
        {["Saving Tips", "Budgeting", "Financial Goals", "Student Life", "General"].map((c) => <option key={c}>{c}</option>)}
      </select></label>
      <label>Content<textarea required name="content" maxLength={4000} placeholder="Share your experience. Never include account numbers or balances." /></label>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label="Publish post" />
    </form>
  );
}

export function ContactForm({ listing, onSaved, onCancel }: { listing: Listing; onSaved: (conversationId: string) => void; onCancel: () => void }) {
  const { busy, error, submit } = useSubmit(async (form) => {
    const started = await api<{ conversationId: string }>(`/listings/${listing.id}/messages`, { method: "POST", json: { body: text(form, "body") } });
    onSaved(started.conversationId);
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Message to {listing.seller.name}<textarea required name="body" maxLength={1000} placeholder="Is it still available? Can we meet nearby?" /></label>
      <p className="muted-small">Never share bank details. Saviny does not process payments in version 1.</p>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label="Send message" />
    </form>
  );
}

export function PasswordForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { busy, error, submit } = useSubmit(async (form) => {
    if (text(form, "newPassword") !== text(form, "confirmPassword")) throw new Error("The new passwords do not match");
    await api("/users/me/password", { method: "POST", json: { currentPassword: text(form, "currentPassword"), newPassword: text(form, "newPassword") } });
    onSaved();
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Current password<input required name="currentPassword" type="password" /></label>
      <label>New password<input required name="newPassword" type="password" minLength={8} /></label>
      <label>Confirm new password<input required name="confirmPassword" type="password" minLength={8} /></label>
      <p className="muted-small">Changing your password signs you out of your other devices.</p>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label="Change password" />
    </form>
  );
}

