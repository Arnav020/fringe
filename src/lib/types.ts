export type Stage = "child" | "teen" | "adult" | "older";

export type FolderKey = "shows" | "movies" | "music" | "games" | "books" | "people" | "places" | "food" | "bridge";

export type CellKind = "seed" | "expanded" | "place" | "food" | "bridge";

export interface Cell {
  id: string;
  label: string;
  say: string;
  image?: string;
  kind: CellKind;
  entityId?: string;
  entityType?: string;
  /** Plain-language reason, always grounded in a Qloo response or the caregiver's words. */
  why: string;
  affinity?: number;
  /** Age buckets with positive Qloo affinity, strongest first. */
  ages?: { bucket: string; value: number }[];
  /** Who this topic is likely to land with, derived from Qloo demographics. */
  talkWith?: string;
  address?: string;
  /** Bridge cells: Qloo age affinity for the AAC user's and the partner's age groups. */
  pair?: { user: number; partner: number };
  /** Qloo explainability: which of the person's favourites drove this pick, with their share. */
  because?: { name: string; share: number }[];
  /** Qloo popularity percentile (0–1): how widely known the topic is, i.e. how many people can join in. */
  popularity?: number;
  /** Label and phrase in the family's home language (labels from Qloo's localised names). */
  alt?: { label: string; say: string };
  /** For places found inside a taste hot-spot from the Qloo heatmap. */
  hotspot?: string;
  geo?: { lat: number; lng: number };
  /** Added by the most recent board update. */
  isNew?: boolean;
  status: "approved" | "suggested";
}

export interface Folder {
  key: FolderKey;
  title: string;
  cells: Cell[];
  /** Social-closeness phrases for this topic ("Have you seen it?"). */
  quick: string[];
  /** For bridge folders: the partner name. */
  partner?: string;
  sharedThemes?: string[];
}

export interface Person {
  name: string;
  age: number;
  city: string;
  stage: Stage;
  about?: string;
  /** Home language besides English (BCP-47 primary tag, e.g. "hi"). */
  lang?: string;
}

export interface HeatPoint {
  lat: number;
  lng: number;
  affinity: number;
}

export interface TraceEvent {
  id: string;
  label: string;
  detail?: string;
  /** Qloo or LLM endpoint touched in this step. */
  endpoint?: string;
  status: "running" | "done" | "warn" | "error";
  ms?: number;
}

export interface Board {
  person: Person;
  folders: Folder[];
  /** Qloo heatmap of where this person's taste is concentrated in their city. */
  heat?: { city: string; points: HeatPoint[]; spots: { lat: number; lng: number; label: string }[] };
  stats: { qlooCalls: number; candidates: number; kept: number; model?: string; ms: number };
}

export interface BuildInput {
  name: string;
  age: number;
  city: string;
  likes: string;
  about?: string;
  lang?: string;
}

export interface BridgeInput {
  person: Person;
  seeds: { id: string; name: string }[];
  partnerName: string;
  partnerAge: number;
  partnerLikes: string;
}

export function stageFor(age: number): Stage {
  if (age < 13) return "child";
  if (age < 20) return "teen";
  if (age < 65) return "adult";
  return "older";
}
