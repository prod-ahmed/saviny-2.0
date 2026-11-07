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

/** Runs one AI request when the user asks for it, and shows the answer. Highly visible and engaging. */
export function AiPanel<T>({
  title,
  action,
  run,
  render,
  description,
  defaultExpanded = false,
}: AiPanelProps<T>) {
  const { busy, error, call } = useAiCall();
  const [result, setResult] = useState<T | null>(null);

  const ask = async () => {
    const answer = await call(run);
    if (answer !== undefined) setResult(answer);
  };

  const defaultDesc =
    title.toLowerCase().includes("budget")
      ? "L'IA examine vos plafonds et vos dépenses réelles pour vous recommander des ajustements d'épargne."
      : title.toLowerCase().includes("subscription") || title.toLowerCase().includes("abonnement")
      ? "Détectez automatiquement vos prélèvements récurrents et repérez les abonnements superflus."
      : title.toLowerCase().includes("goal") || title.toLowerCase().includes("objectif")
      ? "Calculez vos jalons d'épargne optimaux pour atteindre vos objectifs plus rapidement."
      : title.toLowerCase().includes("account") || title.toLowerCase().includes("compte")
      ? "Analysez la répartition de vos liquidités et recevez des conseils de trésorerie."
      : title.toLowerCase().includes("profile") || title.toLowerCase().includes("profil")
      ? "Obtenez un bilan financier complet et des axes d'amélioration personnalisés."
      : title.toLowerCase().includes("digest") || title.toLowerCase().includes("notif")
      ? "Synthétisez vos alertes et vos priorités financières du jour en un résumé clair."
      : "L'IA analyse vos données pour vous faire gagner du temps et optimiser vos décisions financières.";

  return (
    <section
      className="my-4 p-5 rounded-3xl bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-cyan-500/10 dark:from-emerald-950/40 dark:via-teal-950/20 dark:to-cyan-950/30 border-2 border-emerald-400/40 dark:border-emerald-600/40 shadow-md hover:shadow-lg transition-all text-[#102a29] dark:text-emerald-50 relative overflow-hidden"
      aria-label={title}
    >
      {/* Decorative background glow */}
      <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-400/15 rounded-full blur-2xl pointer-events-none" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-600 text-white shadow-sm tracking-wide">
              <span>✨</span> IA PENNYWISE
            </span>
            <span className="text-[10px] text-emerald-800 dark:text-emerald-300 font-bold bg-emerald-100/80 dark:bg-emerald-900/40 px-2 py-0.5 rounded-md border border-emerald-300/40">
              ⚡ Google Gemini Flash
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
            {title}
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-300 max-w-xl">
            {description || defaultDesc}
          </p>
        </div>

        <button
          type="button"
          onClick={ask}
          disabled={busy}
          className="shrink-0 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-700 to-teal-800 hover:from-emerald-600 hover:to-teal-700 text-white text-xs sm:text-sm font-bold shadow-md hover:shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed border border-emerald-500/30"
        >
          {busy ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Analyse en cours...</span>
            </>
          ) : (
            <>
              <span>✨</span>
              <span>{action}</span>
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {result !== null && (
        <div className="mt-4 pt-4 border-t border-emerald-200/60 dark:border-emerald-800/60 animate-fadeIn">
          <div className="p-4 rounded-2xl bg-white/90 dark:bg-[#122322]/90 backdrop-blur-sm border border-emerald-100 dark:border-emerald-900/50 shadow-sm text-sm text-gray-800 dark:text-gray-200 space-y-2">
            {render(result)}
          </div>
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-emerald-200/30 dark:border-emerald-800/20">
        <AiNotice />
      </div>
    </section>
  );
}

export function AiNotice() {
  return (
    <p className="text-gray-500 dark:text-gray-400 text-[11px] flex items-center gap-1.5 opacity-80">
      <span>🔒</span>
      <span>
        <em>Notice de confidentialité :</em> Les calculs et analyses sont traités via Google Gemini. Pennywise protège vos données financières privées.
      </span>
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
