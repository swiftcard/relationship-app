"use client";

import { useEffect, useRef } from "react";
import { getVisitorId, markSavedContact } from "@/lib/visitor";
import { waitForHuman } from "@/lib/human-gate";
import { outbox } from "@/lib/offline-outbox";
import { SCAN_SAVED_EVENT } from "@/lib/scan-saved-event";

// ── The QR-scan landing behaviour ────────────────────────────────────────────
//
// Scanning the desktop "Scan QR code" popup used to send the phone straight to
// the raw .vcf endpoint. The contact sheet appeared, but the moment it was
// dismissed the visitor was staring at a blank page holding a downloaded file —
// the card they'd just scanned was nowhere.
//
// So the QR now lands on the CARD PAGE with ?save=1, and this component fires
// the vCard from there. The phone stacks its native "Add to Contacts" sheet on
// top, and when that's dismissed the full SwiftCard is already loaded
// underneath, ready to scroll.
//
// Delivery is a hidden IFRAME rather than window.location: navigating the top
// frame to a text/vcard URL leaves Android Chrome on a blank tab (it treats the
// navigation as a download and the page it came from is gone). An iframe hands
// the file over while the card page keeps the viewport — same trick the wallet
// pass uses.
export default function ScanSaveContact({
  username,
  source,
  joinVisit = null,
  suppressTracking = false,
}: {
  username: string;
  /**
   * Capture channel, taken from the page's ?source= exactly like every other
   * surface — the QR encodes source=qr_code, so this arrives as "qr_code" and
   * runs through the same SOURCE_LABELS map ("QR code scan"). Hardcoding a new
   * value here would miss that map and print a raw lowercase slug into the
   * owner's notification, which is precisely what happened to swift_links once.
   */
  source: string;
  /** The computer's visit the desktop "Scan to save" QR came from (?vv=): the
   *  download joins it instead of starting a second visit (api/card-events). */
  joinVisit?: string | null;
  /** Owner previewing their own card — deliver the contact, record nothing. */
  suppressTracking?: boolean;
}) {
  // Refs, not effect-local flags: the guards must survive an effect re-run.
  // An earlier version put a single `if (fired.current) return` ABOVE the
  // listener setup — so on any second run (StrictMode in dev, or a remount) the
  // cleanup had already torn the timers down and the early return never rebuilt
  // them. The contact was delivered and the ask then never fired at all.
  const delivered = useRef(false);
  const announced = useRef(false);
  const tracked = useRef(false);

  useEffect(() => {
    // Cleared by the cleanup below, read by the human gate: an unmount must stop
    // a pending record rather than writing into a page that is gone.
    let cancelled = false;

    // ── Hand the phone the contact ───────────────────────────────────────────
    // Small delay so the card paints FIRST. Without it the contact sheet can
    // open over a half-rendered page, and dismissing it reveals a blank card —
    // exactly the problem this component exists to fix.
    let deliverTimer: ReturnType<typeof setTimeout> | undefined;
    if (!delivered.current) {
      deliverTimer = setTimeout(() => {
        delivered.current = true;
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = `/api/card/${encodeURIComponent(username)}/vcard`;
        document.body.appendChild(iframe);
        // Leave it attached briefly so the transfer completes, then clean up.
        setTimeout(() => iframe.remove(), 20_000);
      }, 700);
    }

    // ── Raise the share-back ask once they're back from the OS sheet ─────────
    //
    // The "Add to Contacts" screen belongs to the operating system, so there is
    // no event for "they finished". THREE signals, whichever lands first:
    //   • the tab going hidden and returning — when the sheet is its own surface
    //   • the window regaining focus — how iOS behaves on dismissal
    //   • a timer, because iOS can draw the sheet over Safari WITHOUT ever
    //     marking the page hidden or blurring it, and a signal-only approach
    //     would leave the ask never appearing on iPhone at all
    const announce = () => {
      if (announced.current) return;
      announced.current = true;
      window.dispatchEvent(new CustomEvent(SCAN_SAVED_EVENT));
    };
    let wasHidden = false;
    const onVisibility = () => {
      if (document.hidden) { wasHidden = true; return; }
      if (wasHidden) announce();
    };
    // Focus only counts AFTER the contact has actually been handed over —
    // otherwise a focus event during page load would fire the ask instantly,
    // before the visitor has even seen the contact sheet.
    const onFocus = () => { if (delivered.current) announce(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    // Past the sheet in the common case, still close enough to the save that the
    // ask reads as part of the same moment.
    const askTimer = setTimeout(announce, 4500);

    // ── Record the download, but only for a PERSON ───────────────────────────
    //
    // This used to fire the moment the effect ran. No webdriver check, no
    // visibility check, no dwell — so anything that merely LOADED a ?save=1 URL
    // while presenting a browser-shaped User-Agent booked a contact download on
    // the owner's card and a notification on their phone. The card view on this
    // same page has been gated since 2026-08-26; the save never was, which made
    // the two surfaces of one page disagree about what counts as a human.
    //
    // The gate runs CONCURRENTLY with delivery above, not in front of it: the
    // visitor scanned a QR to get a contact, and making them wait 2.5 seconds
    // for the sheet to protect a statistic would be the wrong trade. Delivery
    // is unchanged at 700ms; only the event waits.
    //
    // acceptBackgroundedAfterVisible is why this path needs its own flag: the
    // OS "Add to Contacts" sheet marks the page hidden, so the view gate's
    // "still visible at the end" test would reject the most common successful
    // save there is. A page that was NEVER visible still fails, which is what
    // keeps preview renderers out.
    //
    // Ref-guarded like delivery: the effect body runs on every pass, and
    // recording twice would double the owner's notification and their contact
    // download count off a single scan.
    if (!suppressTracking && !tracked.current) {
      tracked.current = true;
      markSavedContact(username);
      void (async () => {
        if (!(await waitForHuman(() => cancelled, { acceptBackgroundedAfterVisible: true }))) return;
        // BYTE-FOR-BYTE what SaveContactButton fires — ONE request, not two. Both routes end at the
        // same moment — the phone's "Add to Contacts" sheet — so the owner must
        // get the identical bell entry, activity row and CRM dispatch either
        // way. /api/card-events owns all three off downloaded_vcard; sending
        // anything different here would fork the flow. (Both used to ALSO post a
        // "contact_save" row to analytics_events; that table has no reader
        // anywhere, so it was a duplicate recording of one real action and is
        // gone from both.) Through the offline outbox like the button's, so a
        // scan that lands with no signal is reported once there is — a plain
        // fetch dropped it while the button's identical save was kept.
        outbox.fetch("/api/card-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            card_owner_username: username,
            visitor_id: getVisitorId(),
            event_type: "downloaded_vcard",
            // The QR lands on the CARD page, so the download belongs to that
            // surface. Without it the row carries no surface and the event
            // shares a dedup slot with a links-page save in the same visit.
            surface: "card",
            source,
            ...(joinVisit ? { join_visit: joinVisit } : {}),
          }),
        }).catch(() => {});
      })();
    }

    return () => {
      cancelled = true;
      if (deliverTimer) clearTimeout(deliverTimer);
      clearTimeout(askTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [username, source, joinVisit, suppressTracking]);

  return null;
}
