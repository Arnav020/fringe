import "server-only";
import * as Q from "./qloo";
import { chatJson } from "./llm";
import type { BuildInput } from "./types";

/**
 * The control experiment: what does a plain LLM put on the same board with
 * no taste graph? Each suggestion is then checked against Qloo so the
 * comparison is measured, not asserted. Matching is deliberately generous
 * (parentheticals stripped, either-way prefix, token overlap) so the LLM is
 * not penalised for formatting.
 */

export interface BaselineItem {
  name: string;
  category: string;
  found: boolean;
  repeat: boolean;
  image?: string;
  matched?: string;
}

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\s[-–—:].*$/, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function sameThing(a: string, b: string) {
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return false;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  const tx = new Set(x.split(" "));
  const ty = new Set(y.split(" "));
  const inter = [...tx].filter((t) => ty.has(t)).length;
  return inter / Math.max(tx.size, ty.size) >= 0.6;
}

const TYPE: Record<string, Q.EntityType | undefined> = {
  show: "tv_show",
  movie: "movie",
  music: "artist",
  game: "videogame",
  book: "book",
  place: "place",
};

export async function buildBaseline(input: BuildInput) {
  const r = await chatJson<{ items: { name: string; category: string }[] }>(
    [
      {
        role: "system",
        content:
          'Suggest 12 specific shows, movies, artists, games, books or local places to add to an AAC communication board for this person, based on what they love. JSON {"items":[{"name":"...","category":"show|movie|music|game|book|place"}]}',
      },
      { role: "user", content: `${input.name}, age ${input.age}, lives in ${input.city}. Loves: ${input.likes}` },
    ],
    700,
  );
  if (!r) return null;
  const seeds = input.likes.split(/,|;|\n/).map((s) => s.trim()).filter(Boolean);
  const items = (r.data.items ?? []).slice(0, 12);
  const checked: BaselineItem[] = await Promise.all(
    items.map(async (it) => {
      const type = TYPE[it.category];
      const query = it.name.replace(/\(.*?\)/g, "").trim();
      const [typed, open] = await Promise.all([
        type ? Q.search(query, type, 5).catch(() => []) : Promise.resolve([]),
        Q.search(query, undefined, 5).catch(() => []),
      ]);
      const m = [...typed, ...open].find((h) => sameThing(h.name, query));
      return {
        name: it.name,
        category: it.category,
        found: !!m,
        repeat: seeds.some((s) => sameThing(s, query)),
        image: m?.image,
        matched: m?.name,
      };
    }),
  );
  return { model: r.model, items: checked };
}
