"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

// ── Mount a heavy block only when it can matter ─────────────────────────────
//
// The homepage is a tour of the product: a rotating six-persona showcase, the
// template gallery, two dashboards, phones, a watch — each a faithful replica
// of a real screen. Server-rendering all of it put 3,700 elements and 2.4 MB
// of HTML in front of the first paint, on a phone that shows none of it above
// the fold (SEO audit, 2026-10-14: Lighthouse mobile 77, LCP 6.0 s).
//
// This renders an empty box on the server and fills it in the browser:
//   - when="visible" (default): as the box comes within `rootMargin` of the
//     viewport, so a visitor scrolling down never sees it arrive;
//   - when="idle": once the page has loaded and the browser is idle — for
//     something above the fold that must not delay the first paint but should
//     be there a moment later (the desktop hero showcase).
// `media` gates both on a media query, so a block the CSS would hide anyway
// (hidden xl:flex) is never built at all on a phone.
//
// Only the picture is deferred: every heading, paragraph and link around it
// stays in the server HTML, so nothing a search engine reads moves. Late
// arrivals carry their own data-reveal attributes — ScrollReveal watches for
// nodes added after load, so they still fade in instead of staying invisible.

type When = "visible" | "idle";

function whenIdleAfterLoad(cb: () => void): () => void {
  let handle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = () => {
    if ("requestIdleCallback" in window) handle = window.requestIdleCallback(cb, { timeout: 2500 });
    else timer = setTimeout(cb, 300);
  };
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
  return () => {
    window.removeEventListener("load", idle);
    if (handle !== undefined && "cancelIdleCallback" in window) window.cancelIdleCallback(handle);
    if (timer !== undefined) clearTimeout(timer);
  };
}

export default function Deferred({
  children,
  when = "visible",
  media,
  rootMargin = "900px 0px",
  minHeight,
  className,
  style,
  now,
}: {
  children: ReactNode;
  when?: When;
  /** Checked once in the browser: true builds the block straight away, however
   *  far down the page it is — for a visit that has come back TO it (the card
   *  builder after LinkedIn), which must not wait for a scroll. */
  now?: () => boolean;
  /** Mount only while this media query matches, e.g. "(min-width: 1280px)". */
  media?: string;
  /** How far ahead of the viewport a "visible" block starts building. */
  rootMargin?: string;
  /** Space held while empty, so the page below does not jump when it fills. */
  minHeight?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (show) return;
    const el = ref.current;
    if (!el) return;
    if (now?.()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser-only check; the server (and hydration) render must stay empty
      setShow(true);
      return;
    }
    let cleanup: (() => void) | undefined;
    const arm = () => {
      if (when === "idle") {
        cleanup = whenIdleAfterLoad(() => setShow(true));
        return;
      }
      if (!("IntersectionObserver" in window)) {
        setShow(true);
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setShow(true);
            io.disconnect();
          }
        },
        { rootMargin },
      );
      io.observe(el);
      cleanup = () => io.disconnect();
    };
    if (!media) {
      arm();
      return () => cleanup?.();
    }
    const mql = window.matchMedia(media);
    const check = () => {
      if (!mql.matches) return;
      mql.removeEventListener("change", check);
      arm();
    };
    mql.addEventListener("change", check);
    check();
    return () => {
      mql.removeEventListener("change", check);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is a one-time check on arrival, not a dependency to re-arm on
  }, [show, when, media, rootMargin]);

  return (
    <div
      ref={ref}
      className={className}
      style={show ? style : { minHeight, ...style }}
      data-deferred={show ? "in" : "out"}
    >
      {show ? children : null}
    </div>
  );
}
