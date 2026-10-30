import "server-only";

/**
 * Small in-memory TTL cache with in-flight de-duplication. Warm serverless
 * instances reuse it, so repeat boards (and parallel identical calls inside
 * one run) cost nothing. Rejected promises are evicted so errors never stick.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX = 2000;

export function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn();
  store.set(key, { at: Date.now(), value });
  value.catch(() => store.delete(key));
  if (store.size > MAX) store.delete(store.keys().next().value!);
  return value;
}
