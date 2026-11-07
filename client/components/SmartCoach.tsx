import { useState, useEffect, useRef } from "react";
import { formatMoney } from "../lib/format";
import { api } from "../lib/api";
import { AI_NOTICE } from "../lib/ai";

interface SavingsPlan {
  math: {
    totalBalance: number;
    monthlyIncome: number;
    monthlyExpenses: number;
    netCashFlow: number;
    savingsCapacity: number;
    recommendedWeekly: number;
    recommendedMonthly: number;
    goals: {
      id: string;
      title: string;
      progress: number;
      remaining: number;
      requiredMonthly: number;
      risk: "low" | "medium" | "high";
      riskReason?: string;
    }[];
  };
  coach: {
    healthScore: number;
    healthVerdict: string;
    coachSummary: string;
    spendingCuts: { title: string; tip: string; savingEst: string }[];
  };
}

interface ScenarioSimulation {
  summary: string;
  verdict: "favorable" | "attention" | "critique";
  monthlyChange: number;
  newSavingsCapacity: number;
  goalTimelineImpact: string;
  recommendedSteps: string[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const PRESETS = [
  "Acheter un vélo à 350$ et réduire les sorties de 50$/mois",
  "Nouveau travail avec augmentation de 300$/mois",
  "Abonnement mensuel de sport à 45$/mois",
];

export function SmartCoach({ currency = "USD" }: { currency?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"plan" | "whatif" | "chat">("plan");

  // Plan state
  const [plan, setPlan] = useState<SavingsPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState("");

  // What-If simulation state
  const [scenarioInput, setScenarioInput] = useState("");
  const [simulation, setSimulation] = useState<ScenarioSimulation | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState("");

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSending, setChatSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchPlan = async () => {
    setLoadingPlan(true);
    setPlanError("");
    try {
      const data = await api<SavingsPlan>("/ai/coach/plan");
      setPlan(data);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Impossible de charger le plan d'épargne");
    } finally {
      setLoadingPlan(false);
    }
  };

  useEffect(() => {
    if (open && !plan && !loadingPlan) {
      fetchPlan();
    }
  }, [open]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [chatMessages, chatSending]);

  const runSimulation = async (text?: string) => {
    const q = (text ?? scenarioInput).trim();
    if (q.length < 3) return;
    setSimulating(true);
    setSimError("");
    try {
      const result = await api<ScenarioSimulation>("/ai/coach/simulate", {
        method: "POST",
        json: { scenario: q },
      });
      setSimulation(result);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : "Erreur lors de la simulation");
    } finally {
      setSimulating(false);
    }
  };

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = chatInput.trim();
    if (!prompt || chatSending) return;

    setChatInput("");
    const userMsg: ChatMessage = { role: "user", content: prompt };
    const nextList = [...chatMessages, userMsg];
    setChatMessages(nextList);
    setChatSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextList.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) throw new Error("Erreur de connexion au coach");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setChatMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          assistantText += chunk;
          setChatMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: assistantText };
            return copy;
          });
        }
      }
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Désolé, une erreur est survenue lors de l'échange avec Penny. Veuillez réessayer.",
        },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      {!open && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-3 bg-[#0e2422] hover:bg-[#143330] text-white pl-2.5 pr-4 py-2 rounded-full shadow-lg border border-slate-700/60 hover:shadow-xl transition-all duration-200 cursor-pointer"
            aria-label="Ouvrir Coach Penny"
          >
            <div className="relative">
              <img
                src="/assets/penny-avatar-thumb.png"
                alt="Coach Penny"
                className="w-9 h-9 rounded-full object-cover border border-emerald-400/50 shadow-sm"
              />
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 border-2 border-[#0e2422] rounded-full" />
            </div>

            <div className="text-left">
              <span className="text-[10px] font-medium text-emerald-400 uppercase tracking-wider block">Smart Coach</span>
              <span className="text-xs font-semibold text-white block -mt-0.5">Coach Penny</span>
            </div>
          </button>
        </div>
      )}

      {/* Main Coach Interface Drawer/Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="w-full sm:max-w-xl bg-white dark:bg-[#11201f] text-[#102a29] dark:text-emerald-50 rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh] sm:max-h-[85vh] overflow-hidden">
            {/* Coach Header */}
            <header className="bg-[#0e2422] text-white px-5 py-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/penny-avatar-thumb.png"
                  alt="Penny"
                  className="w-11 h-11 rounded-full object-cover border-2 border-emerald-500/40 shadow-sm"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold leading-tight text-white">Coach Penny</h2>
                    <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded-full font-medium">
                      Assistant IA
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">Plan d'épargne personnalisé et simulations financières</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition text-sm cursor-pointer"
                aria-label="Fermer"
              >
                ✕
              </button>
            </header>

            {/* Navigation Tabs */}
            <div className="grid grid-cols-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab("plan")}
                className={`py-3 text-center transition border-b-2 ${
                  tab === "plan"
                    ? "border-emerald-700 text-emerald-950 dark:text-white bg-white dark:bg-[#11201f]"
                    : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Plan & Diagnostic
              </button>
              <button
                type="button"
                onClick={() => setTab("whatif")}
                className={`py-3 text-center transition border-b-2 ${
                  tab === "whatif"
                    ? "border-emerald-700 text-emerald-950 dark:text-white bg-white dark:bg-[#11201f]"
                    : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Scénarios (What-If)
              </button>
              <button
                type="button"
                onClick={() => setTab("chat")}
                className={`py-3 text-center transition border-b-2 ${
                  tab === "chat"
                    ? "border-emerald-700 text-emerald-950 dark:text-white bg-white dark:bg-[#11201f]"
                    : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Chat Direct
              </button>
            </div>

            {/* Tab 1: Coach Plan & Diagnostics */}
            {tab === "plan" && (
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {loadingPlan && (
                  <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                    <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-medium">Penny analyse vos comptes et flux récents...</p>
                  </div>
                )}

                {planError && (
                  <div className="p-3.5 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs rounded-xl border border-red-200 dark:border-red-800">
                    {planError}
                  </div>
                )}

                {plan && !loadingPlan && (
                  <>
                    {/* Health Score & Verdict Card */}
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                          Bilan de santé financière
                        </span>
                        <span className="text-xs font-bold px-2.5 py-0.5 bg-emerald-800 text-white rounded-md">
                          Score : {plan.coach.healthScore} / 100
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{plan.coach.healthVerdict}</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{plan.coach.coachSummary}</p>
                    </div>

                    {/* Savings Capacity Metrics */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white dark:bg-slate-900/30 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Capacité mensuelle</span>
                        <span className="text-xl font-bold text-slate-900 dark:text-white">
                          {formatMoney(plan.math.savingsCapacity, currency)}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-1">Revenus - Charges réelles</span>
                      </div>
                      <div className="bg-white dark:bg-slate-900/30 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Cible hebdomadaire</span>
                        <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                          {formatMoney(plan.math.recommendedWeekly, currency)}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-1">Rythme conseillé</span>
                      </div>
                    </div>

                    {/* Active Goals & Timeline Monitoring */}
                    <div className="bg-white dark:bg-slate-900/30 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                          Suivi des objectifs d'épargne
                        </h4>
                        <span className="text-[10px] text-slate-400">Calcul actuariel backend</span>
                      </div>

                      {plan.math.goals.length === 0 ? (
                        <p className="text-xs text-slate-400 py-2">Aucun objectif actif. Créez-en un dans la section Objectifs.</p>
                      ) : (
                        plan.math.goals.map((g) => (
                          <div key={g.id} className="p-3 bg-slate-50 dark:bg-slate-900/80 rounded-lg space-y-1.5 border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-900 dark:text-white">{g.title}</span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  g.risk === "high"
                                    ? "bg-red-50 text-red-700 border border-red-200"
                                    : g.risk === "medium"
                                    ? "bg-amber-50 text-amber-800 border border-amber-200"
                                    : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                }`}
                              >
                                {g.risk === "high" ? "Risque de retard" : g.risk === "medium" ? "Rythme juste" : "En bonne voie"}
                              </span>
                            </div>
                            <div className="flex justify-between text-[11px] text-slate-500">
                              <span>Progression : {g.progress}%</span>
                              <span>Reste : {formatMoney(g.remaining, currency)}</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${Math.min(100, g.progress)}%` }} />
                            </div>
                            {g.riskReason && (
                              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{g.riskReason}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {/* Actionable Recommendations */}
                    <div className="bg-white dark:bg-slate-900/30 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                        Recommandations d'optimisation budgétaire
                      </h4>
                      <div className="space-y-2">
                        {plan.coach.spendingCuts.map((cut, idx) => (
                          <div key={idx} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3 text-xs">
                            <div>
                              <p className="font-semibold text-slate-900 dark:text-white">{cut.title}</p>
                              <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{cut.tip}</p>
                            </div>
                            <span className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 text-[11px]">
                              {cut.savingEst}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={fetchPlan}
                      className="w-full py-2.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg font-medium transition cursor-pointer"
                    >
                      Actualiser l'analyse
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Tab 2: What-If Scenario Simulator */}
            {tab === "whatif" && (
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Simulateur prévisionnel</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Modélisez l'impact d'une décision financière sur votre trésorerie et la date d'atteinte de vos objectifs.
                  </p>
                </div>

                {/* Preset Chips */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Hypothèses courantes :</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setScenarioInput(p); runSimulation(p); }}
                        className="text-[11px] bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 hover:text-emerald-900 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-left transition border border-slate-200/60 dark:border-slate-700"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Scenario Input */}
                <div className="space-y-2">
                  <textarea
                    rows={3}
                    value={scenarioInput}
                    onChange={(e) => setScenarioInput(e.target.value)}
                    placeholder="Ex: Augmentation de loyer de 120$/mois à partir de juin, avec coupe de 40$ sur les abonnements..."
                    className="w-full p-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-emerald-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => runSimulation()}
                    disabled={simulating || scenarioInput.trim().length < 3}
                    className="w-full py-2.5 bg-[#0e2422] hover:bg-[#143330] text-white font-semibold text-xs rounded-lg disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    {simulating ? "Modélisation en cours..." : "Calculer l'impact financier"}
                  </button>
                </div>

                {simError && (
                  <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">
                    {simError}
                  </div>
                )}

                {/* Simulation Result */}
                {simulation && (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3 animate-fadeIn text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white text-xs">Verdict prévisionnel</span>
                      <span
                        className={`px-2.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          simulation.verdict === "favorable"
                            ? "bg-emerald-100 text-emerald-800"
                            : simulation.verdict === "attention"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        Impact {simulation.verdict}
                      </span>
                    </div>

                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed font-normal">{simulation.summary}</p>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-800">
                        <span className="text-[10px] text-slate-500 block">Variation nette estimée</span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {simulation.monthlyChange >= 0 ? "+" : ""}{formatMoney(simulation.monthlyChange, currency)}/mois
                        </span>
                      </div>
                      <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-800">
                        <span className="text-[10px] text-slate-500 block">Nouvelle capacité mensuelle</span>
                        <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          {formatMoney(simulation.newSavingsCapacity, currency)}
                        </span>
                      </div>
                    </div>

                    {simulation.goalTimelineImpact && (
                      <div className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300">
                        <strong>Impact sur les objectifs :</strong> {simulation.goalTimelineImpact}
                      </div>
                    )}

                    {simulation.recommendedSteps?.length > 0 && (
                      <div className="pt-1">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 block mb-1">Recommandations :</span>
                        <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 text-[11px]">
                          {simulation.recommendedSteps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Direct Live Chat */}
            {tab === "chat" && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 p-4 overflow-y-auto space-y-3" ref={logRef}>
                  {chatMessages.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-xs">
                      <img
                        src="/assets/penny-avatar-thumb.png"
                        alt="Penny"
                        className="w-12 h-12 rounded-full mx-auto mb-2 object-cover border border-slate-200"
                      />
                      <p className="font-semibold text-slate-700 dark:text-slate-200">Coach Penny est à votre écoute</p>
                      <p className="text-[11px] mt-1 text-slate-500 max-w-xs mx-auto">
                        Posez vos questions sur vos dépenses récentes, vos prévisions d'épargne ou la gestion de votre budget.
                      </p>
                    </div>
                  ) : (
                    chatMessages.map((m, i) => (
                      <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        {m.role !== "user" && (
                          <img
                            src="/assets/penny-avatar-thumb.png"
                            alt="Penny"
                            className="w-7 h-7 rounded-full object-cover shrink-0 border border-slate-200"
                          />
                        )}
                        <div
                          className={`max-w-[80%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                            m.role === "user"
                              ? "bg-[#0e2422] text-white rounded-br-none"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-none"
                          }`}
                        >
                          {m.content || (chatSending ? "Penny rédige sa réponse..." : "")}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={sendChatMessage} className="p-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Posez une question financière à Penny..."
                    className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-emerald-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                    disabled={chatSending}
                  />
                  <button
                    type="submit"
                    disabled={chatSending || !chatInput.trim()}
                    className="px-4 py-2 bg-[#0e2422] hover:bg-[#143330] text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition cursor-pointer"
                  >
                    Envoyer
                  </button>
                </form>
              </div>
            )}

            {/* Footer with Notice */}
            <footer className="p-2.5 bg-slate-50 dark:bg-slate-900 border-t border-slate-200/60 dark:border-slate-800 text-center">
              <p className="text-[10px] text-slate-400">
                Notice de confidentialité : {AI_NOTICE}
              </p>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
