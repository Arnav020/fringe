import { buildBaseline } from "@/lib/baseline";
import { rateLimited } from "@/lib/server/stream";
import type { BuildInput } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as BuildInput | null;
  if (!body?.likes) return Response.json({ error: "Missing input" }, { status: 400 });
  const r = await buildBaseline({
    name: String(body.name ?? "").slice(0, 40),
    age: Number(body.age) || 10,
    city: String(body.city ?? "").slice(0, 60),
    likes: String(body.likes).slice(0, 600),
  });
  if (!r) return Response.json({ error: "The comparison model is busy. Try again shortly." }, { status: 503 });
  return Response.json(r);
}
