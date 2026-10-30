import "server-only";
import * as Q from "./qloo";
import { chatJson } from "./llm";
import type { Board, BuildInput, Cell, Folder, FolderKey, Person, TraceEvent } from "./types";
import { stageFor } from "./types";
import { FOLDER_META } from "./vocab";

/**
 * The Fringe agent.
 *
 *   understand → resolve → expand → localise → read the room → curate → verify
 *
 * The LLM handles language (parsing what a caregiver wrote, writing phrases a
 * person would actually say). Qloo is the only source of *what* goes on the
 * board: every cell is a Qloo entity or the caregiver's own words, and the
 * curation step can only choose from ids Qloo returned. When a step comes back
 * thin the agent changes strategy (relaxes filters, drops a signal) rather than
 * inventing items.
 */

export type Emit = (e: TraceEvent) => void;

const DOMAINS: { key: FolderKey; type: Q.EntityType }[] = [
  { key: "shows", type: "tv_show" },
  { key: "movies", type: "movie" },
  { key: "music", type: "artist" },
  { key: "games", type: "videogame" },
  { key: "books", type: "book" },
];

export const KIND_TO_TYPE: Record<string, Q.EntityType | undefined> = {
  tv_show: "tv_show",
  show: "tv_show",
  movie: "movie",
  film: "movie",
  artist: "artist",
  music: "artist",
  band: "artist",
  videogame: "videogame",
  game: "videogame",
  book: "book",
  author: "book",
  brand: "brand",
  place: "place",
  person: "person",
};

export const TYPE_TO_FOLDER: Record<string, FolderKey | undefined> = {
  tv_show: "shows",
  movie: "movies",
  artist: "music",
  videogame: "games",
  book: "books",
  place: "places",
};

const PER_FOLDER = 8;

interface Seed {
  text: string;
  entity?: Q.QlooEntity;
}

class Tracer {
  calls = 0;
  constructor(private emit: Emit) {}
  async step<T>(id: string, label: string, endpoint: string, fn: () => Promise<T>, summarize: (r: T) => string) {
    const t0 = Date.now();
    this.emit({ id, label, endpoint, status: "running" });
    try {
      const r = await fn();
      this.emit({ id, label, endpoint, status: "done", detail: summarize(r), ms: Date.now() - t0 });
      return r;
    } catch (e) {
      this.emit({ id, label, endpoint, status: "error", detail: String((e as Error).message).slice(0, 160), ms: Date.now() - t0 });
      throw e;
    }
  }
  note(id: string, label: string, detail: string, status: TraceEvent["status"] = "done") {
    this.emit({ id, label, detail, status });
  }
}

/* ------------------------------------------------------------------ */
/* 1. Understand: free text from a caregiver → typed seeds             */
/* ------------------------------------------------------------------ */

interface Parsed {
  seeds: { text: string; kind: string }[];
  foods: string[];
  activities: string[];
}

function naiveParse(likes: string): Parsed {
  const parts = likes
    .split(/,|;|\n| and /i)
    .map((s) => s.trim())
    .filter(Boolean);
  return { seeds: parts.map((text) => ({ text, kind: "unknown" })), foods: [], activities: [] };
}

async function understand(input: BuildInput, t: Tracer): Promise<{ parsed: Parsed; model?: string }> {
  const t0 = Date.now();
  t.note("understand", "Reading what the caregiver wrote", "Groq · intent parsing", "running");
  const r = await chatJson<Parsed>(
    [
      {
        role: "system",
        content:
          'You turn a caregiver\'s note about what someone loves into JSON. Return {"seeds":[{"text":"exact title or name","kind":"tv_show|movie|artist|videogame|book|brand|place|person"}],"foods":["..."],"activities":["..."]}. Use canonical titles (e.g. "Spider-Verse" -> "Spider-Man: Across the Spider-Verse"). Foods are dishes/snacks. Activities are hobbies that are not media (swimming, fishing). Never add things that were not mentioned.',
      },
      { role: "user", content: input.likes.slice(0, 600) },
    ],
    500,
  );
  const ok = r && Array.isArray(r.data.seeds);
  const parsed = ok ? { seeds: r!.data.seeds ?? [], foods: r!.data.foods ?? [], activities: r!.data.activities ?? [] } : naiveParse(input.likes);
  t.note(
    "understand",
    "Reading what the caregiver wrote",
    ok
      ? `${parsed.seeds.length} interests, ${parsed.foods.length} foods, ${parsed.activities.length} activities`
      : "LLM unavailable, split the list by hand instead",
    ok ? "done" : "warn",
  );
  void t0;
  return { parsed, model: r?.model };
}

