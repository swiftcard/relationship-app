import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { isLikelyBot } from "@/lib/bot-detection";
import { resolveGeo } from "@/lib/request-geo";
import { attachVisitIdentity, resolveVisitIdentity } from "@/lib/visit-identity";
import { browserAccountIds } from "@/lib/self-traffic";
import { accountKindOf } from "@/lib/admin-data/accounts";

// Cookie a site-owner sets on their own device (via the Website analytics page)
// so their and their partner's browsing is tagged internal and filtered out.
const INTERNAL_COOKIE = "sc_internal";

// Time on page is a real signal but easy to fat-finger via a scripted beacon;
// cap it at 30 minutes so one bad value can't skew the average.
const MAX_DURATION_MS = 30 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only keep the referrer HOST, and never our own domain (internal navigation
// isn't a referral). Full URLs can carry PII in query strings — host is enough.
function referrerHost(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    if (host === "swiftcard.me" || host === "swiftcard.app" || host === "localhost") return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

/** A campaign tag as written on the link, bounded. */
function tag(raw: unknown, max = 100): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/s+/g, " ").slice(0, max);
  return v || null;
}

const DEVICES = new Set(["phone", "tablet", "computer"]);

// The card builder and sign-in are where a website visit goes next, so they
// count for a visitor. For someone already signed in they are the app (adding
// a second card), not the website.
const APP_WHEN_SIGNED_IN = new Set(["/cards/new", "/login"]);

/** Ours: an admin, an @swiftcard.me account, a founder's, QA's test mailboxes. */
async function isOurs(userId: string | null | undefined, email: string | null | undefined): Promise<boolean> {
  return !!email && (await accountKindOf(userId, email)) !== "customer";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: true });
  }

  // ── Duration beacon: { id, durationMs } updates an existing row ────────────
  if (body.event === "duration") {
    const id = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : null;
    const durationMs = Number(body.durationMs);
    if (!id || !Number.isFinite(durationMs) || durationMs <= 0) return NextResponse.json({ ok: true });
    const admin = getAdminSupabase();
    // The tracker sends the visible time so far each time the page is hidden,
    // so a reader who switches tabs and comes back sends it again, larger.
    // Keep the largest: a late or repeated beacon can never shrink a real
    // value. (Until 2026-10-28 only the first hide was kept.)
    const ms = Math.min(Math.round(durationMs), MAX_DURATION_MS);
    await admin
      .from("site_pageviews")
      .update({ duration_ms: ms })
      .eq("id", id)
      .or(`duration_ms.is.null,duration_ms.lt.${ms}`);
    return NextResponse.json({ ok: true });
  }

  // ── Pageview: record one row ──────────────────────────────────────────────
  // Never record dev/preview traffic — localhost and Vercel preview hosts share
  // the production database, so without this a developer's browsing would
  // pollute the owner's real website analytics.
  const host = req.headers.get("host") ?? "";
  const isRealSite = host === "swiftcard.me" || host === "swiftcard.app" || host === "www.swiftcard.me" || host === "www.swiftcard.app";
  if (!isRealSite) return NextResponse.json({ ok: true, skipped: "non_production_host" });

  const ip = clientIp(req) ?? "unknown";
  // Generous per-IP cap: enough for real browsing (dozens of pages), low enough
  // that a scripted loop can't flood the table.
  if (await isRateLimited(`site-view:${ip}`, 120, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: true, rateLimited: true });
  }

  // Bots/crawlers/synthetic monitors are not people — never counted.
  if (isLikelyBot(req.headers.get("user-agent"))) {
    return NextResponse.json({ ok: true, bot: true });
  }
  // A speculative prefetch or prerender is the browser guessing, not a visit.
  const purpose = `${req.headers.get("sec-purpose") ?? ""} ${req.headers.get("purpose") ?? ""} ${req.headers.get("x-moz") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) {
    return NextResponse.json({ ok: true, skipped: "prefetch" });
  }

  const id = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : crypto.randomUUID();
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : null;
  const path = typeof body.path === "string" && body.path.startsWith("/") ? body.path.split(/[?#]/)[0].slice(0, 300) : null;
  if (!sessionId || !path) return NextResponse.json({ ok: true });

  // One person, one id: the httpOnly sc_vid cookie the card pages already
  // use (lib/visit-identity), adopting the browser's own id on first sight.
  // The id in page storage alone is lost to private windows, in-app browsers
  // and cleared sites, and each loss made one person two visitors.
  const identity = resolveVisitIdentity(req, typeof body.visitorId === "string" ? body.visitorId : null);

  // A person does not read a website from a server rack. The card pages have
  // refused cloud-hosting egress since 2026-09 (lib/request-geo); the website
  // counted it. Privacy relays (iCloud Private Relay, VPNs) still count.
  if (ip !== "unknown") {
    const geo = await resolveGeo(req, ip);
    if (geo.isHosting) return NextResponse.json({ ok: true, skipped: "hosting" });
  }

  // Internal traffic: the owner-set cookie, OR the browser-remembered flag the
  // product funnel already honours (lib/events.ts — a QA context sets it
  // before any page script runs), OR a signed-in admin (covers the owner
  // browsing while logged in, before they've set the cookie).
  //
  // Until 2026-09-23 only the cookie counted here while /api/events took the
  // localStorage flag, so the same nightly QA run was "internal" on the funnel
  // and "real" on Website analytics: 3,206 of 3,842 marketing pageviews.
  //
  // 2026-10-28: "ours" is every account of ours, not only the admin's — the
  // @swiftcard.me accounts and QA's test mailboxes too — and it is also
  // recognised while signed OUT, by the browser's device claim (sc_device)
  // or the owner's pass, the same signals the card pages use for an owner.
  const admin = getAdminSupabase();
  let isInternal = req.cookies.get(INTERNAL_COOKIE)?.value === "1" || body.internal === true;
  let signedIn = false;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    signedIn = !!user;
    if (user && (await isOurs(user.id, user.email))) isInternal = true;
  } catch { /* logged-out visitor — the common case */ }
  if (signedIn && APP_WHEN_SIGNED_IN.has(path)) {
    return NextResponse.json({ ok: true, skipped: "app" });
  }
  if (!isInternal) {
    try {
      for (const userId of (await browserAccountIds(admin)).slice(0, 5)) {
        const { data } = await admin.auth.admin.getUserById(userId);
        if (await isOurs(userId, data?.user?.email)) { isInternal = true; break; }
      }
    } catch { /* no claim to check — count the visit */ }
  }

  const countryHeader = req.headers.get("x-vercel-ip-country");
  const country = countryHeader && /^[A-Z]{2}$/.test(countryHeader) ? countryHeader : null;

  const landing = body.landing === true;
  const { error } = await admin.from("site_pageviews").insert({
    id,
    visitor_id: identity.visitorId,
    session_id: sessionId,
    path,
    referrer: referrerHost(body.referrer),
    country,
    is_internal: isInternal,
    landing,
    // Campaign tags belong to the page a visit started on.
    utm_source: landing ? tag(body.utm_source) : null,
    utm_medium: landing ? tag(body.utm_medium) : null,
    utm_campaign: landing ? tag(body.utm_campaign) : null,
    src: landing ? tag(body.src, 40) : null,
    device: typeof body.device === "string" && DEVICES.has(body.device) ? body.device : null,
  });
  if (error) console.error("[site-view] insert failed:", error.message);

  return attachVisitIdentity(NextResponse.json({ ok: true, id }), identity);
}
