"use client";

import { useState } from "react";
import Link from "next/link";
import BottomNav from "../../client/components/BottomNav";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/**
 * Page Assistant IA (Chapitre 6 du cours, page 17 & 22).
 * Utilise le streaming progressif en temps réel (streamText côté serveur).
 */
export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Bonjour ! Je suis votre assistant financier intelligent Saviny. Comment puis-je vous aider aujourd'hui ?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || isLoading) return;

    setInput("");
    setError("");

    const userMsg: Message = {
      id: String(Date.now()),
      role: "user",
      content: prompt,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        throw new Error(`Erreur serveur (${res.status})`);
      }

      if (!res.body) {
        throw new Error("Flux de réponse vide");
      }

      const assistantId = String(Date.now() + 1);
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: assistantText } : m))
        );
      }
    } catch (err: any) {
      setError(err.message || "Impossible de joindre l'assistant IA.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-[#102a29] pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#102a29] text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-emerald-300 hover:text-white transition">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold">Assistant IA (Streaming)</h1>
        </div>
        <span className="text-xs bg-emerald-700/60 text-emerald-100 px-3 py-1 rounded-full border border-emerald-500/30">
          Gemini Flash
        </span>
      </header>

      {/* Main chat container */}
      <main className="max-w-3xl mx-auto p-4 md:p-6 flex flex-col gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 min-h-[460px] flex flex-col justify-between">
          <div className="space-y-4 mb-4 overflow-y-auto max-h-[60vh] pr-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role !== "user" && (
                  <div className="w-8 h-8 rounded-full bg-[#102a29] text-white flex items-center justify-center text-sm shrink-0">
                    🤖
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-[#102a29] text-white rounded-br-none"
                      : "bg-gray-100 text-gray-800 rounded-bl-none"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 items-center text-sm text-gray-500">
                <div className="w-8 h-8 rounded-full bg-[#102a29] text-white flex items-center justify-center text-sm shrink-0">
                  🤖
                </div>
                <div className="bg-gray-100 rounded-2xl px-4 py-2 text-xs flex items-center gap-2 text-gray-600">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
                  L'IA génère la réponse en direct...
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl border border-red-200">
                Erreur : {error}
              </div>
            )}
          </div>

          {/* Form with input */}
          <form onSubmit={handleSubmit} className="flex gap-2 pt-3 border-t border-gray-100">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez votre question à l'assistant financier..."
              className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-emerald-700 text-sm"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-5 py-3 bg-[#102a29] text-white font-medium text-sm rounded-xl hover:bg-[#1a3f3e] disabled:opacity-50 transition cursor-pointer"
            >
              Envoyer
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400">
          🔒 Conforme Chapitre 6 : Vercel AI SDK (streamText) avec modèle Google Gemini.
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
