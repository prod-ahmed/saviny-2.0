/*
 * Offline storage for the signed-in person's own data, kept in IndexedDB on this device:
 * - responses: the last answer for each GET, shown when the server cannot be reached;
 * - outbox: changes made while offline, sent in order when the connection comes back.
 * Everything here is cleared at sign-out. Every access is guarded: if IndexedDB is unavailable,
 * the app simply behaves as it did before (no offline data, writes need a connection).
 */

const DB_NAME = "saviny-offline";
const DB_VERSION = 1;
const RESPONSES = "responses";
const OUTBOX = "outbox";

/** Fired after changes were sent to the server, so open pages can reload their data. */
export const SYNCED_EVENT = "saviny:synced";
/** Fired whenever the outbox changes, so the pending count can update. */
export const OUTBOX_EVENT = "saviny:outbox";

export interface QueuedWrite {
  id: string;
  method: string;
  path: string;
  json?: unknown;
  createdAt: number;
}

interface CachedResponse {
  path: string;
  data: unknown;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(RESPONSES, { keyPath: "path" });
        request.result.createObjectStore(OUTBOX, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = action(tx.objectStore(store));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** Keeps the latest good answer for a GET so the page still works without a connection. */
export async function cacheResponse(path: string, data: unknown): Promise<void> {
  try {
    const entry: CachedResponse = { path, data, savedAt: Date.now() };
    await run(RESPONSES, "readwrite", (s) => s.put(entry));
  } catch {
    /* offline storage is a convenience: losing a copy is not an error */
  }
}

/** The saved answer for a GET path, or undefined when none was saved on this device. */
export async function readCachedResponse<T>(path: string): Promise<T | undefined> {
  try {
    const entry = await run<CachedResponse | undefined>(RESPONSES, "readonly", (s) => s.get(path));
    return entry ? (entry.data as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Adds a change to the outbox, to be sent when the connection is back. */
export async function queueWrite(method: string, path: string, json?: unknown): Promise<void> {
  const item: QueuedWrite = { id: crypto.randomUUID(), method, path, json, createdAt: Date.now() };
  await run(OUTBOX, "readwrite", (s) => s.put(item));
  window.dispatchEvent(new Event(OUTBOX_EVENT));
}

export async function pendingCount(): Promise<number> {
  try {
    return await run(OUTBOX, "readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

/**
 * Sends the outbox in the order it was written. Stops when the connection drops or the session
 * has expired, so nothing is lost; a change the server rejects (4xx) is removed and counted as dropped.
 */
export async function flushOutbox(token: string | null): Promise<{ sent: number; dropped: number }> {
  let sent = 0;
  let dropped = 0;
  let items: QueuedWrite[];
  try {
    items = await run<QueuedWrite[]>(OUTBOX, "readonly", (s) => s.getAll());
  } catch {
    return { sent, dropped };
  }
  items.sort((a, b) => a.createdAt - b.createdAt);

  for (const item of items) {
    let res: Response;
    try {
      res = await fetch(`/api${item.path}`, {
        method: item.method,
        headers: {
          ...(item.json !== undefined ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: item.json !== undefined ? JSON.stringify(item.json) : undefined,
      });
    } catch {
      break;
    }
    if (res.status === 401 || res.status >= 500) break;
    if (res.ok) sent += 1;
    else dropped += 1;
    await run(OUTBOX, "readwrite", (s) => s.delete(item.id)).catch(() => {});
  }
  window.dispatchEvent(new Event(OUTBOX_EVENT));
  if (sent > 0) window.dispatchEvent(new Event(SYNCED_EVENT));
  return { sent, dropped };
}

/** Removes the saved answers. The outbox is kept, so changes made offline are not lost. */
export async function clearCachedResponses(): Promise<void> {
  try {
    await run(RESPONSES, "readwrite", (s) => s.clear());
  } catch {
    /* nothing to clear */
  }
}
