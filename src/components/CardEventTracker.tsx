"use client";

import { useEffect } from "react";
import { getVisitorId } from "@/lib/visitor";
import { whenIdentityReconciled } from "@/lib/account-state";
import { VIEW_VISIT_WINDOW_MS } from "@/lib/view-window";
import { waitForHuman } from "@/lib/human-gate";
import { outbox } from "@/lib/offline-outbox";

// Fire-at-most-once-per-visit guard, per (username+surface). A Map of last-fire
// times, not a Set: the old Set was never cleared, so in a long-lived SPA tab
// (card A → card B → back to A hours later) a genuinely new visit was silently
// dropped — including the card_events row that drives the owner's notification.
// Within the visit window it still swallows React strict-mode double-mounts,
// remounts, and back-navigation; past it, a return is a real repeat view and
// fires again (the server dedupes on the same window, so this can never
// overcount — it only stops pointless requests).
const lastFired = new Map<string, number>();

// ── The per-contact link token (?ct=, lib/contact-links.ts) ─────────────────
// Read ONCE per page load and removed from the address bar immediately, before
// the human gate even starts: a person who copies the URL to send it on must
// not pass their identity along with it. Module-level so strict-mode's double
// mount can't strip it on the first mount and find nothing on the second.
// Kept in step with CONTACT_LINK_PARAM (pinned by tests/contact-links.test.ts);
// not imported, because that module is server-only.
const CONTACT_LINK_PARAM = "ct";
let contactToken: string | null | undefined;
function takeContactToken(): string | null {
  if (contactToken !== undefined) return contactToken;
  contactToken = null;
  try {
    const url = new URL(window.location.href);
    const t = url.searchParams.get(CONTACT_LINK_PARAM);
    if (t) {
      url.searchParams.delete(CONTACT_LINK_PARAM);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      if (/^[A-Za-z0-9]{10}$/.test(t)) contactToken = t;
    }
  } catch {
    /* no token */
  }
  return contactToken;
}

export default function CardEventTracker({
  username,
  source,
  viewSurface = "card",
}: {
  username: string;
  source: string;
  // "card" tracks views under the plain username; "links" tracks the Swift Link
  // under "<username>__links" so the dashboard can show them separately.
  viewSurface?: "card" | "links";
}) {
  useEffect(() => {
    let cancelled = false;
    const token = takeContactToken();

    const fire = async () => {
      // ── Human gate (owner order 2026-08-26: views "cannot have
      // misinformation") ───────────────────────────────────────────────────
      // webdriver + visible + dwell, and the prerender wait in front of it.
      // MOVED TO lib/human-gate.ts, unchanged, because it lived only here: the
      // QR save path (ScanSaveContact) fired a contact-download event with no
      // gate at all, so one surface was protected and the other wasn't.
      if (!(await waitForHuman(() => cancelled))) return;

      // After an account switch, AccountIsolationGuard wipes the previous
      // person's visitor id + identity blob asynchronously — reading them
      // before that wipe lands is how a view got attributed to the previous
      // account's identity. Wait for the first reconcile (bounded; worst case
      // is the old behavior).
      await whenIdentityReconciled();
      if (cancelled) return;

      // Views table for the dashboard chart — keyed by surface so card vs link
      // split. The guard is claimed only AFTER the awaits and the cancel
      // checks: strict-mode's first (immediately-cleaned-up) mount must not
      // spend the slot, or the surviving mount would skip and the view would
      // be lost entirely.
      const viewsKey = viewSurface === "links" ? `${username}__links` : username;
      const last = lastFired.get(viewsKey);
      if (last && Date.now() - last < VIEW_VISIT_WINDOW_MS) return;
      lastFired.set(viewsKey, Date.now());

      const visitorId = getVisitorId();
      // NO NAME, EMAIL OR PHONE ON A VIEW. They used to ride along from the
      // swiftcard_visitor blob, which is written when someone shares with ANY
      // card — so every other card that browser opened was told who they were.
      // Who a visitor is to THIS owner is decided on the server now, from the
      // owner's own record of them (lib/known-contact.ts); the browser's claim
      // is not evidence and is no longer sent.
      // outbox: a view with no signal (a saved card reopened offline, or the
      // signal dropping mid-visit) is kept and sent later, not lost.
      outbox.fetch("/api/card-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_owner_username: username,
          visitor_id: visitorId,
          event_type: "viewed_card",
          source,
          // Which surface was opened — the notification says "your card" vs
          // "your Swift Links", and source alone no longer encodes it now that
          // the links page forwards real ?source= attribution (QR/NFC scans).
          surface: viewSurface,
          referrer_url: document.referrer || null,
          device_info: navigator.userAgent.slice(0, 250),
          // Only ever sent from here, AFTER waitForHuman: a link scanner or
          // preview that loads the page never gets this far.
          ...(token ? { contact_token: token } : {}),
        }),
      }).catch(() => {});

      // No second POST to /api/views: the event route records the card_views
      // row itself (lib/record-view.ts) so the chart and the notification are
      // decided by ONE request with ONE dedupe key.
    };

    void fire();
    return () => { cancelled = true; };
  }, [username, source, viewSurface]);

  return null;
}
