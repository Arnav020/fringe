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
  { key: "people", type: "person" },
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
  person: "people",
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
          const boardable = (e: Q.QlooEntity) => !!TYPE_TO_FOLDER[String(e.type)] && (String(e.type) !== "place" || type === "place");
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

const THEME_PARK = /disney ?world|disneyland|world of disney|disney parks|universal studios|magic kingdom/i;
/**
 * A deterministic safety net under the curation prompt: names the taste graph links to young
 * people's media but a parent would not expect on their board (adult content, scandals, M-rated games).
 */
const NOT_FOR_CHILDREN = /david dobrik|james charles|colleen ballinger|miranda sings|logan paul|jake paul|shane dawson|tana mongeau|trisha paytas|jeffree star|faze rug|bhad bhabie|five nights at freddy/i;
const NOT_FOR_MINORS = /andrew tate|xxxtentacion|6ix9ine|tekashi|r\. kelly|mortal kombat|grand theft auto|\bgta\b|call of duty|resident evil|the last of us|doom eternal|watch dogs|mafia|far cry|dead space|manhunt|outlast|the evil within|a way out|red dead/i;

/** True if a title or name is fine for this age (the curation prompt does the nuanced part). */
export function ageOk(age: number, name: string) {
  if (age < 13 && NOT_FOR_CHILDREN.test(name)) return false;
  if (age < 18 && NOT_FOR_MINORS.test(name)) return false;
  return true;
}

/**
 * Qloo ignores filter.content_rating for games, but stores the ESRB rating on each one.
 * Under 13: only games rated E or E10+. Under 17: nothing rated M or AO.
 */
export function gameOk(age: number, e: Q.QlooEntity) {
  if (String(e.type) !== "videogame") return true;
  const r = (e.rating ?? "").toUpperCase().replace(/\s+/g, "");
  if (age < 13) return r === "E" || r === "E10+" || r === "EVERYONE" || r === "EVERYONE10+";
  if (age < 17) return !/^(M|AO|MATURE|ADULTSONLY)/.test(r);
  return true;
}

/** Both age checks, for any Qloo entity. */
export const suitable = (age: number, e: Q.QlooEntity) => ageOk(age, e.name) && gameOk(age, e);