/* ------------------------------------------------------------------ */
/* 2. Resolve: names → Qloo entities (ids + pictures)                  */
/* ------------------------------------------------------------------ */

async function resolve(parsed: Parsed, t: Tracer): Promise<Seed[]> {
  return t.step(
    "resolve",
    "Finding each favourite in Qloo's taste graph",
    "GET /search",
    async () => {
      const seeds = await Promise.all(
        parsed.seeds.slice(0, 8).map(async (s): Promise<Seed> => {
          const type = KIND_TO_TYPE[s.kind?.toLowerCase?.() ?? ""];
          const boardable = (e: Q.QlooEntity) => !!TYPE_TO_FOLDER[String(e.type)];
          t.calls++;
          let hits = await Q.search(s.text, type, 3).catch(() => []);
          // "Taylor Swift" can come back as a person or an album; we want the
          // entity that belongs on a board (the artist), so widen and re-pick.
          if (!hits.some(boardable)) {
            t.calls++;
            const wide = await Q.search(s.text, undefined, 8).catch(() => []);
            hits = [...wide.filter(boardable), ...hits];
          }
          return { text: s.text, entity: hits.find(boardable) ?? hits[0] };
        }),
      );
      return seeds;
    },
    (seeds) => {
      const found = seeds.filter((s) => s.entity);
      const miss = seeds.filter((s) => !s.entity).map((s) => s.text);
      return `${found.length}/${seeds.length} matched` + (miss.length ? ` · not in graph: ${miss.join(", ")}` : "");
    },
  );
}

/* ------------------------------------------------------------------ */
/* 3. Expand: cross-domain taste, with age-appropriate guard rails     */
/* ------------------------------------------------------------------ */

export function guards(stage: Person["stage"], type: Q.EntityType): Partial<Q.InsightOptions> {
  if (stage === "child") {
    if (type === "movie") return { contentRating: "G,PG" };
    if (type === "tv_show") return { contentRating: "TV-Y,TV-Y7,TV-G,TV-PG" };
    if (type === "book") return { filterTags: ["urn:tag:genre:media:childrens"] };
  }
  if (stage === "teen") {
    if (type === "movie") return { contentRating: "G,PG,PG-13" };
    if (type === "tv_show") return { contentRating: "TV-Y7,TV-G,TV-PG,TV-14" };
  }
  return {};
}

