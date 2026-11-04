"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CRM_OPTIONS, DEMO_LIMITS, DEMO_RULES, DEMO_TIME_ZONE, TEAM_SIZES, teamSizeFor } from "@/lib/demo/config";
import { checkDetails, type DetailErrors } from "@/lib/demo/input";
import { fmtLongDay, fmtRange, fmtTime, fmtWhen, tzAbbr } from "@/lib/demo/format";
import DemoTimePicker from "./DemoTimePicker";
import { useDemoSlots } from "./useDemoSlots";

// ── Book an Office demo: Details → Time → Confirm → Done ────────────────────
// Owner, 2026-11-03: ask for the details we need, then a calendar to pick an
// open time, then confirm; "everything that pops up" must fit cleanly. Used
// inside the pricing page's popup (DemoBookingDialog) and inline on /demo.
//
// The layout is a column: a fixed header, a body that scrolls, and a fixed
// footer holding the one primary button, so the button is always on screen.
// What they type is kept for the browser session, so closing by accident
// loses nothing.

type Step = "details" | "time" | "confirm" | "done";
const STEPS: { key: Exclude<Step, "done">; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "time", label: "Time" },
  { key: "confirm", label: "Confirm" },
];

type Draft = { name: string; email: string; phone: string; company: string; teamSize: string; role: string; crm: string; notes: string; smsOptIn: boolean };
const DRAFT_KEY = "sc_demo_draft";

type Booked = { start: string; end: string; meetUrl: string | null; email: string; calendarInvite: boolean };

const inputCls =
  "w-full rounded-xl border bg-slate-50 px-4 py-3 text-[0.9375rem] text-slate-900 placeholder-slate-400 outline-none transition-[border-color,background-color,box-shadow] focus:border-blue-500 focus:bg-white focus:shadow-[0_0_0_4px_rgba(37,99,235,0.12)]";
const labelCls = "block text-[0.8125rem] font-semibold text-slate-700 mb-1.5";
const primaryCls = "flex-1 min-w-0 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white font-bold text-sm py-3.5 px-5 transition-colors";
const secondaryCls = "shrink-0 rounded-full border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-bold text-sm py-3.5 px-5 transition-colors";

function newId(): string {
  try { if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID(); } catch { /* fall through */ }
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || DEMO_TIME_ZONE; } catch { return DEMO_TIME_ZONE; }
}

function ErrorText({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1.5 flex items-center gap-1 text-[0.75rem] font-medium text-red-600">
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0" aria-hidden><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-5a1 1 0 112 0 1 1 0 01-2 0zm.25-7.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5z" clipRule="evenodd" /></svg>
      {children}
    </p>
  );
}

