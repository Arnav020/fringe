import { buildBoard } from "@/lib/agent";
import { buildBridge } from "@/lib/bridge";
import { rateLimited } from "@/lib/server/stream";
import type { Board } from "@/lib/types";

/**
 * Fringe as an MCP server (Streamable HTTP, JSON responses, stateless), so an
 * existing agent can give its users culturally grounded AAC vocabulary:
 *
 *   claude mcp add --transport http fringe https://fringe-aac.vercel.app/api/mcp
 *
 * Tools return a compact text summary for the model plus the full board as
 * structured content for clients that can render or export it.
 */

export const maxDuration = 60;

const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "build_aac_board",
    description:
      "Build a personal AAC (augmentative and alternative communication) vocabulary board from what someone loves, grounded in Qloo's taste graph. Returns topic folders (shows, movies, music, games, books, people, places, food) of picture buttons with spoken phrases, each traced to a Qloo entity.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "First name of the AAC user" },
        age: { type: "number" },
        city: { type: "string", description: "City, used for real local places, e.g. 'Austin, TX'" },
        likes: { type: "string", description: "Comma-separated things they love: shows, artists, games, books, foods, people" },
      },
      required: ["name", "age", "city", "likes"],
    },
  },
  {
    name: "talk_with_partner",
    description:
      "Find conversation topics an AAC user and a specific partner (e.g. a grandparent or classmate) can both enjoy, using Qloo taste comparison and age-group affinity. Requires the user's favourite Qloo entity ids from build_aac_board.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        city: { type: "string" },
        seeds: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } },
        partnerName: { type: "string" },
        partnerAge: { type: "number" },
        partnerLikes: { type: "string" },
      },
      required: ["name", "age", "city", "seeds", "partnerName", "partnerAge", "partnerLikes"],
    },
  },
];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function summarise(b: Board) {
  return [
    `AAC board for ${b.person.name} (${b.person.age}, ${b.person.city}): ${b.stats.kept} buttons from ${b.stats.candidates} Qloo candidates.`,
    ...b.folders.map((f) => `${f.title}: ${f.cells.map((c) => `${c.label} ("${c.say}")`).join("; ")}`),
  ].join("\n");
}

async function handle(msg: Rpc) {
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "fringe", version: "1.0.0" },
        instructions: "Fringe builds culturally grounded AAC vocabulary from Qloo's taste graph. Call build_aac_board first.",
      });
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const a = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const noop = () => {};
      try {
        if (name === "build_aac_board") {
          const board = await buildBoard({ name: String(a.name ?? ""), age: Number(a.age) || 10, city: String(a.city ?? ""), likes: String(a.likes ?? "") }, noop);
          return ok(msg.id, { content: [{ type: "text", text: summarise(board) }], structuredContent: board });
        }
        if (name === "talk_with_partner") {
          const age = Number(a.age) || 10;
          const folder = await buildBridge(
            {
              person: { name: String(a.name ?? ""), age, city: String(a.city ?? ""), stage: age < 13 ? "child" : age < 20 ? "teen" : age < 65 ? "adult" : "older" },
              seeds: (Array.isArray(a.seeds) ? a.seeds : []).slice(0, 8) as { id: string; name: string }[],
              partnerName: String(a.partnerName ?? "Partner"),
              partnerAge: Number(a.partnerAge) || 40,
              partnerLikes: String(a.partnerLikes ?? ""),
            },
            noop,
          );
          const text = `${folder.title}. Shared themes: ${folder.sharedThemes?.join(", ") || "none"}.\n` + folder.cells.map((c) => `${c.label}: "${c.say}"`).join("\n");
          return ok(msg.id, { content: [{ type: "text", text }], structuredContent: folder });
        }
        return fail(msg.id, -32602, `Unknown tool: ${name}`);
      } catch (e) {
        return ok(msg.id, { content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return msg.id === undefined ? null : fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  if (rateLimited(req, 20)) return Response.json(fail(null, -32000, "Rate limited"), { status: 429 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m: Rpc) => handle(m)))).filter(Boolean);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const res = await handle(body as Rpc);
  return res ? Response.json(res) : new Response(null, { status: 202 });
}

export async function GET() {
  return new Response("Fringe MCP server. POST JSON-RPC here (Streamable HTTP, stateless).", { status: 405, headers: { Allow: "POST" } });
}
