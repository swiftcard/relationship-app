"use client";

import { useState, type ReactNode } from "react";
import Link, { useLinkStatus } from "next/link";
import { PlanGate } from "@/components/PlanGate";

/**
 * Tap feedback for the card picker.
 *
 * Switching cards is a query-param change on the SAME route, so it is a soft
 * navigation with no new segment — which means /dashboard/loading.tsx never
 * shows. The tick beside each card is driven by `activeUsername`, a SERVER
 * value, so until the RSC payload lands the row you just tapped still renders
 * unticked and the old one stays ticked. On a slow connection that reads as
 * "nothing happened", and the usual response is to tap again.
 *
 * The Next docs name this exact case for useLinkStatus: a dynamic destination
 * with no loading.js boundary. This only reports THIS link's pending state, so
 * it cannot lie about which card is selected the way an optimistic tick would —
 * it says "working", not "done".
 *
 * Must be rendered INSIDE the <Link> it reports on; that is how the hook finds
 * its navigation.
 */
function SelectingSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="Switching card"
      className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-blue-400/30 border-t-blue-400 motion-safe:animate-spin"
    />
  );
}

export type MyCard = {
  id: string;
  username: string;
  label: string | null;
  name: string | null;
};

/**
 * The dashboard's My Cards selector.
 *
 * DESKTOP (sm+) is unchanged from when this was inline in the page: every card
 * is a tile in a wrapping row, all visible at once.
 *
 * MOBILE collapses to just the SELECTED card plus a chevron on its right; the
 * rest drop down underneath when you tap it, and picking one collapses again.
 * Stacking every card full-width pushed the actual dashboard off-screen once
 * someone had three or four.
 *
 * ── The rules that keep this safe on every plan ──────────────────────────────
 *
 * 1. The chevron renders ONLY when there is more than one card. An account with
 *    a single card — which is every Free account — gets exactly the markup it
 *    had before: one row, no toggle, nothing to expand. That is the case that
 *    must not regress, so it is handled by absence rather than by a branch.
 *
 * 2. The "Ready for a second card? Go unlimited with Pro." tile is passed in as
 *    `upsell` and rendered OUTSIDE the collapsing set. It is never hidden by
 *    the dropdown, on any plan or viewport. It is also passed as a slot rather
 *    than rebuilt here, so its plan condition and markup stay in one place.
 *
 * 3. Rows keep their ORIGINAL index. `planInactive` (the LINK OFF — PRO ONLY
 *    badge on a downgraded account's extra cards) is positional — it marks
 *    cards past FREE_CARD_LIMIT — so the map runs over the full array and only
 *    VISIBILITY changes. Hiding a row never renumbers another.
 *
 * 4. Collapsing is CSS, not conditional rendering: hidden rows are still in the
 *    DOM with `hidden sm:flex`. That is what lets one markup tree serve both
 *    viewports, so desktop cannot drift from mobile.
 */
