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
  verdict: "positive" | "neutral" | "attention" | "negative";
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
  "Buy a $350 bike and cut entertainment spending by $50/month",
  "Start a new job with a $300/month pay increase",
  "Add a $45/month gym membership",
];

export function SmartCoach({ currency = "USD" }: { currency?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"plan" | "whatif" | "chat">("chat");

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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hi, I’m Penny. How can I help you today?" },
  ]);
  const [chatSending, setChatSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchPlan = async () => {
    setLoadingPlan(true);
    setPlanError("");
    try {
      const data = await api<SavingsPlan>("/ai/coach/plan");
      setPlan(data);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : "Could not load your savings plan.");
    } finally {
      setLoadingPlan(false);
    }
  };

  useEffect(() => {
    if (open && tab === "plan" && !plan && !loadingPlan) {
      fetchPlan();
    }
  }, [open, tab]);

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
      setSimError(err instanceof Error ? err.message : "The scenario could not be calculated.");
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

      if (!res.ok) throw new Error("Could not connect to Penny.");

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
          content: "Sorry, Penny couldn't reply just now. Please try again.",
        },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  return (
    <>
      {/* Floating Action Button - strictly 3D Penny Avatar */}
      {!open && (
        <div className="penny-float-anchor">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="penny-float-button"
            aria-label="Open Penny Coach"
            title="Penny Coach - your financial assistant"
          >
            <img
              src="/assets/penny-avatar-thumb.png"
              alt="Coach Penny"
              className="penny-float-avatar"
            />
          </button>
          <span className="penny-float-label" aria-hidden="true">Talk to Penny</span>
        </div>
      )}

      {/* Coach interface */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/45 backdrop-blur-xs animate-fadeIn">
          <div className="w-full sm:max-w-xl bg-[#f6f8f7] text-[#102a29] rounded-t-2xl sm:rounded-2xl shadow-2xl border border-stone-200/90 flex flex-col max-h-[92vh] sm:max-h-[85vh] overflow-hidden">
            {/* Coach header */}
            <header className="bg-[#f6f8f7] text-[#102a29] px-5 py-4 flex items-center justify-between border-b border-stone-200">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/penny-avatar-thumb.png"
                  alt="Penny"
                  className="w-11 h-11 rounded-full object-cover border border-stone-300 shadow-xs"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold leading-tight text-[#102a29]">Coach Penny</h2>
                    <span className="text-[10px] bg-[#eaf3f3] text-[#31514f] border border-[#c8dddd] px-2 py-0.5 rounded-full font-medium">
                      AI assistant
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">Simple savings advice and money scenarios</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 hover:text-stone-900 flex items-center justify-center transition text-sm cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            {/* Navigation Tabs */}
            <div className="grid grid-cols-3 bg-[#edf1f0] border-b border-stone-200 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab("plan")}
                className={`py-3 text-center transition border-b-2 ${
                  tab === "plan"
                    ? "border-[#4e8a90] text-[#102a29] bg-[#f6f8f7] font-bold"
                    : "border-transparent text-stone-500 hover:text-stone-900"
                }`}
              >
                Plan &amp; overview
              </button>
              <button
                type="button"
                onClick={() => setTab("whatif")}
                className={`py-3 text-center transition border-b-2 ${
                  tab === "whatif"
                    ? "border-[#4e8a90] text-[#102a29] bg-[#f6f8f7] font-bold"
                    : "border-transparent text-stone-500 hover:text-stone-900"
                }`}
              >
                Scenarios
              </button>
              <button
                type="button"
                onClick={() => setTab("chat")}
                className={`py-3 text-center transition border-b-2 ${
                  tab === "chat"
                    ? "border-[#4e8a90] text-[#102a29] bg-[#f6f8f7] font-bold"
                    : "border-transparent text-stone-500 hover:text-stone-900"
                }`}
              >
                Chat
              </button>
            </div>

            {/* Tab 1: Coach Plan & Diagnostics */}
            {tab === "plan" && (
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                {loadingPlan && (
                  <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
                    <div className="w-8 h-8 border-3 border-[#74b5bd] border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-medium">Penny is reviewing your finances…</p>
                  </div>
                )}

                {planError && (
                  <div className="p-3.5 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs rounded-xl border border-red-200 dark:border-red-800">
                    {planError}
                  </div>
                )}

                {plan && !loadingPlan && (
                  <>
                    {/* Simple financial overview */}
                    <div className="bg-white p-4 rounded-xl border border-stone-200/90 space-y-2 shadow-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-stone-600">Your money at a glance</span>
                      </div>
                      <h3 className="text-sm font-bold text-stone-900">{plan.coach.healthVerdict}</h3>
                      <p className="text-xs text-stone-600 leading-relaxed">{plan.coach.coachSummary}</p>
                      <p className="text-[10px] text-stone-500">A simple guide based on the information you’ve recorded, not financial advice.</p>
                    </div>

                    {/* Two simple savings estimates */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white p-3.5 rounded-xl border border-stone-200/90 shadow-xs">
                        <span className="text-[11px] text-stone-500 block mb-1">Possible savings this month</span>
                        <span className="text-xl font-bold text-stone-900">
                          {formatMoney(plan.math.savingsCapacity, currency)}
                        </span>
                        <span className="text-[10px] text-stone-400 block mt-1">Income minus expenses recorded this month</span>
                      </div>
                      <div className="bg-white p-3.5 rounded-xl border border-stone-200/90 shadow-xs">
                        <span className="text-[11px] text-stone-500 block mb-1">Suggested amount per week</span>
                        <span className="text-xl font-bold text-[#4e8a90]">
                          {formatMoney(plan.math.recommendedWeekly, currency)}
                        </span>
                        <span className="text-[10px] text-stone-400 block mt-1">A flexible suggestion, not a requirement</span>
                      </div>
                    </div>

                    {/* Active Goals & Timeline Monitoring */}
                    <div className="bg-white p-4 rounded-xl border border-stone-200/90 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-stone-900">Your savings goals</h4>
                      </div>

                      {plan.math.goals.length === 0 ? (
                        <p className="text-xs text-stone-500 py-2">No savings goals yet. Create one in Goals to track your progress.</p>
                      ) : (
                        plan.math.goals.map((g) => (
                          <div key={g.id} className="p-3 bg-[#f6f8f7] rounded-lg space-y-1.5 border border-stone-200/80">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-stone-900">{g.title}</span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                  g.risk === "high"
                                    ? "bg-red-50 text-red-700 border border-red-200"
                                    : g.risk === "medium"
                                    ? "bg-amber-50 text-amber-800 border border-amber-200"
                                    : "bg-[#eaf3f3] text-[#31514f] border border-[#c8dddd]"
                                }`}
                              >
                                {g.risk === "high" ? "Needs attention" : g.risk === "medium" ? "A little tight" : "On track"}
                              </span>
                            </div>
                            <div className="flex justify-between text-[11px] text-stone-500">
                              <span>Saved: {g.progress}%</span>
                              <span>Left: {formatMoney(g.remaining, currency)}</span>
                            </div>
                            <div className="w-full bg-stone-200 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-[#74b5bd] h-full rounded-full" style={{ width: `${Math.min(100, g.progress)}%` }} />
                            </div>
                            {g.riskReason && (
                              <p className="text-[11px] text-stone-600 mt-1">{g.riskReason}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {/* Actionable Recommendations */}
                    <div className="bg-white p-4 rounded-xl border border-stone-200/90 space-y-2.5 shadow-xs">
                      <h4 className="text-xs font-bold text-stone-900">A few simple ideas</h4>
                      <div className="space-y-2">
                        {plan.coach.spendingCuts.map((cut, idx) => (
                          <div key={idx} className="p-3 rounded-lg bg-[#f6f8f7] border border-stone-200/80 flex items-start justify-between gap-3 text-xs">
                            <div>
                              <p className="font-semibold text-stone-900">{cut.title}</p>
                              <p className="text-[11px] text-stone-600 mt-0.5 leading-relaxed">{cut.tip}</p>
                            </div>
                            <span className="shrink-0 font-semibold text-[#31514f] bg-[#eaf3f3] px-2 py-0.5 rounded border border-[#c8dddd] text-[11px]">
                              {cut.savingEst}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={fetchPlan}
                      className="w-full py-2.5 text-xs text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg font-medium transition cursor-pointer"
                    >
                      Refresh overview
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Tab 2: What-If Scenario Simulator */}
            {tab === "whatif" && (
              <div className="p-5 overflow-y-auto space-y-4 flex-1">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Try a money scenario</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    See how a change in income or spending could affect your budget and savings goals.
                  </p>
                </div>

                {/* Preset Chips */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Try an example:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setScenarioInput(p); runSimulation(p); }}
                        className="text-[11px] bg-slate-100 dark:bg-slate-800 hover:bg-[#eaf3f3] hover:text-[#31514f] dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-left transition border border-slate-200/60 dark:border-slate-700"
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
                    placeholder="For example: My rent goes up by $120/month, and I cancel a $40 subscription."
                    className="w-full p-3 text-xs rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-[#4e8a90] bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => runSimulation()}
                    disabled={simulating || scenarioInput.trim().length < 3}
                    className="w-full py-2.5 bg-[#102a29] hover:bg-[#1b3d3b] text-white font-semibold text-xs rounded-lg disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-2"
                  >
                    {simulating ? "Calculating..." : "See the impact"}
                  </button>
                </div>

                {simError && (
                  <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">
                    {simError}
                  </div>
                )}

                {/* Simulation Result */}
                {simulation && (
                  <div className="p-4 rounded-xl bg-white border border-stone-200/90 space-y-3 animate-fadeIn text-xs shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-stone-900 text-xs">Scenario result</span>
                      <span
                        className={`px-2.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          simulation.verdict === "positive"
                            ? "bg-[#eaf3f3] text-[#31514f] border border-[#c8dddd]"
                            : simulation.verdict === "attention" || simulation.verdict === "neutral"
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : "bg-red-50 text-red-800 border border-red-200"
                        }`}
                      >
                        {simulation.verdict === "positive" ? "Positive" : simulation.verdict === "neutral" ? "Neutral" : simulation.verdict === "attention" ? "Needs attention" : "Negative"}
                      </span>
                    </div>

                    <p className="text-stone-800 leading-relaxed font-normal">{simulation.summary}</p>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="p-3 bg-[#f6f8f7] rounded-lg border border-stone-200/80">
                        <span className="text-[10px] text-stone-500 block">Monthly change</span>
                        <span className="text-sm font-bold text-stone-900">
                          {simulation.monthlyChange >= 0 ? "+" : ""}{formatMoney(simulation.monthlyChange, currency)}/month
                        </span>
                      </div>
                      <div className="p-3 bg-[#f6f8f7] rounded-lg border border-stone-200/80">
                        <span className="text-[10px] text-stone-500 block">Possible monthly savings</span>
                        <span className="text-sm font-bold text-[#4e8a90]">
                          {formatMoney(simulation.newSavingsCapacity, currency)}
                        </span>
                      </div>
                    </div>

                    {simulation.goalTimelineImpact && (
                      <div className="p-3 bg-[#f6f8f7] rounded-lg border border-stone-200/80 text-[11px] text-stone-700">
                        <strong>Effect on your goals:</strong> {simulation.goalTimelineImpact}
                      </div>
                    )}

                    {simulation.recommendedSteps?.length > 0 && (
                      <div className="pt-1">
                        <span className="font-semibold text-stone-800 block mb-1">Suggested next steps:</span>
                        <ul className="list-disc list-inside space-y-1 text-stone-600 text-[11px]">
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
              <div className="flex flex-col flex-1 overflow-hidden bg-[#f6f8f7]">
                <div className="flex-1 p-4 overflow-y-auto space-y-3" ref={logRef}>
                  {chatMessages.length === 0 ? (
                    <div className="text-center py-8 text-stone-400 text-xs">
                      <img
                        src="/assets/penny-avatar-thumb.png"
                        alt="Penny"
                        className="w-12 h-12 rounded-full mx-auto mb-2 object-cover border border-stone-200 shadow-xs"
                      />
                      <p className="font-semibold text-stone-800">Penny is here to help</p>
                      <p className="text-[11px] mt-1 text-stone-500 max-w-xs mx-auto">
                        Ask about your recent spending, savings goals, or budget.
                      </p>
                    </div>
                  ) : (
                    chatMessages.map((m, i) => (
                      <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                        {m.role !== "user" && (
                          <img
                            src="/assets/penny-avatar-thumb.png"
                            alt="Penny"
                            className="w-7 h-7 rounded-full object-cover shrink-0 border border-stone-200"
                          />
                        )}
                        <div
                          className={`max-w-[80%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                            m.role === "user"
                              ? "bg-[#102a29] text-white rounded-br-none shadow-xs"
                              : "bg-white text-stone-800 border border-stone-200/90 shadow-xs rounded-bl-none"
                          }`}
                        >
                          {m.content || (chatSending ? "Penny is replying..." : "")}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={sendChatMessage} className="p-3 bg-[#edf1f0] border-t border-stone-200 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask Penny a money question..."
                    className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-stone-300 focus:outline-none focus:border-[#4e8a90] bg-white text-stone-900"
                    disabled={chatSending}
                  />
                  <button
                    type="submit"
                    disabled={chatSending || !chatInput.trim()}
                    className="px-4 py-2 bg-[#102a29] hover:bg-[#1b3d3b] text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition cursor-pointer"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}

            {/* Footer with Notice */}
            <footer className="p-2.5 bg-[#f6f8f7] border-t border-stone-200 text-center">
              <p className="text-[10px] text-stone-400">
                Privacy notice: {AI_NOTICE}
              </p>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
