import { nextPair, type ChooseInput } from "@/lib/choose";
import { rateLimited } from "@/lib/server/stream";

export const maxDuration = 30;

export async function POST(req: Request) {
  if (rateLimited(req, 60)) return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Partial<ChooseInput> | null;
  if (!body?.person || !Array.isArray(body.seeds) || !body.seeds.length) {
    return Response.json({ error: "Build a board first, so there's a taste to start from." }, { status: 400 });
  }
  try {
    const round = await nextPair({
      person: body.person,
      seeds: body.seeds.slice(0, 8).map((s) => ({ id: String(s.id), type: String(s.type ?? "") })),
      history: (Array.isArray(body.history) ? body.history : []).slice(-12).map((h) => ({
        shown: (Array.isArray(h?.shown) ? h.shown : []).map(String).slice(0, 2),
        picked: h?.picked ? String(h.picked) : undefined,
        pickedType: h?.pickedType ? String(h.pickedType) : undefined,
      })),
    });
    return Response.json(round);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
