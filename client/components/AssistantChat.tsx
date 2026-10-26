import { useRef, useState, type FormEvent } from "react";
import { getToken } from "../lib/api";
import { AI_NOTICE, aiErrorText } from "../lib/ai";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Floating financial assistant. Answers stream in as they are written and use only the user's own figures. */
export function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    const history: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const token = getToken();
      const res = await fetch("/api/ai/profile/chat", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "The assistant could not answer.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: answer }]);
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
      }
      setMessages([...history, { role: "assistant", content: answer }]);
    } catch (err) {
      setMessages(history);
      setError(aiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="primary ai-fab" aria-label="Open the financial assistant" onClick={() => setOpen(true)}>
        AI assistant
      </button>
    );
  }

  return (
    <section className="ai-chat" aria-label="Financial assistant">
      <div className="ai-head" style={{ padding: "10px 12px" }}>
        <strong><span className="ai-badge">AI</span> Financial assistant</strong>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div className="ai-chat-log" ref={logRef}>
        {messages.length === 0 && <p className="muted-small">Ask about your spending, budgets or goals. I only use your own figures.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`ai-bubble ${m.role}`}>{m.content || (busy ? "..." : "")}</div>
        ))}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <p className="ai-notice">{AI_NOTICE}</p>
      </div>
      <form onSubmit={send}>
        <input aria-label="Ask the assistant" maxLength={1000} placeholder="Ask a question" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" className="primary" disabled={busy || !input.trim()}>Send</button>
      </form>
    </section>
  );
}
