import "server-only";
import * as Q from "./qloo";
import { chatTools, type AgentMessage, type ToolDef } from "./llm";
import { KIND_TO_TYPE, bestMatch, suitable, TEMPLATE, TYPE_TO_FOLDER, guards, shortName } from "./agent";
import type { Board, Cell, Folder, FolderKey, TraceEvent } from "./types";
import { FOLDER_META } from "./vocab";

/**
 * The living board. A caregiver says what changed in plain language and a
 * tool-calling agent decides which Qloo-backed tools to run. This is where the
 * LLM plans; the tools are where Qloo does the work. The loop is bounded
 * (MAX_TURNS) and every tool result is summarised back to the model so it can
 * react: retry with a broader query, or stop.
 */

const MAX_TURNS = 4;

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "add_interest",
      description:
        "Add something the person now loves: a specific title/artist/game/book/public figure (e.g. 'Paw Patrol', 'Olivia Rodrigo') or a broad theme (e.g. 'dinosaurs', 'space', 'trains'). Finds it in Qloo and suggests related items across shows, movies, books and music.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The title, name or theme" },
          kind: { type: "string", enum: ["tv_show", "movie", "artist", "videogame", "book", "person", "theme"], description: "What it is. Use 'theme' for broad topics." },
        },
        required: ["name", "kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "more_like",
      description:
        "Suggest more buttons like the ones the person actually taps most. Pass the exact labels of those buttons; they become the Qloo taste signal for new suggestions in the same folders.",
      parameters: { type: "object", properties: { labels: { type: "array", items: { type: "string" } } }, required: ["labels"] },
    },
  },
  {
    type: "function",
    function: {
      name: "find_places",
      description: "Find real places in the person's city for an activity or food (e.g. 'swimming pool', 'tacos', 'quiet park', 'aquarium'), ranked by fit with their taste.",
      parameters: {
        type: "object",
        properties: {
          what: { type: "string" },
          city: { type: "string", description: "Only if the caregiver names a different city (a trip); otherwise omit." },
        },
        required: ["what"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_buttons",
      description: "Remove buttons from the board by their exact labels (e.g. things they no longer like, or that are too scary).",
      parameters: { type: "object", properties: { labels: { type: "array", items: { type: "string" } } }, required: ["labels"] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_phrases",
      description: "Add short spoken phrases to a topic folder, written in the person's voice (e.g. 'I'm tired of this show').",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", enum: ["shows", "movies", "music", "games", "books", "people", "places", "food"] },
          phrases: { type: "array", items: { type: "string" } },
        },
        required: ["folder", "phrases"],
      },
    },
  },
];

const UNKIND = /f+u+c+k|f\*+|sh[i1]t|b[i1]tch|bastard|damn|crap|idiot|stupid|dumb|moron|retard|hate you|shut up|kill|die\b|ugly|loser/i;

const ORDER: FolderKey[] = ["shows", "movies", "music", "games", "books", "people", "places", "food", "bridge"];

function folderFor(board: Board, key: FolderKey): Folder {
  let f = board.folders.find((x) => x.key === key);
  if (!f) {
    f = { key, title: FOLDER_META[key].title, cells: [], quick: [] };
    board.folders.push(f);
    board.folders.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  }
  return f;
}

function has(board: Board, id: string) {
  return board.folders.some((f) => f.cells.some((c) => c.entityId === id || c.id === id));
}

function toCell(e: Q.QlooEntity, key: FolderKey, why: string, kind: Cell["kind"], status: Cell["status"], because?: Cell["because"]): Cell {
  const label = shortName(e.name);
  return {
    id: e.id,
    label,
    say: kind === "seed" ? `I love ${label}!` : (TEMPLATE[key] ?? TEMPLATE.shows)(label),
    image: e.image,
    kind,
    entityId: e.id,
    entityType: String(e.type),
    affinity: e.affinity,
    why,
    address: e.address,
    popularity: e.popularity,
    because,
    status,
    isNew: true,
  };
}

