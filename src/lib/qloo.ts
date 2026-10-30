import "server-only";
import { memo } from "./server/memo";

/**
 * Thin, typed client for the Qloo hackathon API.
 *
 * - Every call is a GET with query-string params (per the hackathon guide).
 * - Successful responses are cached in memory for a day (private server-side
 *   caching is allowed by the hackathon terms), so repeat boards are instant
 *   and we stay inside rate limits. Errors are never cached.
 * - Responses are trimmed to the handful of fields the agent needs.
 */

const BASE = "https://hackathon.api.qloo.com";

export type EntityType =
  | "artist"
  | "book"
  | "brand"
  | "destination"
  | "movie"
  | "person"
  | "place"
  | "podcast"
  | "tv_show"
  | "videogame";

export interface QlooEntity {
  id: string;
  name: string;
  type: EntityType | string;
  image?: string;
  affinity?: number;
  popularity?: number;
  description?: string;
  address?: string;
  kidFriendly?: boolean;
  tags?: string[];
  /** Qloo explainability: how much each signal entity contributed to this result (shares sum to ~1). */
  because?: { id: string; score: number }[];
  /** Localised names Qloo knows for this entity (e.g. { hi: "छोटा भीम" }). */
  names?: Record<string, string>;
  lat?: number;
  lng?: number;
  /** Content rating as Qloo stores it (MPAA/TV for film, ESRB for games). */
  rating?: string;
}

export class QlooError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function rawGet(path: string, query: string): Promise<unknown> {
  return memo(`q:${path}?${query}`, 24 * 3600_000, () => limited(() => fetchQloo(path, query)));
}

/** At most MAX_IN_FLIGHT Qloo requests at once per instance, so a burst of boards queues instead of hitting 429s. */
const MAX_IN_FLIGHT = 8;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

async function fetchQloo(path: string, query: string): Promise<unknown> {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new QlooError(500, "QLOO_API_KEY is not set");
  const res = await fetch(`${BASE}${path}?${query}`, {
    headers: { "X-Api-Key": key },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new QlooError(res.status, body.slice(0, 300));
  }
  return res.json();
}

/** GET with up to two retries (backoff with jitter) on 429/5xx. Params are sorted so cache keys are stable. */
export async function qlooGet(path: string, params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawGet(path, qs);
    } catch (e) {
      const retryable = e instanceof QlooError && (e.status === 429 || e.status >= 500);
      if (!retryable || attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1) + Math.random() * 400));
    }
  }
}

/* ---------- trimming helpers ---------- */

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function typeOf(r: Raw): string {
  const t: string = r.subtype ?? r.types?.[0] ?? r.type ?? "";
  return t.replace("urn:entity:", "");
}

function imageOf(r: Raw): string | undefined {
  return r.properties?.image?.url ?? r.properties?.images?.[0]?.url ?? undefined;
}

const LANGS = ["hi", "es", "mr", "ta", "bn"];

function trim(r: Raw): QlooEntity {
  const p = r.properties ?? {};
  const names: Record<string, string> = {};
  for (const a of Array.isArray(p.akas) ? p.akas : []) {
    if (LANGS.includes(a.language) && !names[a.language] && a.value) names[a.language] = String(a.value).trim();
  }
  const because = r.query?.explainability?.["signal.interests.entities"];
  return {
    id: r.entity_id,
    name: r.name,
    type: typeOf(r),
    image: imageOf(r),
    affinity: r.query?.affinity,
    popularity: r.popularity,
    description: p.short_description ?? p.description,
    address: p.address,
    kidFriendly: Array.isArray(p.good_for)
      ? p.good_for.some((g: Raw) => String(g.id).includes("good_kids"))
      : undefined,
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 6).map((t: Raw) => t.name) : undefined,
    because: Array.isArray(because) ? because.map((b: Raw) => ({ id: b.entity_id, score: b.score })) : undefined,
    names: Object.keys(names).length ? names : undefined,
    rating: typeof p.content_rating === "string" ? p.content_rating : undefined,
    lat: r.location?.lat ?? p.geocode?.latitude,
    lng: r.location?.lon ?? p.geocode?.longitude,
  };
}

/* ---------- endpoints ---------- */

/** /search — free text → entities (with images). */
export async function search(query: string, type?: EntityType, take = 5): Promise<QlooEntity[]> {
  const d = (await qlooGet("/search", {
    query,
    types: type ? `urn:entity:${type}` : undefined,
    take,
  })) as Raw;
  return (d.results ?? []).map(trim);
}

export interface InsightOptions {
  type: EntityType;
  entities?: string[];
  tags?: string[];
  take?: number;
  location?: string;
  contentRating?: string;
  filterTags?: string[];
  popularityMin?: number;
  age?: string;
  biasTrends?: "low" | "medium" | "high";
  exclude?: string[];
  /** Ask Qloo which signal entities drove each result (feature.explainability). */
  explain?: boolean;
  /** Restrict places to a geohash cell, e.g. a taste hot-spot from the heatmap. */
  geohash?: string;
  /** Qloo audience URNs used as an extra signal (signal.demographics.audiences). */
  audiences?: string[];
  /** Match any of filterTags instead of all of them. */
  anyTag?: boolean;
}

