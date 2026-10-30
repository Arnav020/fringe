import "server-only";
import * as Q from "./qloo";
import { chatJson } from "./llm";
import type { BuildInput } from "./types";

/**
 * The control experiment: what does a plain LLM put on the same board with
 * no taste graph? Each suggestion is then checked against Qloo so the
 * comparison is measured, not asserted.
 */

export interface BaselineItem {
  name: string;
  category: string;
  found: boolean;
  image?: string;
  matched?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

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
  const items = (r.data.items ?? []).slice(0, 12);
  const checked: BaselineItem[] = await Promise.all(
    items.map(async (it) => {
      const hits = await Q.search(it.name, undefined, 3).catch(() => []);
      const m = hits.find((h) => norm(h.name) === norm(it.name) || norm(h.name).startsWith(norm(it.name)));
      return { name: it.name, category: it.category, found: !!m, image: m?.image, matched: m?.name };
    }),
  );
  return { model: r.model, items: checked };
}
