import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { openDatabase, type Db } from "./database/open";
import { MessageHub } from "./messages/hub";

/** Process-wide state: one database connection, one media folder and one socket hub. */
export interface Context {
  db: Db;
  file: string;
  mediaDir: string;
  hub: MessageHub;
}

const globals = globalThis as typeof globalThis & { __savinyContext?: Context };

/** Created on first use and kept on globalThis so hot reloads in development reuse the same connection. */
export function context(): Context {
  globals.__savinyContext ??= createContext();
  return globals.__savinyContext;
}

/** Closes the connection and forgets it. Used by the tests to start from a clean database. */
export function resetContext(): void {
  globals.__savinyContext?.db.close();
  globals.__savinyContext = undefined;
}

function createContext(): Context {
  const file = process.env.DATABASE_FILE ?? join(process.cwd(), "data", "saviny.db");
  const mediaDir = resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR ?? join(dirname(file), "media"));
  mkdirSync(mediaDir, { recursive: true });
  return { db: openDatabase(file), file, mediaDir, hub: new MessageHub() };
}

/** Origins allowed to call the API from another site (CORS). Same-origin requests need none. */
export function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((o) => o.trim()).filter(Boolean);
}
