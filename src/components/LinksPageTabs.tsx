"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

// The Links page's two halves — Swift Links | Swift Signature — one at a time.
//
// The page used to stack both as two near-identical grey boxes, and a first-time
// user couldn't tell what either was for (owner, 2026-10-07). A switch makes it
// one thing at a time, and each side leads with a picture of the real thing.
//
// The panels are SLOTS, rendered by the server page: the Swift Links side holds
// ownLiveHref() links, which sign with node:crypto and can't run in the browser.
//
// Shared by the real page (/share) and its two replicas — the /preview demo and
// the homepage's DashboardDemo — so the switch people try out IS the one they get.

export type LinksTab = "links" | "signature";

const TABS: { id: LinksTab; label: string; icon: ReactNode }[] = [
  {
    id: "links",
    label: "Swift Links",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />,
  },
  {
    id: "signature",
    label: "Swift Signature",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />,
  },
];

/** Fired by EmailSignatureBox with `detail: boolean` — true while the card has
 *  changed since the signature was last copied. The re-copy note lives on the
 *  Signature side, so without this the switch would hide it from anyone
 *  looking at Swift Links. */
export const SIGNATURE_STALE_EVENT = "sc:signature-stale";

export default function LinksPageTabs({
  links,
  signature,
  syncHash = true,
}: {
  links: ReactNode;
  signature: ReactNode;
  /** The real page keeps the side in the URL hash (#links / #signature) so a
   *  reload, a shared link and the guided tour all land on the right side. The
   *  replicas live inside other pages and must never touch their URL. */
  syncHash?: boolean;
}) {
  const [tab, setTab] = useState<LinksTab>("links");
  const [stale, setStale] = useState(false);
  const tabRefs = useRef<Record<LinksTab, HTMLButtonElement | null>>({ links: null, signature: null });

  // The hash picks the side: /share#signature opens Swift Signature, and the
  // guided tour switches sides the same way (its `section` sets the hash and
  // fires hashchange — lib/tour-steps.ts). Read in an effect, never in the
  // initial state: the server cannot see a hash, so initialising from it would
  // make the first client render disagree with the HTML.
  useEffect(() => {
    if (!syncHash) return;
    const fromHash = () => {
      const h = window.location.hash.replace("#", "");
      if (h === "links" || h === "signature") setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [syncHash]);

  useEffect(() => {
    const onStale = (e: Event) => setStale(!!(e as CustomEvent<boolean>).detail);
    window.addEventListener(SIGNATURE_STALE_EVENT, onStale);
    return () => window.removeEventListener(SIGNATURE_STALE_EVENT, onStale);
  }, []);

  function select(id: LinksTab, focus = false) {
    setTab(id);
    if (focus) tabRefs.current[id]?.focus();
    if (!syncHash) return;
    // replaceState, not a new entry: Back should leave the page, not flip sides.
    try {
      const url = new URL(window.location.href);
      url.hash = id;
      window.history.replaceState(window.history.state, "", url);
    } catch { /* ignore */ }
  }

  // Arrow keys move between sides, as in any tab list.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(TABS[next].id, true);
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Swift Links or Swift Signature"
        onKeyDown={onKeyDown}
        className="grid grid-cols-2 gap-1 p-1 mb-6 rounded-xl bg-gray-900 border border-gray-800"
      >
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[t.id] = el; }}
              id={`links-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`links-panel-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(t.id)}
              className={`relative flex items-center justify-center gap-1.5 min-w-0 py-2.5 px-2 rounded-lg text-sm font-semibold transition-colors ${
                on ? "bg-blue-600 text-white shadow-sm" : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden className="w-4 h-4 shrink-0">
                {t.icon}
              </svg>
              <span className="truncate">{t.label}</span>
              {t.id === "signature" && stale && (
                <>
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <span className="sr-only">(needs updating)</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* BOTH sides stay mounted; the other one is hidden. Switching is instant
          and nothing resets — a half-done copy, a loaded preview. */}
      <div id="links-panel-links" role="tabpanel" aria-labelledby="links-tab-links" hidden={tab !== "links"} className="sc-step-in">
        {links}
      </div>
      <div id="links-panel-signature" role="tabpanel" aria-labelledby="links-tab-signature" hidden={tab !== "signature"} className="sc-step-in">
        {signature}
      </div>
    </>
  );
}
