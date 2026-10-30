"use client";

import { Map as MapIcon } from "lucide-react";
import type { Board, Cell } from "@/lib/types";

/**
 * Qloo heatmap of where this person's kind of taste is concentrated in their
 * city, with the board's places pinned on top. Drawn as a plain SVG scatter so
 * it needs no map tiles or keys.
 */
export default function TasteMap({ board, onPick }: { board: Board; onPick: (c: Cell) => void }) {
  const heat = board.heat;
  if (!heat || heat.points.length < 8) return null;
  const pins = board.folders
    .filter((f) => f.key === "places" || f.key === "food")
    .flatMap((f) => f.cells.filter((c) => c.geo));

  // Fit the strongest cells (and pins) into the frame; far-flung suburbs would shrink the centre to a dot.
  const core = heat.points.filter((p) => p.affinity >= 0.35);
  const pts = [...(core.length >= 8 ? core : heat.points), ...pins.map((c) => ({ ...c.geo!, affinity: 1 }))];
  const lats = pts.map((p) => p.lat).sort((a, b) => a - b);
  const lngs = pts.map((p) => p.lng).sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  const [lat0, lat1] = [q(lats, 0.03), q(lats, 0.97)];
  const [lng0, lng1] = [q(lngs, 0.03), q(lngs, 0.97)];
  const kx = Math.cos(((lat0 + lat1) / 2) * (Math.PI / 180));
  const w = Math.max((lng1 - lng0) * kx, 1e-4);
  const h = Math.max(lat1 - lat0, 1e-4);
  const W = 300;
  const H = Math.min(260, Math.max(160, (W * h) / w));
  const pad = 14;
  const x = (lng: number) => pad + ((lng - lng0) * kx * (W - 2 * pad)) / w;
  const y = (lat: number) => pad + ((lat1 - lat) * (H - 2 * pad)) / h;
  const inside = (p: { lat: number; lng: number }) => p.lat >= lat0 && p.lat <= lat1 && p.lng >= lng0 && p.lng <= lng1;

  return (
    <div className="neu p-5">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <MapIcon size={17} className="text-accent" /> Where {board.person.name}&rsquo;s taste lives
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Qloo heatmap of {heat.city.split(",")[0]}: darker cells are where people with this taste concentrate. Pins are places on the board.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="neu-in-sm mt-3 w-full" role="img" aria-label={`Taste heatmap of ${heat.city}`}>
        {heat.points.filter(inside).map((p, i) => (
          <circle key={i} cx={x(p.lng)} cy={y(p.lat)} r={2.2 + p.affinity * 3.2} fill="var(--color-accent, #d9482b)" opacity={0.08 + p.affinity * 0.5} />
        ))}
        {heat.spots.filter(inside).map((s) => (
          <g key={s.label}>
            <circle cx={x(s.lng)} cy={y(s.lat)} r={13} fill="none" stroke="var(--color-accent, #d9482b)" strokeWidth={1.5} strokeDasharray="3 3" />
          </g>
        ))}
        {pins.filter((c) => inside(c.geo!)).map((c) => (
          <g key={c.id} className="cursor-pointer" onClick={() => onPick(c)}>
            <title>{c.label}</title>
            <circle cx={x(c.geo!.lng)} cy={y(c.geo!.lat)} r={5.5} fill="#1b2130" stroke="#fff" strokeWidth={2} />
          </g>
        ))}
      </svg>
      <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-accent" /> taste hot-spot
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-ink" /> place on the board
        </span>
        <span className="font-mono">urn:heatmap</span>
      </div>
    </div>
  );
}
