import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { resetContext } from "../server/context";
import { attachSocket } from "../server/messages/socket";
import { handleApi } from "../server/http/router";
import { resetRateLimits } from "../server/common/rate-limit";

export interface ApiResult {
  status: number;
  body: any;
  headers: Headers;
}

/** Points the app at a fresh database and media folder. Call once per test file, before any request. */
export function freshDatabase(label: string): void {
  const dir = mkdtempSync(join(tmpdir(), `saviny-${label}-`));
  process.env.DATABASE_FILE = join(dir, "test.db");
  process.env.MEDIA_DIR = join(dir, "media");
  resetContext();
  resetRateLimits();
}

/** One request through the same dispatcher the Next.js route handler uses. */
export async function api(method: string, path: string, options: { token?: string; body?: unknown; form?: FormData } = {}): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const res = await handleApi(new Request(`http://localhost${path}`, { method, headers, body }));
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

export const register = (email: string, password = "correct-horse-battery") =>
  api("POST", "/api/auth/register", {
    body: { firstName: "Test", lastName: "User", email, password, confirmPassword: password },
  });

/** A real HTTP server with the socket layer attached, on a free port. */
export async function startSocketServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  attachSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "localhost", () => resolve()));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://localhost:${port}` };
}

export function connectSocket(url: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, { path: "/api/socket.io", auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

/** Waits for the next event with this name. */
export const once = <T>(socket: Socket, event: string): Promise<T> =>
  new Promise((resolve) => socket.once(event, resolve));

/** Waits for the first event with this name whose payload matches. Earlier events are skipped. */
export const waitFor = <T>(socket: Socket, event: string, matches: (payload: T) => boolean): Promise<T> =>
  new Promise((resolve) => {
    const listener = (payload: T) => {
      if (!matches(payload)) return;
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