/** /v2/insights — taste-graph recommendations for one entity type. */
export async function insights(o: InsightOptions): Promise<QlooEntity[]> {
  const d = (await qlooGet("/v2/insights", {
    "filter.type": `urn:entity:${o.type}`,
    "signal.interests.entities": o.entities?.join(","),
    "signal.interests.tags": o.tags?.join(","),
    "filter.location.query": o.location,
    "filter.content_rating": o.contentRating,
    "filter.tags": o.filterTags?.join(","),
    "operator.filter.tags": o.anyTag && o.filterTags?.length ? "union" : undefined,
    "filter.popularity.min": o.popularityMin,
    "filter.exclude.entities": o.exclude?.join(","),
    "signal.demographics.age": o.age,
    "bias.trends": o.biasTrends,
    "feature.explainability": o.explain ? "true" : undefined,
    "filter.location.geohash": o.geohash,
    "signal.demographics.audiences": o.audiences?.join(","),
    take: o.take ?? 8,
  })) as Raw;
  return (d.results?.entities ?? []).map(trim);
}

export const AGE_BUCKETS = [
  "24_and_younger",
  "25_to_29",
  "30_to_34",
  "35_to_44",
  "45_to_54",
  "55_and_older",
] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export interface Demographic {
  id: string;
  age: Record<AgeBucket, number>;
  gender: { male: number; female: number };
}

/** /v2/insights?filter.type=urn:demographics — which ages light up for each signal. */
export async function demographics(ids: string[]): Promise<Demographic[]> {
  if (!ids.length) return [];
  const d = (await qlooGet("/v2/insights", {
    "filter.type": "urn:demographics",
    "signal.interests.entities": ids.join(","),
  })) as Raw;
  return (d.results?.demographics ?? []).map((b: Raw) => ({
    id: b.entity_id,
    age: b.query?.age ?? {},
    gender: b.query?.gender ?? { male: 0, female: 0 },
  }));
}

/** Map an age in years to Qloo's age bucket for signal.demographics.age. */
export function ageBucket(age: number): AgeBucket {
  if (age <= 24) return "24_and_younger";
  if (age <= 29) return "25_to_29";
  if (age <= 34) return "30_to_34";
  if (age <= 44) return "35_to_44";
  if (age <= 54) return "45_to_54";
  return "55_and_older";
}

export interface HeatCell {
  lat: number;
  lng: number;
  geohash: string;
  affinity: number;
  popularity: number;
}

/** /v2/insights?filter.type=urn:heatmap — where in a city this taste is concentrated. */
export async function heatmap(ids: string[], location: string, take = 50): Promise<HeatCell[]> {
  if (!ids.length) return [];
  const d = (await qlooGet("/v2/insights", {
    "filter.type": "urn:heatmap",
    "signal.interests.entities": ids.join(","),
    "filter.location.query": location,
    "output.heatmap.boundary": "urn:geohash",
    take,
  })) as Raw;
  return (d.results?.heatmap ?? []).map((h: Raw) => ({
    lat: h.location?.latitude,
    lng: h.location?.longitude,
    geohash: h.location?.geohash,
    affinity: h.query?.affinity ?? 0,
    popularity: h.query?.popularity ?? 0,
  }));
}

export interface SharedTag {
  id: string;
  name: string;
  subtype: string;
}

/** /v2/analysis/compare — the taste tags two groups of entities share. */
export async function compare(a: string[], b: string[], take = 20) {
  const d = (await qlooGet("/v2/analysis/compare", {
    "a.signal.interests.entities": a.join(","),
    "b.signal.interests.entities": b.join(","),
    take,
  })) as Raw;
  const map = (arr: Raw[] | undefined): SharedTag[] =>
    (arr ?? []).map((t) => ({ id: t.tag_id, name: t.name, subtype: t.subtype }));
  return { shared: map(d.results?.tags), a: map(d.results?.a), b: map(d.results?.b) };
}

/** /v2/tags — keyword → tag ids (e.g. "pizza" → cuisine tags for place filters). */
export async function findTags(query: string, take = 5): Promise<SharedTag[]> {
  const d = (await qlooGet("/v2/tags", { "filter.query": query, take })) as Raw;
  return (d.results?.tags ?? []).map((t: Raw) => ({ id: t.id, name: t.name, subtype: t.type }));
}

/** Place categories that suit an outing with a child or teen (used with operator.filter.tags=union). */
const KID_CATEGORIES = ["park", "playground", "zoo", "museum", "aquarium", "amusement_park", "ice_cream_shop", "toy_store", "bowling_alley", "water_park", "library", "childrens_museum", "science_museum", "swimming_pool", "botanical_garden", "beach"];
const TEEN_EXTRA = ["arcade", "movie_theater", "skate_park", "stadium", "trampoline_park", "book_store"];
export function outingTags(stage: string): string[] | undefined {
  if (stage === "child") return KID_CATEGORIES.map((c) => `urn:tag:category:place:${c}`);
  if (stage === "teen") return [...KID_CATEGORIES, ...TEEN_EXTRA].map((c) => `urn:tag:category:place:${c}`);
  return undefined;
}

/** Places that are not somewhere you'd suggest going together: lodging, bars, transit, venues for business. */
const NOT_A_HANGOUT =
  /hotel|\binn\b|suites|motel|hostel|resort|marriott|hyatt|hilton|aloft|sheraton|westin|by ihg|holiday inn|doubletree|\bbar\b|\bpub\b|lounge|casino|nightclub|airport|convention|terminal|station\b|drinks|brewery|brewing|tap ?room|tap ?house|winery|wine bar|liquor|beer|cocktail|disney world|school\b|college|university|hospital|clinic|office/i;
/** Unnamed places come back as Google plus codes ("WRMH+9M8"). */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}/;

export function isHangout(e: QlooEntity) {
  return !NOT_A_HANGOUT.test(e.name) && !PLUS_CODE.test(e.name);
}
