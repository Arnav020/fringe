"use client";

import { ExternalLink, Heart, MapPin, Sparkles, Users, Volume2, X } from "lucide-react";
import type { Cell } from "@/lib/types";
import { speak } from "@/lib/client";

const KIND_LABEL: Record<Cell["kind"], string> = {
  seed: "Their favourite",
  expanded: "Suggested by Qloo",
  place: "Real place nearby",
  food: "From the caregiver",
  bridge: "Bridge topic",
};

export default function Evidence({ cell, onClose }: { cell: Cell; onClose: () => void }) {
  return (
    <div className="rise">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Why this button</h3>
        <button type="button" onClick={onClose} className="neu-btn grid h-8 w-8 place-items-center text-ink-2" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="mt-4 flex gap-3">
        <div className="neu-in-sm h-20 w-20 shrink-0 overflow-hidden p-1">
          {cell.image ? (
            <img src={cell.image} alt="" className="h-full w-full rounded-[10px] object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center rounded-[10px] bg-accent-soft display text-3xl text-accent">{cell.label[0]}</div>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight text-ink">{cell.label}</div>
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent">
            {cell.kind === "seed" ? <Heart size={12} fill="currentColor" /> : <Sparkles size={12} />}
            {KIND_LABEL[cell.kind]}
          </div>
          {cell.entityType && <div className="mt-1 text-[12px] capitalize text-muted">{cell.entityType.replace("_", " ")}</div>}
        </div>
      </div>

      <button type="button" onClick={() => speak(cell.say)} className="neu-btn mt-4 flex w-full items-center gap-2 px-3 py-2.5 text-left text-[15px] text-ink">
        <Volume2 size={18} className="shrink-0 text-accent" />
        <span>&ldquo;{cell.say}&rdquo;</span>
      </button>

      <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{cell.why}</p>

      {cell.affinity !== undefined && (
        <div className="mt-4">
          <div className="flex justify-between text-[12px] text-muted">
            <span>Qloo taste affinity</span>
            <span className="font-mono text-ink">{cell.affinity.toFixed(2)}</span>
          </div>
          <div className="neu-in-sm mt-1.5 h-3 p-[3px]">
            <div className="h-full rounded-full bg-gradient-to-r from-[#f0a07f] to-accent" style={{ width: `${Math.round(cell.affinity * 100)}%` }} />
          </div>
        </div>
      )}

      {(cell.talkWith || cell.ages?.length) && (
        <div className="neu-in-sm mt-4 p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Users size={15} className="text-accent" /> Who it lands with
          </div>
          {cell.talkWith && <p className="mt-1 text-[14px] text-ink-2">Good topic with <b className="text-ink">{cell.talkWith}</b>.</p>}
          {cell.ages && cell.ages.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cell.ages.map((a) => (
                <span key={a.bucket} className="rounded-lg bg-white/70 px-2 py-0.5 font-mono text-[12px] text-ink-2">
                  ages {a.bucket} +{Math.round(a.value * 100)}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11.5px] text-muted">From Qloo demographic affinity (urn:demographics).</p>
        </div>
      )}

      {cell.address && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cell.label + " " + cell.address)}`}
          target="_blank"
          rel="noreferrer"
          className="neu-btn mt-4 flex items-center gap-2 px-3 py-2.5 text-[13.5px] text-ink-2"
        >
          <MapPin size={16} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">{cell.address}</span>
          <ExternalLink size={14} />
        </a>
      )}

      {cell.entityId && (
        <p className="mt-4 break-all font-mono text-[11px] text-muted">qloo entity · {cell.entityId}</p>
      )}
    </div>
  );
}
