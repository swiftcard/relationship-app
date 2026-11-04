"use client";

import { fmtTime } from "@/lib/demo/format";

// ── The open times for the chosen day ───────────────────────────────────────
// Three to a row on a phone; one column beside the calendar on a computer.

export default function DemoTimes({ slots, timeZone, selected, onSelect }: {
  /** ISO start times, all on the chosen day. */
  slots: string[];
  timeZone: string;
  selected: string | null;
  onSelect: (iso: string) => void;
}) {
  if (!slots.length) {
    return <p className="text-slate-500 text-[0.8125rem] leading-relaxed">Pick a day with a blue dot to see its open times.</p>;
  }
  return (
    <div className="grid grid-cols-3 sm:grid-cols-1 gap-2" role="group" aria-label="Open times">
      {slots.map((iso) => {
        const isSel = iso === selected;
        return (
          <button key={iso} type="button" onClick={() => onSelect(iso)} aria-pressed={isSel}
            className={`h-11 rounded-xl border text-[0.875rem] font-semibold tabular-nums transition-colors ${isSel ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-800 hover:border-blue-400 hover:text-blue-700"}`}>
            {fmtTime(new Date(iso), timeZone)}
          </button>
        );
      })}
    </div>
  );
}
