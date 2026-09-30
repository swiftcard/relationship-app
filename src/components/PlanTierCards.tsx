"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { PLAN_LIMITS, PLAN_PRICES } from "@/lib/plan";
import { PLAN_FEATURES, PLAN_DESCRIPTIONS, money } from "@/lib/plan-content";
import { formatCents, formatUsd, seatSubtotalCents, perMonthCents } from "@/lib/currency";
import ProTrialPrice from "@/components/ProTrialPrice";

// ── THE plan cards ───────────────────────────────────────────────────────────
//
// One set of Free / Pro / Office cards for every place a plan is chosen:
// /pricing, the plan step after signing up (/welcome and the builder's plan
// step, web AND the iPhone app), and /upgrade. Owner, 2026-09-30: "anywhere
// else there's that same pricing plan, it should look the exact same … how it
// does on the website's pricing right now." The markup here IS /pricing's,
// moved; each surface fills the slots (price, button, fine print) and keeps
// its own logic. A card drawn anywhere else can drift, and did — the app's
// plan step had no tabs, no Monthly / Annual switch, and its own Pro card.
//
// Presentational only: no fetching, no checkout. The one piece of state is
// the seat picker's half-typed Custom value.

const OFFICE_MIN_SEATS = PLAN_LIMITS.OFFICE_MIN_SEATS;

/** A plan card that is not the open tab: hidden at phone width, by CSS alone.
 *  It used to be a JS width check, false until hydration, so a phone painted
 *  all three cards stacked and then snapped to the open one. */
const tierClass = (offTab?: boolean) => (offTab ? "max-md:hidden" : "");

/** Homepage checklist style: a white tick in a brand-gradient dot. On the Pro
 *  card (itself the gradient) the dot is translucent white instead. */
