import "server-only";
import * as Q from "./qloo";
import { chatTools, type AgentMessage, type ToolDef } from "./llm";
import { KIND_TO_TYPE, TEMPLATE, TYPE_TO_FOLDER, guards, shortName } from "./agent";
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
      name: "find_places",
      description: "Find real places in the person's city for an activity or food (e.g. 'swimming pool', 'tacos', 'quiet park', 'aquarium'), ranked by fit with their taste.",
      parameters: { type: "object", properties: { what: { type: "string" } }, required: ["what"] },
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

function toCell(e: Q.QlooEntity, key: FolderKey, why: string, kind: Cell["kind"], status: Cell["status"]): Cell {
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
    status,
    isNew: true,
  };
}

export async function refineBoard(board: Board, instruction: string, emit: (e: TraceEvent) => void) {
  const b: Board = structuredClone(board);
  b.folders.forEach((f) => f.cells.forEach((c) => delete c.isNew));
  const person = b.person;
  let step = 0;
  const changes: string[] = [];
  const done: string[] = [];

  const seedIds = () => b.folders.flatMap((f) => f.cells.filter((c) => c.kind === "seed" && c.entityId).map((c) => c.entityId!)).slice(0, 6);

  const run = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const id = `tool-${++step}`;
    const t0 = Date.now();
    const label =
      name === "add_interest" ? `Adding “${args.name}”` : name === "find_places" ? `Finding places for “${args.what}”` : name === "remove_buttons" ? "Removing buttons" : "Adding phrases";
    const endpoint =
      name === "add_interest" ? "GET /search · /v2/tags · /v2/insights" : name === "find_places" ? "GET /v2/tags · /v2/insights (place)" : "board edit";
    emit({ id, label, endpoint, status: "running" });
    let out = "";
    try {
      if (name === "add_interest") {
        const query = String(args.name ?? "").slice(0, 60);
        const kind = String(args.kind ?? "theme");
        const type = KIND_TO_TYPE[kind];
        const added: string[] = [];
        let entity: Q.QlooEntity | undefined;
        if (kind !== "theme") {
          const hits = await Q.search(query, type, 5).catch(() => []);
          entity = hits.find((h) => TYPE_TO_FOLDER[String(h.type)]);
        }
        if (entity) {
          const key = TYPE_TO_FOLDER[String(entity.type)]!;
          if (!has(b, entity.id)) {
            folderFor(b, key).cells.unshift(toCell(entity, key, `Added because the caregiver said: “${instruction.slice(0, 80)}”.`, "seed", "approved"));
            added.push(`${entity.name} (${key})`);
          }
          const rel = await Q.insights({ type: entity.type as Q.EntityType, entities: [entity.id], exclude: [entity.id], take: 6, ...guards(person.stage, entity.type as Q.EntityType) }).catch(() => []);
          for (const e of rel.filter((x) => !has(b, x.id)).slice(0, 4)) {
            folderFor(b, key).cells.push(toCell(e, key, `Qloo affinity ${e.affinity?.toFixed(2) ?? "—"} with ${entity.name}.`, "expanded", "suggested"));
            added.push(e.name);
          }
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
            for (const e of lists[i].filter((x) => !has(b, x.id)).slice(0, 3)) {
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
      } else if (name === "find_places") {
        const what = String(args.what ?? "").slice(0, 60);
        const tags = await Q.findTags(what, 10).catch(() => []);
        const ranked = [
          ...tags.filter((t) => /category:place/.test(t.id) && !/contractor|supply|store/.test(t.id)),
          ...tags.filter((t) => /genre:place:[a-z_]+$/.test(t.id) && !/genre:place:(hotel|restaurant):/.test(t.id)),
          ...tags.filter((t) => /menu_highlight|specialty_dish|cuisine|amenity/.test(t.id)),
        ];
        let places: Q.QlooEntity[] = [];
        let used: Q.SharedTag | undefined;
        for (const t of ranked.slice(0, 3)) {
          places = (await Q.insights({ type: "place", entities: seedIds(), filterTags: [t.id], location: person.city, take: 8 }).catch(() => [])).filter(
            Q.isHangout,
          );
          if (places.length) {
            used = t;
            break;
          }
        }
        if (!places.length) return `No places in ${person.city} matched "${what}".`;
        const f = folderFor(b, "places");
        const added: string[] = [];
        for (const p of places.filter((x) => !has(b, x.id)).slice(0, 4)) {
          const c = toCell(p, "places", `A real ${used?.name ?? what} place in ${person.city}, ranked by fit with ${person.name}'s taste.${p.address ? ` · ${p.address}` : ""}`, "place", "suggested");
          f.cells.unshift(c);
          added.push(p.name);
        }
        changes.push(...added);
        out = `Added ${added.length} places (${used?.name}): ${added.join(", ")}`;
        if (added.length) done.push(`found ${added.length} ${used?.name?.toLowerCase() ?? what} places in ${person.city.split(",")[0]}`);
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
        const phrases = (Array.isArray(args.phrases) ? args.phrases : []).map((p) => String(p).slice(0, 60)).slice(0, 4);
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
      content: `You maintain the AAC communication board of ${person.name} (age ${person.age}, ${person.city}). A caregiver tells you what changed. Call EVERY tool the request needs in your first response (you may call several at once). When done, reply with one short sentence. Only remove buttons whose labels appear on the board. Never invent titles: add_interest and find_places look things up in Qloo for you.\n\nCurrent board:\n${summary}`,
    },
    { role: "user", content: instruction.slice(0, 400) },
  ];

  emit({ id: "plan", label: "Planning the change", endpoint: "Groq · tool calling", status: "running" });
  let reply = "";
  let model = "";
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const r = await chatTools(messages, TOOLS).catch((e: Error) => {
      emit({ id: "plan", label: "Planning the change", status: "error", detail: e.message.slice(0, 160) });
      return null;
    });
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