async function expand(seeds: Seed[], person: Person, t: Tracer) {
  const ids = seeds.flatMap((s) => (s.entity ? [s.entity.id] : []));
  const out: Partial<Record<FolderKey, Q.QlooEntity[]>> = {};
  await t.step(
    "expand",
    "Expanding across shows, movies, music, games and books",
    "GET /v2/insights × 5",
    async () => {
      await Promise.all(
        DOMAINS.map(async ({ key, type }) => {
          const g = guards(person.stage, type);
          t.calls++;
          let res = await Q.insights({ type, entities: ids, exclude: ids, take: 14, ...g }).catch(() => []);
          if (res.length < 3 && Object.keys(g).length) {
            // Self-correct: the safety filter was too tight for this taste profile.
            t.calls++;
            res = await Q.insights({ type, entities: ids, exclude: ids, take: 14, popularityMin: 0.5 }).catch(() => []);
            t.note(`expand-${key}`, `Relaxed filters for ${key}`, `only a few rated titles matched, retried with a popularity floor instead`, "warn");
          }
          out[key] = res;
        }),
      );
      return out;
    },
    (r) =>
      DOMAINS.map(({ key }) => `${key} ${r[key]?.length ?? 0}`)
        .join(" · "),
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. Localise: real places nearby that fit this person's taste        */
/* ------------------------------------------------------------------ */

async function localise(seeds: Seed[], person: Person, foods: string[], t: Tracer) {
  const ids = seeds.flatMap((s) => (s.entity ? [s.entity.id] : []));
  return t.step(
    "places",
    `Finding real places in ${person.city} that match`,
    "GET /v2/tags + /v2/insights (place)",
    async () => {
      // Turn the first food into a cuisine/dish tag so we can find where to eat it.
      let foodTag: Q.SharedTag | undefined;
      let foodPlaces: Q.QlooEntity[] = [];
      if (foods[0]) {
        t.calls++;
        const tags = await Q.findTags(foods[0], 10).catch(() => []);
        const slug = foods[0].toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_");
        // Most specific first: a dish on the menu, then a restaurant genre, then a cuisine.
        const ranked = [
          ...tags.filter((x) => x.id.endsWith(`menu_highlight:qloo:${slug}`) || x.id.endsWith(`specialty_dish:place:${slug}`)),
          ...tags.filter((x) => x.id.includes("genre:place:restaurant")),
          ...tags.filter((x) => x.id.includes("menu_highlight") || x.id.includes("cuisine")),
        ];
        for (const tag of ranked.slice(0, 3)) {
          t.calls++;
          const res = await Q.insights({ type: "place", entities: ids, filterTags: [tag.id], location: person.city, take: 4 }).catch(() => []);
          if (res.length >= 2) {
            foodTag = tag;
            foodPlaces = res;
            break;
          }
        }
      }
      t.calls++;
      let places = await Q.insights({ type: "place", entities: ids, location: person.city, take: 24 }).catch(() => []);
      // Hotels and bars are not "let's go" places for most AAC users.
      const city = person.city.split(",")[0].trim().toLowerCase();
      places = places.filter(
        (p) =>
          Q.isHangout(p) &&
          p.name.trim().toLowerCase() !== city,
      );
      if (person.stage === "child") {
        const kid = places.filter((p) => p.kidFriendly);
        if (kid.length >= 4) places = kid;
      }
      return { places, foodPlaces, foodTag };
    },
    (r) =>
      `${r.places.length} taste-matched places` +
      (r.foodTag ? ` · ${r.foodPlaces.length} for "${r.foodTag.name}"` : ""),
  );
}

/* ------------------------------------------------------------------ */
/* 5. Read the room: who will each topic land with?                    */
/* ------------------------------------------------------------------ */

const BUCKET_LABEL: Record<string, string> = {
  "24_and_younger": "under 25",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55+",
};

function talkWith(person: Person, top: string | undefined): string | undefined {
  if (!top) return undefined;
  const young = top === "24_and_younger";
  const mid = top === "25_to_29" || top === "30_to_34";
  const parent = top === "35_to_44" || top === "45_to_54";
  if (young) return person.stage === "older" ? "grandkids" : "friends & siblings";
  if (mid) return person.stage === "child" ? "teachers & aides" : "people in their 20s–30s";
  if (parent) return person.stage === "child" || person.stage === "teen" ? "parents & teachers" : "people their kids' age";
  return person.stage === "older" ? "friends their own age" : "grandparents";
}

async function readTheRoom(ids: string[], t: Tracer) {
  return t.step(
    "demographics",
    "Checking who each topic resonates with",
    "GET /v2/insights (urn:demographics)",
    async () => {
      const chunks = [ids.slice(0, 12), ids.slice(12, 24), ids.slice(24, 36)].filter((c) => c.length);
      t.calls += chunks.length;
      const d = (await Promise.all(chunks.map((c) => Q.demographics(c).catch(() => [])))).flat();
      return new Map(d.map((x) => [x.id, x]));
    },
    (m) => `age & gender affinity for ${m.size} topics`,
  );
}

/* ------------------------------------------------------------------ */
/* 6. Curate: the LLM picks and phrases, from Qloo candidates only      */
/* ------------------------------------------------------------------ */

interface Curated {
  folders: Record<string, { id: string; label: string; say: string }[]>;
  quick: Record<string, string[]>;
}

export const TEMPLATE: Record<string, (n: string) => string> = {
  shows: (n) => `Can we watch ${n}?`,
  movies: (n) => `I want to watch ${n}`,
  music: (n) => `Play ${n}!`,
  games: (n) => `Let's play ${n}`,
  books: (n) => `Read ${n} with me`,
  places: (n) => `Can we go to ${n}?`,
  food: (n) => `I want ${n}`,
};

const QUICK_FALLBACK: Record<string, string[]> = {
  shows: ["Have you seen it?", "That part was so funny!", "Who's your favorite?", "Let's watch together"],
  movies: ["Have you seen it?", "I want to watch it again", "That was scary!", "Popcorn please!"],
  music: ["Turn it up!", "This is my song", "Do you know this one?", "Play it again"],
  games: ["Want to play?", "I won!", "Your turn", "One more game"],
  books: ["Read it again", "What happens next?", "I like this part", "Turn the page"],
  places: ["Can we go?", "I had fun there", "Let's go this weekend", "Who's coming?"],
  food: ["I'm hungry", "More please", "That's yummy", "I don't like it"],
};

async function curate(
  person: Person,
  candidates: Partial<Record<FolderKey, Q.QlooEntity[]>>,
  t: Tracer,
): Promise<{ data: Curated | null; model?: string }> {
  // Short handles instead of 36-char UUIDs: fewer tokens and no mangled ids.
  const handle = new Map<string, string>();
  const lines = Object.entries(candidates)
    .filter(([, list]) => list && list.length)
    .map(([k, list]) => {
      return (
        `${k}:\n` +
        list!
          .slice(0, 14)
          .map((e, i) => {
            const h = `${k[0]}${i + 1}`;
            handle.set(h, e.id);
            return `${h}|${e.name}`;
          })
          .join("\n")
      );
    })
    .join("\n");
  const t0 = Date.now();
  t.note("curate", "Choosing and phrasing buttons", "Groq · constrained to Qloo ids", "running");
  const r = await chatJson<Curated>(
    [
      {
        role: "system",
        content: `You are an AAC (augmentative and alternative communication) specialist building a personal vocabulary page for ${person.name}, age ${person.age} (${person.about ?? ""}). From the candidate lists ONLY (format handle|name; use the handle as "id"), pick up to ${PER_FOLDER} items per folder that this person would plausibly recognise, enjoy and talk about; prefer well-known titles over obscure ones. Skip anything inappropriate for age ${person.age}, theme parks listed as shows, any hotel/bar/office/convention venue, or duplicates. For each pick write: label (max 18 chars, the short name people actually use) and say (what ${person.name} taps to start talking about it: first person, max 7 words, MUST contain the label, natural for age ${person.age}; e.g. "Can we watch Peppa Pig?", "Frozen II is my favorite!", "Let's play Roblox!", "Put on Olivia Rodrigo!", "Can we go to Zilker Park?"). Also write 4 quick social phrases per folder that build connection (comments and questions, not requests). Return JSON {"folders":{"shows":[{"id":"...","label":"...","say":"..."}],...},"quick":{"shows":["..."],...}}. Use ids exactly as given.`,
      },
      { role: "user", content: lines },
    ],
    2600,
  );
  t.note(
    "curate",
    "Choosing and phrasing buttons",
    r ? `${r.model} picked from ${Object.values(candidates).reduce((n, l) => n + (l?.length ?? 0), 0)} Qloo candidates` : "LLM busy, ranked by Qloo affinity with phrase templates",
    r ? "done" : "warn",
  );
  void t0;
  if (r?.data?.folders) {
    for (const list of Object.values(r.data.folders)) {
      if (!Array.isArray(list)) continue;
      for (const p of list) p.id = handle.get(String(p.id).trim()) ?? `unknown:${p.id}`;
    }
  }
  return { data: r?.data ?? null, model: r?.model };
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                        */
/* ------------------------------------------------------------------ */

function topAges(d?: Q.Demographic) {
  if (!d) return undefined;
  return Object.entries(d.age)
    .filter(([, v]) => v > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([bucket, value]) => ({ bucket: BUCKET_LABEL[bucket] ?? bucket, value, raw: bucket }));
}

/** "Spider-Man: Across the Spider-Verse" → "Across the Spider-Verse"; drops "(2019)" etc. */
export function shortName(name: string) {
  let n = name.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const [head, tail] = n.split(/:\s+/, 2);
  if (tail) n = tail.split(" ").length <= 4 ? tail : head;
  return n.length > 30 ? n.slice(0, 29).trimEnd() + "…" : n;
}

export async function buildBoard(input: BuildInput, emit: Emit): Promise<Board> {
  const started = Date.now();
  const t = new Tracer(emit);
  const person: Person = {
    name: input.name.trim() || "Friend",
    age: Math.max(3, Math.min(100, Number(input.age) || 10)),
    city: input.city.trim() || "New York, NY",
    stage: stageFor(Number(input.age) || 10),
    about: input.about,
  };

  const { parsed, model: parseModel } = await understand(input, t);
  const seeds = await resolve(parsed, t);
  const resolved = seeds.filter((s) => s.entity);
  if (!resolved.length) throw new Error("None of those favourites were found in Qloo. Try exact titles or names.");

  const [expanded, local] = await Promise.all([expand(resolved, person, t), localise(resolved, person, parsed.foods, t)]);

  const candidates: Partial<Record<FolderKey, Q.QlooEntity[]>> = { ...expanded, places: local.places.filter((p) => !local.foodPlaces.some((f) => f.id === p.id)) };
  const all = new Map<string, Q.QlooEntity>();
  Object.values(candidates).forEach((l) => l?.forEach((e) => all.set(e.id, e)));

  const [room, curated] = await Promise.all([
    readTheRoom(
      [...resolved.map((s) => s.entity!.id), ...DOMAINS.flatMap(({ key }) => candidates[key]?.slice(0, 5).map((e) => e.id) ?? [])],
      t,
    ),
    curate(person, candidates, t),
  ]);

  /* --- verify & assemble: nothing reaches the board unless Qloo returned it --- */
  const folders: Folder[] = [];
  let dropped = 0;
  const seedNames = resolved.map((s) => shortName(s.entity!.name));
  const seedRoom = resolved.map((s) => room.get(s.entity!.id));

  for (const key of ["shows", "movies", "music", "games", "books", "places"] as FolderKey[]) {
    const cells: Cell[] = [];
    // The person's own favourites go first, exactly as the caregiver named them.
    for (const s of resolved) {
      if (TYPE_TO_FOLDER[String(s.entity!.type)] !== key) continue;
      const e = s.entity!;
      const ages = topAges(room.get(e.id));
      cells.push({
        id: e.id,
        label: shortName(e.name),
        say: key === "music" ? `I love ${shortName(e.name)}!` : `I love ${shortName(e.name)}!`,
        image: e.image,
        kind: "seed",
        entityId: e.id,
        entityType: String(e.type),
        why: `You told us ${person.name} loves this.`,
        ages: ages?.map(({ bucket, value }) => ({ bucket, value })),
        talkWith: talkWith(person, ages?.[0]?.raw),
        status: "approved",
      });
    }
    const pool = candidates[key] ?? [];
    const picks = curated.data?.folders?.[key];
    const chosen = Array.isArray(picks) && picks.length
      ? picks
          .map((p) => {
            const e = all.get(p.id);
            if (!e) dropped++;
            return e ? { e, label: p.label, say: p.say } : null;
          })
          .filter(Boolean)
      : pool.slice(0, PER_FOLDER).map((e) => ({ e, label: shortName(e.name), say: TEMPLATE[key](shortName(e.name)) }));

    for (const c of chosen.slice(0, PER_FOLDER)) {
      const { e, label, say } = c!;
      if (cells.some((x) => x.id === e.id)) continue;
      const ages = topAges(room.get(e.id));
      const strongest = seedNames.length ? seedNames.slice(0, 3).join(" + ") : "their favourites";
      cells.push({
        id: e.id,
        label: (label || shortName(e.name)).slice(0, 30),
        say: say || TEMPLATE[key](shortName(e.name)),
        image: e.image,
        kind: key === "places" ? "place" : "expanded",
        entityId: e.id,
        entityType: String(e.type),
        affinity: e.affinity,
        why:
          key === "places"
            ? `A real place in ${person.city} that fans of ${strongest} over-index on${e.address ? ` · ${e.address}` : ""}.`
            : `Qloo affinity ${e.affinity?.toFixed(2) ?? "—"} with ${strongest}.`,
        ages: ages?.map(({ bucket, value }) => ({ bucket, value })),
        talkWith: talkWith(person, ages?.[0]?.raw),
        address: e.address,
        status: "suggested",
      });
    }
    if (cells.length) {
      const q = curated.data?.quick?.[key];
      folders.push({
        key,
        title: FOLDER_META[key].title,
        cells,
        quick: Array.isArray(q) && q.length ? q.slice(0, 4) : QUICK_FALLBACK[key],
      });
    }
  }

  // Food: the caregiver's words, plus where to get it nearby.
  if (parsed.foods.length) {
    const cells: Cell[] = parsed.foods.slice(0, 4).map((f, i) => ({
      id: `food-${i}`,
      label: f.slice(0, 30),
      say: TEMPLATE.food(f),
      kind: "food",
      why: `You told us ${person.name} loves this.`,
      status: "approved",
    }));
    for (const p of local.foodPlaces.slice(0, 3)) {
      cells.push({
        id: p.id,
        label: shortName(p.name),
        say: `Can we get ${parsed.foods[0]} at ${shortName(p.name)}?`,
        image: p.image,
        kind: "place",
        entityId: p.id,
        entityType: "place",
        affinity: p.affinity,
        why: `Serves ${local.foodTag?.name ?? parsed.foods[0]} in ${person.city}, and matches ${person.name}'s taste profile.${p.address ? ` · ${p.address}` : ""}`,
        address: p.address,
        status: "suggested",
      });
    }
    folders.push({ key: "food", title: "Food", cells, quick: QUICK_FALLBACK.food });
  }

  if (dropped) t.note("verify", "Verifying every button against Qloo", `removed ${dropped} item(s) the LLM named that Qloo never returned`, "warn");
  else t.note("verify", "Verifying every button against Qloo", "every button traces back to a Qloo entity or the caregiver's words");

  void seedRoom;
  return {
    person,
    folders,
    stats: {
      qlooCalls: t.calls,
      candidates: all.size,
      kept: folders.reduce((n, f) => n + f.cells.length, 0),
      model: curated.model ?? parseModel,
      ms: Date.now() - started,
    },
  };
}
