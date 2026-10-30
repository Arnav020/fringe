import "server-only";
import { memo } from "./server/memo";

/**
 * Groq chat client (OpenAI-compatible). The free tier allows ~8K tokens/min
 * *per model*, so we walk a chain of models on 429s and keep prompts lean.
 * Results are cached in memory by prompt, so repeat boards cost nothing.
 */

const MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

class LlmError extends Error {}

async function callModel(model: string, messages: ChatMessage[], maxTokens: number) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new LlmError("GROQ_API_KEY is not set");
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.4,
    response_format: { type: "json_object" },
  };
  if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
  if (model.startsWith("qwen/")) body.reasoning_effort = "none";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new LlmError(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";
  return JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
}

function cachedJson(messages: ChatMessage[], maxTokens: number): Promise<{ model: string; json: unknown }> {
  return memo(`llm:${maxTokens}:${JSON.stringify(messages)}`, 24 * 3600_000, () => firstModel(messages, maxTokens));
}

async function firstModel(messages: ChatMessage[], maxTokens: number): Promise<{ model: string; json: unknown }> {
  const errors: string[] = [];
  for (const model of MODELS) {
    try {
      return { model, json: await callModel(model, messages, maxTokens) };
    } catch (e) {
      errors.push(String((e as Error).message));
    }
  }
  throw new LlmError(errors.join(" | "));
}

/** Ask for a JSON object. Returns null (never throws) so callers can fall back deterministically. */
export async function chatJson<T>(
  messages: ChatMessage[],
  maxTokens = 1500,
): Promise<{ model: string; data: T } | null> {
  try {
    const r = await cachedJson(messages, maxTokens);
    return { model: r.model, data: r.json as T };
  } catch (e) {
    console.error("[llm]", (e as Error).message);
    return null;
  }
}

/* ---------- tool calling (for the refine agent) ---------- */

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** One agent turn with tools. Walks the model chain on errors/rate limits. */
export async function chatTools(messages: AgentMessage[], tools: ToolDef[], maxTokens = 700) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new LlmError("GROQ_API_KEY is not set");
  const errors: string[] = [];
  for (const model of MODELS) {
    const body: Record<string, unknown> = { model, messages, tools, tool_choice: "auto", max_tokens: maxTokens, temperature: 0.2 };
    if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";
    if (model.startsWith("qwen/")) body.reasoning_effort = "none";
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new LlmError(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const msg = data.choices?.[0]?.message ?? {};
      return { model, content: (msg.content as string | null) ?? null, toolCalls: (msg.tool_calls as ToolCall[] | undefined) ?? [] };
    } catch (e) {
      errors.push(String((e as Error).message));
    }
  }
  throw new LlmError(errors.join(" | "));
}
