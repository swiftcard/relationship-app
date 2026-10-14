"use client";

import { useEffect, useState } from "react";

// ── The hero's ambient footage, started after the page has painted ──────────
//
// The homepage hero loops a bright networking scene behind the headline
// (owner request 2026-08-19). As a plain autoplaying <video> it was the
// page's Largest Contentful Paint: the browser waited on a 2.2 MB file before
// it would call the hero painted (SEO audit, 2026-10-14: LCP 6.0 s). The
// poster is now a real <img> in page.tsx — eager, fetchpriority=high, sized
// per screen — so the first frame IS the first paint, and this component adds
// the video only once the page has loaded and gone idle, fading it in over
// the identical frame. Nothing is fetched at all for prefers-reduced-motion
// (the CSS hides the element too) or for a Save-Data connection.
//
// 720p H.264 at ~330 kbps (public/hero-bg-720.mp4, ~600 KB), re-encoded from
// the 1600×900 original (2.2 MB): under the hero's white wash the difference
// is invisible. One file on purpose — a VP9 WebM of the same scene came out
// larger, and H.264 plays everywhere.

export default function HeroVideo() {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    let cancelled = false;
    let handle: number | undefined;
    const idle = () => {
      if ("requestIdleCallback" in window) handle = window.requestIdleCallback(() => !cancelled && setReady(true), { timeout: 3000 });
      else setTimeout(() => !cancelled && setReady(true), 500);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", idle);
      if (handle !== undefined && "cancelIdleCallback" in window) window.cancelIdleCallback(handle);
    };
  }, []);

  if (!ready) return null;
  return (
    <video
      className="absolute inset-0 w-full h-full object-cover motion-reduce:hidden transition-opacity duration-700"
      style={{ opacity: playing ? 1 : 0 }}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      poster="/hero-bg-poster.jpg?v=2"
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => setPlaying(true)}
    >
      <source src="/hero-bg-720.mp4" type="video/mp4" />
    </video>
  );
}
