"use client";

import { useEffect } from "react";
import { browserGateEnv, startRealViewGate } from "@/lib/prospect-preview/gate";
import { getVisitorId } from "@/lib/visitor";

// ── /p/<slug>: tell the server a person is really looking ───────────────────
// The page request counts for nothing (link previews and mail scanners make
// one the moment the link is pasted). This fires once, when the gate says a
// person is here: three seconds of the page actually visible, or a scroll, a
// tap or a key (lib/prospect-preview/gate.ts). The server then applies its own
// refusals: bots, staff devices, datacenters (/api/p/view).
//
// A second, later message says the visitor scrolled the "Your team" strip.
//
// fetch with keepalive, not navigator.sendBeacon: it survives the tap on the
// button that leaves the page just the same, and unlike a beacon its response
// can set the device cookie the "new device" rule depends on.

const TEAM_STRIP = "[data-team-strip]";

function send(slug: string, event: "view" | "team_strip") {
  let visitor = "";
  try { visitor = getVisitorId(); } catch { /* storage blocked: the server mints one */ }
  const hasTouch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;
  return fetch("/api/p/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, event, visitor_id: visitor, touch: hasTouch }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}

export default function PreviewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    let viewSent: Promise<unknown> | null = null;
    let stripSeen = false;
    let stripSent = false;

    // The strip message must land after the view it belongs to.
    const flushStrip = () => {
      if (!stripSeen || stripSent || !viewSent) return;
      stripSent = true;
      void viewSent.then(() => send(slug, "team_strip"));
    };

    const stop = startRealViewGate(browserGateEnv(), () => {
      viewSent = send(slug, "view");
      flushStrip();
    });

    const strip = document.querySelector(TEAM_STRIP);
    const onStrip = () => { stripSeen = true; flushStrip(); };
    strip?.addEventListener("scroll", onStrip, { passive: true, once: true });

    return () => {
      stop();
      strip?.removeEventListener("scroll", onStrip);
    };
  }, [slug]);

  return null;
}
