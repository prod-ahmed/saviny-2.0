/** Fixed-window counter per key. Kept in memory: enough for one server process. */
const windows = new Map<string, { start: number; count: number }>();

/** True while the key is under `max` hits in the last `windowMs`. */
export function withinLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const current = windows.get(key);
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

export function resetRateLimits(): void {
  windows.clear();
}
