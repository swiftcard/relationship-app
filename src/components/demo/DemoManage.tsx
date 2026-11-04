"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { waitForHuman } from "@/lib/human-gate";
import { DEMO_RULES, DEMO_TIME_ZONE } from "@/lib/demo/config";
import { fmtLongDay, fmtRange, fmtTime, fmtWhen, tzAbbr } from "@/lib/demo/format";
import DemoTimePicker from "./DemoTimePicker";
import { useDemoSlots } from "./useDemoSlots";

// ── swiftcard.me/demo/manage#<token> ────────────────────────────────────────
// Every demo email links here: I'll be there, Pick a new time, Cancel. The
// token is after the "#", so no server ever logs it; this page reads it and
// POSTs it. Opening the page changes nothing. ?a=confirm (the reminders' "Yes,
// I'll be there") confirms by itself, but only once lib/human-gate is sure a
// person is looking, so a mail scanner opening the link records nothing.

type View = {
  status: "confirmed" | "canceled" | "completed" | "no_show";
  start: string; end: string; timezone: string; firstName: string; company: string;
  meetUrl: string | null; reconfirmed: boolean; past: boolean;
};
type Mode = "view" | "reschedule" | "cancel";

const primaryCls = "rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-sm py-3.5 px-6 transition-colors";
const secondaryCls = "rounded-full border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-bold text-sm py-3.5 px-6 transition-colors";

function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEMO_TIME_ZONE; } catch { return DEMO_TIME_ZONE; }
}

