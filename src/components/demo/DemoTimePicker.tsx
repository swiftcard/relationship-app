"use client";

import { useMemo, useRef, useState } from "react";
import { COMMON_TIME_ZONES, dayKey, fmtLongDay, tzLabel } from "@/lib/demo/format";
import DemoCalendar, { monthOf } from "./DemoCalendar";
import DemoTimes from "./DemoTimes";
import type { SlotsState } from "./useDemoSlots";

// ── Pick a day, then a time ─────────────────────────────────────────────────
// Shared by the booking popup, /demo, and the reschedule page. Times are shown
// in the visitor's own time zone (changeable); the server only ever sees UTC.

export default function DemoTimePicker({ slots, timeZone, onTimeZone, selected, onSelect, onRetry }: {
  slots: SlotsState;
  timeZone: string;
  onTimeZone: (tz: string) => void;
  selected: string | null;
  onSelect: (iso: string | null) => void;
  onRetry: () => void;
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const iso of slots.slots) {
      const k = dayKey(new Date(iso), timeZone);
      const list = m.get(k);
      if (list) list.push(iso); else m.set(k, [iso]);
    }
    return m;
  }, [slots.slots, timeZone]);
  const openDays = useMemo(() => new Set(byDay.keys()), [byDay]);
  const firstDay = useMemo(() => [...openDays].sort()[0] ?? null, [openDays]);

  // What the visitor chose; the day and month SHOWN are worked out from it, so
  // they stay valid as times load, reload after "just taken", or change zone.
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const timesRef = useRef<HTMLDivElement>(null);
  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const selectedDay = selected ? dayKey(new Date(selected), timeZone) : null;
  const day = (selectedDay && openDays.has(selectedDay) ? selectedDay : null)
    ?? (chosenDay && openDays.has(chosenDay) ? chosenDay : null)
    ?? firstDay;
  const month = (chosenMonth && [...openDays].some((d) => monthOf(d) === chosenMonth) ? chosenMonth : null)
    ?? (day ? monthOf(day) : null);

  const zones = useMemo(() => {
    const list: string[] = [...COMMON_TIME_ZONES];
    if (!list.includes(timeZone)) list.unshift(timeZone);
    return list;
  }, [timeZone]);
  const today = dayKey(new Date(), timeZone);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-4 text-[0.8125rem] text-slate-600">
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><circle cx="10" cy="10" r="7.25" /><path d="M10 6v4l2.5 1.5" strokeLinecap="round" /></svg>
        <label htmlFor="demo-tz">Times shown in</label>
        <span className="relative inline-flex">
          <select id="demo-tz" value={timeZone} onChange={(e) => { onTimeZone(e.target.value); onSelect(null); }}
            className="appearance-none rounded-full border border-slate-200 bg-white pl-3 pr-8 py-1.5 text-[0.8125rem] font-semibold text-slate-900 hover:border-slate-300 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 max-w-[15rem] truncate">
            {zones.map((z) => <option key={z} value={z}>{tzLabel(z)}</option>)}
          </select>
          <svg viewBox="0 0 12 12" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </div>

      {slots.status === "error" && !slots.slots.length ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center">
          <p className="text-slate-700 text-sm font-semibold">The open times didn&apos;t load.</p>
          <button type="button" onClick={onRetry} className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">Try again</button>
        </div>
      ) : slots.status !== "ready" && !slots.slots.length ? (
        <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-6" aria-busy="true" aria-label="Loading open times">
          <div className="space-y-2">
            <div className="h-6 w-32 rounded-md bg-slate-100 animate-pulse" />
            <div className="h-[15.5rem] rounded-2xl bg-slate-100 animate-pulse" />
          </div>
          <div className="mt-5 sm:mt-8 grid grid-cols-3 sm:grid-cols-1 gap-2">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-11 rounded-xl bg-slate-100 animate-pulse" />)}
          </div>
        </div>
      ) : !slots.slots.length ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center">
          <p className="text-slate-700 text-sm font-semibold">Every demo time in the next 30 days is taken.</p>
          <p className="text-slate-500 text-[0.8125rem] mt-1">Email <a className="text-blue-700 underline" href="mailto:hello@swiftcard.me">hello@swiftcard.me</a> and we&apos;ll find a time that works.</p>
        </div>
      ) : (
        <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-6">
          {month && (
            <DemoCalendar openDays={openDays} month={month} onMonth={setChosenMonth} selected={day} today={today}
              onSelect={(d) => {
                setChosenDay(d);
                setChosenMonth(monthOf(d));
                if (selectedDay && selectedDay !== d) onSelect(null);
                // On a phone the times sit under the calendar: bring them up.
                if (window.matchMedia?.("(max-width: 639px)").matches) {
                  requestAnimationFrame(() => timesRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                }
              }} />
          )}
          <div ref={timesRef} className="mt-5 sm:mt-0 min-w-0 scroll-mb-4">
            <p className="text-slate-900 font-bold text-[0.875rem] mb-2 sm:mt-2 sm:mb-3">{day ? fmtLongDay(new Date(`${day}T12:00:00Z`), "UTC") : "Pick a day"}</p>
            <div className="sm:max-h-[16.5rem] sm:overflow-y-auto sm:pr-1 sm:-mr-1">
              <DemoTimes slots={day ? byDay.get(day) ?? [] : []} timeZone={timeZone} selected={selected} onSelect={onSelect} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
