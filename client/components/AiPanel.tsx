import { useState, type ReactNode } from "react";
import { AI_NOTICE, aiErrorText } from "../lib/ai";

/** Runs one AI request when the user asks for it, and shows the answer. Nothing is sent before that. */
export function AiPanel<T>({ title, action, run, render }: { title: string; action: string; run: () => Promise<T>; render: (result: T) => ReactNode }) {
  const { busy, error, call } = useAiCall();
  const [result, setResult] = useState<T | null>(null);

  const ask = async () => {
    const answer = await call(run);
    if (answer !== undefined) setResult(answer);
  };

  return (
    <section className="ai-panel" aria-label={title}>
      <div className="ai-head">
        <strong><span className="ai-badge">AI</span> {title}</strong>
        <button type="button" className="secondary" onClick={ask} disabled={busy}>{busy ? "Thinking..." : action}</button>
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {result !== null && <div className="ai-body">{render(result)}</div>}
      <AiNotice />
    </section>
  );
}

export function AiNotice() {
  return <p className="ai-notice">{AI_NOTICE}</p>;
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
