import type { z } from "zod";
import { badRequest } from "../common/errors";

/** Reads the JSON body. An empty body counts as {}. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}

/** Strict parse: unknown keys and wrong types are refused, as the old ValidationPipe did. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")} ${i.message}` : i.message)));
  }
  return result.data;
}
