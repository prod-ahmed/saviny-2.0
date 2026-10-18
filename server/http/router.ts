import { allowedOrigins } from "../context";
import { errorBody, HttpError } from "../common/errors";
import { withinLimit } from "../common/rate-limit";
import { routes } from "../routes";
import { bearerToken, userFromToken } from "./session";
import { parse, readJson } from "./validate";
import type { Ctx, Method, Route } from "./types";

const GLOBAL_LIMIT = { max: 300, windowMs: 60_000 };
const METHODS: Method[] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

interface Match {
  route: Route;
  params: Record<string, string>;
}

/** Matches "/listings/abc" against "listings/:id". Method mismatches are reported separately. */
function findRoute(method: string, path: string): Match | "method-not-allowed" | null {
  const segments = path.split("/").filter(Boolean);
  let methodMismatch = false;
  for (const r of routes) {
    const pattern = r.path.split("/").filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = pattern.every((part, i) => {
      if (part.startsWith(":")) {
        params[part.slice(1)] = decodeURIComponent(segments[i]);
        return true;
      }
      return part === segments[i];
    });
    if (!matches) continue;
    if (r.method !== method) {
      methodMismatch = true;
      continue;
    }
    return { route: r, params };
  }
  return methodMismatch ? "method-not-allowed" : null;
}

function clientAddress(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": METHODS.join(", "),
    Vary: "Origin",
  };
}

/** Entry point for every /api request. Rules: session, validation, status codes and error shape match the old NestJS API. */
export async function handleApi(req: Request): Promise<Response> {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  try {
    const found = findRoute(req.method, path);
    if (found === null || found === "method-not-allowed") throw new HttpError(404, `Cannot ${req.method} /api${path}`);
    return await run(req, found, url, cors);
  } catch (err) {
    if (err instanceof HttpError) return Response.json(errorBody(err), { status: err.status, headers: cors });
    console.error("Unhandled error", err);
    return Response.json(errorBody(new HttpError(500)), { status: 500, headers: cors });
  }
}

async function run(req: Request, match: Match, url: URL, cors: Record<string, string>): Promise<Response> {
  const { route } = match;
  const ip = clientAddress(req);
  if (process.env.NODE_ENV !== "test") {
    if (!withinLimit(`${ip}|*`, GLOBAL_LIMIT.max, GLOBAL_LIMIT.windowMs)) throw new HttpError(429, "Too Many Requests");
    if (route.limit && !withinLimit(`${ip}|${route.method} ${route.path}`, route.limit.max, route.limit.windowMs)) {
      throw new HttpError(429, "Too Many Requests");
    }
  }

  const token = bearerToken(req);
  const session = token ? userFromToken(token) : null;
  if (!route.public && !session) throw new HttpError(401, "Unauthorized");

  let bodyRead: Promise<unknown> | undefined;
  const ctx: Ctx = {
    req,
    params: match.params,
    query: url.searchParams,
    user: session?.user as Ctx["user"],
    viewer: session?.user ?? null,
    tokenHash: session?.tokenHash ?? null,
    body: async (schema) => {
      bodyRead ??= readJson(req);
      return parse(schema, await bodyRead);
    },
  };

  const result = await route.handler(ctx);
  if (result instanceof Response) {
    for (const [k, v] of Object.entries(cors)) result.headers.set(k, v);
    return result;
  }
  const status = route.status ?? (route.method === "POST" ? 201 : 200);
  if (status === 204) return new Response(null, { status, headers: cors });
  return Response.json(result ?? null, { status, headers: cors });
}
