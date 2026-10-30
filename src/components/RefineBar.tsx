"use client";

import { useState } from "react";
import { ArrowUp, LoaderCircle, MessageSquareText } from "lucide-react";
import type { Board, TraceEvent } from "@/lib/types";
import { runAgent } from "@/lib/client";
import { upsertTrace } from "./Trace";

const EXAMPLES: Record<string, string[]> = {
  maya: ["She's obsessed with dinosaurs now", "Find somewhere she can swim", "Remove Hello Neighbor, it scares her"],
  leo: ["He's really into Formula 1 now", "Find a basketball court near him", "Add “That was a foul!” to games"],
  ruth: ["She's started watching Downton Abbey", "Find a quiet tea room nearby", "Add “That's my song!” to music"],
};

interface Props {
  board: Board;
  slug: string;
  onTrace: (events: TraceEvent[]) => void;
  onBoard: (b: Board) => void;
}

/** Natural-language board maintenance: the caregiver says what changed, a tool-calling agent updates the board. */
export default function RefineBar({ board, slug, onTrace, onBoard }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ ok: boolean; text: string } | null>(null);
  const examples = EXAMPLES[slug] ?? ["They're into space now", "Find a park nearby", "Remove anything scary"];

  const send = async (instruction: string) => {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setReply(null);
    let events: TraceEvent[] = [];
    onTrace(events);
    try {
      const r = await runAgent<{ board: Board; reply: string }>("/api/refine", { board, instruction }, (e) => {
        events = upsertTrace(events, e);
        onTrace(events);
      });
      onBoard(r.board);
      setReply({ ok: true, text: r.reply });
      setText("");
    } catch (e) {
      setReply({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="neu mb-6 p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
        <MessageSquareText size={17} className="text-accent" /> Tastes change. Tell the agent what&rsquo;s new.
      </div>
      <form
        className="neu-in mt-3 flex items-center gap-2 p-1.5 pl-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`e.g. ${examples[0]}`}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-ink placeholder:text-muted/70 outline-none"
          aria-label="Tell the agent what changed"
        />
        <button type="submit" disabled={busy || !text.trim()} className="btn-accent grid h-10 w-10 shrink-0 place-items-center" aria-label="Update the board">
          {busy ? <LoaderCircle size={18} className="animate-spin" /> : <ArrowUp size={18} />}
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button key={ex} type="button" disabled={busy} onClick={() => send(ex)} className="neu-btn px-3 py-1.5 text-[13px] font-medium text-ink-2 disabled:opacity-50">
            {ex}
          </button>
        ))}
      </div>
      {reply && <p className={`rise mt-3 text-[13.5px] leading-relaxed ${reply.ok ? "text-ok" : "text-err"}`}>{reply.text}</p>}
    </div>
  );
}
