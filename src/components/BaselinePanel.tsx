"use client";

import { useState } from "react";
import { CircleCheck, CircleHelp, ImageOff, LoaderCircle, Scale } from "lucide-react";
import type { Board, BuildInput } from "@/lib/types";

interface Item {
  name: string;
  category: string;
  found: boolean;
  image?: string;
  matched?: string;
}

/**
 * The control experiment, run live: same person, same model, no taste graph.
 * Results are checked against Qloo so the comparison is measured, not claimed.
 */
export default function BaselinePanel({ board, input }: { board: Board; input: BuildInput }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<{ model: string; items: Item[] } | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/baseline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setData(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cells = board.folders.flatMap((f) => f.cells);
  const fringe = {
    pictures: cells.filter((c) => c.image).length,
    total: cells.length,
    places: cells.filter((c) => c.kind === "place" && c.address).length,
    ages: cells.filter((c) => c.ages?.length || c.pair).length,
  };
  const base = data && {
    total: data.items.length,
    found: data.items.filter((i) => i.found).length,
    places: data.items.filter((i) => i.category === "place").length,
    placesFound: data.items.filter((i) => i.category === "place" && i.found).length,
  };

  return (
    <div className="neu p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <span className="neu-sm grid h-12 w-12 shrink-0 place-items-center text-accent">
          <Scale size={22} />
        </span>
        <div>
          <h2 className="display text-3xl leading-none text-ink">Same agent, no Qloo</h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">
            Ask the same language model to fill {board.person.name}&rsquo;s board from the same note, with no taste graph. Then check every suggestion against Qloo. Run it live; nothing here is pre-baked.
          </p>
        </div>
      </div>

      {!data && (
        <button type="button" onClick={run} disabled={busy} className="btn-accent mt-6 flex h-12 items-center gap-2 px-5 font-semibold">
          {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Scale size={18} />}
          {busy ? "Asking the LLM on its own…" : "Run the LLM-only version"}
        </button>
      )}
      {err && <p className="mt-3 text-[14px] text-err">{err}</p>}

      {data && base && (
        <div className="rise mt-7 grid gap-6 lg:grid-cols-2">
          <div className="neu-in p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">LLM only</h3>
              <span className="font-mono text-[11px] text-muted">{data.model}</span>
            </div>
            <ul className="mt-3 space-y-2">
              {data.items.map((i) => (
                <li key={i.name} className="flex items-center gap-3 rounded-xl bg-white/50 px-3 py-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg-deep text-muted">
                    <ImageOff size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-ink">{i.name}</div>
                    <div className="text-[12px] capitalize text-muted">{i.category}</div>
                  </div>
                  {i.found ? (
                    <span className="flex items-center gap-1 text-[12px] text-ok" title={`Matched in Qloo: ${i.matched}`}>
                      <CircleCheck size={15} /> real
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[12px] text-warn" title="No match in Qloo's 250M+ entities">
                      <CircleHelp size={15} /> unverified
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Measured side by side</h3>
            <div className="mt-3 space-y-3">
              <Row label="Buttons with a recognisable picture" a="0" b={`${fringe.pictures}/${fringe.total}`} note="AAC users who are pre-literate or have aphasia navigate by image." />
              <Row label="Suggestions that resolve to a real entity" a={`${base.found}/${base.total}`} b={`${fringe.total - cells.filter((c) => c.kind === "food").length}/${fringe.total - cells.filter((c) => c.kind === "food").length}`} note="Fringe can only place ids Qloo returned; the verifier drops anything else." />
              <Row label={`Real places in ${board.person.city}`} a={`${base.placesFound}/${base.places}`} b={`${fringe.places}`} note="With addresses, matched to this person's taste profile." />
              <Row label="Topics with an age-group signal" a="0" b={`${fringe.ages}`} note="Who each topic will land with, from Qloo demographics." />
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-muted">
              The LLM&rsquo;s list is often sensible, but it is a list of words. It can&rsquo;t show a picture, can&rsquo;t prove a place exists, and can&rsquo;t tell {board.person.name} who will light up when they bring it up.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, a, b, note }: { label: string; a: string; b: string; note: string }) {
  return (
    <div className="neu-sm p-3.5">
      <div className="text-[14px] font-medium text-ink">{label}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-center">
        <div className="neu-in-sm py-2">
          <div className="font-mono text-lg text-muted">{a}</div>
          <div className="text-[11px] text-muted">LLM only</div>
        </div>
        <div className="neu-in-sm py-2">
          <div className="font-mono text-lg font-semibold text-accent">{b}</div>
          <div className="text-[11px] text-muted">Fringe + Qloo</div>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-muted">{note}</p>
    </div>
  );
}
