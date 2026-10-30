import "server-only";
import * as Q from "./qloo";
import { chatJson } from "./llm";
import type { BridgeInput, Cell, Folder, TraceEvent } from "./types";
import { suitable, TYPE_TO_FOLDER, guards, shortName } from "./agent";

/**
 * Partner bridge: find the topics an AAC user and a specific conversation
 * partner (grandparent, classmate, new aide) can BOTH light up about.
 *
 *  1. resolve the partner's favourites in Qloo
 *  2. /v2/analysis/compare → the taste themes the two profiles share
 *  3. /v2/insights with BOTH profiles as signal (plus Qloo's retirement
 *     audience when one of them is 60+) → candidate bridge topics, with
 *     explainability so we know how much each person's favourites drove it
 *  4. urn:demographics → keep topics with positive affinity in BOTH people's
 *     age groups (a topic a 68-year-old and an 8-year-old can share), and
 *     prefer topics that draw on both people's favourites, not just one
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

const RETIREMENT = "urn:audience:life_stage:retirement";

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
            // A genre word like "Westerns" can match a park; a place is not a favourite to ask about.
            .then((h) => h.find((e) => TYPE_TO_FOLDER[String(e.type)] && e.type !== "place") ?? h.find((e) => e.type !== "place"))
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

  const older = input.partnerAge >= 60 || input.person.age >= 60;
  const aSet = new Set(a);
  const bSet = new Set(b);
  /** Explainability → how much of this pick comes from each person's favourites. */
  const balance = (e: Q.QlooEntity) => {
    if (!e.because?.length) return undefined;
    const u = e.because.filter((x) => aSet.has(x.id)).reduce((n, x) => n + x.score, 0);
    const p = e.because.filter((x) => bSet.has(x.id)).reduce((n, x) => n + x.score, 0);
    return u + p > 0 ? { user: u / (u + p), partner: p / (u + p) } : undefined;
  };
  const names = new Map([...input.seeds.map((s) => [s.id, shortName(s.name)] as const), ...partnerSeeds.map((e) => [e.id, shortName(e.name)] as const)]);

  const candidates = await step(
    "b-joint",
    "Searching for topics both tastes point to",
    older ? "GET /v2/insights × 5 (joint signal + retirement audience, explainability)" : "GET /v2/insights × 4 (joint signal, explainability)",
    async () => {
      const types: Q.EntityType[] = ["movie", "tv_show", "artist", "place"];
      const joint = { entities: [...a.slice(0, 5), ...b.slice(0, 5)], exclude: [...a, ...b], take: 8, explain: true };
      const lists = await Promise.all([
        ...types.map((type) =>
          Q.insights({
            type,
            ...joint,
            location: type === "place" ? input.person.city : undefined,
            filterTags: type === "place" ? Q.outingTags(input.person.stage) : undefined,
            anyTag: type === "place",
            ...(type === "place" ? {} : guards(input.person.stage, type)),
          }).catch(() => []),
        ),
        // A grandparent (or an older AAC user): Qloo's retirement audience as an extra signal.
        older ? Q.insights({ type: "movie", ...joint, audiences: [RETIREMENT], ...guards(input.person.stage, "movie") }).catch(() => []) : Promise.resolve([]),
      ]);
      const partnerNames = new Set(partnerSeeds.map((e) => e.name.toLowerCase()));
      const seen = new Set<string>();
      return lists
        .flat()
        .filter((e) => Q.isHangout(e) && !partnerNames.has(e.name.toLowerCase()) && suitable(input.person.age, e))
        .filter((e) => !seen.has(e.id) && !!seen.add(e.id))
        // A title that is just a shared theme ("Family") reads as a category, not a topic.
        .filter((e) => !themes.some((t) => t.name.toLowerCase() === e.name.trim().toLowerCase()));
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
        // Bridge score: taste affinity, plus reward when BOTH generations lean in,
        // plus reward when the pick draws on both people's favourites (explainability).
        const both = d ? Math.min(u, p) : 0;
        const bal = balance(e);
        const even = bal ? 1 - Math.abs(bal.user - bal.partner) : 0.5;
        return { e, u, p, known, bal, score: (e.affinity ?? 0.5) + both * 0.8 + even * 0.3 };
      });
      return withScore.sort((x, y) => y.score - x.score);
    },
    (r) =>
      `${r.filter((x) => x.u > 0 && x.p > 0).length} topics with positive affinity for both ages · ${r.filter((x) => x.bal && Math.min(x.bal.user, x.bal.partner) >= 0.3).length} draw on both people's favourites`,
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
  const cells: Cell[] = picks.map(({ e, u, p, known, bal }) => ({
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
        : `Recommended by Qloo from both taste profiles together.${bal ? ` It draws ${Math.round(bal.user * 100)}% on ${input.person.name}'s favourites and ${Math.round(bal.partner * 100)}% on ${input.partnerName}'s.` : ""}${known ? ` Age affinity: ${input.person.name}'s group ${pct(u)}, ${input.partnerName}'s group ${pct(p)}.` : ""}`,
    because: e.because
      ?.filter((x) => names.has(x.id))
      .sort((x, y) => y.score - x.score)
      .slice(0, 4)
      .map((x) => ({ name: `${names.get(x.id)} (${aSet.has(x.id) ? input.person.name : input.partnerName})`, share: x.score })),
    popularity: e.popularity,
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
