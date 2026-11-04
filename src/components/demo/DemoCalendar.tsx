"use client";

import { useMemo } from "react";

// ── The month grid in the demo popup ────────────────────────────────────────
// Days with an open time are buttons (bold, with a blue dot); every other day
// is plain grey text. Sunday first, as US calendars are. The arrows only reach
// the months that have open times.

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "YYYY-MM" for a "YYYY-MM-DD" key. */
export const monthOf = (dayKey: string) => dayKey.slice(0, 7);

export default function DemoCalendar({
  openDays, month, onMonth, selected, onSelect, today,
}: {
  /** "YYYY-MM-DD" days (in the visitor's zone) that have at least one open time. */
  openDays: Set<string>;
  /** The month shown, "YYYY-MM". */
  month: string;
  onMonth: (m: string) => void;
  selected: string | null;
  onSelect: (day: string) => void;
  /** Today's "YYYY-MM-DD" in the visitor's zone. */
  today: string;
}) {
  const months = useMemo(() => [...new Set([...openDays].map(monthOf))].sort(), [openDays]);
  const idx = months.indexOf(month);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const key = (d: number) => `${month}-${String(d).padStart(2, "0")}`;

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-2">
        <p className="text-slate-900 font-bold text-[0.9375rem]" aria-live="polite">{MONTHS[m - 1]} {y}</p>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" disabled={idx <= 0}
            onClick={() => idx > 0 && onMonth(months[idx - 1])}
            className="w-9 h-9 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12.5 4.5 7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button type="button" aria-label="Next month" disabled={idx < 0 || idx >= months.length - 1}
            onClick={() => idx < months.length - 1 && onMonth(months[idx + 1])}
            className="w-9 h-9 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
            <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="M7.5 4.5 13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center" role="presentation">
        {WEEKDAYS.map((w) => <span key={w} className="text-[0.6875rem] font-semibold text-slate-400 py-1.5" aria-hidden>{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} aria-hidden />;
          const k = key(d);
          const open = openDays.has(k);
          const isSel = selected === k;
          const label = `${WEEKDAY_NAMES[(lead + d - 1) % 7]}, ${MONTHS[m - 1]} ${d}${open ? "" : ", no open times"}`;
          if (!open) {
            return (
              <span key={k} className={`mx-auto w-10 h-10 flex items-center justify-center text-[0.875rem] ${k === today ? "text-slate-500 font-semibold" : "text-slate-300"}`} aria-label={label}>
                {d}
              </span>
            );
          }
          return (
            <button key={k} type="button" onClick={() => onSelect(k)} aria-pressed={isSel} aria-label={label}
              className={`relative mx-auto w-10 h-10 rounded-full flex items-center justify-center text-[0.875rem] font-bold transition-colors ${isSel ? "bg-blue-600 text-white" : "text-blue-700 bg-blue-50 hover:bg-blue-100"}`}>
              {d}
              {!isSel && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-600" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
