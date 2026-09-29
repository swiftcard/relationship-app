"use client";

// ── Guided tour engine ──────────────────────────────────────────────────────
// Mounted once, globally (in the root layout). Dormant until a tour starts.
// While running it:
//   • dims the whole screen and cuts a spotlight hole around the current element
//   • shows a positioned tooltip with Back / Next / Skip / Finish
//   • auto-scrolls the element into view and keeps the spotlight glued to it
//   • navigates between pages when the next step lives elsewhere, then resumes
//   • skips steps whose element isn't on the page (e.g. a Pro-only control)
//
// Positioning is done imperatively in a requestAnimationFrame loop (refs, not
// React state) so scrolling and layout shifts stay perfectly in sync without a
// re-render every frame. React only re-renders when the step index changes.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TOUR_STEPS, buildTourSteps, resolveTourPath, type TourStep } from "@/lib/tour-steps";
import {
  TOUR_RUNNING, TOUR_INDEX, TOUR_CARD, TOUR_START_EVENT, endTour, readTourContext,
} from "@/lib/tour";

const PAD = 8;        // spotlight padding around the element
const GAP = 14;       // gap between spotlight and tooltip
const TIP_W = 340;    // tooltip width (also used for clamping)
const FIND_TRIES = 24; // ~2.9s of polling before giving up on a missing element
// While the route's loading skeleton is still up, the page hasn't arrived —
// nothing on it can be "missing" yet. Those polls don't spend FIND_TRIES, up
// to this cap (~20s) so a page that never finishes can't hold the tour forever.
const LOADING_WAITS = 165;

// Every route skeleton (PortalSkeleton, the dashboard's loading switch) marks
// itself <main aria-busy="true">. The tour navigates with router.push, and
// with a loading.tsx the pathname flips to the new route as soon as the
// SKELETON shows — so the anchor search used to run its 2.9s against a page
// still being rendered on the server, and on a slow load (Settings, most of
// all) it gave up and skipped a step that was about to appear.
function routeStillLoading(): boolean {
  return !!document.querySelector('main[aria-busy="true"]');
}
// Route pushes for one step before we treat its page as unreachable. Small on
// purpose: a page that redirects away bounces on the FIRST attempt, and every
// retry is a wasted navigation the user watches.
const NAV_TRIES = 2;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// First on-screen element matching the anchor (there can be mobile + desktop
// copies of the same thing; we want whichever is actually visible).
function findAnchor(anchor: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none") return el;
  }
  return null;
}

type Props = {
  /**
   * The ordered step list to run. When omitted (the main dashboard tour), the
   * list is built PER PLAN from the persisted account context so it only ever
   * describes what this account has. Passing an explicit list (e.g. the Office
   * admin tour) opts out of plan-tailoring and runs exactly that list.
   */
  steps?: TourStep[];
  /** sessionStorage keys — pass a distinct set to run an independent tour. */
  runningKey?: string;
  indexKey?: string;
  cardKey?: string;
  /** Custom-event name that (re)starts this tour instance. */
  startEvent?: string;
  /** Called instead of the default endTour()+redirect-to-dashboard behavior. */
  onFinish?: (completed: boolean) => void;
  /**
   * Go dormant while the route starts with this prefix — a section that another
   * tour instance owns.
   *
   * Without it the MAIN tour made the Office admin console unreachable. This
   * instance is mounted in the ROOT layout, so it is alive on /office/admin too,
   * and the step-resolve effect below treats "the current step isn't on this
   * page" as "navigate to where it lives". A new Office owner with an unfinished
   * dashboard tour therefore got pushed straight back to /dashboard every time
   * they opened Admin, and the admin tour never got a chance to run.
   *
   * Dormant, not ended: the step and index are untouched, so returning to the
   * dashboard resumes exactly where they were.
   */
  pausePathPrefix?: string;
};

