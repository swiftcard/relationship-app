"use client";

import { useEffect, useRef } from "react";
import { isLinkedInTicket } from "@/lib/linkedin-ticket";

// ── The LinkedIn photo round trip: ONE way back, from anywhere ──────────────
//
// Importing a LinkedIn photo means leaving the page for LinkedIn's consent
// screen and coming back. Each screen used to have its own way back, and every
// one leaned on something fragile: URL parameters surviving, saved progress
// existing, a popup keeping its opener (LinkedIn's sign-in page cuts it, COOP),
// or iOS following a swiftcard:// redirect out of the in-app sheet. When one
// link broke, the photo — already imported and stored — silently never arrived
// (owner, 2026-10-20: "Allow → back on the same page, no photo, no crop").
//
// Now every Connect tap makes a ticket (lib/linkedin-ticket). The callback
// stores the photo under it, and the page asks for its photo by ticket
// whenever it gets control back — on load, on focus, on switching back to the
// tab, when the app's sheet closes or its swiftcard:// link arrives, and every
// few seconds while it is waiting and on screen. HOW it got control back no
// longer matters. The page then puts the photo in its headshot and opens the
// crop tool (ImageUpload adjustKey).
//
// Each page picks up only the ticket for its own `scope`, so the three homepage
// builders sharing one page never take each other's photo.

/** Same-origin page the editors' LinkedIn window lands on; it only closes. */
export const LINKEDIN_RELAY_PATH = "/linkedin-connected";

/** NativeAppBridge fires this when the app's LinkedIn sheet is done with. */
export const LINKEDIN_RETURN_EVENT = "swiftcard:linkedin-return";

/** Fired with { scope, status } when an import came back without a photo. */
export const LINKEDIN_STATUS_EVENT = "swiftcard:linkedin-status";

const TICKET_KEY = "sc_li_ticket";
/** A ticket is honoured this long — past the connect cookies' 30 minutes. */
const TICKET_TTL_MS = 35 * 60 * 1000;
/** While waiting and on screen, ask this often… */
const POLL_MS = 2500;
/** …for this long after the tap; after that only focus / return events ask. */
const POLL_FOR_MS = 5 * 60 * 1000;

type Pending = { t: string; scope: string; at: number };

function newTicket(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Old WebKit without randomUUID: same shape, from getRandomValues.
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
}

/** Start one attempt for `scope`: the ticket to send to /connect?t=. */
export function startLinkedInPhoto(scope: string): string {
  const t = newTicket();
  try {
    localStorage.setItem(TICKET_KEY, JSON.stringify({ t, scope, at: Date.now() } satisfies Pending));
  } catch { /* storage blocked — the URL return (?li_photo=) still works */ }
  return t;
}

