"use client";

import { useState } from "react";
import {
  BookOpen,
  Check,
  Clapperboard,
  Delete,
  Gamepad2,
  Heart,
  HeartHandshake,
  Info,
  MapPin,
  Music2,
  Tv,
  UtensilsCrossed,
  Volume2,
  X,
} from "lucide-react";
import type { Board, Cell, FolderKey } from "@/lib/types";
import { CORE, FITZGERALD } from "@/lib/vocab";
import { speak } from "@/lib/client";

export const FOLDER_ICON: Record<FolderKey, typeof Tv> = {
  shows: Tv,
  movies: Clapperboard,
  music: Music2,
  games: Gamepad2,
  books: BookOpen,
  places: MapPin,
  food: UtensilsCrossed,
  bridge: HeartHandshake,
};

interface Props {
  board: Board;
  active: number;
  setActive: (i: number) => void;
  caregiver: boolean;
  /** Fewer, bigger targets for eye-gaze, switch and motor-access users. */
  large?: boolean;
  selectedId?: string;
  onInspect: (c: Cell) => void;
  onApprove: (folder: number, id: string) => void;
  onRemove: (folder: number, id: string) => void;
}

export default function Device({ board, active, setActive, caregiver, large = false, selectedId, onInspect, onApprove, onRemove }: Props) {
  const [strip, setStrip] = useState<{ key: string; text: string; image?: string }[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const folder = board.folders[active] ?? board.folders[0];

  const press = (key: string, text: string, say = text, image?: string) => {
    speak(say);
    setStrip((s) => [...s, { key: `${key}-${Date.now()}`, text, image }].slice(-12));
    setFlash(key);
    setTimeout(() => setFlash(null), 160);
  };

  const sentence = strip.map((s) => s.text).join(" ");

  return (
    <div className="neu p-3 sm:p-5">
      {/* Message window */}
      <div className="neu-in flex items-center gap-2 p-2 sm:p-3 min-h-[72px]">
        <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0" aria-live="polite">
          {strip.length === 0 ? (
            <span className="px-2 text-muted text-[15px]">Tap a word or a picture. {board.person.name}&rsquo;s sentence builds here.</span>
          ) : (
            strip.map((s) => (
              <span key={s.key} className="rise inline-flex items-center gap-1.5 rounded-xl bg-white/70 pl-1.5 pr-2.5 py-1 text-[15px] font-medium text-ink shadow-sm">
                {s.image ? <img src={s.image} alt="" className="h-6 w-6 rounded-md object-cover" /> : null}
                {s.text}
              </span>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={() => setStrip((s) => s.slice(0, -1))}
          className="neu-btn grid h-12 w-12 shrink-0 place-items-center text-ink-2"
          aria-label="Delete last word"
        >
          <Delete size={20} />
        </button>
        <button
          type="button"
          onClick={() => setStrip([])}
          className="neu-btn hidden sm:grid h-12 w-12 shrink-0 place-items-center text-ink-2"
          aria-label="Clear"
        >
          <X size={20} />
        </button>
        <button
          type="button"
          onClick={() => sentence && speak(sentence)}
          className="btn-accent flex h-12 shrink-0 items-center gap-2 px-4 font-semibold"
          aria-label="Speak sentence"
        >
          <Volume2 size={20} />
          <span className="hidden sm:inline">Speak</span>
        </button>
      </div>

      {/* Core vocabulary — fixed positions, never reshuffled */}
      <div className="mt-4 grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-2.5">
        {CORE.map((w) => {
          const c = FITZGERALD[w.cls];
          return (
            <button
              key={w.word}
              type="button"
              data-flash={flash === `core-${w.word}`}
              onClick={() => press(`core-${w.word}`, w.word)}
              className="key h-12 sm:h-14 overflow-hidden text-[15px] sm:text-base font-semibold"
              style={{ color: c.ink }}
              title={`${c.name} word`}
            >
              <span className="absolute inset-x-0 top-0 h-[5px]" style={{ background: c.bg }} />
              <span className="absolute inset-0 opacity-[0.22]" style={{ background: c.bg }} />
              <span className="relative">{w.word}</span>
            </button>
          );
        })}
      </div>

      {/* Fringe folders */}
      <div className="mt-5 flex flex-wrap gap-2.5" role="tablist" aria-label="Topics">
        {board.folders.map((f, i) => {
          const Icon = FOLDER_ICON[f.key];
          const pending = caregiver ? f.cells.filter((c) => c.status === "suggested").length : 0;
          return (
            <button
              key={`${f.key}-${f.partner ?? ""}`}
              type="button"
              role="tab"
              aria-selected={i === active}
              data-active={i === active}
              onClick={() => setActive(i)}
              className={`neu-btn flex shrink-0 items-center gap-2 px-4 h-11 text-[15px] font-semibold ${i === active ? "text-accent" : "text-ink-2"}`}
            >
              <Icon size={18} strokeWidth={2.2} />
              {f.title}
              {pending > 0 && (
                <span className="ml-0.5 rounded-full bg-accent-soft px-1.5 text-[11px] font-bold text-accent">{pending}</span>
              )}
            </button>
          );
        })}
      </div>

      {folder && (
        <>
          {folder.sharedThemes && folder.sharedThemes.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <span className="font-medium text-ink-2">You both like</span>
              {folder.sharedThemes.map((t) => (
                <span key={t} className="neu-in-sm px-2.5 py-1 font-medium text-ink-2">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className={`mt-3 grid gap-3 sm:gap-4 ${large ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4"}`}>
            {folder.cells.map((c) => {
              const pending = caregiver && c.status === "suggested";
              const selected = selectedId === c.id;
              return (
                <div key={c.id} className={`rise relative ${pending ? "opacity-[0.92]" : ""}`}>
                  <button
                    type="button"
                    data-flash={flash === c.id}
                    onClick={() => press(c.id, c.label, c.say, c.image)}
                    className={`key w-full text-left p-2 ${selected ? "ring-2 ring-accent/70" : ""} ${pending ? "outline-2 outline-dashed outline-accent/50 outline-offset-2" : ""}`}
                    aria-label={`${c.label}. Says: ${c.say}`}
                  >
                    <div className="relative aspect-[4/3] overflow-hidden rounded-[13px] bg-bg-deep">
                      {c.image ? (
                        <img src={c.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#f6c9a6] to-[#f1a97f]">
                          <span className="display text-5xl text-[#5b2a12]">{c.label.slice(0, 1)}</span>
                        </div>
                      )}
                      {c.isNew && (
                        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm">New</span>
                      )}
                      {c.kind === "seed" && (
                        <span className="absolute left-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-accent shadow-sm" title="A favourite you told us about">
                          <Heart size={15} fill="currentColor" />
                        </span>
                      )}
                    </div>
                    <div className="px-1 pt-2 pb-0.5">
                      <div className={`line-clamp-2 font-semibold leading-snug text-ink ${large ? "text-lg sm:text-xl" : "text-[15px] sm:text-base"}`}>{c.label}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onInspect(c)}
                    className="absolute right-3.5 top-3.5 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-ink-2 shadow-sm hover:text-accent"
                    aria-label={`Why ${c.label}?`}
                  >
                    <Info size={16} />
                  </button>
                  {pending && (
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => onApprove(active, c.id)} className="neu-btn flex flex-1 items-center justify-center gap-1 h-9 text-[13px] font-semibold text-ok">
                        <Check size={15} /> Keep
                      </button>
                      <button type="button" onClick={() => onRemove(active, c.id)} className="neu-btn flex flex-1 items-center justify-center gap-1 h-9 text-[13px] font-semibold text-err">
                        <X size={15} /> Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Social-closeness phrases */}
          <div className="mt-5 flex flex-wrap gap-2.5">
            {folder.quick.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => press(`q-${q}`, q)}
                data-flash={flash === `q-${q}`}
                className="key overflow-hidden px-4 h-11 text-[15px] font-semibold"
                style={{ color: FITZGERALD.social.ink }}
              >
                <span className="absolute inset-0 opacity-[0.28]" style={{ background: FITZGERALD.social.bg }} />
                <span className="relative">{q}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
