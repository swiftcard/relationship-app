import { cookies } from "next/headers";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/device";
import { SELF_PASS_COOKIE, decodeSelfPass } from "@/lib/self-pass";

// ── Owner self-traffic exclusion (shared across every analytics ingest) ──────
// A card owner poking at their own card/SwiftLink/preview must NEVER count as a
// visitor. Every public ingest endpoint (views, card-events, analytics/event)
// runs the SAME server-side check so there is no bypass. Client suppression
// (localStorage / a `self` flag / a client-supplied user or card id) is a UX
// nicety only — it is NEVER trusted for the exclusion decision.
//
// CRITICAL: exclusion is IDENTITY/OWNERSHIP-based, not IP-based. A legitimate
// external visitor who happens to share the owner's IP (office NAT, shared
// device while signed out, phone on the same Wi-Fi) MUST still count. Only the
// authenticated session that OWNS the exact slug is excluded — a team member or
// office admin viewing a colleague's card is a real visitor and is counted.

// A SwiftLink surface is tracked under "<slug>__links"; strip that suffix so the
// owner lookup resolves back to the underlying card. Plain card slugs are
// unaffected (they never contain "__links").
export function baseSlugForOwnerLookup(username: string): string {
  return username.replace(/__links$/, "");
}

// Pure ownership decision — the testable core of the exclusion. True only when a
// real viewer id matches a real owner id. Missing/empty ids never match (so a
// signed-out visitor, or a slug with no resolvable owner, is always counted),
// and it can never collapse two different users into a "self".
export function isSelfTraffic(
  ownerId: string | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  return !!ownerId && !!viewerId && ownerId === viewerId;
}

/**
 * How long a browser keeps counting as "signed in as this account" for the
 * purpose of suppressing the owner's own views. Long enough to cover how people
 * actually reach their own card (the share sheet, a QR, the app, a laptop they
 * signed into last month); short enough that a device handed on or resold stops
 * suppressing the previous owner's analytics.
 */
export const DEVICE_CLAIM_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Pure set form of {@link isSelfTraffic}: does ANY account that has claimed this
 * browser own the slug? An empty list or a missing owner never matches, so a
 * signed-out visitor on an unknown browser is always counted.
 */
export function claimsOwner(claimantIds: readonly string[], ownerId: string | null | undefined): boolean {
  return !!ownerId && claimantIds.some((id) => !!id && id === ownerId);
}

type Admin = ReturnType<typeof getAdminSupabase>;

// Resolve the user id that owns a slug: the cards table first (multi-card
// accounts), then the legacy profile username as a fallback. Returns null for a
// slug nobody owns.
export async function resolveOwnerId(admin: Admin, slug: string): Promise<string | null> {
  const base = baseSlugForOwnerLookup(slug);
  const { data: card } = await admin
    .from("cards")
    .select("user_id")
    .eq("username", base)
    .maybeSingle();
  if (card?.user_id) return card.user_id as string;
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", base)
    .maybeSingle();
  return (profile?.id as string | undefined) ?? null;
}