/** A small deterministic planner, used only when the model is unavailable. */
export function rulePlan(instruction: string, board: Board): { name: string; args: Record<string, unknown> }[] {
  const plan: { name: string; args: Record<string, unknown> }[] = [];
  const labels = board.folders.flatMap((f) => f.cells.map((c) => c.label));
  let rest = instruction;
  // Quoted phrases for a folder: 'Add "Six!" and "Out!" to people'.
  const quoted = [...rest.matchAll(/["“]([^"”]{1,60})["”]/g)].map((m) => m[1].trim());
  const folder = rest.toLowerCase().match(/\bto (?:the )?(shows|movies|music|games|books|people|places|food)\b/)?.[1];
  if (quoted.length && folder) {
    plan.push({ name: "add_phrases", args: { folder, phrases: quoted } });
    rest = rest.replace(/add\b[^.;]*\bto (?:the )?\w+/i, " ");
  }
  const clauses = rest
    .split(/[.;!?\n]+|,|\s+and\s+(?=(?:remove|delete|find|add|take|get)\b)/i)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 5);
  for (const clause of clauses) {
    const low = clause.toLowerCase();
    if (/\b(remove|delete|take off|get rid of|no more)\b/.test(low)) {
      const hit = labels.filter((l) => low.includes(l.toLowerCase()));
      if (hit.length) plan.push({ name: "remove_buttons", args: { labels: hit } });
      continue;
    }
    if (/\b(find|somewhere|nearby|near (?:him|her|them|us|me)|place to|go to)\b/.test(low)) {
      const what = low
        .replace(/\b(find|a|an|the|some|somewhere|place|places|where|that|near|nearby|him|her|them|us|me|she|he|they|can|could|to|go|for|our|trip)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const city = clause.match(/\bin ([A-Z][\p{L}.'-]+(?: [A-Z][\p{L}.'-]+)*)/u)?.[1];
      const cleaned = city ? what.replace(new RegExp(`\\bin ${city.toLowerCase()}\\b`), " ").replace(/\s+/g, " ").trim() : what;
      if (cleaned) plan.push({ name: "find_places", args: city ? { what: cleaned, city } : { what: cleaned } });
      continue;
    }
    // Only a clause that clearly states an interest becomes one ("she's into horses", "add Gabby's Dollhouse").
    const m = clause.match(/(?:obsessed with|(?:is |'s |’s |are )?(?:really |totally )?into|crazy about|loves?|likes?|started (?:watching|playing|reading|listening to)|now watching|now playing|^add)\s+(.+)$/i);
    if (!m) continue;
    // "Call of Duty and Grand Theft Auto" → two interests.
    for (const part of m[1].split(/\s*(?:,|\band\b|&)\s*/i)) {
      const name = part.replace(/\b(now|lately|these days|again|too|as well|add (?:them|it))\b/gi, "").replace(/\s+/g, " ").trim();
      if (name && !/^(it|them|that|this)$/i.test(name) && name.length <= 60 && name.split(" ").length <= 6) plan.push({ name: "add_interest", args: { name, kind: "auto" } });
    }
  }
  return plan;
}

export async function refineBoard(board: Board, instruction: string, emit: (e: TraceEvent) => void) {
  const b: Board = structuredClone(board);
  b.folders.forEach((f) => f.cells.forEach((c) => delete c.isNew));
  const person = b.person;
  let step = 0;
  const changes: string[] = [];
  const done: string[] = [];

  const okForPerson = (e: Q.QlooEntity) => suitable(person.age, e);
  const seedIds = () => b.folders.flatMap((f) => f.cells.filter((c) => c.kind === "seed" && c.entityId).map((c) => c.entityId!)).slice(0, 6);

  const run = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const id = `tool-${++step}`;
    const t0 = Date.now();
    const label =
      name === "add_interest"
        ? `Adding “${args.name}”`
        : name === "more_like"
          ? "Learning from what gets tapped"
          : name === "find_places"
            ? `Finding places for “${args.what}”`
            : name === "remove_buttons"
              ? "Removing buttons"
              : "Adding phrases";
    const endpoint =
      name === "add_interest"
        ? "GET /search · /v2/tags · /v2/insights"
        : name === "more_like"
          ? "GET /v2/insights · tapped buttons as signal + explainability"
          : name === "find_places"
            ? "GET /v2/tags · /v2/insights (place)"
            : "board edit";
    emit({ id, label, endpoint, status: "running" });
    let out = "";
    try {
      if (name === "add_interest") {
        const query = String(args.name ?? "").trim().slice(0, 60);
        if (!query || /^(it|them|that|this|those|these|him|her|stuff|things?|everything|all)$/i.test(query)) return "That doesn't name anything to add.";
        const kind = String(args.kind ?? "theme");
        const type = KIND_TO_TYPE[kind];
        const added: string[] = [];
        let entity: Q.QlooEntity | undefined;
        if (kind !== "theme") {
          let hits = await Q.search(query, type, 5).catch(() => []);
          if (!hits.some((h) => TYPE_TO_FOLDER[String(h.type)] && h.type !== "place")) hits = [...hits, ...(await Q.search(query, undefined, 8).catch(() => []))];
          // Search isn't typo-tolerant, so only a close name match counts; anything else is treated as a theme.
          entity = bestMatch(query, hits, (h) => !!TYPE_TO_FOLDER[String(h.type)] && h.type !== "place" && (!type || h.type === type));
          if (!entity && type) entity = bestMatch(query, hits, (h) => !!TYPE_TO_FOLDER[String(h.type)] && h.type !== "place");
        }
        if (entity) {
          const key = TYPE_TO_FOLDER[String(entity.type)]!;
          const fits = okForPerson(entity);
          if (!has(b, entity.id)) {
            folderFor(b, key).cells.unshift(
              fits
                ? toCell(entity, key, `Added because the caregiver said: “${instruction.slice(0, 80)}”.`, "seed", "approved")
                : toCell(entity, key, `The caregiver named this, but it's rated ${entity.rating ?? "for older audiences"}, above age ${person.age}. It waits for review.`, "seed", "suggested"),
            );
            added.push(`${entity.name} (${key})`);
          }
          // Only suggest more like it when it suits the person's age.
          const rel = fits
            ? await Q.insights({ type: entity.type as Q.EntityType, entities: [entity.id], exclude: [entity.id], take: 8, explain: true, ...guards(person.stage, entity.type as Q.EntityType) }).catch(() => [])
            : [];
          for (const e of rel.filter((x) => !has(b, x.id) && okForPerson(x)).slice(0, 4)) {
            folderFor(b, key).cells.push(toCell(e, key, `Qloo affinity ${e.affinity?.toFixed(2) ?? "—"} with ${entity.name}.`, "expanded", "suggested"));
            added.push(`${e.name} (${key})`);
          }
          if (!fits) out = `${entity.name} is rated ${entity.rating ?? "for older audiences"}; added for review only. `;
        } else {
          // A theme: Qloo tag as a hard filter, the person's taste as the signal,
          // so "dinosaurs" for Maya means The Land Before Time, not Jurassic Park.
          const tags = await Q.findTags(query, 12).catch(() => []);
          const rank = (t: Q.SharedTag) =>
            /keyword:qloo/.test(t.id) ? 0 : /genre:media/.test(t.id) ? 1 : /keyword:media/.test(t.id) ? 2 : /subgenre|genre/.test(t.id) ? 3 : 9;
          const candidatesTags = tags.filter((t) => rank(t) < 9).sort((x, y) => rank(x) - rank(y)).slice(0, 3);
          if (!candidatesTags.length) return `No Qloo tag found for "${query}". Try a specific title instead.`;
          const domains: [FolderKey, Q.EntityType][] = [
            ["shows", "tv_show"],
            ["movies", "movie"],
            ["books", "book"],
          ];
          let tag = candidatesTags[0];
          const lists = await Promise.all(
            domains.map(async ([, type]) => {
              for (const t of candidatesTags) {
                const g = guards(person.stage, type);
                // Keep the age guard's tags AND the theme tag (operator defaults to OR, so try the theme alone first).
                const res = await Q.insights({ type, ...g, filterTags: [t.id], entities: seedIds().slice(0, 4), take: 6 }).catch(() => []);
                if (res.length) {
                  tag = t;
                  return res;
                }
              }
              return [] as Q.QlooEntity[];
            }),
          );
          domains.forEach(([key], i) => {
            for (const e of lists[i].filter((x) => !has(b, x.id) && okForPerson(x)).slice(0, 3)) {
              folderFor(b, key).cells.unshift(toCell(e, key, `Tagged “${tag.name}” in Qloo, and ranked by fit with ${person.name}'s taste profile.`, "expanded", "suggested"));
              added.push(`${e.name} (${key})`);
            }
          });
          out = `Theme resolved to Qloo tag "${tag.name}". `;
        }
        out += added.length ? `Added ${added.length}: ${added.join(", ")}` : "Nothing new found.";
        if (added.length) {
          const per = (["shows", "movies", "music", "games", "books"] as FolderKey[])
            .map((k) => [k, added.filter((a) => a.endsWith(`(${k})`)).length] as const)
            .filter(([, n]) => n)
            .map(([k, n]) => `${n} ${k}`);
          done.push(`added ${added.length} for “${query}”${per.length ? ` (${per.join(", ")})` : ""}`);
        }
        changes.push(...added.slice(0, 6));
      } else if (name === "more_like") {
        const labels = (Array.isArray(args.labels) ? args.labels : []).map((l) => String(l).toLowerCase());
        const used = b.folders.flatMap((f) =>
          f.cells.filter((c) => c.entityId && c.entityType && TYPE_TO_FOLDER[c.entityType] && labels.some((l) => c.label.toLowerCase() === l || c.label.toLowerCase().includes(l))),
        );
        if (!used.length) return "None of those labels are picture buttons on the board.";
        const ids = used.map((c) => c.entityId!);
        const names = new Map(used.map((c) => [c.entityId!, c.label]));
        const types = [...new Set(used.map((c) => c.entityType as Q.EntityType))].filter((t) => t !== "place").slice(0, 3);
        const onBoard = b.folders.flatMap((f) => f.cells.map((c) => c.entityId).filter(Boolean)) as string[];
        const added: string[] = [];
        await Promise.all(
          types.map(async (type) => {
            const res = await Q.insights({ type, entities: ids, exclude: onBoard, explain: true, take: 8, ...guards(person.stage, type) }).catch(() => []);
            const key = TYPE_TO_FOLDER[type]!;
            for (const e of res.filter((x) => !has(b, x.id) && okForPerson(x)).slice(0, 3)) {
              const because = e.because
                ?.filter((x) => names.has(x.id))
                .sort((x, y) => y.score - x.score)
                .map((x) => ({ name: names.get(x.id)!, share: x.score }));
              const top = because?.[0]?.name ?? [...names.values()][0];
              folderFor(b, key).cells.unshift(
                toCell(e, key, `${person.name} taps ${top} a lot, and people who love ${top} love this too (Qloo affinity ${e.affinity?.toFixed(2) ?? "—"}).`, "expanded", "suggested", because),
              );
              added.push(`${e.name} (${key})`);
            }
          }),
        );
        out = added.length ? `Added ${added.length} from what gets tapped: ${added.join(", ")}` : "Nothing new found.";
        if (added.length) done.push(`added ${added.length} more like ${[...names.values()].slice(0, 3).join(", ")}`);
        changes.push(...added.slice(0, 6));
      } else if (name === "find_places") {
        const what = String(args.what ?? "").slice(0, 60);
        const city = String(args.city ?? "").trim().slice(0, 60) || person.city;
        // "a farm or zoo" → look up "farm" and "zoo" separately; Qloo tags are single concepts.
        const parts = [...new Set([what, ...what.split(/\s*(?:,|\bor\b|\band\b|&|\/)\s*/i)].map((x) => x.trim()).filter((x) => x.length > 1))].slice(0, 3);
        const tags = (await Promise.all(parts.map((x) => Q.findTags(x, 10).catch(() => [])))).flat();
        const ranked = [
          ...tags.filter((t) => /category:place/.test(t.id) && !/contractor|supply|store|smith|repair|dealer|exit/.test(t.id)),
          ...tags.filter((t) => /genre:place:[a-z_]+$/.test(t.id) && !/genre:place:(hotel|restaurant):/.test(t.id)),
          ...tags.filter((t) => /menu_highlight|specialty_dish|cuisine|amenity/.test(t.id)),
        ].filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i);
        let places: Q.QlooEntity[] = [];
        let used: Q.SharedTag | undefined;
        for (const t of ranked.slice(0, 4)) {
          places = (await Q.insights({ type: "place", entities: seedIds(), filterTags: [t.id], location: city, take: 8 }).catch(() => [])).filter(
            Q.isHangout,
          );
          if (places.length) {
            used = t;
            break;
          }
        }
        if (!places.length) return `No places in ${city} matched "${what}".`;
        const f = folderFor(b, "places");
        const added: string[] = [];
        for (const p of places.filter((x) => !has(b, x.id)).slice(0, 4)) {
          const c = toCell(p, "places", `A real ${used?.name ?? what} place in ${city}, ranked by fit with ${person.name}'s taste.${p.address ? ` · ${p.address}` : ""}`, "place", "suggested");
          f.cells.unshift(c);
          added.push(p.name);
        }
        changes.push(...added);
        out = `Added ${added.length} places (${used?.name}): ${added.join(", ")}`;
        if (added.length) done.push(`found ${added.length} ${used?.name?.toLowerCase() ?? what} places in ${city.split(",")[0]}`);
      } else if (name === "remove_buttons") {
        const labels = (Array.isArray(args.labels) ? args.labels : []).map((l) => String(l).toLowerCase());
        const removed: string[] = [];
        for (const f of b.folders) {
          f.cells = f.cells.filter((c) => {
            const hit = labels.some((l) => c.label.toLowerCase() === l || c.label.toLowerCase().includes(l));
            if (hit) removed.push(c.label);
            return !hit;
          });
        }
        b.folders = b.folders.filter((f) => f.cells.length);
        changes.push(...removed.map((r) => `removed ${r}`));
        out = removed.length ? `Removed: ${removed.join(", ")}` : "No matching buttons.";
        if (removed.length) done.push(`removed ${removed.join(", ")}`);
      } else if (name === "add_phrases") {
        const key = String(args.folder) as FolderKey;
        const asked = (Array.isArray(args.phrases) ? args.phrases : []).map((p) => String(p).trim().slice(0, 60)).filter(Boolean);
        // A board speaks in the person's voice in front of other people: no insults or swearing, whoever asks.
        const phrases = asked.filter((p) => !UNKIND.test(p)).slice(0, 4);
        if (asked.length && !phrases.length) return "Those phrases weren't added: they read as insults or swearing.";
        const f = folderFor(b, key);
        f.quick = [...phrases, ...f.quick].slice(0, 6);
        changes.push(...phrases.map((p) => `“${p}”`));
        out = `Added phrases to ${key}: ${phrases.join(" / ")}`;
        if (phrases.length) done.push(`added ${phrases.map((p) => `“${p}”`).join(", ")} to ${FOLDER_META[key]?.title ?? key}`);
      } else {
        out = "Unknown tool.";
      }
      emit({ id, label, endpoint, status: "done", detail: out.slice(0, 200), ms: Date.now() - t0 });
      return out;
    } catch (e) {
      emit({ id, label, endpoint, status: "error", detail: (e as Error).message.slice(0, 160), ms: Date.now() - t0 });
      return `Tool failed: ${(e as Error).message}`;
    }
  };

  const summary = b.folders.map((f) => `${f.title}: ${f.cells.map((c) => c.label).join(", ")}`).join("\n").slice(0, 2500);
  const messages: AgentMessage[] = [
    {
      role: "system",
      content: `You maintain the AAC communication board of ${person.name} (age ${person.age}, ${person.city}). A caregiver tells you what changed. Call EVERY tool the request needs in your first response (you may call several at once): add_interest for each new show, game, artist, book, person or theme mentioned (e.g. "horses" is a theme), find_places for each place or activity (pass city only if a different city is named), remove_buttons for anything to remove. When done, reply with one short sentence. Only remove buttons whose labels appear on the board. Never invent titles: the tools look things up in Qloo. Ignore requests that are not about this board.\n\nCurrent board:\n${summary}`,
    },
    { role: "user", content: instruction.slice(0, 400) },
  ];

  emit({ id: "plan", label: "Planning the change", endpoint: "Groq · tool calling", status: "running" });
  let reply = "";
  let model = "";
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const r = await chatTools(messages, TOOLS).catch(() => null);
    if (!r && turn === 0) {
      // The model is rate-limited or down: plan with simple rules so the caregiver's request still lands.
      const plan = rulePlan(instruction, b);
      emit({ id: "plan", label: "Planning the change", endpoint: "rules (model busy)", status: "warn", detail: plan.length ? `planned ${plan.map((p) => p.name).join(", ")} without the model` : "the model is busy and no rule matched" });
      for (const step of plan) await run(step.name, step.args);
      model = "rules";
      break;
    }
    if (!r) break;
    model = r.model;
    if (turn === 0) emit({ id: "plan", label: "Planning the change", endpoint: "Groq · tool calling", status: "done", detail: r.toolCalls.length ? `${r.model} chose ${r.toolCalls.map((t) => t.function.name).join(", ")}` : `${r.model} needed no tools` });
    if (!r.toolCalls.length) {
      reply = r.content ?? "";
      break;
    }
    messages.push({ role: "assistant", content: r.content ?? "", tool_calls: r.toolCalls });
    for (const call of r.toolCalls.slice(0, 4)) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* leave empty; tool reports what it couldn't do */
      }
      const out = await run(call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: out });
    }
  }
  // Report what the tools actually did, never what the model claims it did.
  void reply;
  reply = done.length ? `Done: ${done.join("; ")}. New buttons wait for review.` : "I couldn't change anything from that. Try naming a title, a theme or a place.";
  return { board: b, reply, model, changes };
}