export default function MyCardsList({
  cards,
  activeUsername,
  isPro,
  freeCardLimit,
  liveCardIds,
  view,
  sortBy,
  upsell,
}: {
  cards: MyCard[];
  activeUsername: string;
  isPro: boolean;
  freeCardLimit: number;
  /** On Free: the ids that serve publicly (lib/card-active pickFreeLiveCardIds). */
  liveCardIds?: string[];
  view: string;
  sortBy: string;
  /** The Free-plan "second card" upsell, rendered untouched after the rows. */
  upsell?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  // One card = nothing to switch to. No chevron, no dropdown, no behaviour
  // change at all — see rule 1 above.
  const hasMultiple = cards.length > 1;

  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Select a card">
      {cards.map((card, cardIdx) => {
        const isActive = activeUsername === card.username;
        // Mirrors the public kill-switch (lib/card-active): on Free, only the
        // live card(s) serve publicly — the one chosen when Pro ended, else the
        // oldest freeCardLimit. Positional fallback when no live list is given.
        const planInactive = !isPro && (liveCardIds ? !liveCardIds.includes(card.id) : cardIdx >= freeCardLimit);

        // The selected card is always visible and, on mobile, floats to the top
        // of the stack so the dropdown opens BENEATH it. sm:order-none puts the
        // desktop row back in its natural position.
        const visibility = isActive
          ? "flex order-first sm:order-none"
          : expanded
            ? "flex"
            : "hidden sm:flex";

        return (
          <div
            key={card.id}
            // sm:min-w is 40px wider than it was (200 → 240) — exactly the Edit
            // pencil plus its gap — so on the narrowest desktop tile the NAME
            // keeps the room it always had. Height is untouched.
            className={`@container items-center gap-3 rounded-xl px-4 py-3 transition-all border flex-1 min-w-full sm:min-w-[240px] ${visibility} ${
              isActive ? "bg-blue-600/10 border-blue-600/40" : "bg-gray-800/60 border-gray-700/60"
            }`}
          >
            <Link
              scroll={false}
              href={`?card=${card.username}&view=${view}&sort=${sortBy}`}
              role="radio"
              aria-checked={isActive}
              // Picking a different card collapses the dropdown. Without this
              // the panel would stay open over the card you just chose, because
              // a soft navigation keeps this component mounted.
              onClick={() => setExpanded(false)}
              className="flex items-center gap-3 flex-1 min-w-0"
            >
              <span
                className={`w-[18px] h-[18px] rounded-[5px] border flex items-center justify-center shrink-0 transition-colors ${
                  isActive ? "bg-blue-600 border-blue-600" : "border-gray-600"
                }`}
              >
                {isActive && (
                  <svg viewBox="0 0 20 20" fill="white" className="w-3 h-3">
                    <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z" clipRule="evenodd" />
                  </svg>
                )}
              </span>
              {/* max-sm:@max-[230px]:hidden — only on the narrowest phones
                  (320px), where the Edit pencil and the arrow would otherwise
                  cut the name: the initial is decoration (the checkbox marks
                  the selected card), so it gives way and the name keeps the
                  room it always had. */}
              <div
                className={`max-sm:@max-[230px]:hidden w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                  // text-gray-300, not -400: the card's initial is 12px BOLD,
                  // so it needs 4.5:1, and gray-400 on the gray-700 chip
                  // measured 3.96:1 in dark mode. gray-300 clears it at 7.34.
                  // Inactive still reads as the quiet one — that distinction is
                  // carried by hue and by the active chip's blue fill and
                  // border, not by making this letter hard to read.
                  isActive ? "bg-blue-600/30 border border-blue-500/40 text-blue-300" : "bg-gray-700 text-gray-300"
                }`}
              >
                {(card.label || card.name || card.username)[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">
                  {card.label || card.name || card.username}
                  {planInactive && (
                    <PlanGate
                      feature="link-off-badge"
                      nativeCopy="These links are only active on the Pro plan"
                      nativeContent={
                        <span className="ml-2 text-[0.5625rem] font-bold px-1.5 py-0.5 rounded-full bg-amber-950/60 text-amber-400 border border-amber-800/50 align-middle" title="These links are only active on the Pro plan">
                          LINK OFF — PRO ONLY
                        </span>
                      }
                    >
                      <span className="ml-2 text-[0.5625rem] font-bold px-1.5 py-0.5 rounded-full bg-amber-950/60 text-amber-400 border border-amber-800/50 align-middle" title="This card's public link, QR and Swift Links are off on the Free plan — upgrade to Pro to reactivate them.">
                        LINK OFF — PRO ONLY
                      </span>
                    </PlanGate>
                  )}
                </p>
                <p className="text-gray-500 text-xs truncate">
                  /{card.username}
                  {card.name ? ` · ${card.name}` : ""}
                </p>
              </div>
              {/* Inside the Link on purpose — useLinkStatus reads the pending
                  state of the navigation it is rendered within. */}
              <SelectingSpinner />
            </Link>

            {/* Edit, on every card (owner, 2026-09-29: the editor moved here
                from Settings → Cards and sharing, which now only deletes).
                A SIBLING of the select link, never inside it — a link in a
                link is invalid, and a tap here must open the editor, not
                switch cards. h-7 (28px) sits inside the row's existing 32px
                line (the initial chip), so the row is exactly as tall as it
                was; the name beside it truncates first, as it always has. */}
            <Link
              href={`/cards/${card.id}/edit`}
              aria-label={`Edit ${card.label || card.name || card.username}`}
              title="Edit this card"
              className={`shrink-0 inline-flex items-center justify-center gap-1 h-7 min-w-7 px-2 rounded-lg border text-[0.6875rem] font-semibold transition-colors ${
                isActive
                  ? "border-blue-500/40 text-blue-300 hover:text-white hover:bg-blue-600/20"
                  : "border-gray-600/70 text-gray-300 hover:text-white hover:border-gray-500 hover:bg-gray-700/40"
              }`}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 shrink-0" aria-hidden="true">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              {/* On a phone every row shows the pencil alone, a 28px square
                  that matches the dropdown arrow beside it: with the word, the
                  selected row (which also holds the arrow) cut a name as short
                  as "Nadlan Realty" at 375px, and the rows should look alike.
                  A computer tile shows "Edit" whenever it can without taking
                  room from the name. aria-label and title say Edit either way. */}
              <span className="max-sm:hidden @max-[250px]:hidden">Edit</span>
            </Link>

            {/* Mobile-only switcher, on the right of the SELECTED card. Absent
                entirely when there is only one card. */}
            {isActive && hasMultiple && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-label={expanded ? "Hide your other cards" : "Show your other cards"}
                className="sm:hidden shrink-0 -mr-1.5 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                >
                  <path fillRule="evenodd" d="M5.22 7.22a.75.75 0 011.06 0L10 10.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.28a.75.75 0 010-1.06z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        );
      })}

      {/* Free-plan upsell — outside the collapsing set on purpose (rule 2). */}
      {upsell}
    </div>
  );
}
