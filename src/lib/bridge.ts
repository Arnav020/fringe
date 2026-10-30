import "server-only";
import * as Q from "./qloo";
import { chatJson } from "./llm";
import type { BridgeInput, Cell, Folder, TraceEvent } from "./types";
import { TYPE_TO_FOLDER, guards } from "./agent";

/**
 * Partner bridge: find the topics an AAC user and a specific conversation
 * partner (grandparent, classmate, new aide) can BOTH light up about.
 *
 *  1. resolve the partner's favourites in Qloo
 *  2. /v2/analysis/compare → the taste themes the two profiles share
 *  3. /v2/insights with BOTH profiles as signal → candidate bridge topics
 *  4. urn:demographics → keep topics with positive affinity in BOTH people's
 *     age groups (a topic a 68-year-old and an 8-year-old can share)
 *  5. LLM writes conversation openers, constrained to the verified topics
 */

const BUCKETS: [number, string][] = [
  [24, "24_and_younger"],
  [29, "25_to_29"],
  [34, "30_to_34"],
  [44, "35_to_44"],
  [54, "45_to_54"],
  [200, "55_and_older"],
];
const bucketFor = (age: number) => BUCKETS.find(([max]) => age <= max)![1] as Q.AgeBucket;

const NICE_THEME = /plot:qloo|character:qloo|keyword:qloo|subgenre|genre:media|genre:music/;

