import { useState } from "react";
import { api } from "../lib/api";
import { formatMoney } from "../lib/format";
import { AiNotice, useAiCall } from "./AiPanel";

interface ScenarioResult {
  summary: string;
  monthlyChange: number;
  verdict?: "favorable" | "neutre" | "attention" | "critique";
  verdictExplanation?: string;
  newSavingsCapacity?: number;
  effects: { area: string; effect: string }[];
  goalTimelineImpact?: string;
  risks: string[];
  recommendedSteps?: string[];
}

const PRESETS = [
  "Acheter un vélo à 350$ et réduire les sorties de 50$/mois",
  "Nouveau travail avec augmentation de 300$/mois",
  "Abonnement mensuel de sport à 45$/mois",
];

/**
 * Simulateur de Scénarios Financiers (Saviny AI – Smart Savings Coach).
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
        // Fallback transparent to legacy endpoint if needed
        api<ScenarioResult>("/ai/finance/what-if", {
          method: "POST",
          json: { scenario: textToRun },
        })
      )
    );
    if (answer) setResult(answer);
  };

  return (
    <section className="bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40 border border-emerald-900/15 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4 my-4" aria-label="Simulateur Smart Savings Coach">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-white flex items-center justify-center text-lg shadow-sm">
            🔮
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm sm:text-base text-gray-900">
                Saviny AI – Smart Savings Coach : Simulateur
              </h3>
              <span className="text-[10px] font-extrabold uppercase bg-emerald-600/15 text-emerald-800 border border-emerald-600/20 px-2 py-0.5 rounded-full">
                ✨ Scénario IA
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Anticipez l'impact d'une dépense, d'un achat ou d'un changement de revenus sur vos objectifs d'épargne.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Presets */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Exemples :</span>
        {PRESETS.map((p, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => { setScenario(p); simulate(p); }}
            className="text-[11px] bg-white hover:bg-emerald-100 hover:text-emerald-950 text-gray-700 px-3 py-1 rounded-full border border-gray-200 transition shadow-2xs"
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
          placeholder="Ex: J'achète un appareil électroménager à 450$ en deux fois et je réduis mon budget transport de 30$/mois..."
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          className="w-full p-3.5 text-xs sm:text-sm rounded-2xl border border-gray-200 focus:outline-none focus:border-emerald-700 bg-white shadow-2xs resize-none"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => simulate()}
            disabled={ai.busy || scenario.trim().length < 3}
            className="px-5 py-2.5 bg-[#102a29] text-white font-bold text-xs rounded-xl hover:bg-[#1a3f3e] disabled:opacity-50 transition cursor-pointer flex items-center gap-2 shadow"
          >
            {ai.busy ? "🧙‍♂️ Analyse du coach en cours..." : "Simuler ce scénario"}
          </button>
        </div>
      </div>

      {ai.error && <p className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">{ai.error}</p>}

      {result && (
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-emerald-200/80 shadow-sm space-y-3.5 animate-fade-in text-xs">
          <div className="flex items-center justify-between flex-wrap gap-2 border-b border-gray-100 pb-2.5">
            <span className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
              <span>📊</span> Analyse Prévisionnelle du Coach
            </span>
            {result.verdict && (
              <span
                className={`px-3 py-1 rounded-full text-[10px] font-extrabold uppercase ${
                  result.verdict === "favorable"
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                    : result.verdict === "attention"
                    ? "bg-amber-100 text-amber-800 border border-amber-200"
                    : "bg-red-100 text-red-800 border border-red-200"
                }`}
              >
                Impact {result.verdict}
              </span>
            )}
          </div>

          <p className="text-gray-800 leading-relaxed font-medium text-xs sm:text-sm">{result.summary}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Variation mensuelle</span>
              <strong className={`text-base ${result.monthlyChange >= 0 ? "text-emerald-700" : "text-gray-900"}`}>
                {result.monthlyChange >= 0 ? "+" : ""}{formatMoney(result.monthlyChange, currency)}/mois
              </strong>
            </div>

            {result.newSavingsCapacity !== undefined && (
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Nouvelle capacité d'épargne</span>
                <strong className="text-base text-emerald-950">
                  {formatMoney(result.newSavingsCapacity, currency)}/mois
                </strong>
              </div>
            )}
          </div>

          {result.goalTimelineImpact && (
            <div className="p-3 bg-emerald-50/80 rounded-xl border border-emerald-200/80 text-[11px] text-emerald-900 leading-relaxed">
              <strong>🎯 Impact sur vos objectifs d'épargne :</strong> {result.goalTimelineImpact}
            </div>
          )}

          {result.effects?.length > 0 && (
            <div className="space-y-1">
              <span className="font-bold text-gray-800 text-[11px] block">Impacts par domaine :</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {result.effects.map((e, i) => (
                  <div key={i} className="p-2 bg-gray-50 rounded-lg text-[11px] text-gray-700">
                    <strong className="text-gray-900">{e.area}:</strong> {e.effect}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.recommendedSteps && result.recommendedSteps.length > 0 && (
            <div className="space-y-1 pt-1">
              <span className="font-bold text-gray-800 text-[11px] block">Recommandations du Coach pour réussir ce scénario :</span>
              <ul className="list-disc list-inside space-y-0.5 text-gray-600 text-[11px]">
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
