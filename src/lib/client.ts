"use client";

import type { TraceEvent } from "./types";

/** Speak with the device's own voice (no network, works offline once loaded). `lang` is a primary tag like "hi". */
export function speak(text: string, lang = "en") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const pick =
    lang === "en"
      ? voices.find((v) => /en-US/i.test(v.lang) && /natural|neural|samantha|aria|jenny|google us/i.test(v.name)) ??
        voices.find((v) => /en[-_]US/i.test(v.lang)) ??
        voices.find((v) => /^en/i.test(v.lang))
      : voices.find((v) => new RegExp(`^${lang}`, "i").test(v.lang) && /natural|neural|google/i.test(v.name)) ??
        voices.find((v) => new RegExp(`^${lang}`, "i").test(v.lang));
  if (pick) u.voice = pick;
  u.lang = pick?.lang ?? (lang === "en" ? "en-US" : `${lang}-IN`);
  u.rate = 0.95;
  u.pitch = 1.02;
  synth.speak(u);
}

/** POST to an NDJSON agent endpoint and surface each trace line as it arrives. */
export async function runAgent<T>(url: string, body: unknown, onTrace: (e: TraceEvent) => void): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: T | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.trace) onTrace(msg.trace);
      if (msg.error) throw new Error(msg.error);
      if (msg.result) result = msg.result;
    }
  }
  if (!result) throw new Error("The agent stopped before finishing. Please try again.");
  return result;
}

export const store = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode / quota: the board still works, it just won't persist */
    }
  },
};

/** On-device tap counts per board (nothing leaves the browser until a caregiver asks for suggestions). */
export const usage = {
  key: (name: string) => `fringe:usage:${name.toLowerCase()}`,
  read(name: string): Record<string, { label: string; n: number }> {
    try {
      return JSON.parse(localStorage.getItem(usage.key(name)) ?? "{}");
    } catch {
      return {};
    }
  },
  tap(name: string, id: string, label: string) {
    try {
      const u = usage.read(name);
      u[id] = { label, n: (u[id]?.n ?? 0) + 1 };
      localStorage.setItem(usage.key(name), JSON.stringify(u));
    } catch {}
  },
  top(name: string, k = 3) {
    return Object.entries(usage.read(name))
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, k)
      .map(([id, v]) => ({ id, ...v }));
  },
};
