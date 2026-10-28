"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getVisitorId } from "@/lib/visitor";
import { internalFlag } from "@/lib/events";
import { waitForHuman } from "@/lib/human-gate";

// First-party website analytics tracker for the MARKETING site. Records a
// pageview per route change and the time spent on each page. Deliberately does
// NOT track the signed-in app, the admin portal, or shared card/links pages —
// those are either private or already tracked by card_views. Fully first-party:
// one same-origin POST, no third party, no cookies of its own (the ingest sets
// the same sc_vid visitor cookie the card pages use).

// Marketing routes to TRACK — an allow-list, not a deny-list. It has to be:
// card pages moved to the ROOT (swiftcard.me/<username>, 2026-08-19), so an
// unknown single-segment path is somebody's card, and a deny-list would count
// every card visitor as a website visitor AND double-count them against
// card_views. Anything not listed here is app, admin, or a shared card/links
// page — private or already tracked elsewhere.
//
// 2026-10-28: the sitemap's /about, /faq, /press, /download and /for/* pages
// were missing, and so were /login and /cards/new — the two places a website
// visit goes next, so every visit that went on to sign up read as "left after
// one page". /upgrade, /account-deleted and /unsubscribe were counted and are
// app pages (a customer paying, leaving, or opting out), so they're out.
const TRACK_PREFIXES = [
  "/pricing", "/products", "/templates", "/compare", "/company",
  "/about", "/faq", "/press", "/download", "/for",
  "/testimonials", "/contact", "/preview", "/terms", "/privacy",
  "/sms-consent", "/sms-terms",
  "/business-card-view-tracking", "/link-in-bio-with-analytics",
  "/blog",
  "/login", "/cards/new",
];

const SESSION_KEY = "sc_site_session";
const SESSION_TS_KEY = "sc_site_session_ts";
const SESSION_GAP_MS = 30 * 60 * 1000; // 30-min inactivity → new session

// A website reader skims: a 1-second dwell (not the card's 2.5 s) keeps the
// person who glanced at a page and moved on, and still drops the renderers
// that paint a page hidden or under automation. Datacenter traffic is refused
// at the ingest, which is where the rest of the preview farms are caught.
const SITE_DWELL_MS = 1000;

// When storage is blocked there's no session to keep. One id per page LOAD
// then, never a shared constant: until 2026-10-28 every such browser reported
// the session "nostore", so all of them were one enormous visit.
let loadSessionId = "";
// The first page of this load: the only one whose document.referrer is about
// where the visitor came from. A client-side page change keeps the
// original referrer, which is how one visit from Google read as six.
let firstOfLoad = true;

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* fall through */ }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The visit this page belongs to, and whether this page starts it. */
function currentSession(): { id: string; landing: boolean } {
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(SESSION_TS_KEY) || 0);
    let id = sessionStorage.getItem(SESSION_KEY);
    let landing = false;
    if (!id || now - last > SESSION_GAP_MS) {
      id = newId();
      landing = true;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    sessionStorage.setItem(SESSION_TS_KEY, String(now));
    return { id, landing };
  } catch {
    const landing = !loadSessionId;
    if (!loadSessionId) loadSessionId = newId();
    return { id: loadSessionId, landing };
  }
}

function tracked(path: string): boolean {
  return path === "/" || TRACK_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** What the browser says it is. iPadOS Safari calls itself a Mac, so a "Mac"
 *  with a touch screen is a tablet. */
function deviceKind(): "phone" | "tablet" | "computer" {
  const ua = navigator.userAgent || "";
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "tablet";
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "tablet";
  const hint = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  if (hint === true || /Mobi|iPhone|iPod|Android/i.test(ua)) return "phone";
  return "computer";
}

/** The campaign tags on the address the visit started at. */
function campaign(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "src"]) {
      const v = q.get(k);
      if (v) out[k] = v.slice(0, 100);
    }
  } catch { /* no query */ }
  return out;
}

function post(payload: object, beacon = false) {
  const body = JSON.stringify(payload);
  // sendBeacon survives the page unloading; fetch+keepalive is the fallback.
  if (beacon) {
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/site-view", new Blob([body], { type: "application/json" }))) return;
    } catch { /* fall through */ }
  }
  fetch("/api/site-view", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, body })
    .catch(() => { /* analytics must never surface an error to the visitor */ });
}

export default function SiteAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    // Only the page the browser actually loaded knows the referrer, whether
    // or not that page is tracked (a card page, then a tap through to /).
    const atLoad = firstOfLoad;
    firstOfLoad = false;
    if (!tracked(pathname)) return;
    // Inside the iPhone app the marketing pages are part of the app.
    if (document.documentElement.classList.contains("native-app")) return;

    const referrer = atLoad ? document.referrer || null : null;

    let cancelled = false;
    let id: string | null = null;
    // Visible time on this page, accumulated across tab switches.
    let visibleMs = 0;
    let visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
    let sentMs = 0;

    const elapsed = () => visibleMs + (visibleSince ? Date.now() - visibleSince : 0);
    const sendDuration = () => {
      if (!id) return;
      const durationMs = elapsed();
      // Sub-second: a misclick, not a read. Unchanged since the last send: nothing new.
      if (durationMs < 1000 || durationMs <= sentMs) return;
      sentMs = durationMs;
      post({ event: "duration", id, durationMs }, true);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (visibleSince) { visibleMs += Date.now() - visibleSince; visibleSince = 0; }
        sendDuration();
      } else if (!visibleSince) {
        visibleSince = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", sendDuration);

    // Record the view once a person is actually looking at the page: not a
    // prerender, not automation, not a tab that never came forward.
    waitForHuman(() => cancelled, { dwellMs: SITE_DWELL_MS }).then((human) => {
      if (!human || cancelled) return;
      const session = currentSession();
      id = newId();
      post({
        id,
        visitorId: getVisitorId(),
        sessionId: session.id,
        landing: session.landing,
        path: pathname,
        referrer,
        device: deviceKind(),
        ...(session.landing ? campaign() : {}),
        // The same "this browser is ours" flag the product funnel sends
        // (lib/events.ts), so both sinks agree on what is internal.
        internal: internalFlag(),
      });
    });

    return () => {
      cancelled = true;
      sendDuration();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", sendDuration);
    };
  }, [pathname]);

  return null;
}
