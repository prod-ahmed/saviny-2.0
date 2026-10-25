import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { connectStore, type Store } from "./database/store";
import { MessageHub } from "./messages/hub";

/** Process-wide state: one database connection, one media folder and one socket hub. */
export interface Context {
  store: Store;
  mediaDir: string;
  hub: MessageHub;
}

const globals = globalThis as typeof globalThis & { __savinyContext?: Promise<Context> };

/** Connected on first use and kept on globalThis so hot reloads in development reuse the same connection. */
export function context(): Promise<Context> {
  if (!globals.__savinyContext) {
    const pending = createContext();
    // A failed connection is not cached, so the next request tries again.
    pending.catch(() => {
      globals.__savinyContext = undefined;
    });
    globals.__savinyContext = pending;
  }
  return globals.__savinyContext;
}

/** Closes the connection and forgets it. Used by the tests to start from a clean database. */
export async function resetContext(): Promise<void> {
  const pending = globals.__savinyContext;
  globals.__savinyContext = undefined;
  if (pending) await (await pending).store.close();
}

async function createContext(): Promise<Context> {
  const mediaDir = resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR ?? join(process.cwd(), "data", "media"));
  mkdirSync(mediaDir, { recursive: true });
  const store = await connectStore(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017", process.env.MONGODB_DB ?? "saviny");
  return { store, mediaDir, hub: new MessageHub() };
}

/** Origins allowed to call the API from another site (CORS). Same-origin requests need none. */
export function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((o) => o.trim()).filter(Boolean);
}
