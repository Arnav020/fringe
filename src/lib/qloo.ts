import "server-only";
import { cacheLife } from "next/cache";

/**
 * Thin, typed client for the Qloo hackathon API.
 *
 * - Every call is a GET with query-string params (per the hackathon guide).
 * - Successful responses are cached remotely ('use cache: remote') so repeat
 *   boards are instant and we stay well inside rate limits. Errors throw and
 *   are therefore never cached.
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
}

export class QlooError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function rawGet(path: string, query: string): Promise<unknown> {
  "use cache: remote";
  cacheLife("days");
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

/** GET with one retry on 429/5xx. Params are sorted so cache keys are stable. */
export async function qlooGet(path: string, params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, String(v)]),
  ).toString();
  try {
    return await rawGet(path, qs);
  } catch (e) {
    if (e instanceof QlooError && (e.status === 429 || e.status >= 500)) {
      await new Promise((r) => setTimeout(r, 700));
      return rawGet(path, qs);
    }
    throw e;
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

function trim(r: Raw): QlooEntity {
  const p = r.properties ?? {};
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
    "filter.popularity.min": o.popularityMin,
    "filter.exclude.entities": o.exclude?.join(","),
    "signal.demographics.age": o.age,
    "bias.trends": o.biasTrends,
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
