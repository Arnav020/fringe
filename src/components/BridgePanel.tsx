"use client";

import { useState } from "react";
import { HeartHandshake, LoaderCircle } from "lucide-react";
import type { Board, Folder, TraceEvent } from "@/lib/types";
import { runAgent } from "@/lib/client";
import Trace, { upsertTrace } from "./Trace";

interface Props {
  board: Board;
  defaults: { name: string; age: number; relation: string; likes: string };
  onFolder: (f: Folder) => void;
}

const field = "neu-in-sm w-full px-3.5 py-3 text-[15px] text-ink placeholder:text-muted/70 outline-none focus-visible:outline-none";

export default function BridgePanel({ board, defaults, onFolder }: Props) {
  const [name, setName] = useState(defaults.name);
  const [age, setAge] = useState(defaults.age);
  const [likes, setLikes] = useState(defaults.likes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [result, setResult] = useState<Folder | null>(null);

  const seeds = board.folders.flatMap((f) => f.cells.filter((c) => c.kind === "seed" && c.entityId).map((c) => ({ id: c.entityId!, name: c.label })));

  const run = async () => {
    setBusy(true);
    setErr(null);
    setTrace([]);
    try {
      const folder = await runAgent<Folder>(
        "/api/bridge",
        { person: board.person, seeds, partnerName: name, partnerAge: age, partnerLikes: likes },
        (e) => setTrace((t) => upsertTrace(t, e)),
      );
      setResult(folder);
      onFolder(folder);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="neu p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <span className="neu-sm grid h-12 w-12 shrink-0 place-items-center text-accent">
          <HeartHandshake size={22} />
        </span>
        <div>
          <h2 className="display text-3xl leading-none text-ink">Talk with someone specific</h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
            A board that only knows {board.person.name}&rsquo;s taste helps them talk <i>at</i> people. This builds a page for one conversation partner: Qloo compares both taste profiles, searches with both as the signal, and keeps
            topics with positive affinity in <b className="text-ink-2">both</b> people&rsquo;s age groups.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_120px]">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">Partner&rsquo;s name</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">Age</span>
          <input className={field} type="number" min={3} max={100} value={age} onChange={(e) => setAge(Number(e.target.value))} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">What {name || "they"} loves</span>
          <input className={field} value={likes} onChange={(e) => setLikes(e.target.value)} placeholder="Johnny Cash, True Grit, BBQ brisket" />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !likes.trim() || !seeds.length} onClick={run} className="btn-accent flex h-12 items-center gap-2 px-5 font-semibold">
          {busy ? <LoaderCircle size={18} className="animate-spin" /> : <HeartHandshake size={18} />}
          {busy ? "Finding common ground…" : `Build “Talk with ${name || "…"}”`}
        </button>
        {err && <span className="text-[14px] text-err">{err}</span>}
      </div>

      {(trace.length > 0 || result) && (
        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="neu-in p-4">
            <Trace events={trace} title="Bridge agent" />
          </div>
          {result && (
            <div className="rise">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Shared ground, measured</h3>
              <p className="mt-1 text-[13px] text-muted">Qloo age affinity: {board.person.name}&rsquo;s age group vs {name}&rsquo;s</p>
              <div className="mt-3 space-y-2.5">
                {result.cells
                  .filter((c) => c.pair)
                  .map((c) => (
                    <div key={c.id} className="flex items-center gap-3">
                      {c.image ? <img src={c.image} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-lg bg-accent-soft" />}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium text-ink">{c.label}</div>
                        <div className="mt-1 grid grid-cols-2 gap-1.5">
                          <Bar v={c.pair!.user} label={board.person.name} tone="#d9482b" />
                          <Bar v={c.pair!.partner} label={name} tone="#3f6fb5" />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
              <p className="mt-4 text-[13px] text-muted">The new page has been added to {board.person.name}&rsquo;s board as a folder.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Bar({ v, label, tone }: { v: number; label: string; tone: string }) {
  const w = Math.min(100, Math.abs(v) * 160);
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${v > 0 ? "+" : ""}${Math.round(v * 100)}`}>
      <div className="neu-in-sm relative h-2.5 flex-1 overflow-hidden p-0">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v > 0 ? w : 0}%`, background: tone, opacity: v > 0 ? 0.9 : 0 }} />
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[11px] text-muted">
        {v > 0 ? "+" : ""}
        {Math.round(v * 100)}
      </span>
    </div>
  );
}
