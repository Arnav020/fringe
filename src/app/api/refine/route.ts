import { refineBoard } from "@/lib/refine";
import { ndjsonRun, rateLimited } from "@/lib/server/stream";
import type { Board } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { board?: Board; instruction?: string } | null;
  if (!body?.board?.person || !Array.isArray(body.board.folders) || !body.instruction?.trim()) {
    return Response.json({ error: "Say what changed, e.g. “she's into dinosaurs now”." }, { status: 400 });
  }
  return ndjsonRun((emit) => refineBoard(body.board!, body.instruction!, emit));
}