async function expand(seeds: Seed[], person: Person, t: Tracer) {
  const ids = seeds.flatMap((s) => (s.entity ? [s.entity.id] : []));
  const out: Partial<Record<FolderKey, Q.QlooEntity[]>> = {};
  await t.step(
    "expand",
    "Expanding across shows, movies, music, games, books and people",
    "GET /v2/insights × 6 · with explainability",
    async () => {
      await Promise.all(
        DOMAINS.filter(({ type }) => person.stage !== "older" || type !== "videogame" || seeds.some((s) => s.entity?.type === type)).map(async ({ key, type }) => {
          const g = guards(person.stage, type);
          t.calls++;
          // No signal.demographics.age here: in testing it pulled an Indian 12-year-old's board towards
          // US youth titles. Age is handled by content ratings, and Qloo demographics read the room.
          const base = { type, entities: ids, exclude: ids, take: 14, explain: true, excludeTags: type === "person" ? [Q.POLITICIAN] : undefined };
          let res = await Q.insights({ ...base, ...g }).catch(() => []);
          if (res.length < 3 && Object.keys(g).length) {
            // Self-correct: the safety filter was too tight for this taste profile.
            t.calls++;
            res = await Q.insights({ ...base, popularityMin: 0.5 }).catch(() => []);
            t.note(`expand-${key}`, `Relaxed filters for ${key}`, `only a few rated titles matched, retried with a popularity floor instead`, "warn");
          }
          // Theme-park specials are catalogued as shows; they're places, not topics.
          out[key] = res.filter((e) => !THEME_PARK.test(e.name) && suitable(person.age, e));
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
  const kid = person.stage === "child" || person.stage === "teen";
  const okPlace = (p: Q.QlooEntity) => Q.isHangout(p) && p.name.trim().toLowerCase() !== person.city.split(",")[0].trim().toLowerCase();
  return t.step(
    "places",
    `Finding real places in ${person.city} that match`,
    "GET /v2/tags + /v2/insights (place, location + geohash)",
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
          const res = (await Q.insights({ type: "place", entities: ids, filterTags: [tag.id], location: person.city, take: 8 }).catch(() => [])).filter(okPlace);
          if (res.length >= 2) {
            foodTag = tag;
            foodPlaces = res;
            break;
          }
        }
      }
      t.calls++;
      // Only outing-type places (parks, museums, pools…, by age), via a union tag filter.
      const outing = Q.outingTags(person.stage);
      let places = (await Q.insights({ type: "place", entities: ids, location: person.city, take: 24, filterTags: outing, anyTag: true }).catch(() => [])).filter(okPlace);
      if (places.length < 4) {
        // Thin coverage (smaller cities): widen, keeping only places Qloo marks as good for kids when it's a child.
        t.calls++;
        const wide = (await Q.insights({ type: "place", entities: ids, location: person.city, take: 24 }).catch(() => [])).filter(okPlace);
        places = [...places, ...wide.filter((p) => !kid || p.kidFriendly)];
      }
      return { places, foodPlaces, foodTag };
    },
    (r) =>
      `${r.places.length} taste-matched places` +
      (r.foodTag ? ` · ${r.foodPlaces.length} for "${r.foodTag.name}"` : ""),
  );
}

/* ------------------------------------------------------------------ */
/* 4b. Hot-spots: where in the city this taste is concentrated          */
/* ------------------------------------------------------------------ */

async function hotspots(seeds: Seed[], person: Person, t: Tracer) {
  const ids = seeds.flatMap((s) => (s.entity ? [s.entity.id] : []));
  return t.step(
    "heatmap",
    `Mapping where ${person.name}'s kind of taste clusters in ${person.city}`,
    "GET /v2/insights (urn:heatmap → place by geohash)",
    async () => {
      t.calls++;
      const cells = await Q.heatmap(ids, person.city).catch(() => []);
      // Roll the fine cells up into neighbourhood-sized areas (5-char geohash, ~5 km).
      const areas = new Map<string, { score: number; lat: number; lng: number; best: number }>();
      for (const c of cells) {
        if (!c.geohash) continue;
        const k = c.geohash.slice(0, 5);
        const a = areas.get(k) ?? { score: 0, lat: c.lat, lng: c.lng, best: -1 };
        a.score += c.affinity;
        if (c.affinity > a.best) Object.assign(a, { lat: c.lat, lng: c.lng, best: c.affinity });
        areas.set(k, a);
      }
      const top = [...areas.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 2);
      const found = await Promise.all(
        top.map(async ([geohash]) => {
          t.calls++;
          const res = await Q.insights({
            type: "place",
            entities: ids,
            geohash,
            take: 10,
            filterTags: Q.outingTags(person.stage),
            anyTag: true,
          }).catch(() => []);
          return res.filter(Q.isHangout).map((p) => ({ ...p, hotspot: geohash }));
        }),
      );
      // Thousands of fine cells → a few hundred ~1 km cells for the map.
      const fine = new Map<string, { lat: number; lng: number; affinity: number; n: number }>();
      for (const c of cells) {
        if (!c.geohash || !c.lat || !c.lng) continue;
        const k = c.geohash.slice(0, 6);
        const f = fine.get(k) ?? { lat: 0, lng: 0, affinity: 0, n: 0 };
        f.lat += c.lat;
        f.lng += c.lng;
        f.affinity = Math.max(f.affinity, c.affinity);
        f.n++;
        fine.set(k, f);
      }
      const points = [...fine.values()]
        .map((f) => ({ lat: +(f.lat / f.n).toFixed(4), lng: +(f.lng / f.n).toFixed(4), affinity: +f.affinity.toFixed(2) }))
        .filter((p) => p.affinity > 0.15)
        .sort((a, b) => b.affinity - a.affinity)
        .slice(0, 400);
      return {
        points,
        spots: top.map(([, a], i) => ({ lat: a.lat, lng: a.lng, label: `Hot-spot ${i + 1}` })),
        places: found.flat(),
      };
    },
    (r) => (r.points.length ? `${r.points.length} taste cells · ${r.places.length} places inside the top ${r.spots.length} hot-spots` : "no heatmap coverage here, using city search"),
  );
}

/* ------------------------------------------------------------------ */
/* 4c. Snacks: food & drink brands that fit this taste profile          */
/* ------------------------------------------------------------------ */

const NOT_FOR_KIDS = /coffee|starbucks|dunkin|espresso|beer|wine|vodka|whisk|bourbon|tequila|rum\b|gin\b|liquor|spirits|brew|seltzer|energy|red bull|monster|bang\b|celsius|tobacco|cigar|vape|nitro/i;

async function snacks(seeds: Seed[], person: Person, t: Tracer) {
  const ids = seeds.flatMap((s) => (s.entity ? [s.entity.id] : []));
  return t.step(
    "snacks",
    "Finding snacks and treats that fit this taste",
    "GET /v2/insights (brand · food & beverage)",
    async () => {
      t.calls++;
      const res = await Q.insights({
        type: "brand",
        entities: ids,
        filterTags: ["urn:tag:genre:brand:food_and_beverage"],
        age: Q.ageBucket(person.age),
        explain: true,
        take: 16,
      }).catch(() => []);
      return person.age < 18 ? res.filter((b) => !NOT_FOR_KIDS.test(b.name) && !(b.tags ?? []).some((x) => NOT_FOR_KIDS.test(x))) : res;
    },
    (r) => `${r.length} food & drink brands`,
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
  people: (n) => `I like ${n}!`,
  places: (n) => `Can we go to ${n}?`,
  food: (n) => `I want ${n}`,
};

const QUICK_FALLBACK: Record<string, string[]> = {
  shows: ["Have you seen it?", "That part was so funny!", "Who's your favorite?", "Let's watch together"],
  movies: ["Have you seen it?", "I want to watch it again", "That was scary!", "Popcorn please!"],
  music: ["Turn it up!", "This is my song", "Do you know this one?", "Play it again"],
  games: ["Want to play?", "I won!", "Your turn", "One more game"],
  books: ["Read it again", "What happens next?", "I like this part", "Turn the page"],
  people: ["Did you see them?", "They're so cool", "Who's your favorite?", "I want to meet them"],
  places: ["Can we go?", "I had fun there", "Let's go this weekend", "Who's coming?"],
  food: ["I'm hungry", "More please", "That's yummy", "I don't like it"],
};

/** Distinct handle prefixes: "movies" and "music" (and "people"/"places") share a first letter. */
export const HANDLE: Record<string, string> = { shows: "s", movies: "mv", music: "mu", games: "g", books: "b", people: "pp", places: "pl", food: "f" };

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
            const h = `${HANDLE[k] ?? k.slice(0, 2)}${i + 1}`;
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
        content: `You are an AAC (augmentative and alternative communication) specialist building a personal vocabulary page for ${person.name}, age ${person.age} (${person.about ?? ""}). From the candidate lists ONLY (format handle|name; use the handle as "id"), pick up to ${PER_FOLDER} items per folder that this person would plausibly recognise, enjoy and talk about; prefer well-known titles over obscure ones. Skip anything inappropriate for age ${person.age}${person.age < 17 ? " (no M-rated or graphically violent games such as Mortal Kombat, GTA or PUBG; no R-rated films or adult shows)" : ""}, politicians and controversial public figures${person.age < 13 ? " (for a child, people must be kid-appropriate: children's entertainers, athletes, musicians kids like; no adult YouTubers or influencers known for scandals or adult content such as David Dobrik, James Charles, Colleen Ballinger or Logan Paul)" : ""}, theme parks listed as shows, any hotel/bar/office/school/convention venue, or duplicates. The "food" list is snack and drink brands: keep treats and foods ${person.name} could ask for${person.age < 18 ? "; no coffee, alcohol or energy drinks" : ""}. For each pick write: label (max 18 chars, the short name people actually use) and say (what ${person.name} taps to start talking about it: first person, max 7 words, MUST contain the label, natural for age ${person.age}; e.g. "Can we watch Peppa Pig?", "Frozen II is my favorite!", "Let's play Roblox!", "Put on Olivia Rodrigo!", "Can we go to Zilker Park?"). Also write 4 quick social phrases per folder that build connection (comments and questions, not requests). Return JSON {"folders":{"shows":[{"id":"...","label":"...","say":"..."}],...},"quick":{"shows":["..."],...}}. Use ids exactly as given.`,
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
/* 7. Home language: phrases in the language the family speaks          */
/* ------------------------------------------------------------------ */

export const LANG_NAME: Record<string, string> = { hi: "Hindi", es: "Spanish", mr: "Marathi", ta: "Tamil", bn: "Bengali" };

async function translate(person: Person, folders: Folder[], t: Tracer) {
  if (!person.lang || !LANG_NAME[person.lang]) return;
  const cells = folders.flatMap((f) => f.cells);
  if (!cells.length) return;
  const lang = LANG_NAME[person.lang];
  t.note("translate", `Writing phrases in ${lang}`, "Groq · labels from Qloo's localised names", "running");
  const r = await chatJson<{ t: string[] }>(
    [
      {
        role: "system",
        content: `Translate each numbered AAC phrase into natural, simple spoken ${lang} for a ${person.age}-year-old, in its native script, with correct ${lang} word order. Keep names of shows, games, people, brands and places as they are commonly said in ${lang}. Return JSON {"t":["..."]} with exactly one translation per line, in order.`,
      },
      { role: "user", content: cells.map((c, i) => `${i + 1}. ${c.say}`).join("\n") },
    ],
    2400,
  );
  const out = r?.data?.t;
  const ok = Array.isArray(out) && out.length === cells.length;
  if (ok) cells.forEach((c, i) => (c.alt = { label: c.alt?.label ?? c.label, say: String(out![i] ?? "").slice(0, 120) }));
  else cells.forEach((c) => c.alt && !c.alt.say && (c.alt = undefined));
  t.note(
    "translate",
    `Writing phrases in ${lang}`,
    ok ? `${cells.length} phrases · ${cells.filter((c) => c.alt?.label && c.alt.label !== c.label).length} labels from Qloo's ${lang} names` : "translation unavailable, board stays in English",
    ok ? "done" : "warn",
  );
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
    lang: input.lang && /^[a-z]{2}$/.test(input.lang) ? input.lang : undefined,
  };

  const { parsed, model: parseModel } = await understand(input, t);
  const seeds = await resolve(parsed, t);
  const resolved = seeds.filter((s) => s.entity);
  if (!resolved.length) throw new Error("None of those favourites were found in Qloo. Try exact titles or names.");

  const [expanded, local, heat, brands] = await Promise.all([
    expand(resolved, person, t),
    localise(resolved, person, parsed.foods, t),
    hotspots(resolved, person, t).catch(() => ({ points: [], spots: [], places: [] as (Q.QlooEntity & { hotspot?: string })[] })),
    snacks(resolved, person, t).catch(() => [] as Q.QlooEntity[]),
  ]);

  // Hot-spot places first (taste-dense neighbourhoods), then the city-wide search.
  const placePool = new Map<string, Q.QlooEntity & { hotspot?: string }>();
  // At most two of a kind, so a board isn't eight ice-cream shops.
  const KINDS: [string, RegExp][] = [
    ["treats", /ice cream|gelato|popsicle|creamery|dairy|kulfi|frozen|cake|bakery|baked|dessert|patisserie|mithai|sweet|candy|donut|cookie|yogurt|chocolate|boba|tea house/i],
    ["outdoors", /park|garden|beach|lake|trail|greenway|pond/i],
    ["museum", /museum|science|nature cent|history|gallery|planetarium/i],
    ["play", /play|arcade|bowling|trampoline|escape|games|toy/i],
    ["water", /pool|swim|aquatic|water park|splash/i],
    ["animals", /zoo|aquarium|farm|sanctuary/i],
  ];
  const kindOf = (p: Q.QlooEntity) => {
    const text = `${p.name} ${(p.tags ?? []).join(" ")}`;
    return KINDS.find(([, re]) => re.test(text))?.[0] ?? p.id;
  };
  const perKind = new Map<string, number>();
  for (const p of [...heat.places, ...local.places]) {
    if (placePool.has(p.id) || local.foodPlaces.some((f) => f.id === p.id)) continue;
    const k = kindOf(p);
    if ((perKind.get(k) ?? 0) >= 2) continue;
    perKind.set(k, (perKind.get(k) ?? 0) + 1);
    placePool.set(p.id, p);
  }
  const candidates: Partial<Record<FolderKey, Q.QlooEntity[]>> = { ...expanded, places: [...placePool.values()], food: brands };
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
  const seedName = new Map(resolved.map((s) => [s.entity!.id, shortName(s.entity!.name)]));
  /** Qloo explainability → "Encanto 51% · Bluey 49%". */
  const because = (e: Q.QlooEntity) =>
    e.because
      ?.filter((b) => seedName.has(b.id) && b.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((b) => ({ name: seedName.get(b.id)!, share: b.score }));
  const seedRoom = resolved.map((s) => room.get(s.entity!.id));

  // One button per name across the board: "Richie Rich" the show and the remake, or Arijit Singh as artist and as person.
  const usedLabels = new Set<string>();
  const fresh = (label: string) => {
    const k = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (!k || usedLabels.has(k)) return false;
    usedLabels.add(k);
    return true;
  };

  for (const key of ["shows", "movies", "music", "games", "books", "people", "places"] as FolderKey[]) {
    const cells: Cell[] = [];
    // The person's own favourites go first, exactly as the caregiver named them.
    for (const s of resolved) {
      if (TYPE_TO_FOLDER[String(s.entity!.type)] !== key) continue;
      if (!fresh(shortName(s.entity!.name))) continue;
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
        popularity: e.popularity,
        ages: ages?.map(({ bucket, value }) => ({ bucket, value })),
        talkWith: talkWith(person, ages?.[0]?.raw),
        alt: person.lang && e.names?.[person.lang] ? { label: e.names[person.lang], say: "" } : undefined,
        status: "approved",
      });
    }
    const pool = candidates[key] ?? [];
    const picks = curated.data?.folders?.[key];
    const inPool = new Set(pool.map((e) => e.id));
    const curatedPicks = Array.isArray(picks)
      ? picks
          .map((p) => {
            // Only this folder's candidates: a handle from another list would put an artist in Movies.
            const e = inPool.has(p.id) ? all.get(p.id) : undefined;
            if (!e) dropped++;
            return e ? { e, label: p.label, say: p.say } : null;
          })
          .filter(Boolean)
      : [];
    // If curation came back short (rate limits, a truncated reply), top up from Qloo's own ranking.
    const chosen = [
      ...curatedPicks,
      ...(curatedPicks.length >= PER_FOLDER - 2
        ? []
        : pool
            .filter((e) => !curatedPicks.some((c) => c!.e.id === e.id))
            .map((e) => ({ e, label: shortName(e.name), say: TEMPLATE[key](shortName(e.name)) }))),
    ];

    for (const c of chosen.slice(0, PER_FOLDER)) {
      const { e, label, say } = c!;
      if (cells.some((x) => x.id === e.id) || !fresh(label || shortName(e.name))) continue;
      const ages = topAges(room.get(e.id));
      const drivers = because(e);
      const strongest = drivers?.length ? drivers.map((d) => d.name).join(" + ") : seedNames.length ? seedNames.slice(0, 3).join(" + ") : "their favourites";
      const hot = (e as Q.QlooEntity & { hotspot?: string }).hotspot;
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
            ? `A real place in ${person.city} that fans of ${strongest} over-index on${hot ? ", inside a neighbourhood where this taste is concentrated" : ""}.`
            : drivers?.length
              ? `People who love ${strongest} love this too (Qloo affinity ${e.affinity?.toFixed(2) ?? "—"}).`
              : `Qloo affinity ${e.affinity?.toFixed(2) ?? "—"} with ${strongest}.`,
        because: drivers,
        popularity: e.popularity,
        hotspot: hot ? "Taste hot-spot" : undefined,
        geo: e.lat && e.lng ? { lat: e.lat, lng: e.lng } : undefined,
        ages: ages?.map(({ bucket, value }) => ({ bucket, value })),
        talkWith: talkWith(person, ages?.[0]?.raw),
        address: e.address,
        alt: person.lang && e.names?.[person.lang] ? { label: e.names[person.lang], say: "" } : undefined,
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

  // Food: the caregiver's words, snacks that fit the taste profile, and where to eat nearby.
  if (parsed.foods.length || brands.length) {
    const cells: Cell[] = parsed.foods.slice(0, 4).map((f, i) => ({
      id: `food-${i}`,
      label: f.slice(0, 30),
      say: TEMPLATE.food(f),
      kind: "food",
      why: `You told us ${person.name} loves this.`,
      status: "approved",
    }));
    const snackPicks = curated.data?.folders?.food;
    const chosenSnacks = (Array.isArray(snackPicks) && snackPicks.length
      ? snackPicks.map((p) => ({ e: all.get(p.id), label: p.label, say: p.say }))
      : brands.slice(0, 4).map((e) => ({ e, label: shortName(e.name), say: TEMPLATE.food(shortName(e.name)) }))
    ).filter((x) => x.e);
    for (const { e, label, say } of chosenSnacks.filter((x) => fresh(x.label || shortName(x.e!.name))).slice(0, 5)) {
      const drivers = because(e!);
      cells.push({
        id: e!.id,
        label: (label || shortName(e!.name)).slice(0, 30),
        say: say || TEMPLATE.food(shortName(e!.name)),
        image: e!.image,
        kind: "expanded",
        entityId: e!.id,
        entityType: "brand",
        affinity: e!.affinity,
        why: drivers?.length
          ? `A snack brand people who love ${drivers.map((d) => d.name).join(" + ")} over-index on (Qloo affinity ${e!.affinity?.toFixed(2) ?? "—"}).`
          : `A food & drink brand that matches ${person.name}'s taste profile.`,
        because: drivers,
        popularity: e!.popularity,
        status: "suggested",
      });
    }
    for (const p of local.foodPlaces.slice(0, 3)) {
      cells.push({
        id: p.id,
        label: shortName(p.name),
        say: parsed.foods[0] ? `Can we get ${parsed.foods[0]} at ${shortName(p.name)}?` : TEMPLATE.places(shortName(p.name)),
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
  await translate(person, folders, t);

  return {
    person,
    folders,
    heat: heat.points.length ? { city: person.city, points: heat.points, spots: heat.spots } : undefined,
    stats: {
      qlooCalls: t.calls,
      candidates: all.size,
      kept: folders.reduce((n, f) => n + f.cells.length, 0),
      model: curated.model ?? parseModel,
      ms: Date.now() - started,
    },
  };
}
