import type { z } from "zod";
import type { toUser } from "../common/mappers";

export type SessionUser = ReturnType<typeof toUser>;

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** What a handler receives. `user` is set on protected routes, `viewer` (nullable) on public ones. */
export interface Ctx {
  req: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  user: SessionUser;
  viewer: SessionUser | null;
  tokenHash: string | null;
  /** The JSON body, checked against the schema. Refused with 400 when it does not match. */
  body<T extends z.ZodType>(schema: T): Promise<z.output<T>>;
}

export type Handler = (ctx: Ctx) => unknown;

export interface Route {
  method: Method;
  /** Path below /api, for example "listings/:id". */
  path: string;
  handler: Handler;
  /** Overrides the status. Defaults to 201 for POST (as NestJS did) and 200 otherwise. */
  status?: number;
  /** Reachable without a session. */
  public?: boolean;
  /** Per-route limit, counted per client address. */
  limit?: { max: number; windowMs: number };
}

export const route = (method: Method, path: string, handler: Handler, options: Omit<Route, "method" | "path" | "handler"> = {}): Route => ({
  method,
  path,
  handler,
  ...options,
});
