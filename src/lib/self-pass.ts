import { createHmac, timingSafeEqual } from "node:crypto";

// ── The owner's pass: "this browser belongs to the card's owner" ─────────────
//
// Owner, 2026-09-24: when someone opens their OWN SwiftCard or Swift Links —
// most often with "View live" at the top of their dashboard — it must not be
// recorded as a view. "It's a legal issue": the numbers an owner is shown are
// statements about other people looking at their card.
//
// The server already recognises an owner two ways (lib/self-traffic): the
// signed-in session, and a browser they have signed in on (sc_device). Neither
// reaches the case that matters most. In the iPhone app a new-tab link is handed
// to iOS (Capacitor's createWebViewWith → UIApplication.open), so "View live"
// opens in SAFARI — no session, and a browser the account never signed in on.
// That visit was recorded as a stranger.
//
// So an owner's own "open my card" links go through /api/self-view with a
// signed token, which leaves this pass on whatever browser the link lands in:
// an httpOnly cookie holding the owner's account id(s), signed so a page script
// or a visitor cannot forge one, then redirects to the card at its normal
// address. Every view counter asks self-traffic, and self-traffic now reads the
// pass too.
//
// It is NOT a device slot: sign-in allows two devices per account
// (lib/device DEVICE_LIMIT) and a Safari tab opened from "View live" must never
// use one up. It grants nothing — it only stops counting.

export const SELF_PASS_COOKIE = "sc_self";
/** Same span the device signal trusts (self-traffic DEVICE_CLAIM_MS): 90 days. */
export const SELF_PASS_MAX_AGE_S = 90 * 24 * 60 * 60;
/** A "View live" link stays good this long — a dashboard left open for days still works. */
const LINK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** A browser shared by a family can carry a few owners; never an unbounded list. */
const MAX_OWNERS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): string | null {
  return process.env.OAUTH_SECRET || null;
}

/** HMAC over a PURPOSE-prefixed payload, so a link token can never be replayed as a pass or the reverse. */
function sign(purpose: "self-link" | "self-pass", payload: string, key: string): string {
  return createHmac("sha256", key).update(`${purpose}|${payload}`).digest("base64url");
}

function verify(purpose: "self-link" | "self-pass", token: string | null | undefined): string | null {
  const key = secret();
  if (!key || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let payload: string;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }
  const a = Buffer.from(sign(purpose, payload, key));
  const b = Buffer.from(parts[1]);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

/** A token for the owner's own "View live" link. Null when signing is unavailable. */
export function signSelfLink(userId: string, now = Date.now()): string | null {
  const key = secret();
  if (!key || !UUID.test(userId)) return null;
  const payload = `${userId}|${now}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign("self-link", payload, key)}`;
}

/** The account a "View live" token was minted for, if it is genuine and fresh. */
export function verifySelfLink(token: string | null | undefined, now = Date.now()): string | null {
  const payload = verify("self-link", token);
  if (!payload) return null;
  const [userId, ts] = payload.split("|");
  const at = Number(ts);
  if (!UUID.test(userId ?? "") || !Number.isFinite(at) || now - at > LINK_MAX_AGE_MS || at - now > 60_000) return null;
  return userId;
}

/** The cookie value for a set of owner ids (newest first, bounded). */
export function encodeSelfPass(ids: string[]): string | null {
  const key = secret();
  const clean = [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, MAX_OWNERS);
  if (!key || !clean.length) return null;
  const payload = clean.join(",");
  return `${Buffer.from(payload).toString("base64url")}.${sign("self-pass", payload, key)}`;
}

/** The owner ids a pass cookie vouches for; an unsigned or tampered one vouches for nobody. */
export function decodeSelfPass(value: string | null | undefined): string[] {
  const payload = verify("self-pass", value);
  if (!payload) return [];
  return payload.split(",").filter((id) => UUID.test(id)).slice(0, MAX_OWNERS);
}

/**
 * Only a card or Swift Links path of our own — never an open redirect.
 * "/dana-whitfield", "/links/dana-whitfield", "/card/dana-whitfield".
 */
export function selfViewTarget(to: string | null | undefined): string | null {
  if (typeof to !== "string") return null;
  if (/^\/(?:(?:links|card)\/)?[a-z0-9][a-z0-9_-]{0,79}\/?$/i.test(to)) return to;
  // A Create + share link (lib/create-link): /<slug>/p/<13 digits><j|p|g>. The
  // owner's preview of something they linked opens it through here, so their
  // own click — in the iPhone app it lands in Safari — is never a view.
  return /^\/[a-z0-9][a-z0-9_-]{0,79}\/p\/\d{13}[jpg]$/i.test(to) ? to : null;
}

/**
 * The href for an owner's OWN live card or Swift Links: through /api/self-view,
 * so whichever browser it opens in is marked as the owner's before the page
 * loads. Falls back to the plain URL whenever it can't sign or the target
 * isn't a card path — the button always works.
 */
export function ownLiveHref(userId: string | null | undefined, url: string, appUrl: string): string {
  if (!userId) return url;
  let path: string;
  try {
    path = new URL(url, appUrl).pathname;
  } catch {
    return url;
  }
  const target = selfViewTarget(path);
  const token = target ? signSelfLink(userId) : null;
  if (!target || !token) return url;
  return `${appUrl.replace(/\/+$/, "")}/api/self-view?to=${encodeURIComponent(target)}&t=${encodeURIComponent(token)}`;
}
