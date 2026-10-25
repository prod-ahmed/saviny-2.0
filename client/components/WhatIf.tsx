import { useState } from "react";
import { api } from "../lib/api";
import { formatMoney } from "../lib/format";
import { AiNotice, useAiCall } from "./AiPanel";

interface Scenario {
  summary: string;
  monthlyChange: number;
  effects: { area: string; effect: string }[];
  risks: string[];
}

/** "What if" simulator: estimates a scenario from the real figures. It changes no data. */
export function WhatIf({ currency }: { currency: string }) {
  const [scenario, setScenario] = useState("");
  const [result, setResult] = useState<Scenario | null>(null);
  const ai = useAiCall();

  const simulate = async () => {
    const answer = await ai.call(() => api<Scenario>("/ai/finance/what-if", { method: "POST", json: { scenario: scenario.trim() } }));
    if (answer) setResult(answer);
  };

  return (
    <section className="ai-panel" aria-label="What if simulator">
      <div className="ai-head">
        <strong><span className="ai-badge">AI</span> What if...</strong>
      </div>
      <textarea
        aria-label="Describe a scenario"
        maxLength={500}
        rows={2}
        placeholder="e.g. I buy a laptop for 900 paid over 6 months, or I move to a flat that costs 400 more a month"
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
      />
      <div className="ai-inline">
        <button type="button" className="primary" onClick={simulate} disabled={ai.busy || scenario.trim().length < 3}>{ai.busy ? "Simulating..." : "Simulate"}</button>
      </div>
      {ai.error && <p className="auth-error" role="alert">{ai.error}</p>}
      {result && (
        <div className="ai-body">
          <p>{result.summary}</p>
          <p><strong>Estimated monthly change: </strong>{formatMoney(result.monthlyChange, currency)}</p>
          {result.effects.length > 0 && (
            <ul>{result.effects.map((e, i) => <li key={i}><strong>{e.area}</strong>: {e.effect}</li>)}</ul>
          )}
          {result.risks.length > 0 && (
            <ul>{result.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
          )}
        </div>
      )}
      <AiNotice />
    </section>
  );
}
