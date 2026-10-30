"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Hand, LoaderCircle, RotateCcw, Shuffle, Volume2 } from "lucide-react";
import type { Board, Cell } from "@/lib/types";
import { runAgent, speak } from "@/lib/client";

const ROUNDS = 6;

interface Round {
  pair: Cell[];
  reason: string;
}

interface Props {
  board: Board;
  /** Add the chosen cells to the board, then let the refine agent suggest more like them. */
  onAdd: (picks: { cell: Cell; over: string }[]) => Board;
  onBoard: (b: Board) => void;
  onDone: () => void;
}

/**
 * "This or that": a paired-choice preference session. Two pictures from Qloo at a time; the person
 * chooses; the next pair adapts to what they chose. For people who can't tell anyone what they like.
 */
export default function ChoosePanel({ board, onAdd, onBoard, onDone }: Props) {
  const [round, setRound] = useState<Round | null>(null);
  const [history, setHistory] = useState<{ shown: string[]; picked?: string; pickedType?: string }[]>([]);
  const [picks, setPicks] = useState<{ cell: Cell; over: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const started = useRef(false);

  const seeds = board.folders.flatMap((f) =>
    f.cells.filter((c) => c.entityId && c.entityType && c.entityType !== "place" && c.entityType !== "brand" && (c.kind === "seed" || c.status === "approved")).map((c) => ({ id: c.entityId!, type: c.entityType! })),
  );
  const done = history.length >= ROUNDS;

  const next = useCallback(
    async (h: typeof history) => {
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch("/api/choose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ person: board.person, seeds: seeds.slice(0, 8), history: h }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Couldn't load the next pair.");
        setRound(j);
        speak(`${j.pair[0].label}, or ${j.pair[1].label}?`);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
        setChosen(null);
      }
    },
    [board.person, seeds],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    next([]);
  }, [next]);

  const choose = (c: Cell | null) => {
    if (!round || busy || chosen) return;
    const other = round.pair.find((x) => x.id !== c?.id);
    if (c) {
      speak(c.label);
      setChosen(c.id);
      setPicks((p) => [...p, { cell: c, over: other?.label ?? "" }]);
    }
    const h = [...history, { shown: round.pair.map((x) => x.entityId!), picked: c?.entityId, pickedType: c?.entityType }];
    setHistory(h);
    setTimeout(() => (h.length >= ROUNDS ? setRound(null) : next(h)), c ? 650 : 0);
  };

  const restart = () => {
    setHistory([]);
    setPicks([]);
    setAdded(null);
    next([]);
  };

  const addToBoard = async () => {
    if (!picks.length) return;
    setAdding(true);
    try {
      const withPicks = onAdd(picks);
      // The picks are now on the board; the refine agent's more_like tool uses them as the Qloo signal.
      const r = await runAgent<{ board: Board; reply: string }>(
        "/api/refine",
        { board: withPicks, instruction: `${board.person.name} picked these in This or that: ${picks.map((p) => p.cell.label).join(", ")}. Suggest more like them.` },
        () => {},
      ).catch(() => null);
      if (r?.board) onBoard(r.board);
      setAdded(r?.reply ?? `Added ${picks.length} picks to the board.`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="neu p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="display text-3xl leading-none text-ink">This or that</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
            For when {board.person.name} can&rsquo;t tell you what they like. Show two pictures, let them reach for one. Qloo picks each pair from their taste graph and the next pair follows what they chose.
          </p>
        </div>
        <div className="flex items-center gap-1.5" aria-label={`Round ${Math.min(history.length + 1, ROUNDS)} of ${ROUNDS}`}>
          {Array.from({ length: ROUNDS }).map((_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < history.length ? "bg-accent" : "bg-line"}`} />
          ))}
        </div>
      </div>

      {err && (
        <p className="mt-5 text-[14px] text-err">
          {err}{" "}
          <button type="button" className="font-semibold underline" onClick={() => next(history)}>
            Try again
          </button>
        </p>
      )}

      {!done && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-6">
            {(round?.pair ?? [null, null]).map((c, i) =>
              c ? (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => choose(c)}
                  disabled={busy || !!chosen}
                  className={`key rise p-2 sm:p-3 text-left transition ${chosen === c.id ? "ring-4 ring-accent" : chosen ? "opacity-40" : ""}`}
                  aria-label={`Choose ${c.label}`}
                >
                  <div className="aspect-square overflow-hidden rounded-[14px] bg-bg-deep">
                    <img src={c.image} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="px-1 pt-3 pb-1 text-lg sm:text-2xl font-semibold leading-tight text-ink">{c.label}</div>
                  <div className="px-1 pb-1 text-[12.5px] text-muted">{c.why}</div>
                </button>
              ) : (
                <div key={i} className="neu-sm grid aspect-square place-items-center">
                  <LoaderCircle className="animate-spin text-accent" />
                </div>
              ),
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted">{round?.reason}</p>
            <div className="flex gap-2">
              <button type="button" disabled={!round || busy} onClick={() => round && speak(`${round.pair[0].label}, or ${round.pair[1].label}?`)} className="neu-btn flex h-10 items-center gap-1.5 px-3 text-[13px] font-semibold text-ink-2">
                <Volume2 size={15} /> Ask again
              </button>
              <button type="button" disabled={!round || busy || !!chosen} onClick={() => choose(null)} className="neu-btn flex h-10 items-center gap-1.5 px-3 text-[13px] font-semibold text-ink-2">
                <Shuffle size={15} /> Neither
              </button>
            </div>
          </div>
        </>
      )}

      {done && (
        <div className="rise mt-6">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Hand size={17} className="text-accent" /> What {board.person.name} chose
          </div>
          {picks.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {picks.map((p) => (
                <li key={p.cell.id} className="neu-in-sm flex items-center gap-3 p-2">
                  {p.cell.image && <img src={p.cell.image} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{p.cell.label}</div>
                    <div className="truncate text-[12.5px] text-muted">over {p.over}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14px] text-muted">No picks this time. Try again later, or with different favourites.</p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            {picks.length > 0 && !added && (
              <button type="button" onClick={addToBoard} disabled={adding} className="btn-accent flex h-12 items-center gap-2 px-5 font-semibold">
                {adding ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={18} />}
                {adding ? "Adding and finding more like them…" : `Add ${picks.length} picks to the board`}
              </button>
            )}
            {added && (
              <button type="button" onClick={onDone} className="btn-accent flex h-12 items-center gap-2 px-5 font-semibold">
                <Check size={18} /> See the board
              </button>
            )}
            <button type="button" onClick={restart} className="neu-btn flex h-12 items-center gap-2 px-4 text-[14px] font-semibold text-ink-2">
              <RotateCcw size={16} /> Play again
            </button>
          </div>
          {added && <p className="rise mt-3 text-[13.5px] text-ok">{added}</p>}
        </div>
      )}
    </div>
  );
}