function PlanCheck({ pro }: { pro?: boolean }) {
  return (
    <span className="w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 mt-px" style={{ background: pro ? "rgba(255,255,255,0.24)" : "var(--rd-aurora)" }}>
      <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke="#ffffff" strokeWidth={2.6}>
        <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// The buttons, by plan. Exported so a button rendered elsewhere (the app's
// In-App Purchase button, given PRO_CTA_CLASS by PlanCards) wears exactly the
// same class.
export const FREE_CTA_CLASS = "w-full text-center font-bold py-3.5 rounded-full text-sm bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-900 border border-slate-300 transition-colors";
export const PRO_CTA_CLASS = "w-full bg-white hover:bg-white/90 disabled:opacity-50 text-[#2450d8] font-bold py-3.5 rounded-full transition-colors text-sm shadow-lg";
export const PRO_CTA_LINK_CLASS = "block w-full text-center bg-white hover:bg-white/90 text-[#2450d8] font-bold py-3.5 rounded-full transition-colors text-sm shadow-lg";
export const OFFICE_CTA_CLASS = "w-full font-bold py-3.5 px-3 rounded-full text-sm leading-tight bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors break-words";
export const OFFICE_CTA_LINK_CLASS = "block w-full text-center font-bold py-3.5 px-3 rounded-full text-sm leading-tight bg-blue-600 hover:bg-blue-500 text-white transition-colors break-words";
export const PRO_FINE_PRINT_CLASS = "text-white/70 text-[0.6875rem] text-center mt-2.5 leading-relaxed";
export const OFFICE_FINE_PRINT_CLASS = "text-slate-500 text-[0.6875rem] text-center mt-2.5 leading-relaxed";

/** What annual saves on the web (PLAN_PRICES: $54 vs 12 × $4.99). */
const WEB_SAVE_BADGE = "SAVE 10%";

/** The three cards' grid. md:pt-6 makes room for Pro sitting higher. */
export const PLAN_GRID_CLASS = "grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch md:pt-6";

/**
 * Monthly / Annual. `hideOnPhone` (the Free tab is open, where the switch
 * changes nothing) keeps its space — invisible, not removed — so the tabs
 * under it don't jump. visibility:hidden also takes it out of the
 * accessibility tree, so no aria-hidden is needed.
 */
export function BillingToggle({
  annual,
  onToggle,
  saveBadge = WEB_SAVE_BADGE,
  badgePending = false,
  hideOnPhone = false,
  className = "",
  reveal = false,
}: {
  annual: boolean;
  onToggle: () => void;
  /** null hides the badge — the app shows it only once StoreKit's own
   *  prices say what annual saves. */
  saveBadge?: string | null;
  /** The badge isn't known yet (StoreKit still answering): hold its width,
   *  invisibly, so the switch doesn't widen and shift when it arrives. */
  badgePending?: boolean;
  hideOnPhone?: boolean;
  className?: string;
  /** /pricing's scroll-in fade. Only pages that mount ScrollReveal may set
   *  it: anywhere else the element would stay at opacity 0. */
  reveal?: boolean;
}) {
  return (
    <div className={`inline-flex items-center gap-4 rounded-full px-5 py-2.5 border border-slate-200 bg-slate-50 ${hideOnPhone ? "max-md:invisible" : ""} ${className}`} data-reveal={reveal ? "fade" : undefined}>
      <span className={`text-sm font-medium transition-colors ${!annual ? "text-slate-900 font-bold" : "text-slate-600"}`}>Monthly</span>
      <button type="button" onClick={onToggle} aria-label="Toggle annual billing" aria-pressed={annual} className="relative w-11 h-6 rounded-full transition-colors duration-200" style={{ background: annual ? "#2563EB" : "#cbd5e1" }}>
        <div className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200" style={{ transform: annual ? "translateX(22px)" : "translateX(2px)" }} />
      </button>
      <span className={`text-sm font-medium transition-colors ${annual ? "text-slate-900 font-bold" : "text-slate-600"}`}>
        Annual{(saveBadge || badgePending) && <> <span className={`ml-1 text-[0.625rem] font-black text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded-full ${saveBadge ? "" : "invisible"}`}>{saveBadge || WEB_SAVE_BADGE}</span></>}
      </span>
    </div>
  );
}

type CardProps = {
  /** Not the open tab (MobilePlanTabs): hidden at phone width. */
  offTab?: boolean;
  /** See BillingToggle.reveal. */
  reveal?: boolean;
};

/** Free Forever. The button is the caller's: /pricing starts the builder,
 *  the plan step settles the plan. */
export function FreePlanCard({ cta, offTab, reveal }: CardProps & { cta: ReactNode }) {
  return (
    <div data-reveal={reveal ? "" : undefined} className={`${tierClass(offTab)} rounded-[28px] p-6 sm:p-8 flex flex-col bg-white border border-slate-200 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.3)]`}>
      {/* "Forever" inherits the heading's size/weight/font from this <p>;
          the span overrides ONLY the color. */}
      <p className="text-[1.4rem] font-extrabold tracking-tight text-slate-900 mb-3">Free <span className="text-slate-500">Forever</span></p>
      <div className="flex items-end gap-1 mb-1"><span className="text-[2.6rem] font-bold text-slate-900 leading-none">$0</span><span className="text-slate-500 text-sm mb-1">/ month</span></div>
      <p className="text-slate-500 text-sm mb-7 mt-2">{PLAN_DESCRIPTIONS.free}</p>
      <ul className="space-y-2.5 mb-8 flex-1">
        {PLAN_FEATURES.free.map((f) => (<li key={f} className="flex items-start gap-2.5 text-[0.84375rem] text-slate-500"><PlanCheck />{f}</li>))}
      </ul>
      {cta}
    </div>
  );
}

/**
 * Pro — deliberately not a peer of the other two: it sits taller, on top, and
 * is the only card with the aurora fill, so the eye lands on it first.
 *
 * sc-dark-sheet: this card is dark ink-on-gradient in EVERY theme. Inside the
 * app's light theme (.sc-app) `.text-white` is remapped to near-black, which
 * turned the feature list black on blue on the plan step.
 */
export function ProPlanCard({
  price,
  children,
  offTab,
  reveal,
}: CardProps & {
  /** The price block: ProWebPrice on the web, StoreKit's price in the app. */
  price: ReactNode;
  /** Button, fine print and any error, under the feature list. */
  children: ReactNode;
}) {
  const style: CSSProperties = { background: "var(--rd-aurora)", boxShadow: "0 40px 90px -30px rgba(37,99,235,0.6)" };
  if (reveal) style.transitionDelay = "90ms";
  return (
    <div data-reveal={reveal ? "" : undefined} className={`${tierClass(offTab)} sc-dark-sheet relative rounded-[28px] p-6 sm:p-8 flex flex-col overflow-hidden md:-mt-6 md:mb-0 md:z-10 ring-1 ring-blue-500/20`} style={style}>
      <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(120% 90% at 20% -10%, rgba(255,255,255,0.6), transparent 55%)" }} />
      <div className="absolute top-6 right-6 z-[4] bg-white/25 text-white text-[0.6875rem] font-bold px-3 py-1 rounded-full">MOST POPULAR</div>
      <div className="relative z-[2] flex flex-col flex-1">
        <p className="text-[1.4rem] font-extrabold tracking-tight text-black mb-3">Pro</p>
        {price}
        <p className="text-white/80 text-sm mb-7 mt-4">{PLAN_DESCRIPTIONS.pro}</p>
        <ul className="space-y-2.5 mb-8 flex-1">
          {PLAN_FEATURES.pro.map((f) => (<li key={f} className="flex items-start gap-2.5 text-[0.84375rem] text-white"><PlanCheck pro />{f}</li>))}
        </ul>
        {children}
      </div>
    </div>
  );
}

/**
 * The website's Pro price. "Free for your first 14 days, then $X" (owner-
 * approved 2026-08-19) — the word Free IS the price block, the real price
 * stated plainly under it. `trial` false (the account already had its free Pro
 * period, or already has Pro/Office) shows the plain price.
 */
export function ProWebPrice({ annual, trial }: { annual: boolean; trial: boolean }) {
  const monthly = PLAN_PRICES.PRO_MONTHLY_CENTS / 100;
  const yearly = PLAN_PRICES.PRO_ANNUAL_CENTS / 100;
  if (!trial) {
    return <div className="flex items-end gap-1"><span className="text-[2.6rem] font-bold text-white leading-none">{annual ? `$${yearly}` : `$${monthly}`}</span><span className="text-white/80 text-sm mb-1">/ {annual ? "year" : "month"}</span></div>;
  }
  return annual
    ? <ProTrialPrice price={`$${yearly}`} period="year" note={`~$${money(yearly / 12)}/mo · Save 10%`} />
    : <ProTrialPrice price={`$${monthly}`} period="month" />;
}

/** Office, for teams. On the web the price and the seat picker fill `price`
 *  and `seatPicker`; in the app it carries neither (App Review 3.1.1). */
export function OfficePlanCard({
  price,
  seatPicker,
  children,
  offTab,
  reveal,
}: CardProps & {
  price: ReactNode;
  seatPicker?: ReactNode;
  /** Button and any fine print, under the feature list. */
  children: ReactNode;
}) {
  return (
    <div data-reveal={reveal ? "" : undefined} style={reveal ? { transitionDelay: "180ms" } : undefined} className={`${tierClass(offTab)} rounded-[28px] p-6 sm:p-8 flex flex-col bg-white border border-slate-200 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.3)]`}>
      <div className="flex items-center gap-2 mb-3">
        <p className="text-[1.4rem] font-extrabold tracking-tight text-slate-900">Office</p>
        <span className="text-[0.625rem] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">FOR TEAMS</span>
      </div>
      {price}
      {seatPicker}
      <ul className="space-y-2.5 mb-8 flex-1">
        {PLAN_FEATURES.office.map((f) => (<li key={f} className="flex items-start gap-2.5 text-[0.84375rem] text-slate-600"><PlanCheck />{f}</li>))}
      </ul>
      {children}
    </div>
  );
}

/** What `seats` Office seats cost for the period: "$99.80/mo" / "$1,077.84/yr". */
export function officeTotalLabel(annual: boolean, seats: number): string {
  return annual
    ? `${formatUsd(seatSubtotalCents(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS, seats))}/yr`
    : `${formatUsd(seatSubtotalCents(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS, seats))}/mo`;
}

/** The website's Office price: per user per month, the minimum, the total. */
export function OfficeWebPrice({ annual, seats }: { annual: boolean; seats: number }) {
  return (
    <div className="mb-1">
      <div className="flex items-end gap-1"><span className="text-[2.6rem] font-bold text-slate-900 leading-none">${annual ? formatCents(perMonthCents(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS)) : formatCents(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS)}</span><span className="text-slate-500 text-sm mb-1">/ mo per user</span></div>
      <p className="text-blue-600 text-xs font-semibold mt-1.5">Minimum {OFFICE_MIN_SEATS} users{annual ? " · billed annually, save 10%" : ""}</p>
      <p className="text-slate-800 font-bold text-[0.8125rem] mt-1">{seats} users → {officeTotalLabel(annual, seats)}</p>
    </div>
  );
}

/** Team size: the presets and a Custom box. */
export function OfficeSeatPicker({ seats, onSeats }: { seats: number; onSeats: (n: number) => void }) {
  // What is being TYPED in the Custom box, clamped only on blur. Clamping each
  // keystroke turned the "1" of "12" into 2, so 10–19 could not be typed.
  const [seatsDraft, setSeatsDraft] = useState<string | null>(null);
  return (
    <div className="mt-4 mb-6">
      <label className="text-xs text-slate-600 font-medium block mb-2">Team size</label>
      <div className="flex gap-2 flex-wrap">
        {[2, 5, 10, 25, 50].map((n) => (
          <button key={n} type="button" onClick={() => onSeats(n)} className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
            style={{ background: seats === n ? "#2563EB" : "#f1f5f9", color: seats === n ? "#fff" : "#475569", border: seats === n ? "none" : "1px solid #e2e8f0" }}>{n} users</button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label htmlFor="office-seats" className="text-xs text-slate-500">Custom:</label>
        <input id="office-seats" aria-label="Number of team seats" type="number" min={OFFICE_MIN_SEATS} value={seatsDraft ?? seats}
          onChange={(e) => { setSeatsDraft(e.target.value); const n = Math.floor(Number(e.target.value)); if (n >= OFFICE_MIN_SEATS) onSeats(n); }}
          onBlur={() => setSeatsDraft(null)}
          className="w-20 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 bg-white border border-slate-200 focus:outline-none" />
        <span className="text-xs text-slate-500">users</span>
      </div>
      <p className="text-slate-500 text-[0.6875rem] mt-2">No cap on team size — add more seats anytime from your account as you grow.</p>
    </div>
  );
}