export async function buildBridge(input: BridgeInput, emit: (e: TraceEvent) => void): Promise<Folder> {
  const step = async <T,>(id: string, label: string, endpoint: string, fn: () => Promise<T>, sum: (r: T) => string) => {
    const t0 = Date.now();
    emit({ id, label, endpoint, status: "running" });
    const r = await fn();
    emit({ id, label, endpoint, status: "done", detail: sum(r), ms: Date.now() - t0 });
    return r;
  };

  const partnerSeeds = await step(
    "b-resolve",
    `Finding ${input.partnerName}'s favourites`,
    "GET /search",
    async () => {
      const parts = input.partnerLikes.split(/,|;|\n/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
      // Prefer the entity that belongs on a board (artist over person/album, show over brand).
      const hits = await Promise.all(
        parts.map((p) =>
          Q.search(p, undefined, 6)
            .then((h) => h.find((e) => TYPE_TO_FOLDER[String(e.type)]) ?? h[0])
            .catch(() => undefined),
        ),
      );
      return hits.filter(Boolean) as Q.QlooEntity[];
    },
    (r) => `${r.length} matched: ${r.map((e) => e.name).join(", ")}`,
  );
  if (!partnerSeeds.length) throw new Error(`Couldn't find any of ${input.partnerName}'s favourites in Qloo.`);

  const a = input.seeds.map((s) => s.id);
  const b = partnerSeeds.map((e) => e.id);

  const themes = await step(
    "b-compare",
    "Comparing the two taste profiles",
    "GET /v2/analysis/compare",
    async () => {
      const c = await Q.compare(a, b, 30).catch(() => ({ shared: [], a: [], b: [] }));
      const shared = c.shared.length
        ? c.shared
        : c.a.filter((x) => c.b.some((y) => y.id === x.id)); // intersect if the API doesn't pre-compute it
      const seen = new Set<string>();
      return shared
        .map((t) => ({ ...t, name: t.name.replace(/[,.;]+$/, "").trim() }))
        .filter((t) => NICE_THEME.test(t.subtype ?? t.id))
        .filter((t) => !seen.has(t.name.toLowerCase()) && !!seen.add(t.name.toLowerCase()))
        .slice(0, 6);
    },
    (r) => (r.length ? `shared themes: ${r.map((t) => t.name).join(", ")}` : "no shared themes, leaning on the joint signal"),
  );

  const candidates = await step(
    "b-joint",
    "Searching for topics both tastes point to",
    "GET /v2/insights × 4 (joint signal)",
    async () => {
      const types: Q.EntityType[] = ["movie", "tv_show", "artist", "place"];
      const lists = await Promise.all(
        types.map((type) =>
          Q.insights({
            type,
            entities: [...a.slice(0, 5), ...b.slice(0, 5)],
            exclude: [...a, ...b],
            take: 8,
            location: type === "place" ? input.person.city : undefined,
            ...guards(input.person.stage, type),
          }).catch(() => []),
        ),
      );
      const partnerNames = new Set(partnerSeeds.map((e) => e.name.toLowerCase()));
      return lists.flat().filter((e) => Q.isHangout(e) && !partnerNames.has(e.name.toLowerCase()));
    },
    (r) => `${r.length} candidates`,
  );

  const userBucket = bucketFor(input.person.age);
  const partnerBucket = bucketFor(input.partnerAge);
  const scored = await step(
    "b-demo",
    "Keeping topics that land with both age groups",
    "GET /v2/insights (urn:demographics)",
    async () => {
      const top = candidates.filter((e) => e.type !== "place").slice(0, 18);
      const demo = await Q.demographics(top.map((e) => e.id)).catch(() => []);
      const byId = new Map(demo.map((d) => [d.id, d]));
      const withScore = candidates.map((e) => {
        const d = byId.get(e.id);
        const u = d?.age[userBucket] ?? 0;
        const p = d?.age[partnerBucket] ?? 0;
        const known = !!d && (u !== 0 || p !== 0);
        // Bridge score: taste affinity, plus reward when BOTH generations lean in.
        const both = d ? Math.min(u, p) : 0;
        return { e, u, p, known, score: (e.affinity ?? 0.5) + both * 0.8 };
      });
      return withScore.sort((x, y) => y.score - x.score);
    },
    (r) => `${r.filter((x) => x.u > 0 && x.p > 0).length} topics with positive affinity for both ages`,
  );

  const picks = [
    ...scored.filter((x) => x.e.type !== "place").slice(0, 6),
    ...scored.filter((x) => x.e.type === "place").slice(0, 2),
  ];

  emit({ id: "b-write", label: "Writing conversation openers", endpoint: "Groq · constrained to verified topics", status: "running" });
  const llm = await chatJson<{ cells: { id: string; say: string }[]; quick: string[] }>(
    [
      {
        role: "system",
        content: `You write AAC buttons for ${input.person.name} (age ${input.person.age}) to start conversations with ${input.partnerName} (age ${input.partnerAge}). ${input.partnerName} loves: ${partnerSeeds.map((e) => e.name).join(", ")}. ${input.person.name} loves: ${input.seeds.map((s) => s.name).join(", ")}. For each topic id below write "say": a short first-person line (max 9 words) ${input.person.name} would tap to start talking about it with ${input.partnerName}, referencing what they share. Then 4 "quick" questions ${input.person.name} could ask ${input.partnerName} about their favourites. JSON: {"cells":[{"id":"...","say":"..."}],"quick":["..."]}. Use ids exactly.`,
      },
      { role: "user", content: picks.map((x) => `${x.e.id}|${x.e.name}|${x.e.type}`).join("\n") },
    ],
    900,
  );
  emit({
    id: "b-write",
    label: "Writing conversation openers",
    endpoint: "Groq · constrained to verified topics",
    status: llm ? "done" : "warn",
    detail: llm ? `${llm.model}` : "LLM busy, used phrase templates",
  });
  const say = new Map((llm?.data.cells ?? []).map((c) => [c.id, c.say]));

  const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
  const cells: Cell[] = picks.map(({ e, u, p, known }) => ({
    id: `bridge-${e.id}`,
    label: e.name.replace(/\s*\(.*?\)/g, "").slice(0, 30),
    say: say.get(e.id) || `${input.partnerName}, have you seen ${e.name}?`,
    image: e.image,
    kind: "bridge",
    entityId: e.id,
    entityType: String(e.type),
    affinity: e.affinity,
    why:
      e.type === "place"
        ? `A place in ${input.person.city} that matches both taste profiles.${e.address ? ` · ${e.address}` : ""}`
        : `Recommended by Qloo from both taste profiles together.${known ? ` Age affinity: ${input.person.name}'s group ${pct(u)}, ${input.partnerName}'s group ${pct(p)}.` : ""}`,
    talkWith: input.partnerName,
    address: e.address,
    pair: e.type === "place" || !known ? undefined : { user: u, partner: p },
    status: "suggested",
  }));

  // The partner's own favourites become questions the AAC user can ask.
  for (const e of partnerSeeds.slice(0, 3)) {
    cells.push({
      id: `ask-${e.id}`,
      label: e.name.slice(0, 30),
      say: `Tell me about ${e.name}!`,
      image: e.image,
      kind: "bridge",
      entityId: e.id,
      entityType: String(e.type),
      why: `One of ${input.partnerName}'s favourites. Asking about it shows interest in them.`,
      talkWith: input.partnerName,
      status: "approved",
    });
  }

  return {
    key: "bridge",
    title: `Talk with ${input.partnerName}`,
    partner: input.partnerName,
    sharedThemes: themes.map((t) => t.name),
    cells,
    quick: llm?.data.quick?.slice(0, 4) ?? [
      `${input.partnerName}, what's your favorite?`,
      "Can we do that together?",
      "Tell me a story",
      "I like that too!",
    ],
  };
}
