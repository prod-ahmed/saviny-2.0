import { streamText } from "ai";
import { google } from "@ai-sdk/google";
import { AI_MODEL_ID } from "../../../server/ai/model";

export const dynamic = "force-dynamic";

/**
 * Route IA en streaming (Chapitre 6 du cours, page 22).
 * Reçoit les messages et renvoie un flux de texte progressif.
 */
export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: google(AI_MODEL_ID),
    system: "Tu es l'assistant financier intelligent de Saviny. Réponds de manière concise, courtoise et utile en français.",
    messages,
  });

  return result.toTextStreamResponse();
}
