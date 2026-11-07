import { useState } from "react";
import { AiNotice, useAiCall } from "./AiPanel";
import { formatMoney } from "../lib/format";
import { api } from "../lib/api";

interface ScenarioResult {
  summary: string;
  verdict?: "favorable" | "attention" | "critique";
  monthlyChange: number;
  newSavingsCapacity?: number;
  goalTimelineImpact?: string;
  effects: { area: string; effect: string }[];
  recommendedSteps?: string[];
}

const PRESETS = [
  "Acheter un vélo à 350$ et réduire les sorties de 50$/mois",
  "Nouveau travail avec augmentation de 300$/mois",
  "Abonnement mensuel de sport à 45$/mois",
];

/**
 * Simulateur de Scénarios Financiers (Pennywise Coach).
 * Permet à l'utilisateur de simuler des choix budgétaires et voir l'impact immédiat sur son épargne.
 */
export function WhatIf({ currency }: { currency: string }) {
  const [scenario, setScenario] = useState("");
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const ai = useAiCall();

  const simulate = async (customText?: string) => {
    const textToRun = (customText ?? scenario).trim();
    if (textToRun.length < 3) return;
    const answer = await ai.call(() =>
      api<ScenarioResult>("/ai/coach/simulate", {
        method: "POST",
        json: { scenario: textToRun },
      }).catch(() =>
        api<ScenarioResult>("/ai/finance/what-if", {
          method: "POST",
          json: { scenario: textToRun },
        })
      )
    );
    if (answer) setResult(answer);
  };

  return (
    <section className="bg-slate-50/70 dark:bg-slate-900/40 border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 space-y-3.5 my-3 text-slate-900 dark:text-slate-100" aria-label="Simulateur prévisionnel">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <img
            src="/assets/penny-avatar-thumb.png"
            alt="Coach Penny"
            className="w-8 h-8 rounded-full object-cover border border-slate-300 dark:border-slate-700 shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-slate-900 dark:text-white">
                Simulateur Prévisionnel (What-If)
              </h3>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                Coach Penny
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Évaluez l'impact d'une dépense, d'un achat ou d'un changement de revenus sur vos objectifs.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Presets */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Hypothèses courantes :</span>
        {PRESETS.map((p, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => { setScenario(p); simulate(p); }}
            className="text-[11px] bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 px-2.5 py-1 rounded-lg border border-slate-200/80 dark:border-slate-700 transition cursor-pointer"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <textarea
          aria-label="Décrivez un scénario financier"
          maxLength={500}
          rows={2}
          placeholder="Ex: J'achète un appareil électroménager à 450$ en deux fois et je réduis mon budget sorties de 30$/mois..."
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          className="w-full p-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-emerald-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white resize-none"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => simulate()}
            disabled={ai.busy || scenario.trim().length < 3}
            className="px-4 py-2 bg-[#0e2422] hover:bg-[#153430] text-white font-semibold text-xs rounded-lg disabled:opacity-50 transition cursor-pointer flex items-center gap-2"
          >
            {ai.busy ? "Calcul en cours..." : "Lancer la simulation"}
          </button>
        </div>
      </div>

      {ai.error && <p className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-200">{ai.error}</p>}

      {result && (
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 animate-fadeIn text-xs">
          <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
            <span className="font-semibold text-slate-900 dark:text-white text-xs">
              Synthèse prévisionnelle
            </span>
            {result.verdict && (
              <span
                className={`px-2.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                  result.verdict === "favorable"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : result.verdict === "attention"
                    ? "bg-amber-50 text-amber-800 border border-amber-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                Impact {result.verdict}
              </span>
            )}
          </div>

          <p className="text-slate-800 dark:text-slate-200 leading-relaxed font-normal">{result.summary}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-100 dark:border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-medium block mb-0.5">Variation mensuelle</span>
              <strong className={`text-sm ${result.monthlyChange >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-slate-900 dark:text-white"}`}>
                {result.monthlyChange >= 0 ? "+" : ""}{formatMoney(result.monthlyChange, currency)}/mois
              </strong>
            </div>

            {result.newSavingsCapacity !== undefined && (
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase font-medium block mb-0.5">Nouvelle capacité mensuelle</span>
                <strong className="text-sm text-slate-900 dark:text-white">
                  {formatMoney(result.newSavingsCapacity, currency)}/mois
                </strong>
              </div>
            )}
          </div>

          {result.goalTimelineImpact && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
              <strong>Impact sur vos objectifs d'épargne :</strong> {result.goalTimelineImpact}
            </div>
          )}

          {result.effects?.length > 0 && (
            <div className="space-y-1">
              <span className="font-semibold text-slate-800 dark:text-slate-200 text-[11px] block">Impacts détaillés :</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {result.effects.map((e, i) => (
                  <div key={i} className="p-2 bg-slate-50 dark:bg-slate-800 rounded text-[11px] text-slate-700 dark:text-slate-300">
                    <strong className="text-slate-900 dark:text-white">{e.area}:</strong> {e.effect}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.recommendedSteps && result.recommendedSteps.length > 0 && (
            <div className="space-y-1 pt-1">
              <span className="font-semibold text-slate-800 dark:text-slate-200 text-[11px] block">Recommandations du Coach :</span>
              <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400 text-[11px]">
                {result.recommendedSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <AiNotice />
    </section>
  );
}
