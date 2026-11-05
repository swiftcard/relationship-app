import { createHash } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

// ── Who is on the other end of a view, decided by the SERVER ─────────────────
//
// THE BUG THIS EXISTS FOR. One visit to a freshly-created card produced FOUR
// counted views and FOUR "unique visitors" (prod, 2026-09-14 15:55–15:56 on
// menashharooni-swiftcard-2: four card_views rows, four different visitor ids,
// one card, ninety seconds). request-geo.ts had already written down the same
// shape from an earlier sighting — "seven views, seven different visitor ids, a
// fresh browser each time".
//
// The cause was never the dedupe logic; it was the KEY the dedupe logic ran on.
// The visitor id was minted by page script into localStorage (lib/visitor.ts)
// and sent up in the request body, so it is only as durable as that browser's
// storage. In-app browsers (LinkedIn, Instagram, Messages), a WKWebView that
// gets a fresh data store per open, Safari's storage partitioning and private
// windows, an ITP eviction, a cleared site — every one of them hands the next
// page load a BRAND NEW id. And a brand new id defeats both halves of the old
// dedupe at once:
//
//   • the visit-window lookup is keyed on visitor_id, so it matches nothing;
//   • the per-IP backstop sat in an `else` branch, reached ONLY when no
//     visitor id was supplied at all — so a fresh-id-every-load client
//     skipped it every single time.
//
// One visit, N loads, N rows, N "unique visitors". Exactly what the owner saw.
//
// TWO DURABLE SIGNALS REPLACE THE ONE FRAGILE ONE.
//
//   1. sc_vid — a first-party, httpOnly cookie the ingest routes set on the
//      response. A cookie survives everything localStorage survives and a good
//      deal that it doesn't, page script can neither read nor rotate it, and
//      it is scoped to this site alone. On first sight we ADOPT the client's
//      existing localStorage id rather than minting over it, so every visitor
//      already known to the dashboard keeps their history and their "repeat
//      visitor" status.
//
//   2. deviceKey — sha256(ip + user-agent + card), computed on every request
//      and stored on the row. Never an identity and never displayed: it is the
//      answer to "has THIS BROWSER ON THIS NETWORK already been counted for
//      THIS CARD in this visit?", which is the question a client with no
//      durable storage at all cannot answer for us. Hashed because the raw IP
//      is deliberately not persisted (see record-view.ts), and salted with the
//      card key so the stored value cannot be used to follow one device from
//      one owner's card to another's.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not collapse visitors by IP.
// Two people behind one office NAT are two people (self-traffic.ts spells out
// why that rule matters), and they reach here with two different user agents,
// two different cookies, or both. The only pair this merges is a pair that
// shares an IP AND a byte-identical User-Agent AND lands inside the same
// 30-minute window — which is one person's page re-loading, not a conference
// room.

/** The durable visit identity. httpOnly, first-party, two years. */
export const VISITOR_COOKIE = "sc_vid";

/** Two years: long enough that "a repeat visitor" survives a real-world gap. */
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 730;

/** The same length cap /api/card-events already applies to the
 *  client-supplied id, so an adopted value can never exceed the column's
 *  expectations or the cookie's sane size. */
const MAX_ID_LEN = 64;

/** Cryptographically random and URL-safe — the shape newDeviceId() uses. */
function newVisitorId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A cookie value we are willing to treat as an identity.
 *
 * Permissive on shape because it may be an ADOPTED localStorage id from any
 * era of this app (a UUID, or the `v-…` fallback lib/visitor.ts mints when
 * crypto.randomUUID is unavailable), and strict on the things that matter: no
 * control characters, no separators that could confuse a cookie or a query,
 * bounded length.
 */
export function isVisitorId(v: string | null | undefined): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_.:-]{8,64}$/.test(v);
}

export type VisitIdentity = {
  /** The id every downstream row is keyed on. Never null. */
  visitorId: string;
  /** Set the cookie on the response? True on the first request from a browser
   *  that does not carry one yet — including the adoption case. */
  setCookie: boolean;
  /** True when nothing durable arrived and we had to invent the id. Recorded
   *  so a spike in fresh identities is visible rather than silently inflating
   *  the unique-visitor count. */
  minted: boolean;
};

/**
 * The pure decision: cookie wins, then the client's own id, then a fresh one.
 *
 * The cookie wins over the body deliberately. A client that mints a new
 * localStorage id on every load (the whole reason this file exists) would
 * otherwise keep overwriting a perfectly good server-side identity with noise;
 * the cookie is the one value in the request that this browser cannot have
 * lost since its last visit.
 */
export function decideVisitIdentity(
  cookieId: string | null | undefined,
  clientId: string | null | undefined,
): VisitIdentity {
  if (isVisitorId(cookieId)) return { visitorId: cookieId, setCookie: false, minted: false };
  const adopted = typeof clientId === "string" ? clientId.trim().slice(0, MAX_ID_LEN) : "";
  if (isVisitorId(adopted)) return { visitorId: adopted, setCookie: true, minted: false };
  return { visitorId: newVisitorId(), setCookie: true, minted: true };
}

/** Read the identity for this request. `clientId` is the body's visitorId. */
export function resolveVisitIdentity(req: NextRequest, clientId: string | null): VisitIdentity {
  return decideVisitIdentity(req.cookies.get(VISITOR_COOKIE)?.value ?? null, clientId);
}

/**
 * Persist the identity so the NEXT load of this card is recognisably the same
 * visit. Called on every public ingest response; a no-op when the browser
 * already carries the cookie.
 */
export function attachVisitIdentity<T extends NextResponse>(res: T, identity: VisitIdentity): T {
  if (!identity.setCookie) return res;
  res.cookies.set(VISITOR_COOKIE, identity.visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE,
  });
  return res;
}

/**
 * The per-card device fingerprint used as the LAST-RESORT dedupe key.
 *
 * Salted with the card key on purpose: the value is stored on card_views, and
 * an unsalted hash of (ip + ua) would be a stable cross-card identifier — a
 * tracking primitive this product has no use for. Salted, it answers only the
 * one question the dedupe asks and says nothing about anywhere else the device
 * has been.
 *
 * Null when there is nothing to hash: a request with no usable IP is one this
 * key cannot speak for, and a null key must never match another null key.
 */
export function deviceKeyFor(opts: {
  ip: string | null | undefined;
  userAgent: string | null | undefined;
  username: string;
}): string | null {
  const ip = (opts.ip ?? "").trim();
  if (!ip || ip === "unknown") return null;
  const sep = String.fromCharCode(31);
  return createHash("sha256")
    .update([opts.username.toLowerCase(), ip, (opts.userAgent ?? "").trim()].join(sep))
    .digest("hex")
    .slice(0, 32);
}
