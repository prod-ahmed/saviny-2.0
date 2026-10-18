import { context } from "../context";
import { toUser } from "../common/mappers";
import { sha256 } from "../common/security";
import type { Row } from "../database/types";

/** Resolves a session token to its user, or null when the session was revoked or never existed. */
export function userFromToken(token: string): { user: ReturnType<typeof toUser>; tokenHash: string } | null {
  const tokenHash = sha256(token);
  const row = context().db
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
    .get(tokenHash) as Row | undefined;
  return row ? { user: toUser(row), tokenHash } : null;
}

/** The Bearer token of a request, if any. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}