// ── The SECOND owner signal, and why one was not enough ──────────────────────
//
// For months the only way this file could recognise an owner was an
// authenticated Supabase session on the request. Production says that signal
// never once fired: across the entire history of analytics_ingest_log there
// are ZERO decisions with reason "self", while the owner's own views of his own
// cards were recorded as anonymous visitors and pushed to his own phone.
//
// The reason is structural. A card page and a Swift Links page are PUBLIC
// routes, and public routes are deliberately outside src/proxy.ts's matcher —
// so nothing on those requests refreshes the session or persists a rotated
// refresh token (the matcher's own comment spells out that hazard). An owner
// arriving at their card with an expired access token therefore reads as
// signed-out to getUser(), and with only one signal there was nothing else to
// ask. Add to that the ordinary cases — the card opened from the share sheet,
// from a QR scan, from an in-app browser, from the phone rather than the laptop
// they are signed in on — and "the owner is a visitor" is the common path, not
// the edge.
//
// sc_device is the answer, and it costs nothing new: src/proxy.ts already
// plants it on every authenticated route, it is httpOnly (page script can
// neither read nor forge it), it is a year long, and user_devices maps it to
// the account that claimed it. It says "this browser profile is signed in as
// <user>", which is a narrower and more honest claim than an IP will ever be —
// it is one browser on one machine, exactly the thing an owner uses to look at
// their own card.
//
// STILL NOT IP-BASED, and still per-identity: a visitor who shares the owner's
// network, or borrows their phone while signed out of a DIFFERENT browser, has
// no sc_device of the owner's and counts normally.
async function deviceClaimants(admin: Admin): Promise<string[]> {
  try {
    const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
    if (!isDeviceId(deviceId)) return [];
    // EVERY account that has claimed this browser recently, not just the most
    // recent one (owner report, 2026-09-18).
    //
    // "Most recent claimant" was wrong for the commonest case there is: one
    // person with two SwiftCard accounts on one device. Production proved it —
    // the owner's two accounts have each claimed the same two device ids, and
    // last_seen only moves when THAT account loads a protected page. So he
    // opened his own /swiftcard while the other account's row happened to be
    // fresher, this check named the wrong account, and his own visit was
    // recorded as a stranger and pushed to his own phone.
    //
    // A set, bounded by DEVICE_CLAIM_MS, keeps the honest half of the old rule
    // (a device really handed on ages out) and drops the half that could never
    // be right (one browser, one account, ever).
    const { data } = await admin
      .from("user_devices")
      .select("user_id")
      .eq("device_id", deviceId)
      .gte("last_seen", new Date(Date.now() - DEVICE_CLAIM_MS).toISOString());
    return (data ?? []).map((r) => r.user_id as string).filter(Boolean);
  } catch {
    // Table not migrated, cookie store unavailable outside a request, Supabase
    // unreachable — fail towards COUNTING, exactly like the session check.
    return [];
  }
}

// The THIRD signal: the owner's pass (lib/self-pass), left by their own "View
// live" link on whatever browser it opened in — in the iPhone app that is
// Safari, which has neither a session nor a device claim. Signed and httpOnly,
// so it cannot be forged by a page or a visitor. Fails towards counting.
async function selfPassClaimants(): Promise<string[]> {
  try {
    return decodeSelfPass((await cookies()).get(SELF_PASS_COOKIE)?.value);
  } catch {
    return [];
  }
}

/**
 * Every account this browser is known to belong to, by the two signals that
 * outlive a session: the device claim (sc_device) and the owner's pass. The
 * website ingest asks it to recognise the team's own browsers while they're
 * signed out (2026-10-28). Never throws; [] means "no claim".
 */
export async function browserAccountIds(admin: Admin): Promise<string[]> {
  const [pass, device] = await Promise.all([selfPassClaimants(), deviceClaimants(admin)]);
  return [...new Set([...pass, ...device])];
}

// Full server-side check: is the CURRENT request coming from the slug's owner?
// Safe to call unconditionally — with neither signal (signed-out visitor, cron,
// bot, automated preview) it returns false and the event is recorded normally.
export async function isOwnerRequest(admin: Admin, slug: string): Promise<boolean> {
  try {
    const ownerId = await resolveOwnerId(admin, slug);
    if (!ownerId) return false;

    // The session is authoritative when it is there.
    try {
      const { data: { user: viewer } } = await (await createClient()).auth.getUser();
      if (isSelfTraffic(ownerId, viewer?.id)) return true;
    } catch {
      // Auth lookup failed — fall through to the device signal, which is
      // exactly the outage/expiry case it exists for.
    }

    return claimsOwner([...(await selfPassClaimants()), ...(await deviceClaimants(admin))], ownerId);
  } catch {
    // No request context available (e.g. invoked from a script) — treat as a
    // visitor; never let a lookup failure drop a legitimate event.
    return false;
  }
}

/**
 * The same decision for a caller that has ALREADY resolved the owner and the
 * session viewer and does not want to pay for either a second time
 * (/api/card-events resolves both for its identity handling).
 */
export async function isOwnerActivity(
  admin: Admin,
  ownerId: string | null,
  sessionUserId: string | null | undefined,
): Promise<boolean> {
  if (!ownerId) return false;
  if (isSelfTraffic(ownerId, sessionUserId)) return true;
  return claimsOwner([...(await selfPassClaimants()), ...(await deviceClaimants(admin))], ownerId);
}
