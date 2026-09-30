"use client";

import { useEffect, useRef, useState } from "react";
import { isCollapsedWhileVisible } from "@/lib/collapse-detect";

// A collapsed slot makes this component render its content at opacity 0 — a
// perfect, invisible render with no error anywhere. The homepage SwiftLink
// preview shipped that way for ~12 days because nothing in the stack can see
// it: the SSR HTML is correct, the state is correct, and only real client
// layout exposes it. So the component reports itself.
//
// Once per page load, not per instance: one broken layout usually collapses
// several scalers at once, and ten identical reports would be noise (the
// uptime probe taught us what self-inflicted error spam costs).
let collapseReported = false;
/** Generous: covers mount, fonts, images and any open/close transition. */
const COLLAPSE_CHECK_MS = 2500;

function reportCollapse(natural: number) {
  if (collapseReported) return;
  collapseReported = true;
  const detail = `CardScaler slot has zero width — its content is rendering invisibly (natural=${natural}px) at ${location.pathname}`;
  // Dev: the fastest possible feedback for whoever is building the surface.
  if (process.env.NODE_ENV !== "production") console.warn("[CardScaler]", detail);
  // Production: route it into the same error pipeline every other client fault
  // uses, so an invisible-UI bug lands where deploy checks already look instead
  // of waiting to be noticed by eye.
  try {
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        level: "error",
        context: "cardscaler.collapsed",
        message: detail,
        url: location.href,
      }),
    }).catch(() => {});
  } catch { /* reporting must never break the page */ }
}

// Renders content at a fixed design width where everything fits, then scales it
// down to the container width. Cards use it (fixed 460px so the QR / bottom rows
// never clip on narrow screens); the Swift Links live preview passes a phone
// width (~390) so the real profile renders at true phone proportions and is then
// shrunk into the preview slot — pixel-identical to the published page, just
// smaller.
const DEFAULT_NATURAL = 460;

export default function CardScaler({ children, natural = DEFAULT_NATURAL }: { children: React.ReactNode; natural?: number }) {
  const NATURAL = natural;
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    function recompute() {
      const w = outerRef.current?.clientWidth ?? NATURAL;
      const s = Math.min(1, w / NATURAL);
      const naturalH = innerRef.current?.offsetHeight ?? Math.round(NATURAL / 1.75);
      setScale(s);
      setHeight(naturalH * s);
    }
    recompute();
    const ro = new ResizeObserver(recompute);
    if (outerRef.current) ro.observe(outerRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    // Self-report an invisible render (see reportCollapse above). Checked once,
    // late, and only when the slot is genuinely on-screen — a preview hidden by
    // display:none (mobile plan tabs, a closed modal) measures 0 correctly and
    // must not be reported.
    const collapseTimer = setTimeout(() => {
      if (isCollapsedWhileVisible(outerRef.current)) reportCollapse(NATURAL);
    }, COLLAPSE_CHECK_MS);
    return () => { ro.disconnect(); clearTimeout(collapseTimer); };
  }, [NATURAL]);

  // Before hydration the card used to be a zero-height, fully transparent box:
  // scale and height both start at 0 and only exist once the effect above has
  // measured. So on every public card view the hero was invisible until
  // JavaScript ran, and Save Contact and everything under it jumped down
  // ~200px when it appeared — a guaranteed layout shift on the page's most
  // important element, and a blank cream page for anyone whose JS is slow or
  // blocked (UX audit 2026-09-30). Two fixes, both in the server HTML:
  //   • the outer box reserves the card's aspect ratio until it is measured,
  //     so nothing below moves when the real height lands;
  //   • the inline script right after it scales and reveals the card as soon
  //     as the parser reaches it — one synchronous read of clientWidth, the
  //     same arithmetic recompute() does — so the card is in the first paint.
  //     React re-applies the measured values on hydration.
  // suppressHydrationWarning: the script deliberately changes these style
  // attributes before React hydrates; the effect overwrites them right after.
  const boot = `(function(){var s=document.currentScript,o=s&&s.previousElementSibling;if(!o)return;var i=o.firstElementChild;if(!i)return;var w=o.clientWidth||${NATURAL},k=Math.min(1,w/${NATURAL});i.style.transform="scale("+k+")";i.style.opacity="1";o.style.height=i.offsetHeight*k+"px";})();`;
  return (
    <>
      {/* contain:size — the inner card keeps a fixed LAYOUT width of 460px
          (the scale() transform is visual only), which would otherwise inflate
          any auto-sized grid/flex track holding a card to >=460px on phones
          and get it clipped. Size containment zeroes that intrinsic
          contribution; the explicit measured height keeps layout correct. */}
      <div
        ref={outerRef}
        className="w-full"
        suppressHydrationWarning
        style={{ height: height || undefined, aspectRatio: height ? undefined : `${NATURAL} / ${Math.round(NATURAL / 1.75)}`, contain: "size" }}
      >
        <div
          ref={innerRef}
          suppressHydrationWarning
          style={{
            width: NATURAL,
            transform: scale ? `scale(${scale})` : undefined,
            transformOrigin: "top left",
            opacity: scale ? 1 : 0,
          }}
        >
          {children}
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: boot }} />
    </>
  );
}
