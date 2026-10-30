import "server-only";
import type { TraceEvent } from "../types";

/**
 * Streams an agent run as NDJSON: one `{"trace":...}` line per step, then a
 * final `{"result":...}` or `{"error":...}` line. Lets the UI show the agent
 * working live instead of a spinner.
 */
export function ndjsonRun<T>(run: (emit: (e: TraceEvent) => void) => Promise<T>) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        const result = await run((e) => send({ trace: e }));
        send({ result });
      } catch (e) {
        send({ error: (e as Error).message || "Something went wrong" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Very small per-instance rate limiter so one visitor can't drain the shared API quota. */
const hits = new Map<string, number[]>();
export function rateLimited(req: Request, max = 20, windowMs = 60_000) {
  if (process.env.NODE_ENV !== "production") return false;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  // Per endpoint, so building a board doesn't use up the budget for refining it.
  const key = `${new URL(req.url).pathname}|${ip}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}
