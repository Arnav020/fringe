import "server-only";
import * as Q from "./qloo";
import { LANG_TEMPLATE, TEMPLATE, TYPE_TO_FOLDER, guards, shortName, suitable } from "./agent";
import type { Cell, Person, TraceEvent } from "./types";

/**
 * "This or that": find out what someone loves by letting them choose.
 *
 * Many AAC users can't say what they like, and a caregiver's note can only list what's already known.
 * Paired-stimulus preference assessment (Fisher et al., 1992) shows two items at a time and records
 * which one the person reaches for. Here the two pictures come from Qloo, and each pair adapts:
 *
 *   - "closer": more like what they just picked (the picks are the taste signal), same kind of thing
 *   - "wider":  a different kind of thing from their broader taste profile, so the session explores
 *
 * Every choice is evidence the board can use. No language model is involved: Qloo picks, the person chooses.
 */

const KINDS: Q.EntityType[] = ["tv_show", "movie", "artist", "videogame", "book"];

export interface ChooseInput {
  person: Person;
  /** Qloo ids of favourites already on the board (the wider taste signal). */
  seeds: { id: string; type: string }[];
  /** Earlier rounds: what was shown and what was picked ("none" when they chose neither). */
  history: { shown: string[]; picked?: string; pickedType?: string }[];
}

export interface ChooseRound {
  pair: Cell[];
  /** One line on why these two, for the caregiver. */
  reason: string;
  /** "Miraculous, or Onward?" in English, and in the family's language when they have one. */
  ask: string;
  askAlt?: string;
  /** What the agent did this round, for the studio's trace panel. */
  trace: TraceEvent;
}

const ASK: Record<string, (a: string, b: string) => string> = {
  hi: (a, b) => `${a} या ${b}?`,
  es: (a, b) => `¿${a} o ${b}?`,
};

function toCell(e: Q.QlooEntity, why: string, lang?: string): Cell {
  const label = shortName(e.name);
  const key = TYPE_TO_FOLDER[String(e.type)] ?? "shows";
  // Same home-language treatment as the board: Qloo's localised name, the folder's phrase pattern.
  const tpl = lang ? LANG_TEMPLATE[lang] : undefined;
  const altLabel = (lang && e.names?.[lang]) || label;
  return {
    alt: tpl ? { label: altLabel, say: (tpl[key] ?? tpl.seed!)(altLabel) } : undefined,
    id: e.id,
    label,
    say: (TEMPLATE[key] ?? TEMPLATE.shows)(label),
    image: e.image,
    kind: "expanded",
    entityId: e.id,
    entityType: String(e.type),
    affinity: e.affinity,
    popularity: e.popularity,
    why,
    status: "approved",
  };
}

export async function nextPair(input: ChooseInput): Promise<ChooseRound> {
  const t0 = Date.now();
  const { person, seeds, history } = input;
  // Only real Qloo ids: one malformed id in filter.exclude.entities makes Qloo reject the whole request.
  const isId = (x: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  const shown = new Set(history.flatMap((h) => h.shown).filter(isId));
  seeds.forEach((s) => isId(s.id) && shown.add(s.id));
  const picks = history.filter((h) => h.picked && isId(h.picked)).map((h) => ({ id: h.picked!, type: h.pickedType ?? "" }));
  const lastPick = picks.at(-1);
  const seedIds = seeds.map((s) => s.id).filter(isId).slice(0, 6);

  // Prefer a picture, a suitable rating for their age, and something not shown yet.
  const usable = (e: Q.QlooEntity) => !!e.image && !shown.has(e.id) && suitable(person.age, e) && TYPE_TO_FOLDER[String(e.type)] !== undefined;
  const fetch = (type: Q.EntityType, entities: string[]) =>
    Q.insights({ type, entities, exclude: [...shown].slice(0, 60), take: 12, explain: true, ...guards(person.stage, type) })
      .then((r) => r.filter((e) => String(e.type) === type && usable(e)))
      .catch(() => [] as Q.QlooEntity[]);

  // Closer: same kind as the last pick, steered by everything they've picked so far.
  const closerType = (KINDS.includes(lastPick?.type as Q.EntityType) ? lastPick!.type : KINDS[history.length % KINDS.length]) as Q.EntityType;
  const closerSignal = picks.length ? picks.slice(-3).map((p) => p.id) : seedIds;
  // Wider: a different kind of thing, steered by their whole profile (seeds plus picks).
  const others = KINDS.filter((k) => k !== closerType);
  const widerType = others[(history.length + picks.length) % others.length];
  const widerSignal = [...seedIds, ...picks.map((p) => p.id)].slice(-6);

  if (!closerSignal.length) throw new Error("Add at least one favourite to the board first.");
  const [closer, wider] = await Promise.all([fetch(closerType, closerSignal), fetch(widerType, widerSignal)]);
  let a: Q.QlooEntity | undefined = closer[0];
  let b = wider.find((e) => e.id !== a?.id);
  // Thin results for a kind: fall back to the next best from the other list.
  if (!a) a = wider.find((e) => e.id !== b?.id);
  if (!b) b = closer.find((e) => e.id !== a?.id);
  if (!a || !b) throw new Error("Qloo has nothing new to show right now. Try again after adding a favourite.");

  const lastLabel = lastPick ? "what they picked" : "their favourites";

  const pair = [
    toCell(a, `More like ${lastLabel} (Qloo affinity ${a.affinity?.toFixed(2) ?? "—"}).`, person.lang),
    toCell(b, `Something different from their wider taste: a ${String(b.type).replace("_", " ")} (Qloo affinity ${b.affinity?.toFixed(2) ?? "—"}).`, person.lang),
  ];
  const kind = (x: string) => x.replace("_", " ").replace("videogame", "game").replace("artist", "artist");
  return {
    pair,
    ask: `${pair[0].label}, or ${pair[1].label}?`,
    askAlt: person.lang && ASK[person.lang] ? ASK[person.lang](pair[0].alt?.label ?? pair[0].label, pair[1].alt?.label ?? pair[1].label) : undefined,
    trace: {
      id: `choose-${history.length + 1}`,
      label: `Round ${history.length + 1}: choosing the next pair`,
      endpoint: "GET /v2/insights × 2 · choices as the signal",
      status: "done",
      detail: `${kind(String(a.type))} like ${picks.length ? "their picks" : "their favourites"} → ${a.name} · ${kind(String(b.type))} from their wider taste → ${b.name}`,
      ms: Date.now() - t0,
    },
    reason: picks.length
      ? `One more like what they've been choosing, and one ${String(b.type).replace("_", " ")} to see if their taste reaches further.`
      : `One like their favourites, and one ${String(b.type).replace("_", " ")} from the same taste profile.`,
  };
}
