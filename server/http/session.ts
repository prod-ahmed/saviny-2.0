import { context } from "../context";
import { toUser } from "../common/mappers";
import { sha256 } from "../common/security";

/** Resolves a session token to its user, or null when the session was revoked or never existed. */
export async function userFromToken(token: string): Promise<{ user: ReturnType<typeof toUser>; tokenHash: string } | null> {
  const { store } = await context();
  const tokenHash = sha256(token);
  const session = await store.one("sessions", { token_hash: tokenHash });
  if (!session) return null;
  const user = await store.one("users", { id: session.user_id });
  return user ? { user: toUser(user), tokenHash } : null;
}

/** The Bearer token of a request, if any. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}
