import "server-only";
import { cacheLife } from "next/cache";

/**
 * Groq chat client (OpenAI-compatible). The free tier allows ~8K tokens/min
 * *per model*, so we walk a chain of models on 429s and keep prompts lean.
 * Results are cached remotely by prompt, so repeat boards cost nothing.
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

async function cachedJson(messages: ChatMessage[], maxTokens: number): Promise<{ model: string; json: unknown }> {
  "use cache: remote";
  cacheLife("days");
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
