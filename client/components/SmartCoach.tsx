import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, getToken } from "../lib/api";
import { formatMoney } from "../lib/format";
import { AI_NOTICE, aiErrorText } from "../lib/ai";
import { Icon } from "./ui";

interface GoalRisk {
  id: string;
  title: string;
  targetAmount: number;
  savedAmount: number;
  remaining: number;
  progress: number;
  targetDate: string | null;
  monthsLeft: number | null;
  requiredMonthly: number | null;
  risk: "on_track" | "medium" | "high";
  riskReason: string;
}

interface CoachPlanData {
  math: {
    balance: number;
    income: number;
    expenses: number;
    netCashFlow: number;
    savingsCapacity: number;
    recommendedMonthly: number;
    recommendedWeekly: number;
    goals: GoalRisk[];
    isInsufficient: boolean;
  };
  coach: {
    healthVerdict: string;
    healthScore: number;
    coachSummary: string;
    spendingCuts: { title: string; tip: string; savingEst: string }[];
    goalAdvice: { goalTitle: string; advice: string }[];
    actionSteps: string[];
  };
}

interface SimulationResult {
  summary: string;
  monthlyChange: number;
  verdict: "favorable" | "neutre" | "attention" | "critique";
  verdictExplanation: string;
  newSavingsCapacity: number;
  effects: { area: string; effect: string }[];
  goalTimelineImpact: string;
  risks: string[];
  recommendedSteps: string[];
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const PRESETS = [
  "Acheter un nouvel ordinateur à 900$ payé en 3 fois",
  "Réduire les repas au restaurant de 60$ par mois",
  "Déménager dans un appartement avec un loyer supérieur de 150$",
  "Prendre un travail d'appoint qui rapporte 250$ net par mois",
];

export function SmartCoach({ currency = "USD" }: { currency?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"plan" | "whatif" | "chat">("plan");

  // Coach Plan State
  const [plan, setPlan] = useState<CoachPlanData | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState("");

  // What-If Simulation State
  const [scenarioInput, setScenarioInput] = useState("");
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState("");

  // Live Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const fetchPlan = async () => {
    setLoadingPlan(true);
    setPlanError("");
    try {
      const res = await api<CoachPlanData>("/ai/coach/plan");
      setPlan(res);
    } catch (err: any) {
      setPlanError(aiErrorText(err));
    } finally {
      setLoadingPlan(false);
    }
  };

  useEffect(() => {
    if (open && !plan) {
      fetchPlan();
    }
  }, [open]);

  const runSimulation = async (textToSimulate?: string) => {
    const text = (textToSimulate ?? scenarioInput).trim();
    if (!text || simulating) return;
    setSimulating(true);
    setSimError("");
    try {
      const res = await api<SimulationResult>("/ai/coach/simulate", {
        method: "POST",
        json: { scenario: text },
      });
      setSimulation(res);
    } catch (err: any) {
      setSimError(aiErrorText(err));
    } finally {
      setSimulating(false);
    }
  };

  const sendChatMessage = async (e: FormEvent) => {
    e.preventDefault();
    const q = chatInput.trim();
    if (!q || chatBusy) return;
    const history: ChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setChatInput("");
    setChatBusy(true);
    setChatError("");
    try {
      const token = getToken();
      const res = await fetch("/api/ai/profile/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        throw new Error("L'assistant n'a pas pu répondre.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: answer }]);
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
      }
    } catch (err: any) {
      setChatError(aiErrorText(err));
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <>
      {/* Charismatic Floating Coach Avatar Button */}
      {!open && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="group relative flex items-center gap-3 bg-gradient-to-r from-[#102a29] to-[#1e4a47] text-white pl-4 pr-5 py-3 rounded-full shadow-2xl border border-emerald-400/40 hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer"
            aria-label="Ouvrir Saviny AI - Smart Savings Coach"
          >
            {/* Coach Avatar Circle with glow */}
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-200 text-gray-950 flex items-center justify-center text-xl shadow-inner font-bold">
                🧙‍♂️
              </div>
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-400 border-2 border-[#102a29] rounded-full animate-pulse" />
            </div>

            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-extrabold uppercase tracking-wider bg-emerald-400/20 text-emerald-300 px-1.5 py-0.5 rounded">
                  ✨ AI Coach
                </span>
              </div>
              <span className="text-sm font-bold text-white block">Coach Saviny</span>
            </div>
          </button>
        </div>
      )}

      {/* Main Coach Interface Drawer/Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full sm:max-w-xl bg-white text-[#102a29] rounded-t-3xl sm:rounded-3xl shadow-2xl border border-emerald-900/20 flex flex-col max-h-[92vh] sm:max-h-[85vh] overflow-hidden">
            {/* Coach Header */}
            <header className="bg-gradient-to-r from-[#102a29] via-[#163836] to-[#102a29] text-white p-4 sm:p-5 flex items-center justify-between shadow">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-400 to-teal-200 text-gray-950 flex items-center justify-center text-2xl shadow">
                  🧙‍♂️
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-bold leading-tight">Saviny AI – Smart Savings Coach</h2>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-full font-semibold">
                      Gemini
                    </span>
                  </div>
                  <p className="text-xs text-emerald-200/80">Votre conseiller financier personnel intelligent</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition text-sm cursor-pointer"
                aria-label="Fermer"
              >
                ✕
              </button>
            </header>

            {/* Navigation Tabs */}
            <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab("plan")}
                className={`py-3 text-center transition border-b-2 flex items-center justify-center gap-1.5 ${
                  tab === "plan"
                    ? "border-emerald-700 text-emerald-950 bg-white"
                    : "border-transparent text-gray-500 hover:text-gray-900"
                }`}
              >
                <span>📊</span> Plan & Diagnostic
              </button>
              <button
                type="button"
                onClick={() => setTab("whatif")}
                className={`py-3 text-center transition border-b-2 flex items-center justify-center gap-1.5 ${
                  tab === "whatif"
                    ? "border-emerald-700 text-emerald-950 bg-white"
                    : "border-transparent text-gray-500 hover:text-gray-900"
                }`}
              >
                <span>🔮</span> Scénarios (What-If)
              </button>
              <button
                type="button"
                onClick={() => setTab("chat")}
                className={`py-3 text-center transition border-b-2 flex items-center justify-center gap-1.5 ${
                  tab === "chat"
                    ? "border-emerald-700 text-emerald-950 bg-white"
                    : "border-transparent text-gray-500 hover:text-gray-900"
                }`}
              >
                <span>💬</span> Chat Direct
              </button>
            </div>

            {/* Tab 1: Coach Plan & Diagnostics */}
            {tab === "plan" && (
              <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
                {loadingPlan && (
                  <div className="py-12 flex flex-col items-center justify-center gap-3 text-gray-500">
                    <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-medium">Coach Saviny analyse vos comptes et transactions...</p>
                  </div>
                )}

                {planError && (
                  <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">
                    {planError}
                  </div>
                )}

                {plan && !loadingPlan && (
                  <>
                    {/* Health Score & Verdict Card */}
                    <div className="bg-gradient-to-br from-emerald-50 via-teal-50 to-white p-4 rounded-2xl border border-emerald-200/60 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                          <span>✨</span> Diagnostic du Coach
                        </span>
                        <span className="text-xs font-bold px-2.5 py-1 bg-emerald-600 text-white rounded-full">
                          Score : {plan.coach.healthScore}/100
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-emerald-950 mb-1">{plan.coach.healthVerdict}</h3>
                      <p className="text-xs text-gray-700 leading-relaxed">{plan.coach.coachSummary}</p>
                    </div>

                    {/* Savings Capacity Gauge */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-sm">
                        <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">Capacité d'épargne mensuelle</span>
                        <span className="text-xl font-extrabold text-emerald-900">
                          {formatMoney(plan.math.savingsCapacity, currency)}
                        </span>
                        <span className="text-[10px] text-gray-400 block mt-1">Revenus - Dépenses réelles</span>
                      </div>
                      <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-sm">
                        <span className="text-[11px] text-gray-500 block mb-0.5 font-medium">Objectif conseillé (par semaine)</span>
                        <span className="text-xl font-extrabold text-teal-800">
                          {formatMoney(plan.math.recommendedWeekly, currency)}
                        </span>
                        <span className="text-[10px] text-gray-400 block mt-1">Épargne sans effort</span>
                      </div>
                    </div>

                    {/* Active Goals & Delay Risks */}
                    <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm space-y-3">
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center justify-between">
                        <span>🎯 Suivi des Objectifs & Détection des Risques</span>
                        <span className="text-[10px] text-gray-400 font-normal">Calcul backend</span>
                      </h4>

                      {plan.math.goals.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">Aucun objectif actif. Créez-en un dans la section Objectifs !</p>
                      ) : (
                        plan.math.goals.map((g) => (
                          <div key={g.id} className="p-2.5 bg-gray-50 rounded-xl space-y-1.5 border border-gray-100">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-gray-900">{g.title}</span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  g.risk === "high"
                                    ? "bg-red-100 text-red-700"
                                    : g.risk === "medium"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {g.risk === "high" ? "🔴 Risque de retard" : g.risk === "medium" ? "🟡 Attention au rythme" : "🟢 Sur les rails"}
                              </span>
                            </div>
                            <div className="flex justify-between text-[11px] text-gray-500">
                              <span>Progression : {g.progress}%</span>
                              <span>Reste : {formatMoney(g.remaining, currency)}</span>
                            </div>
                            <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${Math.min(100, g.progress)}%` }} />
                            </div>
                            {g.riskReason && (
                              <p className="text-[10px] text-gray-600 italic">💡 {g.riskReason}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {/* Top Spending Cuts Recommendations */}
                    <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm space-y-2.5">
                      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                        💡 Recommandations personnalisées pour réduire vos dépenses
                      </h4>
                      <div className="space-y-2">
                        {plan.coach.spendingCuts.map((cut, idx) => (
                          <div key={idx} className="p-2.5 rounded-xl bg-gray-50 border border-gray-100 flex items-start justify-between gap-3 text-xs">
                            <div>
                              <p className="font-bold text-gray-900">{cut.title}</p>
                              <p className="text-[11px] text-gray-600 mt-0.5">{cut.tip}</p>
                            </div>
                            <span className="shrink-0 font-bold text-emerald-700 bg-emerald-100/60 px-2 py-1 rounded-lg text-[11px]">
                              {cut.savingEst}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={fetchPlan}
                      className="w-full py-2.5 text-xs text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition"
                    >
                      🔄 Rafraîchir l'analyse du coach
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Tab 2: What-If Scenario Simulator */}
            {tab === "whatif" && (
              <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Simulateur de Scénarios Financiers</h3>
                  <p className="text-xs text-gray-500">
                    Testez une décision financière (achat, réduction de dépenses, nouveau revenu) avant de la concrétiser.
                  </p>
                </div>

                {/* Preset Chips */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Scénarios rapides :</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setScenarioInput(p); runSimulation(p); }}
                        className="text-[11px] bg-gray-100 hover:bg-emerald-100 hover:text-emerald-950 text-gray-700 px-2.5 py-1.5 rounded-lg text-left transition"
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
                    placeholder="Ex: Je réduis mon budget sorties de 80$ et j'achète un vélo à 350$ le mois prochain..."
                    className="w-full p-3 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-emerald-700"
                  />
                  <button
                    type="button"
                    onClick={() => runSimulation()}
                    disabled={simulating || scenarioInput.trim().length < 3}
                    className="w-full py-3 bg-[#102a29] text-white font-bold text-xs rounded-xl hover:bg-[#1a3f3e] disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-2 shadow"
                  >
                    {simulating ? "🧙‍♂️ Coach Saviny simule l'impact..." : "🔮 Lancer la simulation"}
                  </button>
                </div>

                {simError && (
                  <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">
                    {simError}
                  </div>
                )}

                {/* Simulation Result */}
                {simulation && (
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-50 via-teal-50/50 to-white border border-emerald-200 shadow-sm space-y-3 animate-fade-in text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-950 text-sm">Résultat de la simulation</span>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${
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

                    <p className="text-gray-800 leading-relaxed font-medium">{simulation.summary}</p>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="p-2.5 bg-white rounded-xl border border-gray-100">
                        <span className="text-[10px] text-gray-500 block">Impact mensuel estimé</span>
                        <span className="text-base font-bold text-emerald-800">
                          {simulation.monthlyChange >= 0 ? "+" : ""}{formatMoney(simulation.monthlyChange, currency)}/mois
                        </span>
                      </div>
                      <div className="p-2.5 bg-white rounded-xl border border-gray-100">
                        <span className="text-[10px] text-gray-500 block">Nouvelle capacité d'épargne</span>
                        <span className="text-base font-bold text-gray-900">
                          {formatMoney(simulation.newSavingsCapacity, currency)}
                        </span>
                      </div>
                    </div>

                    {simulation.goalTimelineImpact && (
                      <div className="p-2.5 bg-white/80 rounded-xl border border-emerald-100 text-[11px] text-emerald-900">
                        <strong>🎯 Impact sur vos objectifs :</strong> {simulation.goalTimelineImpact}
                      </div>
                    )}

                    {simulation.recommendedSteps?.length > 0 && (
                      <div>
                        <span className="font-bold text-gray-800 block mb-1">Étapes recommandées par le coach :</span>
                        <ul className="list-disc list-inside space-y-0.5 text-gray-600 text-[11px]">
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
                  {messages.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-xs">
                      <div className="text-3xl mb-2">🧙‍♂️</div>
                      <p className="font-semibold text-gray-700">Coach Saviny est à votre écoute.</p>
                      <p className="text-[11px] mt-1">
                        Posez-moi n'importe quelle question sur vos comptes, vos dépenses réelles ou vos objectifs.
                      </p>
                    </div>
                  ) : (
                    messages.map((m, i) => (
                      <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        {m.role !== "user" && (
                          <div className="w-7 h-7 rounded-full bg-emerald-800 text-white flex items-center justify-center text-xs shrink-0">
                            🧙‍♂️
                          </div>
                        )}
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                            m.role === "user"
                              ? "bg-[#102a29] text-white rounded-br-none"
                              : "bg-gray-100 text-gray-800 rounded-bl-none"
                          }`}
                        >
                          {m.content || (chatBusy ? "Réflexion en cours..." : "")}
                        </div>
                      </div>
                    ))
                  )}
                  {chatError && (
                    <div className="p-2 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">
                      {chatError}
                    </div>
                  )}
                </div>

                <form onSubmit={sendChatMessage} className="p-3 bg-gray-50 border-t border-gray-200 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Demandez un conseil à Coach Saviny..."
                    className="flex-1 px-3.5 py-2.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-emerald-700 bg-white"
                    disabled={chatBusy}
                  />
                  <button
                    type="submit"
                    disabled={chatBusy || !chatInput.trim()}
                    className="px-4 py-2.5 bg-[#102a29] text-white text-xs font-bold rounded-xl hover:bg-[#1a3f3e] disabled:opacity-50 transition cursor-pointer"
                  >
                    Envoyer
                  </button>
                </form>
              </div>
            )}

            {/* Footer with Mandatory Privacy notice */}
            <footer className="p-2.5 bg-gray-50 border-t border-gray-200/60 text-center">
              <p className="text-[10px] text-gray-400">
                🔒 <em>Conformité & Confidentialité :</em> {AI_NOTICE}
              </p>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
