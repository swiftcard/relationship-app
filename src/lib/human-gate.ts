// ── Is there actually a person in front of this page? ────────────────────────
//
// The server's bot check is a User-Agent denylist (lib/bot-detection.ts), and a
// denylist only catches what it has heard of. The families that matter most —
// link-preview renderers and crawler render farms — present a completely normal
// browser UA, so they sail past it. Three things they cannot fake are available
// in the browser, and this is them:
//
//   1. navigator.webdriver — every automation framework sets it (Playwright,
//      Puppeteer, Selenium, and the crawler renderers built on top of them).
//   2. The page must actually be VISIBLE. Preview renderers paint into a hidden
//      surface and never bring it forward.
//   3. A dwell, still visible at the end of it. A preview crawler snapshots and
//      destroys the page in well under two seconds; a person who just opened a
//      card is still looking at it.
//
// A real visitor who bounces inside the dwell loses the event. That is the
// deliberate trade, made on the owner's order of 2026-08-26: views "cannot have
// misinformation", and an owner must never be told someone opened their card
// when no one did.
//
// WHY THIS FILE EXISTS. The gate lived inline in CardEventTracker, so the card
// view was gated and nothing else was. ScanSaveContact fires a "downloaded your
// contact card" event straight from an effect on page load — no webdriver check,
// no visibility check, no dwell — which means anything that merely LOADED a
// ?save=1 URL with a browser-shaped UA booked a contact download on the owner's
// card and a notification on their phone. One implementation, used by both, is
// the only way the two surfaces cannot drift apart again.

/** The dwell CardEventTracker has used since 2026-08-26. */
export const HUMAN_DWELL_MS = 2500;

export type HumanGateOptions = {
  /** Override the dwell. Only do this with a reason written down. */
  dwellMs?: number;
  /**
   * Count a page that was visible and then went AWAY as human.
   *
   * Needed by exactly one caller, and it would be wrong anywhere else. On the
   * QR-scan path the page hands the phone a .vcf and the operating system draws
   * its "Add to Contacts" sheet on top — which marks the page hidden. So the
   * dwell's "still visible at the end" test, which is the right test for a
   * view, would reject the most common successful save there is.
   *
   * A page that was never visible at all still fails: a preview renderer paints
   * into a hidden surface and never comes forward, so it can't reach this.
   */
  acceptBackgroundedAfterVisible?: boolean;
  /**
   * A REAL TAP OR KEY PRESS ON THE VISIBLE PAGE IS A PERSON — pass at once.
   *
   * The dwell exists to tell a person from a preview renderer, and nothing
   * tells them apart better than a trusted pointer or key event: a renderer
   * does not press anything, and a script's synthetic events carry
   * isTrusted=false. Without this, the visitor who opened the card and tapped
   * Instagram inside 2.5 seconds — the hand-off to the app hides the page —
   * never counted as a view at all: the tap was recorded with no visit behind
   * it, no notification, and no row in Recent visits (owner, 2026-11-05:
   * "sometimes it shows… sometimes it doesn't"). webdriver, visibility and
   * the prerender wait still apply before it.
   */
  passOnGesture?: boolean;
};

/**
 * Resolves true when this page is being looked at by a person, false when it
 * isn't (or when the caller cancelled first).
 *
 * `isCancelled` is read after every await so a component unmounting mid-wait
 * stops rather than recording into a page that is gone. Never throws: in a
 * non-browser context it returns false, because "no person" is the quiet,
 * non-inventing direction.
 */
export async function waitForHuman(
  isCancelled: () => boolean,
  options: HumanGateOptions = {},
): Promise<boolean> {
  const dwellMs = options.dwellMs ?? HUMAN_DWELL_MS;
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  // Chrome speculation-rules prerender runs effects before the visitor has seen
  // anything. Wait for the page to become real; an abandoned prerender simply
  // never resolves, and so never records.
  const doc = document as Document & { prerendering?: boolean };
  if (doc.prerendering) {
    await new Promise<void>((resolve) =>
      document.addEventListener("prerenderingchange", () => resolve(), { once: true }),
    );
    if (isCancelled()) return false;
  }

  if ((navigator as Navigator & { webdriver?: boolean }).webdriver) return false;

  if (document.visibilityState !== "visible") {
    await new Promise<void>((resolve) => {
      const onVis = () => {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", onVis);
          resolve();
        }
      };
      document.addEventListener("visibilitychange", onVis);
    });
    if (isCancelled()) return false;
  }

  // From here the page HAS been visible to someone. Watch whether it leaves —
  // that is the signal the save path needs and the view path must ignore.
  let leftWhileVisible = false;
  const onHide = () => { if (document.hidden) leftWhileVisible = true; };
  document.addEventListener("visibilitychange", onHide);
  // A trusted gesture on the visible page ends the dwell early (passOnGesture).
  // Capture phase on the document, so it is seen before the link's own
  // handler can take the page away.
  let gestured = false;
  let wake: (() => void) | null = null;
  const onGesture = (e: Event) => {
    if (!e.isTrusted || document.visibilityState !== "visible") return;
    gestured = true;
    wake?.();
  };
  const GESTURES = ["pointerdown", "touchstart", "keydown"] as const;
  if (options.passOnGesture) {
    for (const g of GESTURES) document.addEventListener(g, onGesture, { capture: true, passive: true });
  }
  try {
    await new Promise<void>((r) => {
      const t = setTimeout(r, dwellMs);
      wake = () => { clearTimeout(t); r(); };
    });
    if (isCancelled()) return false;
    if (gestured) return true;
    if (document.visibilityState === "visible") return true;
    return !!options.acceptBackgroundedAfterVisible && leftWhileVisible;
  } finally {
    document.removeEventListener("visibilitychange", onHide);
    if (options.passOnGesture) {
      for (const g of GESTURES) document.removeEventListener(g, onGesture, { capture: true });
    }
  }
}
