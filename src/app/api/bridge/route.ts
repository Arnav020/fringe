import { buildBridge } from "@/lib/bridge";
import { ndjsonRun, rateLimited } from "@/lib/server/stream";
import type { BridgeInput } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as BridgeInput | null;
  if (!body?.person || !Array.isArray(body.seeds) || !body.seeds.length || !body.partnerLikes?.trim()) {
    return Response.json({ error: "Add the partner's name and a few things they love." }, { status: 400 });
  }
  const input: BridgeInput = {
    person: body.person,
    seeds: body.seeds.slice(0, 8).map((s) => ({ id: String(s.id), name: String(s.name) })),
    partnerName: String(body.partnerName || "Partner").slice(0, 30),
    partnerAge: Number(body.partnerAge) || 40,
    partnerLikes: body.partnerLikes.slice(0, 400),
  };
  return ndjsonRun((emit) => buildBridge(input, emit));
}