function Banner({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  return (
    <div role="alert" className={`mb-4 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-[0.8125rem] leading-relaxed ${tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mt-px shrink-0" aria-hidden><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" /></svg>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function DemoBookingFlow({ variant, seats, onClose, headingId = "demo-flow-title" }: {
  /** "dialog": inside the pricing page's popup (the body scrolls). "page": /demo. */
  variant: "dialog" | "page";
  /** The Office seat picker's number, to start Team size on the right chip. */
  seats?: number | null;
  onClose?: () => void;
  headingId?: string;
}) {
  const [step, setStep] = useState<Step>("details");
  const [draft, setDraft] = useState<Draft>(() => ({
    name: "", email: "", phone: "", company: "", teamSize: teamSizeFor(seats ?? 2), role: "", crm: "", notes: "", smsOptIn: true,
  }));
  const [errors, setErrors] = useState<DetailErrors>({});
  const [trap, setTrap] = useState("");
  const [tz, setTz] = useState<string>(DEMO_TIME_ZONE);
  const [slot, setSlot] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "info"; text: React.ReactNode } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [booked, setBooked] = useState<Booked | null>(null);
  const idRef = useRef<string>("");
  const openedAt = useRef<number>(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // Open times load as soon as the flow opens, so they are ready by step 2.
  const slots = useDemoSlots(true);
  const seatsAtOpen = useRef(seats);

  // Once, when the flow opens: a booking id (a second Confirm press is the same
  // booking), the clock for the minimum fill time, their time zone, and any
  // draft from earlier in this browser session.
  useEffect(() => {
    idRef.current = newId();
    openedAt.current = Date.now();
    let saved: Partial<Draft> | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null") as Partial<Draft> | null; } catch { /* storage blocked */ }
    const zone = browserZone();
    // Deferred a frame so the restore isn't a synchronous render cascade.
    const raf = requestAnimationFrame(() => {
      setTz(zone);
      if (saved && typeof saved === "object") {
        const restored = saved;
        setDraft((d) => ({
          ...d,
          ...Object.fromEntries(Object.entries(restored).filter(([k, v]) => k in d && (typeof v === "string" || typeof v === "boolean"))),
          // The seat picker on this visit wins over an old draft's team size.
          ...(seatsAtOpen.current ? { teamSize: teamSizeFor(seatsAtOpen.current) } : {}),
        }));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (step === "done") return;
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage blocked */ }
  }, [draft, step]);

  // A new step: back to the top, and screen readers hear its heading.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    bodyRef.current?.scrollTo?.({ top: 0 });
    stepHeading.current?.focus({ preventScroll: true });
  }, [step]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (k in errors) setErrors((e) => { const n = { ...e }; delete n[k as keyof DetailErrors]; return n; });
  };

  const goTime = useCallback(() => {
    const e = checkDetails(draft);
    setErrors(e);
    if (Object.keys(e).length) {
      const first = (["name", "company", "email", "phone"] as const).find((k) => e[k]);
      if (first) document.getElementById(`demo-${first}`)?.focus();
      return;
    }
    setBanner(null);
    setStep("time");
  }, [draft]);

  async function confirm() {
    if (!slot || submitting) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch("/api/demo/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: idRef.current, ...draft, start: slot, timezone: tz, website: trap,
          elapsedMs: Date.now() - openedAt.current, source: variant === "page" ? "page" : "pricing",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: Record<string, string>; booking?: Booked; start?: string; timezone?: string };
      if (res.ok && data.booking) {
        setBooked(data.booking);
        setStep("done");
        try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage blocked */ }
        return;
      }
      if (data.error === "slot_taken" || data.error === "not_open") {
        setSlot(null);
        slots.reload();
        setStep("time");
        setBanner({ tone: "error", text: "Sorry, that time was just booked by someone else. Please pick another." });
        return;
      }
      if (data.error === "invalid" && data.fields) {
        if ("form" in data.fields) { setBanner({ tone: "error", text: data.fields.form }); return; }
        setErrors(data.fields as DetailErrors);
        setStep("details");
        return;
      }
      if (data.error === "already_booked" && data.start) {
        const when = fmtWhen(new Date(data.start), data.timezone || tz);
        setBanner({ tone: "info", text: <>You already have a demo booked for <strong>{when}</strong>. We just emailed {draft.email} the confirmation again, with a link to change it.</> });
        return;
      }
      if (data.error === "too_fast") { setBanner({ tone: "error", text: "One moment. Check your details above, then press Confirm demo again." }); return; }
      if (res.status === 429) { setBanner({ tone: "error", text: <>We can&apos;t take more bookings from here right now. Email <a className="underline" href="mailto:hello@swiftcard.me">hello@swiftcard.me</a> and we&apos;ll set it up.</> }); return; }
      setBanner({ tone: "error", text: "Something went wrong on our side and nothing was booked. Please try again." });
    } catch {
      setBanner({ tone: "error", text: "We couldn't reach SwiftCard. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const start = slot ? new Date(slot) : null;
  const end = start ? new Date(start.getTime() + DEMO_RULES.durationMin * 60_000) : null;
  const showNy = !!start && (fmtTime(start, tz) !== fmtTime(start, DEMO_TIME_ZONE) || tzAbbr(start, tz) !== tzAbbr(start, DEMO_TIME_ZONE));
  const scroll = variant === "dialog";

  return (
    <div className={`flex flex-col ${scroll ? "h-full min-h-0" : ""}`}>
      {/* Header */}
      <div className="shrink-0 px-5 sm:px-7 pt-5 sm:pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="text-slate-900 font-bold text-[1.1875rem] sm:text-[1.3125rem] leading-tight tracking-tight">Book your Office demo</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><circle cx="10" cy="10" r="7.25" /><path d="M10 6v4l2.5 1.5" strokeLinecap="round" /></svg>
                {DEMO_RULES.durationMin} min
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><path d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Google Meet
              </span>
            </p>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
            </button>
          )}
        </div>
        {step !== "done" && (
          <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.key} className="min-w-0" aria-current={i === stepIndex ? "step" : undefined}>
                <span className={`block h-1 rounded-full transition-colors ${i <= stepIndex ? "bg-blue-600" : "bg-slate-200"}`} aria-hidden />
                <span className={`mt-1.5 block text-[0.6875rem] font-semibold ${i === stepIndex ? "text-slate-900" : i < stepIndex ? "text-blue-700" : "text-slate-400"}`}>
                  <span className="sr-only">Step {i + 1} of 3: </span>{s.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Body */}
      <div ref={bodyRef} className={`px-5 sm:px-7 py-5 ${scroll ? "flex-1 min-h-0 overflow-y-auto overscroll-contain" : ""}`}>
        {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}

        {step === "details" && (
          <form id="demo-details" method="post" action="/demo" noValidate onSubmit={(e) => { e.preventDefault(); goTime(); }}>
            <h3 ref={stepHeading} tabIndex={-1} className="sr-only">Your details</h3>
            <p className="text-slate-600 text-[0.875rem] leading-relaxed mb-5">Tell us a little about you and your team, then pick a time that works.</p>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <label htmlFor="demo-name" className={labelCls}>Full name</label>
                <input id="demo-name" name="name" autoComplete="name" required maxLength={DEMO_LIMITS.name} value={draft.name} onChange={(e) => set("name", e.target.value)}
                  aria-invalid={!!errors.name} aria-describedby={errors.name ? "demo-name-err" : undefined}
                  className={`${inputCls} ${errors.name ? "border-red-400" : "border-slate-200"}`} placeholder="Alex Morgan" />
                {errors.name && <ErrorText id="demo-name-err">{errors.name}</ErrorText>}
              </div>
              <div>
                <label htmlFor="demo-company" className={labelCls}>Company</label>
                <input id="demo-company" name="company" autoComplete="organization" required maxLength={DEMO_LIMITS.company} value={draft.company} onChange={(e) => set("company", e.target.value)}
                  aria-invalid={!!errors.company} aria-describedby={errors.company ? "demo-company-err" : undefined}
                  className={`${inputCls} ${errors.company ? "border-red-400" : "border-slate-200"}`} placeholder="Morgan Realty" />
                {errors.company && <ErrorText id="demo-company-err">{errors.company}</ErrorText>}
              </div>
              <div>
                <label htmlFor="demo-email" className={labelCls}>Work email</label>
                <input id="demo-email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={DEMO_LIMITS.email} value={draft.email} onChange={(e) => set("email", e.target.value)}
                  aria-invalid={!!errors.email} aria-describedby={errors.email ? "demo-email-err" : undefined}
                  className={`${inputCls} ${errors.email ? "border-red-400" : "border-slate-200"}`} placeholder="alex@company.com" />
                {errors.email && <ErrorText id="demo-email-err">{errors.email}</ErrorText>}
              </div>
              <div>
                <label htmlFor="demo-phone" className={labelCls}>Phone</label>
                <input id="demo-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={DEMO_LIMITS.phone} value={draft.phone} onChange={(e) => set("phone", e.target.value)}
                  aria-invalid={!!errors.phone} aria-describedby={errors.phone ? "demo-phone-err" : undefined}
                  className={`${inputCls} ${errors.phone ? "border-red-400" : "border-slate-200"}`} placeholder="(555) 123-4567" />
                {errors.phone && <ErrorText id="demo-phone-err">{errors.phone}</ErrorText>}
              </div>
            </div>

            <label className="mt-3 flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" name="smsOptIn" checked={draft.smsOptIn} onChange={(e) => set("smsOptIn", e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 rounded border-slate-300 accent-blue-600" />
              <span className="text-[0.8125rem] text-slate-600 leading-snug">Text me a reminder the morning of the demo (US and Canada numbers).</span>
            </label>

            <fieldset className="mt-5">
              <legend className={labelCls}>How many people are on your team?</legend>
              <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Team size">
                {TEAM_SIZES.map((t) => {
                  const on = draft.teamSize === t;
                  return (
                    <button key={t} type="button" role="radio" aria-checked={on} onClick={() => set("teamSize", t)}
                      className={`h-11 rounded-xl border text-[0.875rem] font-semibold tabular-nums transition-colors ${on ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-blue-400"}`}>
                      {t}
                    </button>
                  );
                })}
              </div>
              {errors.teamSize && <ErrorText id="demo-team-err">{errors.teamSize}</ErrorText>}
            </fieldset>

            <div className="mt-5 grid sm:grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <label htmlFor="demo-role" className={labelCls}>Your role <span className="font-normal text-slate-400">(optional)</span></label>
                <input id="demo-role" name="role" autoComplete="organization-title" maxLength={DEMO_LIMITS.role} value={draft.role} onChange={(e) => set("role", e.target.value)}
                  className={`${inputCls} border-slate-200`} placeholder="Owner, manager…" />
              </div>
              <div>
                <label htmlFor="demo-crm" className={labelCls}>CRM you use <span className="font-normal text-slate-400">(optional)</span></label>
                <div className="relative">
                  <select id="demo-crm" name="crm" value={draft.crm} onChange={(e) => set("crm", e.target.value)} className={`${inputCls} border-slate-200 appearance-none pr-10`}>
                    <option value="">Choose one</option>
                    {CRM_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <svg viewBox="0 0 12 12" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="demo-notes" className={labelCls}>Anything you want us to cover? <span className="font-normal text-slate-400">(optional)</span></label>
              <textarea id="demo-notes" name="notes" rows={3} maxLength={DEMO_LIMITS.notes} value={draft.notes} onChange={(e) => set("notes", e.target.value)}
                className={`${inputCls} border-slate-200 resize-none`} placeholder="What your team needs, questions you have…" />
            </div>

            {/* A field people never see. Bots fill every field they find. */}
            <div aria-hidden="true" className="absolute -left-[10000px] top-auto w-px h-px overflow-hidden">
              <label htmlFor="demo-website">Website</label>
              <input id="demo-website" name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
            </div>
          </form>
        )}

        {step === "time" && (
          <div>
            <h3 ref={stepHeading} tabIndex={-1} className="text-slate-900 font-bold text-[1rem] mb-1 outline-none">Pick a time</h3>
            <p className="text-slate-500 text-[0.8125rem] mb-4">Demos run Monday to Friday and can be booked from tomorrow on. Every time shown is open.</p>
            <DemoTimePicker slots={slots} timeZone={tz} onTimeZone={setTz} selected={slot} onSelect={setSlot} onRetry={slots.reload} />
          </div>
        )}

        {step === "confirm" && start && end && (
          <div>
            <h3 ref={stepHeading} tabIndex={-1} className="text-slate-900 font-bold text-[1rem] mb-4 outline-none">Check and confirm</h3>
            <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
              <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-blue-700">Your demo</p>
              <p className="mt-1.5 text-slate-900 font-bold text-[1.125rem] leading-snug">{fmtLongDay(start, tz)}</p>
              <p className="text-slate-700 text-[0.9375rem] tabular-nums">{fmtRange(start, end, tz)}</p>
              {showNy && <p className="text-slate-500 text-[0.8125rem] mt-0.5">{fmtTime(start, DEMO_TIME_ZONE)} New York time</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-[0.8125rem] text-slate-600">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><path d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Google Meet · link sent by email
                </p>
                <button type="button" onClick={() => { setBanner(null); setStep("time"); }} className="text-[0.8125rem] font-semibold text-blue-700 hover:text-blue-800 underline-offset-2 hover:underline">Change time</button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-slate-500">Your details</p>
                <button type="button" onClick={() => { setBanner(null); setStep("details"); }} className="text-[0.8125rem] font-semibold text-blue-700 hover:text-blue-800 underline-offset-2 hover:underline">Edit</button>
              </div>
              <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.84375rem]">
                <dt className="text-slate-500">Name</dt><dd className="text-slate-900 font-medium break-words">{draft.name}</dd>
                <dt className="text-slate-500">Company</dt><dd className="text-slate-900 font-medium break-words">{draft.company}</dd>
                <dt className="text-slate-500">Email</dt><dd className="text-slate-900 font-medium break-all">{draft.email}</dd>
                <dt className="text-slate-500">Phone</dt><dd className="text-slate-900 font-medium break-words">{draft.phone}</dd>
                <dt className="text-slate-500">Team size</dt><dd className="text-slate-900 font-medium">{draft.teamSize}</dd>
                {draft.role && <><dt className="text-slate-500">Role</dt><dd className="text-slate-900 font-medium break-words">{draft.role}</dd></>}
                {draft.crm && <><dt className="text-slate-500">CRM</dt><dd className="text-slate-900 font-medium">{draft.crm}</dd></>}
              </dl>
            </div>
            <p className="mt-4 text-[0.75rem] text-slate-500 leading-relaxed text-center">
              We&apos;ll email you the Google Meet link, a calendar invite, and reminders before the demo.
            </p>
          </div>
        )}

        {step === "done" && booked && (
          <div className={`py-4 sm:py-6 text-center ${scroll ? "min-h-full flex flex-col justify-center" : ""}`}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-emerald-200 bg-emerald-50">
              <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={1.8} className="w-8 h-8" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h3 ref={stepHeading} tabIndex={-1} className="text-slate-900 font-bold text-2xl outline-none">You&apos;re booked!</h3>
            <p className="mt-2 text-slate-900 font-semibold text-[1rem]">{fmtLongDay(new Date(booked.start), tz)}</p>
            <p className="text-slate-600 text-[0.9375rem] tabular-nums">{fmtRange(new Date(booked.start), new Date(booked.end), tz)}</p>
            <p className="mt-4 text-slate-500 text-[0.875rem] leading-relaxed max-w-sm mx-auto">
              We sent the details{booked.meetUrl ? " and your Google Meet link" : ""} to <span className="font-semibold text-slate-700 break-words">{booked.email}</span>.
              {booked.calendarInvite ? " A calendar invite from hello@swiftcard.me is on its way too." : " Your Google Meet link follows by email."}
            </p>
            {booked.meetUrl && <MeetLink url={booked.meetUrl} />}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-5 sm:px-7 pt-3 pb-5 sm:pb-6 border-t border-slate-100 bg-white" style={scroll ? { paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" } : undefined}>
        {step === "details" && (
          <div className="flex"><button type="submit" form="demo-details" className={primaryCls}>Continue</button></div>
        )}
        {step === "time" && (
          <div className="flex gap-2.5">
            <button type="button" onClick={() => { setBanner(null); setStep("details"); }} className={secondaryCls}>Back</button>
            <button type="button" disabled={!slot} onClick={() => { setBanner(null); setStep("confirm"); }} className={primaryCls}>
              {slot ? `Continue · ${fmtTime(new Date(slot), tz)}` : "Pick a time"}
            </button>
          </div>
        )}
        {step === "confirm" && (
          <div className="flex gap-2.5">
            <button type="button" onClick={() => { setBanner(null); setStep("time"); }} disabled={submitting} className={secondaryCls}>Back</button>
            <button type="button" onClick={confirm} disabled={submitting} className={primaryCls} aria-busy={submitting}>{submitting ? "Booking…" : "Confirm demo"}</button>
          </div>
        )}
        {step === "done" && (
          <div className="flex">
            {onClose
              ? <button type="button" onClick={onClose} className={primaryCls}>Done</button>
              : <Link href="/pricing" className={`${primaryCls} text-center`}>Back to pricing</Link>}
          </div>
        )}
      </div>
    </div>
  );
}

function MeetLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const short = url.replace(/^https:\/\//, "");
  return (
    <div className="mt-5 mx-auto max-w-sm flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 pl-3.5 pr-1.5 py-1.5">
      <svg viewBox="0 0 24 24" className="w-4 h-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><path d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-left text-[0.8125rem] font-semibold text-blue-700 hover:underline">{short}</a>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ } }}
        className="shrink-0 rounded-lg px-3 h-9 text-[0.75rem] font-bold text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 transition-colors">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
