import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiUpload, readAsDataUrl } from "../lib/api";
import { todayIso } from "../lib/format";
import type { Account, Bill, Budget, Category, Goal, Listing, Transaction } from "../lib/types";
import { AiNotice, useAiCall } from "./AiPanel";
import { CameraCapture } from "./CameraCapture";
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

/** Fills one field of an uncontrolled form, for an AI suggestion. The user still reviews it before saving. */
function setField(form: HTMLFormElement | null, name: string, value: string | number): void {
  const field = form?.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) field.value = String(value);
}

const fieldText = (form: HTMLFormElement | null, name: string): string => String(new FormData(form ?? undefined).get(name) ?? "").trim();

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
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const ai = useAiCall();
  const [scannedReceipts, setScannedReceipts] = useState<Array<{
    id: string;
    fileName: string;
    preview: string;
    amount: number;
    date: string;
    description: string;
    categoryId: string | null;
    saved: boolean;
  }>>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanPhase, setScanPhase] = useState("");
  const [activeScanPreview, setActiveScanPreview] = useState<string | null>(null);
  const [scanError, setScanError] = useState("");
  const [saveReceiptsBusy, setSaveReceiptsBusy] = useState(false);
  const [saveReceiptsError, setSaveReceiptsError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [pendingFill, setPendingFill] = useState<{ amount: number; date: string; description: string; categoryId: string | null } | null>(null);

  /** Fill form fields after React finishes rendering (so the DOM is stable). */
  useEffect(() => {
    if (!pendingFill) return;
    const form = formRef.current;
    if (!form) return;
    // Amount — the total from the receipt
    setField(form, "amount", pendingFill.amount);
    // Date — real date from the ticket, or today if missing
    setField(form, "date", pendingFill.date || todayIso());
    // Description
    setField(form, "description", pendingFill.description);
    // Category
    if (pendingFill.categoryId) {
      setField(form, "categoryId", pendingFill.categoryId);
    }
    // Default account to checking or first available
    const currentAccount = fieldText(form, "accountId");
    if (!currentAccount) {
      const defaultAccount = accounts.find((a) => a.type === "checking") ?? accounts[0];
      if (defaultAccount) setField(form, "accountId", defaultAccount.id);
    }
    // Set type to expense for receipts
    const expenseRadio = form.querySelector<HTMLInputElement>('input[name="type"][value="expense"]');
    if (expenseRadio) expenseRadio.checked = true;
    setPendingFill(null);
  }, [pendingFill, accounts]);

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

  useEffect(() => () => {
    for (const preview of previewUrlsRef.current) URL.revokeObjectURL(preview);
  }, []);

  const suggestCategory = async () => {
    const description = fieldText(formRef.current, "description");
    if (description.length < 2) return ai.setError("Write a short description first, then ask for a category.");
    const type = fieldText(formRef.current, "type") === "income" ? "income" : "expense";
    const amount = Number(fieldText(formRef.current, "amount")) || undefined;
    const answer = await ai.call(() => api<{ categoryId: string | null }>("/ai/finance/categorize", { method: "POST", json: { description, type, amount } }));
    if (answer?.categoryId) setField(formRef.current, "categoryId", answer.categoryId);
    else if (answer) ai.setError("No category matched. Choose one yourself.");
  };

  /** Scans selected receipts one by one and keeps each verified total ready to save as an expense. */
  const scanReceipts = async (files: File[]) => {
    if (files.length === 0) return;
    const queued = files.slice(0, 10);
    setScanError(files.length > queued.length ? "Only the first 10 receipts were selected for scanning." : "");
    setSaveReceiptsError("");
    setIsScanning(true);
    let failed = 0;
    for (const [index, file] of queued.entries()) {
      const preview = URL.createObjectURL(file);
      previewUrlsRef.current.add(preview);
      setActiveScanPreview(preview);
      setScanProgress(5);
      setScanPhase(`Scanning receipt ${index + 1} of ${queued.length}…`);
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024) {
        failed += 1;
        setScanError((current) => `${current ? `${current} ` : ""}${file.name}: choose a JPEG, PNG, or WebP image up to 4 MB.`);
        URL.revokeObjectURL(preview);
        previewUrlsRef.current.delete(preview);
        continue;
      }

      const timer = window.setInterval(() => {
        setScanProgress((progress) => Math.min(92, progress + Math.max(2, Math.round((92 - progress) * 0.12))));
      }, 350);
      try {
        const receipt = await apiUpload<{ type: string; amount: number; date: string; description: string; categoryId: string | null }>(
          "/ai/finance/receipt",
          file
        );
        if (!Number.isFinite(receipt.amount) || receipt.amount <= 0) {
          throw new Error("Could not read a valid total. Retake the photo or choose another image.");
        }
        setScannedReceipts((current) => [...current, {
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
          fileName: file.name,
          preview,
          amount: receipt.amount,
          date: receipt.date,
          description: receipt.description,
          categoryId: receipt.categoryId,
          saved: false,
        }]);
        // Queue field-fill for after React re-renders the DOM
        setPendingFill({
          amount: receipt.amount,
          date: receipt.date || todayIso(),
          description: receipt.description,
          categoryId: receipt.categoryId,
        });
        setScanProgress(100);
        setScanPhase(`Receipt ${index + 1} scanned`);
      } catch (err) {
        failed += 1;
        URL.revokeObjectURL(preview);
        previewUrlsRef.current.delete(preview);
        setScanError((current) => `${current ? `${current} ` : ""}${file.name}: ${err instanceof Error ? err.message : "Could not scan this receipt."}`);
      } finally {
        window.clearInterval(timer);
      }
    }
    setActiveScanPreview(null);
    setIsScanning(false);
    setScanProgress(0);
    setScanPhase(failed ? `${queued.length - failed} of ${queued.length} receipts scanned.` : `${queued.length} receipt${queued.length === 1 ? "" : "s"} scanned.`);
    if (fileRef.current) fileRef.current.value = "";
  };

  const saveScannedReceipts = async () => {
    const unsaved = scannedReceipts.filter((receipt) => !receipt.saved);
    if (unsaved.length === 0) return;
    const accountId = fieldText(formRef.current, "accountId")
      || accounts.find((account) => account.type === "checking")?.id
      || accounts[0]?.id;
    if (!accountId) {
      setSaveReceiptsError("Add an account before saving scanned expenses.");
      return;
    }
    setSaveReceiptsBusy(true);
    setSaveReceiptsError("");
    let savedCount = 0;
    try {
      for (const receipt of unsaved) {
        const categoryId = receipt.categoryId
          || categories.find((category) => category.name.toLowerCase() === "food")?.id
          || categories[0]?.id;
        if (!categoryId) throw new Error("Add an expense category before saving scanned expenses.");
        await api("/transactions", {
          method: "POST",
          requireOnline: true,
          json: {
            type: "expense",
            amount: receipt.amount,
            date: receipt.date,
            description: receipt.description || receipt.fileName,
            accountId,
            categoryId,
          },
        });
        setScannedReceipts((current) => current.map((item) => item.id === receipt.id ? { ...item, saved: true } : item));
        savedCount += 1;
      }
      onSaved();
    } catch (err) {
      const remaining = unsaved.length - savedCount;
      setSaveReceiptsError(
        savedCount > 0
          ? `${savedCount} receipt${savedCount === 1 ? "" : "s"} saved. ${remaining} could not be saved: ${err instanceof Error ? err.message : "Please try again."}`
          : err instanceof Error ? err.message : "Could not save scanned receipts. Please try again."
      );
    } finally {
      setSaveReceiptsBusy(false);
    }
  };

  return (
    <form className="flow-form" onSubmit={submit} ref={formRef}>
      {!cameraOpen && activeScanPreview && (
        <section className="receipt-scan-card relative mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 p-3 text-white shadow-md" aria-live="polite">
          <div className="receipt-scan-stage">
            <img src={activeScanPreview} alt="Receipt being scanned" />
            <div className="scanner-laser" aria-hidden="true" />
          </div>
          <div className="mt-3 flex justify-between gap-2 text-xs">
            <span>{scanPhase}</span><span className="font-semibold text-emerald-300">{scanProgress}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-700">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${scanProgress}%` }} />
          </div>
        </section>
      )}
      {scannedReceipts.length > 0 && (
        <section className="receipt-save-prompt" aria-label="Scanned receipts">
          <div className="w-full">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <strong>Scanned receipts ({scannedReceipts.length})</strong>
              <span className="text-xs font-semibold text-slate-700">
                Total: ${scannedReceipts.reduce((sum, receipt) => sum + receipt.amount, 0).toFixed(2)}
              </span>
            </div>
            <div className="grid gap-2">
              {scannedReceipts.map((receipt) => (
                <div key={receipt.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
                  <img src={receipt.preview} alt="" className="h-14 w-12 shrink-0 rounded-lg bg-slate-100 object-cover" />
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-xs text-slate-900">{receipt.description || receipt.fileName}</strong>
                    <span className="text-xs text-slate-600">{receipt.date} · ${receipt.amount.toFixed(2)}</span>
                  </div>
                  {receipt.saved
                    ? <span className="shrink-0 text-xs font-semibold text-emerald-700">Saved</span>
                    : <button type="button" className="shrink-0 ml-auto px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition" aria-label={`Remove ${receipt.fileName}`} onClick={() => {
                      URL.revokeObjectURL(receipt.preview);
                      previewUrlsRef.current.delete(receipt.preview);
                      setScannedReceipts((current) => current.filter((item) => item.id !== receipt.id));
                    }}>Remove</button>}
                </div>
              ))}
            </div>
            <button type="button" className="primary mt-3 w-full" disabled={saveReceiptsBusy || isScanning || !scannedReceipts.some((receipt) => !receipt.saved)} onClick={saveScannedReceipts}>
              {saveReceiptsBusy ? "Saving expenses…" : `Save ${scannedReceipts.filter((receipt) => !receipt.saved).length} expense${scannedReceipts.filter((receipt) => !receipt.saved).length === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      )}
      {scanError && <p className="my-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800" role="alert">{scanError}</p>}
      {saveReceiptsError && <p className="my-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800" role="alert">{saveReceiptsError}</p>}
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
      {/* Smart Form Assistance Bar */}
      <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 my-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <span className="text-xs font-semibold text-slate-900 dark:text-white block">Smart form assistance</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Scan one or more receipts or get an automatic suggestion</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={suggestCategory}
            disabled={ai.busy || isScanning || saveReceiptsBusy}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 font-medium text-xs rounded-lg border border-slate-200 dark:border-slate-700 transition cursor-pointer disabled:opacity-50"
          >
            {ai.busy ? "Analyzing…" : "Suggest category"}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={ai.busy || isScanning || saveReceiptsBusy}
            className="px-3.5 py-1.5 bg-[#0e2422] hover:bg-[#153430] text-white font-semibold text-xs rounded-lg transition cursor-pointer disabled:opacity-50"
          >
            {isScanning ? "Scanning…" : "Choose receipt photos"}
          </button>
          <button type="button" onClick={() => setCameraOpen(true)} disabled={isScanning || saveReceiptsBusy || cameraOpen} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-100 disabled:opacity-50">
            {cameraOpen ? "Camera open" : "Use camera"}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void scanReceipts(Array.from(e.target.files ?? []))} />
        </div>
      </div>
      {cameraOpen && (
        <CameraCapture
          busy={isScanning}
          captureLabel="Capture and scan receipt"
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            setCameraOpen(false);
            void scanReceipts([file]);
          }}
        />
      )}
      <AiNotice />
      <FormError message={error || ai.error} />
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
  const [priceNote, setPriceNote] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const ai = useAiCall();
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
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setPhotoError("Choose a JPEG, PNG, WebP or GIF photo.");
      return;
    }
    if (file.size > 400 * 1024) return setPhotoError("Choose a photo under 400 KB");
    if (photos.length >= 5) return setPhotoError("You can add up to 5 photos.");
    try {
      const url = await readAsDataUrl(file);
      setPhotos((p) => [...p, url].slice(0, 5));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "The photo could not be added");
    }
  };

  const listingDetails = () => ({
    title: fieldText(formRef.current, "title"),
    category: fieldText(formRef.current, "category"),
    condition: fieldText(formRef.current, "condition"),
  });

  const writeDescription = async () => {
    const answer = await ai.call(() => api<{ description: string }>("/ai/market/description", {
      method: "POST",
      json: { ...listingDetails(), notes: fieldText(formRef.current, "description") || undefined },
    }));
    if (answer) setField(formRef.current, "description", answer.description);
  };

  const suggestPrice = async () => {
    const answer = await ai.call(() => api<{ suggestedPrice: number; low: number; high: number; reasoning: string }>("/ai/market/price", {
      method: "POST",
      json: { ...listingDetails(), description: fieldText(formRef.current, "description") || undefined },
    }));
    if (!answer) return;
    setField(formRef.current, "price", answer.suggestedPrice);
    setPriceNote(`Suggested ${answer.suggestedPrice} (range ${answer.low} to ${answer.high}). ${answer.reasoning}`);
  };

  return (
    <form className="flow-form" onSubmit={submit} ref={formRef}>
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
      <div className="my-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Listing help
          </span>
          <span className="text-[10px] text-slate-400">Assistant Pennywise</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={suggestPrice}
            disabled={ai.busy}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition cursor-pointer"
          >
            {ai.busy ? "Estimating…" : "Suggest a price"}
          </button>
          <button
            type="button"
            onClick={writeDescription}
            disabled={ai.busy}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 transition cursor-pointer"
          >
            {ai.busy ? "Writing…" : "Write a description"}
          </button>
        </div>
        {priceNote && (
          <p className="text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 leading-relaxed mt-1">
            {priceNote}
          </p>
        )}
      </div>
      <label>Description<textarea required name="description" maxLength={2000} defaultValue={initial?.description} placeholder="Describe the item honestly" /></label>
      <AiNotice />
      <div className="photo-picker">
        <span>Photos ({photos.length}/5)</span>
        <div className="photo-row">
          {photos.map((src, i) => (
            <button type="button" key={i} className="photo-thumb" aria-label={`Remove photo ${i + 1}`} onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
              <img src={src} alt="" />
              <span aria-hidden="true">×</span>
            </button>
          ))}
          {photos.length < 5 && <label className="photo-add">
            <span aria-hidden="true">+</span>
            <span>Add photo</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Add a listing photo" onChange={(e) => { void addPhoto(e.target.files); e.currentTarget.value = ""; }} />
          </label>}
        </div>
        {photoError && <p className="auth-error" role="alert">{photoError}</p>}
      </div>
      <FormError message={error || ai.error} />
      <Actions busy={busy} onCancel={onCancel} label={initial ? "Save listing" : "Publish listing"} />
    </form>
  );
}

export function PostForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const ai = useAiCall();
  const [review, setReview] = useState<{ issues: { rule: string; message: string }[]; suggestedTitle: string } | null>(null);
  const { busy, error, submit } = useSubmit(async (form) => {
    await api("/posts", { method: "POST", json: { title: text(form, "title"), content: text(form, "content"), category: text(form, "category") } });
    onSaved();
  });

  /** Checks the draft against the community rules. It only warns: the author decides what to publish. */
  const checkDraft = async () => {
    const answer = await ai.call(() => api<{ issues: { rule: string; message: string }[]; suggestedTitle: string }>("/ai/community/draft-check", {
      method: "POST",
      json: { title: fieldText(formRef.current, "title"), content: fieldText(formRef.current, "content"), category: fieldText(formRef.current, "category") },
    }));
    if (answer) setReview(answer);
  };

  return (
    <form className="flow-form" onSubmit={submit} ref={formRef}>
      <label>Title<input required name="title" maxLength={140} placeholder="A clear question or tip" /></label>
      <label>Category<select name="category" defaultValue="General">
        {["Saving Tips", "Budgeting", "Financial Goals", "Student Life", "General"].map((c) => <option key={c}>{c}</option>)}
      </select></label>
      <label>Content<textarea required name="content" maxLength={4000} placeholder="Share your experience. Never include account numbers or balances." /></label>
      <div className="ai-inline">
        <button type="button" className="secondary" onClick={checkDraft} disabled={ai.busy}>{ai.busy ? "Checking..." : "AI: check against the rules"}</button>
      </div>
      {review && (
        <div className="ai-body">
          {review.issues.length === 0 ? <p>No rule problems found.</p> : (
            <ul>{review.issues.map((i, n) => <li key={n}><strong>{i.rule}</strong>: {i.message}</li>)}</ul>
          )}
          {review.suggestedTitle && <button type="button" className="secondary" onClick={() => setField(formRef.current, "title", review.suggestedTitle)}>Use suggested title</button>}
        </div>
      )}
      <AiNotice />
      <FormError message={error || ai.error} />
      <Actions busy={busy} onCancel={onCancel} label="Publish post" />
    </form>
  );
}

export function ContactForm({ listing, onSaved, onCancel }: { listing: Listing; onSaved: (conversationId: string) => void; onCancel: () => void }) {
  const { busy, error, submit } = useSubmit(async (form) => {
    const started = await api<{ conversationId: string }>(`/listings/${listing.id}/messages`, { method: "POST", json: { body: text(form, "body") }, requireOnline: true });
    onSaved(started.conversationId);
  });
  return (
    <form className="flow-form" onSubmit={submit}>
      <label>Message to {listing.seller.name}<textarea required name="body" maxLength={1000} placeholder="Is it still available? Can we meet nearby?" /></label>
      <p className="muted-small">Never share bank details. Pennywise does not process payments directly in version 1.</p>
      <FormError message={error} />
      <Actions busy={busy} onCancel={onCancel} label="Send message" />
    </form>
  );
}

export function PasswordForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { busy, error, submit } = useSubmit(async (form) => {
    if (text(form, "newPassword") !== text(form, "confirmPassword")) throw new Error("The new passwords do not match");
    await api("/users/me/password", { method: "POST", json: { currentPassword: text(form, "currentPassword"), newPassword: text(form, "newPassword") }, requireOnline: true });
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
