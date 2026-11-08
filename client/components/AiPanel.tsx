import { useState, type ReactNode } from "react";
import { AI_NOTICE, aiErrorText } from "../lib/ai";

interface AiPanelProps<T> {
  title: string;
  action: string;
  run: () => Promise<T>;
  render: (result: T) => ReactNode;
  description?: string;
  defaultExpanded?: boolean;
}

/** Runs one AI request when the user asks for it, and shows the answer. Clean, restrained, professional. */
export function AiPanel<T>({
  title,
  action,
  run,
  render,
  description,
}: AiPanelProps<T>) {
  const { busy, error, call } = useAiCall();
  const [result, setResult] = useState<T | null>(null);

  const ask = async () => {
    const answer = await call(run);
    if (answer !== undefined) setResult(answer);
  };

  const defaultDesc =
    title.toLowerCase().includes("budget")
      ? "Compare your budget limits with your spending and suggest helpful changes."
      : title.toLowerCase().includes("subscription")
      ? "Find recurring payments that may be subscriptions or duplicates."
      : title.toLowerCase().includes("goal")
      ? "Estimate how much to save each month to reach your goal on time."
      : title.toLowerCase().includes("account")
      ? "Review how your money is spread across accounts and savings."
      : title.toLowerCase().includes("profile")
      ? "Get a simple overview of your finances and practical next steps."
      : title.toLowerCase().includes("digest") || title.toLowerCase().includes("notif")
      ? "Get a clear summary of recent alerts and financial priorities."
      : "Review your financial information.";

  return (
    <section
      className="my-3 p-4 rounded-xl bg-slate-50/70 dark:bg-slate-900/40 border border-slate-200/90 dark:border-slate-800 text-[#102a29] dark:text-emerald-50 transition"
      aria-label={title}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
              Pennywise Intelligence
            </span>
          </div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {title}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed">
            {description || defaultDesc}
          </p>
        </div>

        <button
          type="button"
          onClick={ask}
          disabled={busy}
          className="shrink-0 px-3.5 py-2 rounded-lg bg-[#0e2422] hover:bg-[#153430] text-white text-xs font-semibold shadow-sm transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
        >
          {busy ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Analyzing…</span>
            </>
          ) : (
            <span>{action}</span>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
          <span>{error}</span>
        </div>
      )}

      {result !== null && (
        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 animate-fadeIn">
          <div className="p-3.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 space-y-1.5 leading-relaxed">
            {render(result)}
          </div>
        </div>
      )}

      <div className="mt-2.5 pt-2 border-t border-slate-200/50 dark:border-slate-800/50">
        <AiNotice />
      </div>
    </section>
  );
}

export function AiNotice() {
  return (
    <p className="ai-notice text-slate-400 text-[10px] leading-normal">
      Privacy notice: AI analyses are generated securely from your private data.
    </p>
  );
}

/** Busy and error state for an AI call made from inside a form or a custom control. */
export function useAiCall() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function call<T>(run: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await run();
    } catch (err) {
      setError(aiErrorText(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, call, setError };
}
