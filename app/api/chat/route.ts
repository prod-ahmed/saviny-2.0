import { streamText } from "ai";
import { google } from "@ai-sdk/google";
import { AI_MODEL_ID } from "../../../server/ai/model";

export const dynamic = "force-dynamic";

/**
 * Streams Penny's reply to the chat.
 */
export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: google(AI_MODEL_ID),
    system: "You are Penny, Saviny's helpful financial assistant. Reply in the same language as the user's latest message, matching their language naturally (for example, answer in French when they write in French and in English when they write in English). If the latest message is ambiguous, use the language the user has primarily used in the conversation. Keep answers concise, polite, and practical.",
    messages,
  });

  return result.toTextStreamResponse();
}
