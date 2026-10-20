"use client";

// The live preview on the two DESIGN steps, on a PHONE (owner, 2026-09-16):
//   • Card design   → the card
//   • Social design → the Swift Links page
// It sits at the top of the step and stays pinned to the top of the screen the
// whole time you scroll ("I want it to stay up there but when they scroll it
// still stays"), at a size you can actually read, and tapping it opens it full
// size. Card info and Socials keep their inline previews where they are.
//
// Plain CSS `position: sticky` — no scroll listener, and it pins before
// hydration. The strip carries the page's own background (sc-pinned-preview in
// globals.css) so the controls scrolling underneath never show through. Always
// mounted, never CSS-hidden on a phone, so CardScaler never measures an empty
// slot. Desktop (lg and up) keeps its pinned right-hand column instead.
//
// The full-size view is portalled to <body>: the sticky strip is its own
// stacking context (z-30), and a fixed overlay left inside it would sit UNDER
// anything else on the page with a higher z-index.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CardScaler from "@/components/CardScaler";
import InertPreview from "@/components/InertPreview";
import UndoDesignButton from "@/components/UndoDesignButton";
import type { DesignHistory } from "@/lib/use-design-history";

function PinnedPreview({
  label,
  pinned,
  full,
  stickBelow,
}: {
  /** CSS selector of a sticky header this strip must pin BELOW (the Office
   *  admin's header + tabs). Its live height is measured; without it the strip
   *  pins under the status bar. */
  stickBelow?: string;
  /** What a tap does, for screen readers: "See your card full size". */
  label: string;
  /** A node (the whole strip is one tap target), or a render function given
   *  "open full size" when the strip has controls of its own. */
  pinned: React.ReactNode | ((expand: () => void) => React.ReactNode);
  full: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState<number | null>(null);

  useEffect(() => {
    if (!stickBelow) return;
    const el = document.querySelector(stickBelow) as HTMLElement | null;
    if (!el) return;
    const measure = () => setBelow(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stickBelow]);

  const close = useCallback(() => setOpen(false), []);
  const expand = useCallback(() => setOpen(true), []);

  return (
    <>
      <div
        // Full-bleed (-mx-5) inside the editors' page gutter; inside the Office
        // console's column the strip stays within the column it pins in.
        className={`sc-pinned-preview lg:hidden sticky z-30 pt-2 pb-3 ${stickBelow ? "" : "-mx-5 px-5"}`}
        style={{ top: below !== null ? `${below}px` : "env(safe-area-inset-top, 0px)" }}
      >
        {typeof pinned === "function" ? pinned(expand) : (
        <button
          type="button"
          onClick={expand}
          aria-label={label}
          className="relative block mx-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          {pinned}
          {/* The "tap me" cue sits OFF the card face, on its top-right corner:
              inside the card it covered the QR code on every template. */}
          <span
            aria-hidden
            className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gray-900 text-white ring-2 ring-white/80 flex items-center justify-center shadow"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </span>
        </button>
        )}
      </div>

      {open && <FullSizeOverlay label={label} onClose={close}>{full}</FullSizeOverlay>}
    </>
  );
}

/** Card design: the card itself (the template element, exactly as the editor builds it). */
export default function PinnedCardPreview({ children, stickBelow, undo }: {
  children: React.ReactNode;
  stickBelow?: string;
  /** The design tab's Undo (lib/use-design-history): a round button on the
   *  card's top-left corner, opposite the full-size cue. Omitted = none. */
  undo?: DesignHistory;
}) {
  const card = (
    <InertPreview className="rounded-xl overflow-hidden border border-gray-800 shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
      <CardScaler>{children}</CardScaler>
    </InertPreview>
  );
  const sized = <div className="w-[min(320px,calc(100vw-40px))]">{card}</div>;
  return (
    <PinnedPreview
      label="See your card full size"
      stickBelow={stickBelow}
      // With Undo the strip holds two buttons, so the card is no longer ONE
      // tap target (a button inside a button is invalid): the card + cue stay
      // the full-size button, Undo sits beside it on the other corner.
      pinned={undo ? (expand) => (
        <div className="relative w-fit mx-auto">
          <button
            type="button"
            onClick={expand}
            aria-label="See your card full size"
            className="relative block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            {sized}
            <span
              aria-hidden
              className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gray-900 text-white ring-2 ring-white/80 flex items-center justify-center shadow"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            </span>
          </button>
          <UndoDesignButton history={undo} variant="corner" />
        </div>
      ) : sized}
      full={<div className="w-full max-w-[460px] my-auto">{card}</div>}
    />
  );
}

// ── Social design: the Swift Links page ─────────────────────────────────────
//
// A PAGE is not a card: it is several screens tall, so no pinned strip can show
// all of it at a readable size. The old strip showed the top of the page and
// faded the rest out, so anything below the socials — the Connect button, the
// link buttons, a background under them — was simply cut off while being
// edited (owner, 2026-09-17: "it doesn't show the full page and it's cutting
// out").
//
// So the strip is a small PHONE you can scroll, showing the real page at true
// proportions:
//   • it FOLLOWS the step being edited — scroll to "Social icons" and the
//     preview scrolls to the icons, "Link buttons" to the links — so the edit
//     is always in view without touching it;
//   • "Top · Socials · Connect · Links" jump to any part directly;
//   • drag inside it to look anywhere, and "Full size" opens the whole page.
// The phone and its controls sit side by side, so it takes no more height than
// the old strip did.

type Section = "top" | "socials" | "connect" | "links";
const STEP_SECTION: Record<string, Section> = {
  header: "top", look: "top", colors: "top", font: "top",
  icons: "socials", connect: "connect", links: "links",
};
const SECTION_LABEL: Record<Section, string> = { top: "Top", socials: "Socials", connect: "Connect", links: "Links" };

/** The scrollable mini phone plus its section controls. Exported for the
 *  homepage SwiftLink builder, whose modal already pins its own strip. */
export function LinkPageViewport({ children, onExpand, undo }: { children: React.ReactNode; onExpand?: () => void; undo?: DesignHistory }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<Section>("top");
  const [hasLinks, setHasLinks] = useState(false);
  const followRef = useRef<string | null>(null);
  // A tapped jump ("Links") holds until the PAGE scrolls again; then the
  // preview goes back to following the step being edited.
  const manualRef = useRef(false);

  const scrollTo = useCallback((to: Section, smooth = true) => {
    const frame = frameRef.current;
    if (!frame) return;
    let top = 0;
    if (to !== "top") {
      const anchor = frame.querySelector(`[data-sl-section="${to}"]`) as HTMLElement | null;
      if (!anchor) return;
      top = frame.scrollTop + anchor.getBoundingClientRect().top - frame.getBoundingClientRect().top - 10;
    }
    frame.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    setSection(to);
  }, []);

  // Which sections the page actually has (Links only once there are links).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const check = () => setHasLinks(!!frame.querySelector('[data-sl-section="links"]'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(frame, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // Follow the step being edited. Capture-phase scroll listener, so it works
  // whether the page scrolls or a modal does (the homepage builder).
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const frame = frameRef.current;
      const list = document.querySelector('ol[data-design-steps="swiftlinks"]');
      if (!frame || !list) return;
      // The step nearest the middle of what is visible under the pinned strip.
      const top = frame.getBoundingClientRect().bottom;
      const mid = top + (window.innerHeight - top) / 2;
      const items = Array.from(list.querySelectorAll<HTMLElement>("li[data-design-step]"));
      let current: string | null = null;
      let best = Infinity;
      for (const li of items) {
        const r = li.getBoundingClientRect();
        if (r.bottom < top || r.top > window.innerHeight) continue;
        const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
        if (d < best) { best = d; current = li.dataset.designStep ?? null; }
      }
      follow(current);
    };
    const follow = (key: string | null) => {
      if (!key || key === followRef.current) return;
      followRef.current = key;
      const to = STEP_SECTION[key];
      if (to) scrollTo(to);
    };
    const onScroll = (e: Event) => {
      // The preview's own scrolling is not the page moving.
      if (frameRef.current && e.target instanceof Node && frameRef.current.contains(e.target)) return;
      if (manualRef.current) { manualRef.current = false; followRef.current = null; }
      if (!raf) raf = requestAnimationFrame(update);
    };
    // Touching a control is the surest sign of what is being edited.
    const onPointer = (e: Event) => {
      const li = (e.target as Element | null)?.closest?.("ol[data-design-steps=\"swiftlinks\"] li[data-design-step]") as HTMLElement | null;
      if (li) follow(li.dataset.designStep ?? null);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
    document.addEventListener("focusin", onPointer, { capture: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("pointerdown", onPointer, { capture: true });
      document.removeEventListener("focusin", onPointer, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollTo]);

  // A soft fade on whichever edge has more page beyond it. The window is a
  // fixed height, so its edge always cuts SOMETHING — and a hard cut sliced
  // the last line in half ("View SwiftCard" under the Connect button, on
  // every short page), which read as a rendering glitch rather than "scroll
  // for more" (2026-09-24 UI review). No fade once you reach that end.
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const top = frame.scrollTop > 2;
      const bottom = frame.scrollTop + frame.clientHeight < frame.scrollHeight - 2;
      setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
    };
    measure();
    frame.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    if (frame.firstElementChild) ro.observe(frame.firstElementChild);
    const mo = new MutationObserver(measure);
    mo.observe(frame, { childList: true, subtree: true });
    return () => { frame.removeEventListener("scroll", measure); ro.disconnect(); mo.disconnect(); };
  }, []);
  const fade = edges.top || edges.bottom
    ? `linear-gradient(to bottom, ${edges.top ? "transparent 0, #000 22px" : "#000 0"}, ${edges.bottom ? "#000 calc(100% - 22px), transparent 100%" : "#000 100%"})`
    : undefined;

  const sections: Section[] = hasLinks ? ["top", "socials", "connect", "links"] : ["top", "socials", "connect"];

  return (
    <div className="flex items-stretch justify-center gap-3">
      <div
        ref={frameRef}
        onClick={onExpand}
        // Scrolls by touch; the page inside is inert, so a tap opens full size.
        className="sc-link-viewport relative self-center w-[min(150px,40vw)] max-h-[min(262px,36vh)] overflow-y-auto overscroll-contain rounded-[22px] cursor-zoom-in [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Your Swift Links page. Scroll to see all of it."
        style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
      >
        {children}
      </div>
      <div className="flex flex-col justify-center gap-1.5 min-w-[92px]">
        <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">Live preview</p>
        {sections.map((sec) => (
          <button
            key={sec}
            type="button"
            onClick={() => { manualRef.current = true; scrollTo(sec); }}
            aria-pressed={section === sec}
            className={`text-left px-3 py-1.5 rounded-full text-[0.6875rem] font-semibold border transition-colors ${
              section === sec ? "border-blue-600 bg-blue-600/15 text-blue-200" : "border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600"
            }`}
          >
            {SECTION_LABEL[sec]}
          </button>
        ))}
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.6875rem] font-semibold bg-white/10 hover:bg-white/15 text-gray-200 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
            Full size
          </button>
        )}
        {undo && <UndoDesignButton history={undo} variant="pill" className="mt-1" />}
      </div>
    </div>
  );
}

/** Social design (phone): the scrollable page viewport, pinned. */
export function PinnedLinkPreview({ children, stickBelow, undo }: { children: React.ReactNode; stickBelow?: string; undo?: DesignHistory }) {
  return (
    <PinnedPreview
      label="See your Swift Links page full size"
      stickBelow={stickBelow}
      pinned={(expand) => <LinkPageViewport onExpand={expand} undo={undo}>{children}</LinkPageViewport>}
      full={<div className="w-full max-w-[390px]">{children}</div>}
    />
  );
}

/** The full-size view on its own (the homepage builder opens it itself). */
export function FullSizeOverlay({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {/* Dim on its own non-scrolling layer: backdrop-filter on the same
          element as overflow-y-auto kills touch scrolling on iOS Safari. */}
      <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="fixed inset-0 z-[121] overflow-y-auto"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="min-h-full flex flex-col items-center px-4 pb-10 pt-[max(1rem,calc(env(safe-area-inset-top)+0.75rem))]"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <button
            type="button"
            onClick={onClose}
            className="self-end mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-sm font-semibold px-4 py-2.5"
          >
            Close
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