export default function GuidedTour({
  steps: propSteps,
  runningKey = TOUR_RUNNING,
  indexKey = TOUR_INDEX,
  cardKey = TOUR_CARD,
  startEvent = TOUR_START_EVENT,
  onFinish,
  pausePathPrefix,
}: Props = {}) {
  const router = useRouter();
  const pathname = usePathname();

  // Dormant on a section another tour owns. Checked BEFORE the step-resolve
  // effect can decide to navigate, which is the whole point — otherwise this
  // instance drags the visitor out of that section and back to its own step.
  const paused = !!pausePathPrefix && !!pathname && pathname.startsWith(pausePathPrefix);

  const [running, setRunning] = useState(false);
  const [idx, setIdx] = useState(0);
  // Plan-tailored steps for the main tour. Rebuilt from the persisted account
  // context each time the tour starts (see boot()). An explicit `propSteps`
  // (Office admin tour) always wins and skips the plan tailoring. Falls back to
  // the full base list until context is read.
  const [builtSteps, setBuiltSteps] = useState<TourStep[]>(TOUR_STEPS);
  const steps = propSteps ?? builtSteps;
  // Bumped whenever the spotlight target is (re)resolved, so the render reads
  // fresh clickToAdvance state. Positions themselves are handled by the rAF loop.
  const [, forceTick] = useState(0);

  const step: TourStep | null = running ? steps[idx] ?? null : null;

  // The resolve effect and its polling run inside a closure that must NOT read a
  // stale `idx` — otherwise a skip computes the wrong next step. Mirror idx into
  // a ref that's always current and use that ref for all index math.
  const idxRef = useRef(0);
  idxRef.current = idx;

  // Direction of travel, so a missing element skips the RIGHT way (fwd/back).
  const dirRef = useRef(1);
  // Route pushes spent trying to reach the current step's page, so a page that
  // redirects away is skipped instead of pushed forever. Keyed by step index:
  // a different step starts its own budget, and Back re-earns one.
  const navTriesRef = useRef<{ step: number; n: number }>({ step: -1, n: 0 });
  const targetRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Overlay node refs — mutated directly in the rAF loop.
  const maskT = useRef<HTMLDivElement>(null);
  const maskB = useRef<HTMLDivElement>(null);
  const maskL = useRef<HTMLDivElement>(null);
  const maskR = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const holeCover = useRef<HTMLDivElement>(null);
  const corners = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);

  // ── Persist index so a page navigation can resume the tour ────────────────
  const persist = useCallback((i: number) => {
    try {
      sessionStorage.setItem(runningKey, "1");
      sessionStorage.setItem(indexKey, String(i));
    } catch { /* ignore */ }
  }, [runningKey, indexKey]);

  const finish = useCallback((completed: boolean) => {
    setRunning(false);
    targetRef.current = null;
    if (onFinish) {
      onFinish(completed);
      return;
    }
    endTour(completed);
    // When the tour ends, land the user on their dashboard.
    router.push("/dashboard");
  }, [router, onFinish]);

  const go = useCallback((next: number) => {
    if (next < 0) return;
    if (next >= steps.length) { finish(true); return; }
    dirRef.current = next >= idxRef.current ? 1 : -1;
    persist(next);
    setIdx(next);
  }, [persist, finish, steps.length]);

  // ── Start / resume: read sessionStorage on mount and on the start event ───
  useEffect(() => {
    function boot() {
      let active = false, i = 0;
      try {
        active = sessionStorage.getItem(runningKey) === "1";
        i = parseInt(sessionStorage.getItem(indexKey) || "0", 10) || 0;
      } catch { /* ignore */ }
      if (!active) return;
      // Main tour: (re)build the plan-tailored list from the account context now,
      // so a resume on a fresh page load uses the same variant. The admin tour
      // passes its own list and skips this.
      const list = propSteps ?? buildTourSteps(readTourContext());
      if (!propSteps) setBuiltSteps(list);
      setIdx(Math.min(Math.max(i, 0), list.length - 1));
      setRunning(true);
    }
    boot();
    window.addEventListener(startEvent, boot);
    return () => window.removeEventListener(startEvent, boot);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys are stable per instance
  }, []);

  // ── Resolve the current step: navigate if needed, else find + scroll to it ─
  // Keyed on the PRIMITIVE idx (not the step object) so the effect only re-runs
  // when the step genuinely changes — never from an unrelated re-render, which
  // would otherwise reset the find-polling and could strand a skip.
  useEffect(() => {
    if (!running || paused) return;
    const cur = steps[idx];
    if (!cur) return;

    // Wrong page for this step → go there; this effect re-runs after the route
    // changes (pathname is a dependency) and we resume on arrival.
    //
    // NAV_TRIES exists because "push and wait for pathname" assumes the push
    // lands. Some tour pages bounce: /share redirects to /dashboard for an
    // account with no cards, so the push changed pathname to /dashboard, this
    // effect re-ran, saw the wrong page again, and pushed /share again — a
    // redirect loop under a full-screen scrim with no tooltip and no way out
    // but Escape. Counting attempts per step turns an unreachable page into a
    // skipped step, which is what the missing-anchor path already does.
    if (cur.path !== pathname) {
      const attempts = (navTriesRef.current.step === idx ? navTriesRef.current.n : 0) + 1;
      navTriesRef.current = { step: idx, n: attempts };
      if (attempts > NAV_TRIES) {
        const nextIdx = idxRef.current + dirRef.current;
        if (nextIdx < 0 || nextIdx >= steps.length) { finish(true); return; }
        go(nextIdx);
        return;
      }
      let card: string | null = null;
      try { card = sessionStorage.getItem(cardKey); } catch { /* ignore */ }
      router.push(resolveTourPath(cur, card));
      return;
    }
    // Arrived — this step gets a fresh budget if it is ever revisited via Back.
    if (navTriesRef.current.step === idx) navTriesRef.current = { step: -1, n: 0 };

    // Settings steps: open the target section BEFORE looking for its anchor.
    // SettingsShell shows one section at a time and reacts to the #hash, so a
    // step whose anchor lives in a collapsed section would otherwise never be
    // found. replaceState + a synthetic hashchange switches the panel without
    // pushing a history entry. The anchor polling below waits for it to render.
    if (cur.section) {
      try {
        if (window.location.hash !== `#${cur.section}`) {
          window.history.replaceState(null, "", `#${cur.section}`);
          window.dispatchEvent(new Event("hashchange"));
        }
      } catch { /* ignore */ }
    }

    // Centered message (no anchor) — nothing to find.
    if (!cur.anchor) {
      targetRef.current = null;
      // Forces a re-render to re-resolve the anchorless step.
      forceTick((n) => n + 1);
      startLoop();
      return () => stopLoop();
    }

    let tries = 0;
    let loadingWaits = 0;
    let cancelled = false;
    let cleanupClick: (() => void) | undefined;

    const tryFind = () => {
      if (cancelled) return;
      const el = findAnchor(cur.anchor!);
      if (el) {
        targetRef.current = el;
        el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center", inline: "nearest" });
        forceTick((n) => n + 1);
        startLoop();
        if (cur.clickToAdvance) {
          const onClick = (e: Event) => { e.preventDefault(); e.stopPropagation(); go(idxRef.current + 1); };
          el.addEventListener("click", onClick, { capture: true });
          cleanupClick = () => el.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
        }
        return;
      }
      if (routeStillLoading() && ++loadingWaits < LOADING_WAITS) {
        window.setTimeout(tryFind, 120);
        return;
      }
      if (++tries >= FIND_TRIES) {
        // Element genuinely isn't here — skip in the direction we're moving.
        const nextIdx = idxRef.current + dirRef.current;
        if (nextIdx < 0 || nextIdx >= steps.length) { finish(true); return; }
        go(nextIdx);
        return;
      }
      window.setTimeout(tryFind, 120);
    };
    tryFind();

    return () => { cancelled = true; cleanupClick?.(); stopLoop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, running, pathname, paused]);

  // ── Keep the spotlight glued to the element ───────────────────────────────
  // rAF gives buttery tracking while the tab is visible. We ALSO position once
  // synchronously (so the first paint is correct, no flash) and on scroll/resize
  // (so it still tracks if rAF is throttled, e.g. a backgrounded tab).
  //
  // PERF: the naive version of this loop wrote styles to 7 overlay nodes and
  // called getComputedStyle/offsetWidth every frame. Each write dirties layout,
  // so the NEXT frame's getBoundingClientRect forces a synchronous reflow —
  // 60fps layout thrash that made the whole tour feel laggy on a busy
  // dashboard. Now everything expensive is cached (tooltip size per step,
  // border-radius per target) and the frame bails out before ANY write when
  // the target hasn't moved — a steady-state frame is a single cheap rect read.
  const measureRef = useRef<{
    el: HTMLElement | null;   // target the radius cache belongs to
    radius: string;           // cached computed border-radius for the ring
    tipStep: number;          // step the tooltip size was measured for
    tipW: number;
    tipH: number;
    sig: string;              // last-applied layout signature (bail when equal)
    nudgedStep: number;       // step the page was already nudged for (once each)
    nudgeT?: ReturnType<typeof setTimeout>;
  }>({ el: null, radius: "12px", tipStep: -1, tipW: TIP_W, tipH: 160, sig: "", nudgedStep: -1 });

  function startLoop() {
    stopLoop();
    measureRef.current.sig = ""; // new target/step → force one full layout pass
    layout(); // immediate — don't wait for the first animation frame
    const frame = () => {
      layout();
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    window.addEventListener("scroll", layout, true);
    window.addEventListener("resize", onResize);
  }
  function stopLoop() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    window.removeEventListener("scroll", layout, true);
    window.removeEventListener("resize", onResize);
  }
  function onResize() {
    // Viewport changed → cached tooltip size may be stale (width clamp) and the
    // bail signature no longer matches reality. Remeasure + relayout.
    measureRef.current.tipStep = -1;
    measureRef.current.sig = "";
    layout();
  }

  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const el = targetRef.current;
    const tipEl = tip.current;
    const m = measureRef.current;

    // Tooltip size: fixed width + step-dependent content → only remeasure when
    // the step changes (or after a resize), never per frame.
    if (tipEl && m.tipStep !== idxRef.current) {
      m.tipW = tipEl.offsetWidth || TIP_W;
      m.tipH = tipEl.offsetHeight || 160;
      m.tipStep = idxRef.current;
    }

    // No target → full-screen dim + centered tooltip.
    if (!el) {
      const sig = `c|${W}|${H}|${m.tipW}|${m.tipH}`;
      if (sig === m.sig) return;
      m.sig = sig;
      if (full.current) { full.current.style.opacity = "1"; full.current.style.pointerEvents = "auto"; }
      [maskT, maskB, maskL, maskR].forEach((mm) => mm.current && (mm.current.style.opacity = "0"));
      if (ring.current) ring.current.style.opacity = "0";
      if (holeCover.current) holeCover.current.style.opacity = "0";
      if (corners.current) corners.current.style.opacity = "0";
      if (tipEl) {
        tipEl.style.left = `${Math.round((W - m.tipW) / 2)}px`;
        tipEl.style.top = `${Math.round((H - m.tipH) / 2)}px`;
        tipEl.style.visibility = "visible";
      }
      return;
    }

    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, r.left - PAD), y0 = Math.max(0, r.top - PAD);
    const x1 = Math.min(W, r.right + PAD), y1 = Math.min(H, r.bottom + PAD);
    const hw = Math.max(0, x1 - x0), hh = Math.max(0, y1 - y0);

    // Bail before ANY write when nothing moved — keeps layout clean so the rect
    // read above stays cheap (no forced reflow) on every idle frame.
    const clickable = !!(step?.clickToAdvance || step?.interactive);
    const sig = `${x0}|${y0}|${x1}|${y1}|${W}|${H}|${m.tipW}|${m.tipH}|${clickable ? 1 : 0}`;
    if (sig === m.sig) return;
    m.sig = sig;

    // Hidden AND out of the way. It used to go transparent but keep catching
    // every tap, full-screen and above the page — so the spotlight hole was
    // never actually open: an "interactive" step ("Your SwiftCard — try it",
    // which invites you to tap the card) or a clickToAdvance step could
    // not be clicked at all. The four masks and the hole cover below are what
    // block the rest of the page during a spotlight step.
    if (full.current) { full.current.style.opacity = "0"; full.current.style.pointerEvents = "none"; }

    // Four dim rectangles framing the hole.
    setBox(maskT.current, 0, 0, W, y0);
    setBox(maskB.current, 0, y1, W, H - y1);
    setBox(maskL.current, 0, y0, x0, hh);
    setBox(maskR.current, x1, y0, W - x1, hh);
    [maskT, maskB, maskL, maskR].forEach((mm) => mm.current && (mm.current.style.opacity = "1"));

    // Spotlight ring (visual only). Computed border-radius is cached per target.
    if (ring.current) {
      if (m.el !== el) {
        const cs = getComputedStyle(el);
        m.radius = cs.borderRadius && cs.borderRadius !== "0px" ? cs.borderRadius : "12px";
        m.el = el;
      }
      setBox(ring.current, x0, y0, hw, hh);
      ring.current.style.borderRadius = m.radius;
      ring.current.style.opacity = "1";
    }
    // Dim the hole's corners outside the ring's rounded shape. The four masks
    // cut a SQUARE hole, so a round target (the help bubble, the bell) sat in
    // a bright square with the round ring drawn inside it. Visual only — it
    // never takes a tap, so clickable steps behave exactly as before.
    if (corners.current) {
      setBox(corners.current, x0, y0, hw, hh);
      const shape = corners.current.firstElementChild as HTMLElement | null;
      if (shape) shape.style.borderRadius = m.radius;
      corners.current.style.opacity = "1";
    }
    // Click blocker over the hole — present unless this step invites a click
    // (clickToAdvance) or lets the visitor genuinely use the control (interactive).
    if (holeCover.current) {
      setBox(holeCover.current, x0, y0, hw, hh);
      holeCover.current.style.opacity = clickable ? "0" : "1";
      holeCover.current.style.pointerEvents = clickable ? "none" : "auto";
    }

    // Tooltip: try the preferred side, fall back to whatever fits.
    if (tipEl) {
      const tw = m.tipW, th = m.tipH;
      const place = step?.placement ?? "bottom";
      let top: number, left: number;
      const fitsBelow = y1 + GAP + th <= H, fitsAbove = y0 - GAP - th >= 0;
      const fitsRight = x1 + GAP + tw <= W, fitsLeft = x0 - GAP - tw >= 0;

      const below = () => { top = y1 + GAP; left = clamp(r.left + r.width / 2 - tw / 2, W - tw); };
      const above = () => { top = y0 - GAP - th; left = clamp(r.left + r.width / 2 - tw / 2, W - tw); };
      const right = () => { left = x1 + GAP; top = clamp(r.top + r.height / 2 - th / 2, H - th); };
      const left_ = () => { left = x0 - GAP - tw; top = clamp(r.top + r.height / 2 - th / 2, H - th); };

      if (place === "bottom" && fitsBelow) below();
      else if (place === "top" && fitsAbove) above();
      else if (place === "right" && fitsRight) right();
      else if (place === "left" && fitsLeft) left_();
      else if (fitsBelow) below();
      else if (fitsAbove) above();
      else if (fitsRight) right();
      else if (fitsLeft) left_();
      else {
        top = clamp(y1 + GAP, H - th); left = clamp(r.left + r.width / 2 - tw / 2, W - tw);
        // Nothing fits with the target where scrollIntoView left it (centred),
        // but target and tooltip DO fit stacked. On a phone the "Your SwiftCard —
        // try it" card is ~310px tall: centred, the tooltip was clamped over the
        // card's lower half — over the very card the step asks them to tap. Once the scroll has settled, move the page up just enough
        // for the tooltip to sit underneath (once per step; the next frame lays
        // out "below" with the new rect).
        if (m.nudgedStep !== idxRef.current && (y1 - y0) + GAP + th + 16 <= H) {
          if (m.nudgeT) clearTimeout(m.nudgeT);
          m.nudgeT = setTimeout(() => {
            const t = targetRef.current;
            if (!t || m.nudgedStep === idxRef.current) return;
            const rr = t.getBoundingClientRect();
            const need = rr.bottom + PAD + GAP + m.tipH + 8 - window.innerHeight;
            if (need > 0 && rr.top - PAD - need >= 64) {
              m.nudgedStep = idxRef.current;
              window.scrollBy({ top: need, behavior: prefersReducedMotion() ? "auto" : "smooth" });
            }
          }, 400);
        }
      }

      tipEl.style.left = `${Math.round(left!)}px`;
      tipEl.style.top = `${Math.round(top!)}px`;
      tipEl.style.visibility = "visible";
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Not while paused: on /office/admin this (hidden) tour and the admin tour
  // could both be running, and Escape here finished the MAIN tour — which
  // pushes /dashboard — dragging the admin out of the console mid-tour.
  useEffect(() => {
    if (!running || paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(true); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, paused, idx, go, finish]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- stopLoop is redefined each render but only its cleanup-on-unmount behavior matters here
  useEffect(() => () => stopLoop(), []);

  // Dormant on a section another tour owns — render NOTHING. This matters as
  // much as skipping the navigation above: the dim-while-navigating branch below
  // triggers whenever the step's path differs from the current one, which on
  // that section is always true, so an unfinished tour would drape a dark scrim
  // over a page it has no business touching.
  if (paused) return null;

  if (!step) return null;

  // While navigating to another page, keep the screen dimmed (instead of
  // unmounting everything) so the step change reads as one continuous motion
  // rather than a bright flash of the raw page mid-tour.
  if (step.path !== pathname) {
    return (
      <div className="sc-tour" aria-hidden="true">
        <div className="fixed inset-0 z-[9998]" style={{ background: "rgba(3,7,18,0.80)", pointerEvents: "auto" }} />
      </div>
    );
  }

  const isLast = idx === steps.length - 1;
  const isFirst = idx === 0;

  return (
    <div className="sc-tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* Centered-step full dim */}
      <div ref={full} className="fixed inset-0 z-[9998] transition-opacity duration-200" style={{ background: "rgba(3,7,18,0.80)", opacity: 0, pointerEvents: "auto" }} />
      {/* Four dim rectangles for the spotlight */}
      {[maskT, maskB, maskL, maskR].map((m, i) => (
        <div key={i} ref={m} className="fixed z-[9998]" style={{ background: "rgba(3,7,18,0.74)", opacity: 0, pointerEvents: "auto" }} />
      ))}
      {/* Click blocker over the highlighted element (removed on click-to-advance steps) */}
      <div ref={holeCover} className="fixed z-[9998]" style={{ opacity: 0, background: "transparent" }} />
      {/* The hole's corners, dimmed outside the ring's radius (see layout()). */}
      <div ref={corners} className="fixed z-[9998] overflow-hidden" style={{ opacity: 0, pointerEvents: "none" }}>
        <div className="absolute inset-0" style={{ boxShadow: "0 0 0 9999px rgba(3,7,18,0.74)" }} />
      </div>
      {/* Spotlight ring */}
      <div
        ref={ring}
        className={`fixed z-[9999] ${step.clickToAdvance || step.interactive ? "sc-tour-pulse" : ""}`}
        style={{ opacity: 0, pointerEvents: "none", boxShadow: "0 0 0 3px rgba(96,165,250,0.95), 0 8px 40px rgba(37,99,235,0.35)" }}
      />

      {/* Tooltip — keyed on the step so each step gets a light fade/slide-in.
          Mounts hidden; layout() reveals it once it's actually positioned, so a
          fresh node never flashes at the viewport origin while the next anchor
          is still being located. */}
      <div
        key={idx}
        ref={tip}
        className="fixed z-[10000] rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl p-5 sc-tour-tip-in"
        style={{ width: TIP_W, maxWidth: "calc(100vw - 24px)", visibility: "hidden" }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[0.6875rem] font-semibold tracking-wide text-blue-400 uppercase">Step {idx + 1} of {steps.length}</span>
          <button onClick={() => finish(true)} className="text-gray-500 hover:text-gray-300 text-xs font-medium transition-colors">Skip tour</button>
        </div>
        <p className="text-white font-bold text-[0.9375rem] leading-snug mb-1.5">{step.title}</p>
        <p className="text-gray-300 text-[0.8125rem] leading-relaxed">{step.body}</p>
        {step.clickToAdvance && (
          <p className="text-blue-300 text-[0.75rem] font-medium mt-2">Tap the highlighted card, or press Next.</p>
        )}
        {step.interactive && (
          <p className="text-blue-300 text-[0.75rem] font-medium mt-2">Go ahead — try it. Then press Next to continue.</p>
        )}

        {/* Progress dots */}
        <div className="flex items-center gap-1 mt-4 mb-3 flex-wrap">
          {steps.map((_, i) => (
            <span key={i} className={`h-1 rounded-full transition-all ${i === idx ? "w-4 bg-blue-500" : i < idx ? "w-1.5 bg-blue-800" : "w-1.5 bg-gray-700"}`} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => go(idx - 1)}
            disabled={isFirst}
            className="text-sm font-semibold px-3 py-2 rounded-full transition-colors text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400"
          >
            ← Back
          </button>
          <button
            onClick={() => (isLast ? finish(true) : go(idx + 1))}
            className="text-sm font-bold text-white bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-full transition-colors shadow-lg shadow-blue-900/40"
          >
            {isLast ? "Finish" : "Next →"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes sc-tour-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(96,165,250,0.95), 0 8px 40px rgba(37,99,235,0.35); }
          50% { box-shadow: 0 0 0 6px rgba(96,165,250,0.55), 0 8px 46px rgba(37,99,235,0.5); }
        }
        .sc-tour-pulse { animation: sc-tour-pulse 1.4s ease-in-out infinite; }
        @keyframes sc-tour-tip-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .sc-tour-tip-in { animation: sc-tour-tip-in .18s ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .sc-tour-pulse { animation: none; }
          .sc-tour-tip-in { animation: none; }
        }
      `}</style>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────
function setBox(el: HTMLElement | null, x: number, y: number, w: number, h: number) {
  if (!el) return;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${Math.max(0, w)}px`;
  el.style.height = `${Math.max(0, h)}px`;
}
function clamp(v: number, max: number): number {
  return Math.max(12, Math.min(v, max - 12));
}
