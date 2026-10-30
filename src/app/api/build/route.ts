import { buildBoard } from "@/lib/agent";
import { ndjsonRun, rateLimited } from "@/lib/server/stream";
import type { BuildInput } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many boards at once. Try again in a minute." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as BuildInput | null;
  if (!body || typeof body.likes !== "string" || !body.likes.trim()) {
    return Response.json({ error: "Tell us at least one thing they love." }, { status: 400 });
  }
  const input: BuildInput = {
    name: String(body.name ?? "").slice(0, 40),
    age: Number(body.age) || 10,
    city: String(body.city ?? "").slice(0, 60),
    likes: body.likes.slice(0, 600),
    about: body.about ? String(body.about).slice(0, 200) : undefined,
  };
  return ndjsonRun((emit) => buildBoard(input, emit));
}