/** The attempt `scope` is waiting on, if any (and not stale). */
export function pendingLinkedInPhoto(scope: string): Pending | null {
  try {
    const raw = localStorage.getItem(TICKET_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    if (!p || !isLinkedInTicket(p.t) || typeof p.at !== "number") return null;
    if (Date.now() - p.at > TICKET_TTL_MS) {
      localStorage.removeItem(TICKET_KEY);
      return null;
    }
    return p.scope === scope ? p : null;
  } catch {
    return null;
  }
}

/** Some page is waiting on a LinkedIn photo (whichever scope). */
export function hasPendingLinkedInPhoto(): boolean {
  try {
    const p = JSON.parse(localStorage.getItem(TICKET_KEY) || "null") as Pending | null;
    return !!p && isLinkedInTicket(p.t) && Date.now() - p.at <= TICKET_TTL_MS;
  } catch {
    return false;
  }
}

/** The attempt for `scope` is handled (its photo arrived some other way). */
export function settleLinkedInPhoto(scope: string, ticket?: string): void {
  try {
    const p = pendingLinkedInPhoto(scope);
    if (p && (!ticket || p.t === ticket)) localStorage.removeItem(TICKET_KEY);
  } catch { /* storage blocked */ }
}

/** A photo URL from our own public storage — the only kind ever applied. */
export function isStoredPhotoUrl(url: string | null | undefined, storageOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL): url is string {
  return !!url && !!storageOrigin && url.startsWith(`${storageOrigin}/storage/v1/object/public/`);
}

export type PickupResult = { url: string } | { status: string } | null;

/** Ask once for `scope`'s photo. Settles the ticket when there is an answer. */
export async function pickUpLinkedInPhoto(scope: string): Promise<PickupResult> {
  const p = pendingLinkedInPhoto(scope);
  if (!p) return null;
  let data: { url?: string; status?: string; pending?: boolean };
  try {
    const res = await fetch(`/api/integrations/linkedin/photo?t=${p.t}`, { cache: "no-store" });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }
  // Handled some other way while we asked (the ?li_photo= return, another tab).
  if (pendingLinkedInPhoto(scope)?.t !== p.t) return null;
  if (isStoredPhotoUrl(data.url)) {
    settleLinkedInPhoto(scope, p.t);
    return { url: data.url };
  }
  if (data.status === "nophoto" || data.status === "error") {
    settleLinkedInPhoto(scope, p.t);
    return { status: data.status };
  }
  return null;
}

// ── A failed import, carried to the suggester ───────────────────────────────
// The suggester may not be on screen when the answer arrives (a homepage
// builder still closed, the wizard on another step), so the status waits in
// sessionStorage and the suggester shows it when it mounts — or at once, via
// LINKEDIN_STATUS_EVENT, if it is already there.
export const LINKEDIN_GUEST_STATUS_KEY = "sc_li_guest_status";

export function stashGuestLinkedInStatus(status: string | null): void {
  if (!status || status === "photo") return;
  try { sessionStorage.setItem(LINKEDIN_GUEST_STATUS_KEY, status); } catch { /* storage blocked */ }
}

export function takeGuestLinkedInStatus(): string | null {
  try {
    const s = sessionStorage.getItem(LINKEDIN_GUEST_STATUS_KEY);
    if (s) sessionStorage.removeItem(LINKEDIN_GUEST_STATUS_KEY);
    return s;
  } catch {
    return null;
  }
}

export function reportLinkedInStatus(scope: string, status: string): void {
  stashGuestLinkedInStatus(status);
  window.dispatchEvent(new CustomEvent(LINKEDIN_STATUS_EVENT, { detail: { scope, status } }));
}

/** Strip the URL return's own parameters so a refresh can't replay it. */
export function stripLinkedInReturnParams(keys: string[] = ["li_photo", "integration", "status"]): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const k of keys) if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
  if (changed) window.history.replaceState(window.history.state, "", url.toString());
}

/**
 * Pick up `scope`'s LinkedIn photo whenever this page gets control back.
 *
 * `onPhoto` gets the stored URL — the page applies it to its headshot and bumps
 * the tile's adjustKey so it opens in the crop tool. `onStatus` (optional) hears
 * a failure; the suggester is told either way. `fromUrl` also applies a
 * ?li_photo= the page was loaded with — for the editors, which have no reader
 * of their own (the builders and the wizard do, and call settleLinkedInPhoto).
 */
export function useLinkedInPhotoPickup(
  scope: string,
  onPhoto: (url: string) => void,
  opts: { onStatus?: (status: string) => void; fromUrl?: boolean } = {},
): void {
  const handlers = useRef({ onPhoto, onStatus: opts.onStatus });
  useEffect(() => {
    handlers.current = { onPhoto, onStatus: opts.onStatus };
  });
  const fromUrl = !!opts.fromUrl;

  useEffect(() => {
    let live = true;
    let busy = false;

    if (fromUrl) {
      const photo = new URLSearchParams(window.location.search).get("li_photo");
      if (photo) {
        stripLinkedInReturnParams();
        if (isStoredPhotoUrl(photo)) {
          settleLinkedInPhoto(scope);
          // Off the effect body, so the page's setState lands in its own render.
          setTimeout(() => { if (live) handlers.current.onPhoto(photo); }, 0);
        }
      }
    }

    const check = async () => {
      if (busy || !live) return;
      busy = true;
      try {
        const r = await pickUpLinkedInPhoto(scope);
        if (!live || !r) return;
        if ("url" in r) handlers.current.onPhoto(r.url);
        else {
          reportLinkedInStatus(scope, r.status);
          handlers.current.onStatus?.(r.status);
        }
      } finally {
        busy = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const onReturn = () => { void check(); };
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const p = pendingLinkedInPhoto(scope);
      if (p && Date.now() - p.at < POLL_FOR_MS) void check();
    };

    void check();
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener("focus", onReturn);
    window.addEventListener("pageshow", onReturn);
    window.addEventListener(LINKEDIN_RETURN_EVENT, onReturn);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("pageshow", onReturn);
      window.removeEventListener(LINKEDIN_RETURN_EVENT, onReturn);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [scope, fromUrl]);
}