export default function DemoManage() {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [tz, setTz] = useState(DEMO_TIME_ZONE);
  const [slot, setSlot] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const autoConfirm = useRef(false);
  const slots = useDemoSlots(mode === "reschedule");

  const call = useCallback(async (t: string, body: Record<string, unknown>) => {
    const res = await fetch("/api/demo/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t, ...body }) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; booking?: View; error?: string };
    return { status: res.status, data };
  }, []);

  useEffect(() => {
    const t = window.location.hash.replace(/^#/, "");
    const a = new URLSearchParams(window.location.search).get("a");
    const zone = browserZone();
    let stale = false;
    (async () => {
      setTz(zone);
      if (!/^[A-Za-z0-9_-]{43}$/.test(t)) { setState("missing"); return; }
      setToken(t);
      try {
        const r = await call(t, { action: "view" });
        if (stale) return;
        if (r.status === 404) { setState("missing"); return; }
        if (!r.data.booking) { setState("error"); return; }
        setView(r.data.booking);
        setState("ready");
        if (a === "reschedule" && r.data.booking.status === "confirmed" && !r.data.booking.past) setMode("reschedule");
        if (a === "cancel" && r.data.booking.status === "confirmed" && !r.data.booking.past) setMode("cancel");
        if (a === "confirm") autoConfirm.current = true;
      } catch {
        if (!stale) setState("error");
      }
    })();
    return () => { stale = true; };
  }, [call]);

  const confirm = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const r = await call(token, { action: "confirm" });
      if (r.data.booking) { setView(r.data.booking); setNote({ tone: "good", text: "Thanks! We'll see you there." }); }
    } finally { setBusy(false); }
  }, [token, call]);

  // The reminders' one-tap "Yes, I'll be there", once a person is really here.
  useEffect(() => {
    if (!autoConfirm.current || !view || view.status !== "confirmed" || view.reconfirmed || view.past) return;
    autoConfirm.current = false;
    let gone = false;
    waitForHuman(() => gone).then((human) => { if (human && !gone) void confirm(); });
    return () => { gone = true; };
  }, [view, confirm]);

  async function move() {
    if (!token || !slot) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await call(token, { action: "reschedule", start: slot });
      if (r.data.booking) {
        setView(r.data.booking);
        setMode("view");
        setSlot(null);
        setNote({ tone: "good", text: "Done. Your demo has its new time, and we've emailed you the details." });
      } else if (r.data.error === "slot_taken" || r.data.error === "not_open") {
        setSlot(null);
        slots.reload();
        setNote({ tone: "bad", text: "Sorry, that time was just booked. Please pick another." });
      } else {
        setNote({ tone: "bad", text: "That didn't work. Please try again in a minute." });
      }
    } catch {
      setNote({ tone: "bad", text: "We couldn't reach SwiftCard. Check your connection and try again." });
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!token) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await call(token, { action: "cancel", reason });
      if (r.data.booking) { setView(r.data.booking); setMode("view"); setNote({ tone: "good", text: "Your demo is canceled. We've emailed you a confirmation." }); }
      else setNote({ tone: "bad", text: "That didn't work. Please try again in a minute." });
    } catch {
      setNote({ tone: "bad", text: "We couldn't reach SwiftCard. Check your connection and try again." });
    } finally { setBusy(false); }
  }

  if (state === "loading") {
    return <div className="py-16 text-center text-slate-500 text-sm" aria-busy="true">Loading your demo…</div>;
  }
  if (state === "missing" || state === "error" || !view) {
    return (
      <div className="py-12 text-center">
        <h1 className="text-slate-900 font-bold text-xl">{state === "error" ? "Something went wrong" : "We couldn't find that demo"}</h1>
        <p className="mt-2 text-slate-500 text-[0.9375rem] max-w-sm mx-auto">
          {state === "error" ? "Please reload the page in a minute." : "Open the link from your demo email again, or book a new time."}
        </p>
        <Link href="/demo" className={`${primaryCls} inline-block mt-6`}>Book a demo</Link>
      </div>
    );
  }

  const start = new Date(view.start);
  const end = new Date(view.end);
  const showNy = fmtTime(start, tz) !== fmtTime(start, DEMO_TIME_ZONE) || tzAbbr(start, tz) !== tzAbbr(start, DEMO_TIME_ZONE);
  const live = view.status === "confirmed" && !view.past;
  const newStart = slot ? new Date(slot) : null;

  return (
    <div>
      <h1 className="text-slate-900 font-bold text-[1.375rem] sm:text-[1.625rem] leading-tight tracking-tight">
        {view.status === "canceled" ? "This demo is canceled" : view.past ? "This demo has passed" : `Your demo, ${view.firstName}`}
      </h1>

      {note && (
        <p role="status" className={`mt-4 rounded-xl border px-3.5 py-3 text-[0.875rem] ${note.tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>{note.text}</p>
      )}

      <div className={`mt-5 rounded-2xl border p-5 ${view.status === "canceled" ? "border-slate-200 bg-slate-50" : "border-blue-100 bg-blue-50/60"}`}>
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-blue-700">SwiftCard Office demo · {DEMO_RULES.durationMin} min</p>
        <p className={`mt-1.5 font-bold text-[1.125rem] leading-snug ${view.status === "canceled" ? "text-slate-500 line-through" : "text-slate-900"}`}>{fmtLongDay(start, tz)}</p>
        <p className={`text-[0.9375rem] tabular-nums ${view.status === "canceled" ? "text-slate-400 line-through" : "text-slate-700"}`}>{fmtRange(start, end, tz)}</p>
        {showNy && <p className="text-slate-500 text-[0.8125rem] mt-0.5">{fmtTime(start, DEMO_TIME_ZONE)} New York time</p>}
        {live && view.reconfirmed && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[0.75rem] font-bold text-emerald-800">You confirmed you&apos;ll be there</p>}
      </div>

      {live && mode === "view" && (
        <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
          {view.meetUrl && <a href={view.meetUrl} target="_blank" rel="noopener noreferrer" className={`${primaryCls} text-center`}>Join with Google Meet</a>}
          {!view.reconfirmed && <button type="button" onClick={confirm} disabled={busy} className={view.meetUrl ? secondaryCls : primaryCls}>Yes, I&apos;ll be there</button>}
          <button type="button" onClick={() => { setNote(null); setMode("reschedule"); }} className={secondaryCls}>Pick a new time</button>
          <button type="button" onClick={() => { setNote(null); setMode("cancel"); }} className="rounded-full px-6 py-3.5 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors">Cancel demo</button>
        </div>
      )}

      {live && mode === "reschedule" && (
        <div className="mt-6">
          <h2 className="text-slate-900 font-bold text-[1rem] mb-3">Pick a new time</h2>
          <DemoTimePicker slots={slots} timeZone={tz} onTimeZone={setTz} selected={slot} onSelect={setSlot} onRetry={slots.reload} />
          <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2.5">
            <button type="button" onClick={() => { setMode("view"); setSlot(null); }} className={secondaryCls}>Keep my time</button>
            <button type="button" onClick={move} disabled={!newStart || busy} className={`${primaryCls} sm:flex-1`}>
              {busy ? "Moving…" : newStart ? `Move it to ${fmtWhen(newStart, tz)}` : "Pick a time"}
            </button>
          </div>
        </div>
      )}

      {live && mode === "cancel" && (
        <div className="mt-6">
          <h2 className="text-slate-900 font-bold text-[1rem]">Cancel this demo?</h2>
          <p className="mt-1 text-slate-500 text-[0.875rem]">The time opens up for someone else. You can always book another.</p>
          <label htmlFor="demo-cancel-reason" className="block mt-4 text-[0.8125rem] font-semibold text-slate-700 mb-1.5">Mind telling us why? <span className="font-normal text-slate-400">(optional)</span></label>
          <textarea id="demo-cancel-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[0.9375rem] text-slate-900 outline-none focus:border-blue-500 focus:bg-white focus:shadow-[0_0_0_4px_rgba(37,99,235,0.12)] resize-none" />
          <div className="mt-4 flex flex-col-reverse sm:flex-row gap-2.5">
            <button type="button" onClick={() => setMode("view")} className={secondaryCls}>Keep my demo</button>
            <button type="button" onClick={cancel} disabled={busy} className="sm:flex-1 rounded-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-sm py-3.5 px-6 transition-colors">{busy ? "Canceling…" : "Yes, cancel my demo"}</button>
          </div>
        </div>
      )}

      {!live && (
        <div className="mt-6">
          <Link href="/demo" className={`${primaryCls} inline-block`}>{view.status === "canceled" ? "Book a new time" : "Book another demo"}</Link>
        </div>
      )}
    </div>
  );
}
