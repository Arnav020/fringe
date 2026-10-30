"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, LoaderCircle, Pencil, RotateCcw, ShieldCheck, Sparkles, UserRound, Wand2 } from "lucide-react";
import type { Board, BuildInput, Cell, Folder, TraceEvent } from "@/lib/types";
import { PERSONAS, personaBySlug, type Persona } from "@/lib/personas";
import { runAgent, store } from "@/lib/client";
import { exportObz } from "@/lib/obf";
import Device from "./Device";
import Trace, { upsertTrace } from "./Trace";
import Evidence from "./Evidence";
import BridgePanel from "./BridgePanel";
import BaselinePanel from "./BaselinePanel";
import RefineBar from "./RefineBar";

type Tab = "board" | "bridge" | "baseline";

const field = "neu-in-sm w-full px-3.5 py-3 text-[15px] text-ink placeholder:text-muted/70 outline-none focus-visible:outline-none";
const CACHE_VERSION = "v4";

export default function Studio() {
  const params = useSearchParams();
  const router = useRouter();
  const slug = params.get("p") ?? "maya";
  const persona = personaBySlug(slug);

  const [input, setInput] = useState<BuildInput>(() => persona ?? PERSONAS[0]);
  const [custom, setCustom] = useState(slug === "custom");
  const [board, setBoard] = useState<Board | null>(null);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [caregiver, setCaregiver] = useState(false);
  const [large, setLarge] = useState(slug === "leo");
  const [inspect, setInspect] = useState<Cell | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [refineTrace, setRefineTrace] = useState<TraceEvent[]>([]);
  const ran = useRef<string | null>(null);

  const cacheKey = (i: BuildInput) => `fringe:${CACHE_VERSION}:${i.name}|${i.age}|${i.city}|${i.likes}`;

  const build = useCallback(async (i: BuildInput, force = false) => {
    setErr(null);
    setInspect(null);
    setRefineTrace([]);
    setTab("board");
    setActive(0);
    const cached = !force ? store.get<{ board: Board; trace: TraceEvent[] }>(cacheKey(i)) : null;
    if (cached) {
      setBoard(cached.board);
      setTrace(cached.trace);
      return;
    }
    setBusy(true);
    setBoard(null);
    setTrace([]);
    const collected: TraceEvent[] = [];
    try {
      const b = await runAgent<Board>("/api/build", i, (e) => {
        const next = upsertTrace(collected, e);
        collected.splice(0, collected.length, ...next);
        setTrace(next);
      });
      setBoard(b);
      store.set(cacheKey(i), { board: b, trace: collected });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (slug === "custom") return;
    const p = personaBySlug(slug) ?? PERSONAS[0];
    if (ran.current === p.slug) return;
    ran.current = p.slug;
    setCustom(false);
    setLarge(p.slug === "leo");
    setInput(p);
    build(p);
  }, [slug, build]);

  // Persist caregiver edits (approve/remove/bridge pages) for this person.
  useEffect(() => {
    if (board) store.set(cacheKey(input), { board, trace });
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutateFolder = (fi: number, fn: (f: Folder) => Folder | null) =>
    setBoard((b) => {
      if (!b) return b;
      const folders = b.folders.map((f, i) => (i === fi ? fn(f) : f)).filter(Boolean) as Folder[];
      return { ...b, folders };
    });

  const addBridge = (f: Folder) =>
    setBoard((b) => {
      if (!b) return b;
      const folders = [...b.folders.filter((x) => !(x.key === "bridge" && x.partner === f.partner)), f];
      setActive(folders.length - 1);
      return { ...b, folders };
    });

  const pending = board?.folders.reduce((n, f) => n + f.cells.filter((c) => c.status === "suggested").length, 0) ?? 0;
  const p: Persona | undefined = custom ? undefined : persona;

  const partnerDefaults = useMemo(
    () => (p ? p.partner : { name: "Grandma", age: 70, relation: "grandmother", likes: "The Beatles, The Sound of Music, gardening shows" }),
    [p],
  );

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 sm:px-6 pb-16">
      {/* Persona switcher */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        {PERSONAS.map((x) => (
          <button
            key={x.slug}
            type="button"
            data-active={!custom && slug === x.slug}
            onClick={() => {
              ran.current = null;
              router.push(`/studio?p=${x.slug}`, { scroll: false });
            }}
            className={`neu-btn flex h-10 sm:h-11 items-center gap-2 px-3.5 sm:px-4 text-[14px] sm:text-[15px] font-semibold ${!custom && slug === x.slug ? "text-accent" : "text-ink-2"}`}
          >
            {x.name}, {x.age}
          </button>
        ))}
        <button
          type="button"
          data-active={custom}
          onClick={() => {
            setCustom(true);
            router.push(`/studio?p=custom`, { scroll: false });
          }}
          className={`neu-btn flex h-10 sm:h-11 items-center gap-2 px-3.5 sm:px-4 text-[14px] sm:text-[15px] font-semibold ${custom ? "text-accent" : "text-ink-2"}`}
        >
          <Pencil size={16} /> Your own
        </button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        {/* Left: who this board is for */}
        <aside className="order-2 space-y-6 lg:order-none">
          {custom ? (
            <form
              className="neu p-5"
              onSubmit={(e) => {
                e.preventDefault();
                build(input, true);
              }}
            >
              <h2 className="display text-2xl text-ink">Who is this board for?</h2>
              <p className="mt-1 text-[13.5px] text-muted">A parent, SLP or support worker fills this in. Everything stays in this browser.</p>
              <div className="mt-4 space-y-3.5">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">First name</span>
                  <input className={field} value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} required />
                </label>
                <div className="grid grid-cols-[90px_1fr] gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">Age</span>
                    <input className={field} type="number" min={3} max={100} value={input.age} onChange={(e) => setInput({ ...input, age: Number(e.target.value) })} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">City</span>
                    <input className={field} value={input.city} onChange={(e) => setInput({ ...input, city: e.target.value })} placeholder="Denver, CO" />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">What do they love?</span>
                  <textarea
                    className={`${field} min-h-[110px] resize-y`}
                    value={input.likes}
                    onChange={(e) => setInput({ ...input, likes: e.target.value })}
                    placeholder="Shows, songs, games, books, foods… e.g. Paw Patrol, Ed Sheeran, Mario Kart, tacos"
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">Anything else? <span className="font-normal text-muted">(optional)</span></span>
                  <input className={field} value={input.about ?? ""} onChange={(e) => setInput({ ...input, about: e.target.value })} placeholder="Loves dogs, hates loud places" />
                </label>
              </div>
              <button type="submit" disabled={busy} className="btn-accent mt-5 flex h-12 w-full items-center justify-center gap-2 font-semibold">
                {busy ? <LoaderCircle size={18} className="animate-spin" /> : <Wand2 size={18} />}
                {busy ? "Building…" : "Build the board"}
              </button>
            </form>
          ) : (
            p && (
              <div className="neu p-5">
                <div className="flex items-center gap-3">
                  <span className="neu-in-sm grid h-14 w-14 place-items-center display text-3xl text-accent">{p.name[0]}</span>
                  <div>
                    <div className="display text-3xl leading-none text-ink">{p.name}</div>
                    <div className="mt-1 text-[13.5px] text-muted">
                      {p.age} · {p.city}
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-[15px] italic leading-snug text-ink-2">{p.headline}</p>
                <dl className="mt-4 space-y-2 text-[13.5px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Communication</dt>
                    <dd className="text-right font-medium text-ink">{p.condition}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Access</dt>
                    <dd className="text-right font-medium text-ink">{p.access}</dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-muted">Caregiver&rsquo;s note</div>
                  <p className="neu-in-sm mt-2 px-3 py-2.5 text-[14px] leading-relaxed text-ink-2">&ldquo;Loves {p.likes}.&rdquo;</p>
                </div>
                <p className="mt-3 text-[11.5px] text-muted">Illustrative person. That one sentence is the whole input.</p>
              </div>
            )
          )}

          {board && (
            <div className="neu p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <ShieldCheck size={18} className="text-ok" /> Caregiver review
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={caregiver}
                  onClick={() => setCaregiver((v) => !v)}
                  className={`neu-in-sm relative h-8 w-14 shrink-0 rounded-full p-1 transition`}
                  aria-label="Caregiver review mode"
                >
                  <span className={`block h-6 w-6 rounded-full shadow transition-transform ${caregiver ? "translate-x-6 bg-accent" : "translate-x-0 bg-white"}`} />
                </button>
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
                {pending > 0
                  ? `${pending} suggestions are waiting for a parent or SLP to keep or remove. Favourites you named are already in.`
                  : "Everything on the board has been reviewed."}
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                <div>
                  <div className="text-[14px] font-semibold text-ink">Large targets</div>
                  <div className="text-[12.5px] text-muted">For eye-gaze, switch and motor access</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={large}
                  onClick={() => setLarge((v) => !v)}
                  className="neu-in-sm relative h-8 w-14 shrink-0 rounded-full p-1"
                  aria-label="Large targets"
                >
                  <span className={`block h-6 w-6 rounded-full shadow transition-transform ${large ? "translate-x-6 bg-accent" : "translate-x-0 bg-white"}`} />
                </button>
              </div>
              <button type="button" onClick={() => exportObz(board)} className="neu-btn mt-4 flex h-11 w-full items-center justify-center gap-2 text-[14px] font-semibold text-ink">
                <Download size={17} /> Export to any AAC app (.obz)
              </button>
              <button type="button" onClick={() => build(input, true)} disabled={busy} className="mt-3 flex w-full items-center justify-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
                <RotateCcw size={14} /> Rebuild from scratch
              </button>
            </div>
          )}
        </aside>

        {/* Centre: the device */}
        <section className="order-1 min-w-0 lg:order-none">
          <div className="mb-4 flex flex-wrap gap-2.5" role="tablist">
            {(
              [
                ["board", `${board?.person.name ?? input.name}'s board`],
                ["bridge", `Talk with ${partnerDefaults.name}`],
                ["baseline", "Without Qloo"],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                data-active={tab === k}
                disabled={!board}
                onClick={() => setTab(k)}
                className={`neu-btn h-11 px-4 text-[15px] font-semibold disabled:opacity-50 ${tab === k ? "text-accent" : "text-ink-2"}`}
              >
                {l}
              </button>
            ))}
          </div>

          {err && (
            <div className="neu mb-6 p-5 text-[15px] text-err">
              {err}{" "}
              <button type="button" className="ml-2 font-semibold underline" onClick={() => build(input, true)}>
                Try again
              </button>
            </div>
          )}

          {!board && busy && <BuildingState name={input.name} trace={trace} />}

          {!board && !busy && !err && custom && (
            <div className="neu grid min-h-[420px] place-items-center p-10 text-center">
              <div>
                <UserRound className="mx-auto text-muted" size={34} />
                <p className="display mt-3 text-3xl text-ink">Tell the agent who it&rsquo;s for.</p>
                <p className="mt-2 text-[15px] text-muted">One sentence about what they love is enough.</p>
              </div>
            </div>
          )}

          {board && tab === "board" && (
            <RefineBar
              board={board}
              slug={custom ? "custom" : slug}
              onTrace={setRefineTrace}
              onBoard={(nb) => {
                setBoard(nb);
                const i = nb.folders.findIndex((f) => f.cells.some((c) => c.isNew));
                if (i >= 0) setActive(i);
              }}
            />
          )}
          {board && tab === "board" && (
            <Device
              board={board}
              active={Math.min(active, board.folders.length - 1)}
              setActive={setActive}
              caregiver={caregiver}
              large={large}
              selectedId={inspect?.id}
              onInspect={setInspect}
              onApprove={(fi, id) => mutateFolder(fi, (f) => ({ ...f, cells: f.cells.map((c) => (c.id === id ? { ...c, status: "approved" } : c)) }))}
              onRemove={(fi, id) =>
                mutateFolder(fi, (f) => {
                  const cells = f.cells.filter((c) => c.id !== id);
                  return cells.length ? { ...f, cells } : null;
                })
              }
            />
          )}
          {board && tab === "bridge" && (
            <BridgePanel
              key={board.person.name + partnerDefaults.name}
              board={board}
              defaults={partnerDefaults}
              onFolder={addBridge}
              onOpen={() => setTab("board")}
            />
          )}
          {board && tab === "baseline" && <BaselinePanel key={board.person.name} board={board} input={input} />}
        </section>

        {/* Right: the agent's reasoning */}
        <aside className="order-3 lg:order-none lg:col-span-2 xl:col-span-1">
          <div className="neu p-5 xl:sticky xl:top-6">
            {inspect ? (
              <Evidence cell={inspect} onClose={() => setInspect(null)} />
            ) : (
              <>
                {refineTrace.length > 0 && (
                  <div className="mb-6 border-b border-line pb-5">
                    <Trace events={refineTrace} title="Board update · tool-calling agent" />
                  </div>
                )}
                <Trace events={trace} stats={board?.stats} />
              </>
            )}
            {!inspect && board && (
              <p className="mt-5 flex items-start gap-2 rounded-2xl bg-white/50 p-3 text-[12.5px] leading-relaxed text-muted">
                <Sparkles size={15} className="mt-0.5 shrink-0 text-accent" />
                <span>Tap the info button on any picture to see the Qloo evidence behind it.</span>
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function BuildingState({ name, trace }: { name: string; trace: TraceEvent[] }) {
  const current = [...trace].reverse().find((t) => t.status === "running") ?? trace[trace.length - 1];
  return (
    <div className="neu grid min-h-[520px] place-items-center p-10">
      <div className="max-w-md text-center">
        <div className="neu-in mx-auto grid h-20 w-20 place-items-center rounded-full">
          <LoaderCircle size={30} className="animate-spin text-accent" />
        </div>
        <p className="display mt-6 text-3xl text-ink">Building {name}&rsquo;s words</p>
        <p className="mt-2 min-h-[1.5em] text-[15px] text-muted">{current?.label ?? "Starting the agent"}…</p>
        <div className="mt-6 grid grid-cols-4 gap-3 opacity-60">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="neu-sm aspect-square pulse-dot" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
