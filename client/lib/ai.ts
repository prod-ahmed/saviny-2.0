/** Shown next to every AI answer. Must match AI_NOTICE in server/ai/model.ts. */
export const AI_NOTICE = "Your data was sent to Google Gemini to produce this answer. Saviny does not keep the answer.";

/** A readable message for any error an AI request throws. */
export const aiErrorText = (err: unknown): string => (err instanceof Error ? err.message : "The AI assistant could not answer.");
