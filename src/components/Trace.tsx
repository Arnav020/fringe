"use client";

import { AlertTriangle, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import type { Board, TraceEvent } from "@/lib/types";

export function upsertTrace(list: TraceEvent[], e: TraceEvent) {
  const i = list.findIndex((x) => x.id === e.id);
  if (i === -1) return [...list, e];
  const next = list.slice();
  next[i] = { ...next[i], ...e, endpoint: e.endpoint ?? next[i].endpoint };
  return next;
}

const ICON = {
  running: <LoaderCircle size={17} className="animate-spin text-accent" />,
  done: <CircleCheck size={17} className="text-ok" />,
  warn: <AlertTriangle size={17} className="text-warn" />,
  error: <CircleX size={17} className="text-err" />,
};

export default function Trace({ events, stats, title = "Agent run" }: { events: TraceEvent[]; stats?: Board["stats"]; title?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</h3>
        {stats && <span className="font-mono text-[12px] text-muted">{(stats.ms / 1000).toFixed(1)}s</span>}
      </div>
      {stats && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            [stats.qlooCalls, "Qloo calls"],
            [stats.candidates, "candidates"],
            [stats.kept, "buttons"],
          ].map(([v, l]) => (
            <div key={l} className="neu-in-sm px-2 py-2.5 text-center">
              <div className="text-xl font-semibold tabular-nums text-ink">{v}</div>
              <div className="text-[11px] text-muted">{l}</div>
            </div>
          ))}
        </div>
      )}
      <ol className="mt-4 space-y-2.5">
        {events.length === 0 && <li className="text-[14px] text-muted">The agent&rsquo;s steps will appear here as it works.</li>}
        {events.map((e) => (
          <li key={e.id} className="rise flex gap-2.5">
            <span className="mt-0.5 shrink-0">{ICON[e.status]}</span>
            <div className="min-w-0">
              <div className="text-[14px] font-medium leading-snug text-ink">{e.label}</div>
              {e.endpoint && <div className="mt-0.5 font-mono text-[11.5px] text-accent/90">{e.endpoint}</div>}
              {e.detail && <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{e.detail}</div>}
            </div>
            {e.ms !== undefined && <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{e.ms}ms</span>}
          </li>
        ))}
      </ol>
      {stats?.model && <p className="mt-4 text-[12px] text-muted">Language model: <span className="font-mono">{stats.model}</span> (Groq). Every button is a Qloo entity or the caregiver&rsquo;s own words.</p>}
    </div>
  );
}
