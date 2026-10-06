"use client";

import { useEffect } from "react";
import { waitForHuman } from "@/lib/human-gate";

/** localStorage list read by public/offline.html ("Cards saved on this phone"). */
export const SAVED_CARDS_KEY = "sc_saved_cards";
const MAX_SAVED = 25;

/** What a saved page needs in order to run with no signal. public/sw.js checks every URL again. */
function pageAssets(): string[] {
  const out = new Set<string>();
  const keep = (raw: string | null | undefined) => {
    if (!raw) return;
    try {
      const u = new URL(raw, location.href);
      const own = u.origin === location.origin && u.pathname.startsWith("/_next/static/");
      const picture = u.protocol === "https:" && u.hostname.endsWith(".supabase.co") && u.pathname.startsWith("/storage/v1/object/public/");
      if (own || picture) out.add(u.href);
    } catch { /* not a URL */ }
  };
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => keep(s.src));
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"]').forEach((l) => keep(l.href));
  document.querySelectorAll<HTMLImageElement>("img").forEach((i) => keep(i.currentSrc || i.src));
  // Chunks and fonts that loaded after the HTML (dynamic imports, CSS fonts).
  try {
    for (const e of performance.getEntriesByType("resource")) keep(e.name);
  } catch { /* no timing API */ }
  return [...out];
}

function remember(path: string, name: string) {
  try {
    const list = (JSON.parse(localStorage.getItem(SAVED_CARDS_KEY) || "[]") as Array<{ path?: unknown }>)
      .filter((c) => c && typeof c.path === "string" && c.path !== path);
    localStorage.setItem(SAVED_CARDS_KEY, JSON.stringify([{ path, name }, ...list].slice(0, MAX_SAVED)));
  } catch { /* storage blocked: the card is still saved, just not listed */ }
}

/**
 * Saves the card on this phone once a person has really looked at it, so it
 * opens again with no signal and Save Contact still works (public/sw.js).
 * Waits for the same human gate as the view count, then for an idle moment,
 * so it never competes with the card's own first load. Renders nothing.
 */
export default function OfflineCardSaver({ name, vcardHref }: {
  /** Shown in "Cards saved on this phone". */
  name: string;
  /** The contact file Save Contact hands a phone. Absent while the card is awaiting a plan. */
  vcardHref?: string;
}) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    (async () => {
      if (!(await waitForHuman(() => cancelled))) return;
      // `ready` never settles on a page with no registration; don't wait forever.
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
      ]);
      if (cancelled || !reg?.active) return;
      await new Promise<void>((r) => {
        const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
        if (w.requestIdleCallback) w.requestIdleCallback(() => r(), { timeout: 3000 });
        else setTimeout(r, 500);
      });
      if (cancelled) return;
      const path = location.pathname.toLowerCase().replace(/\/+$/, "");
      reg.active.postMessage({ type: "save-card", path, vcard: vcardHref, assets: pageAssets(), name });
      remember(path, name);
    })();
    return () => { cancelled = true; };
  }, [name, vcardHref]);

  return null;
}
