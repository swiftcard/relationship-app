import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, DEVICE_LIMIT, deviceLabel, isDeviceId, newDeviceId } from "@/lib/device";
import { COOKIE_MAX_AGE, SRC_COOKIE, isSignupSource } from "@/lib/referral";
import { resolveDownloadTarget } from "@/lib/download-link";

// See the soft-delete guard below for why this exists and why 60s is safe.
const deletedCheckCache = new Map<string, { deleted: boolean; at: number }>();
const DELETED_CHECK_TTL_MS = 60_000;

// Two devices per account — see lib/device.ts for what counts as one.
//
// Cached exactly like the soft-delete guard above and for the same reason:
// without it this is a serial DB round trip in front of every protected page.
// Only ALLOWED answers are cached, so 60s is the blast radius of REVOKING a
// device — sign one out in Settings and it stops working within a minute. A
// denial is never cached, so a blocked device recovers the instant a slot is
// freed. Keyed on user+device: the answer differs per device for one user.
const deviceCheckCache = new Map<string, { ok: boolean; at: number }>();
const DEVICE_CHECK_TTL_MS = 60_000;

export async function proxy(request: NextRequest) {
  // /pricing is a selling page, and the app must never paint one (App Store
  // 3.1.1 — build 1.0.0 (7) was rejected for exactly that). Its own guard is
  // client-side, so until hydration the full price list showed inside the
  // shell whenever something sent the app there — /office/admin's guard
  // redirects a lapsed owner or removed member to /pricing. Decided here,
  // first, on the same two shell-only signals as "/" below, before any HTML.
  // The website's /pricing skips everything else in this function: no auth
  // work, same page as before.
  if (request.nextUrl.pathname === "/pricing") {
    const shell = (request.headers.get("user-agent") ?? "").includes("SwiftCardApp") ||
      request.cookies.get("sc_shell")?.value === "1";
    return shell ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
  }

  // /download — the smart store link (lib/download-link). Decided here, on the
  // User-Agent, before any HTML: an iPhone or Android visitor gets a 307
  // straight to its store with the link's utm/query tags carried across, so
  // the phone never paints a page and then jumps. Everything else — a
  // computer, an unknown or missing UA, a crawler or link unfurler, a device
  // whose store URL is not configured — falls through to the static page at
  // src/app/download/page.tsx, which shows both stores. Same shape as /pricing
  // above: no auth work, so the website's other routes are untouched.
  //
  // The native shell is sent to /dashboard like /pricing: "get the app" from
  // inside the app is at best a no-op and at worst a trip to the App Store.
  //
  // Loop-proof by construction: the only redirect targets are the two store
  // origins (lib/app-store), and a target on OUR origin is refused and shown
  // the page instead — a misconfigured env var can never bounce /download to
  // /download. `no-store` keeps a device-specific 307 out of any shared cache.
  if (request.nextUrl.pathname === "/download") {
    const shell = (request.headers.get("user-agent") ?? "").includes("SwiftCardApp") ||
      request.cookies.get("sc_shell")?.value === "1";
    // (Before any session work, so there are no rotated cookies to carry —
    // the plain redirect is correct here, as it is for /pricing.)
    const dashboard = new URL("/dashboard", request.url);
    if (shell) return NextResponse.redirect(dashboard);
    const target = resolveDownloadTarget(request.headers.get("user-agent"), request.nextUrl.search);
    if (!target || new URL(target).origin === request.nextUrl.origin) return NextResponse.next();
    const res = NextResponse.redirect(target, 307);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Every network call this client makes (the session refresh, the
      // deleted-account lookup) gets a hard 8s cap. Without it, a slow or
      // down Supabase held the FIRST BYTE of every protected page — the app
      // sat on a black screen for as long as the outage lasted (2026-08-27,
      // Supabase auth "partially degraded": cold opens hung 40s+ to forever).
      global: {
        fetch: (url: RequestInfo | URL, init?: RequestInit) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(8000) }),
      },
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims(), NOT getUser(). getUser() is a NETWORK CALL to Supabase's auth
  // server, and this proxy runs on every navigation to /dashboard, /contacts,
  // /cards, /settings, /office, /share, /upgrade, /welcome, /join and
  // /checkout — plus every prefetch of them. That was 200-600ms of dead time on
  // cellular BEFORE any page code ran, so it sat underneath every loading
  // skeleton and delayed the one thing that makes a tap feel answered.
  //
  // getClaims verifies the JWT locally against the project's JWKS instead. That
  // only helps for ASYMMETRIC signing keys: for HS256 it falls back to
  // getUser() internally and nothing is gained. This project issues ES256 with
  // a kid (checked against /auth/v1/.well-known/jwks.json), so the verification
  // really is local, and the JWKS is cached in-process after the first fetch.
  //
  // SESSION REFRESH IS PRESERVED, which is the thing that would have broken
  // silently: with no jwt argument getClaims calls getSession(), and that
  // refreshes an expired session and writes the rotated cookies through the
  // setAll handler above — exactly as getUser() did.
  //
  // SECURITY IS UNCHANGED for what this proxy decides. Local verification
  // proves the token was signed by the project and is unexpired, which is all
  // the login wall needs; it does not re-check the user server-side, so a
  // session revoked elsewhere stays usable until the access token expires. That
  // window already existed — signOut only revokes the REFRESH token, which is
  // precisely why the soft-delete guard below exists — and every protected page
  // still calls getUser() itself, so a hard-deleted account is caught there.
  // `sub` is a REQUIRED claim on a Supabase access token, so its absence means
  // there is no usable session — same signal `user === null` gave before.
  // The refresh leg is additionally raced against 5s: a VALID-looking session
  // whose refresh cannot complete must not block the page. On timeout we let
  // the request THROUGH rather than bounce to /login — the token may still be
  // fine (local verify never got to run), and the page's own auth handles it.
  // Bouncing here would log every user "out" for the duration of a Supabase
  // brownout.
  let userId: string | null = null;
  let authUnavailable = false;
  try {
    const claimsResult = await Promise.race([
      supabase.auth.getClaims(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("auth-timeout")), 5000)),
    ]);
    userId = claimsResult?.data?.claims?.sub ?? null;
  } catch {
    authUnavailable = true;
  }

  // Any redirect below must carry the auth cookies just written onto
  // supabaseResponse (e.g. a rotated refresh token from the session refresh
  // above) — a bare NextResponse.redirect() is a fresh response object that
  // doesn't inherit them, silently discarding a token rotation and desyncing
  // the browser's session (auth audit).
  function redirectWithAuthCookies(url: URL): NextResponse {
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  }

  // The native shell must never land on the marketing homepage — "/" is the
  // app. A hero, a "Get started free" CTA and a footer of site links is the
  // wrong first screen for something you just installed, and it is the shape
  // App Review reads as a repackaged website (guideline 4.2).
  //
  // Keyed on two shell-only signals, so the WEBSITE at "/" is completely
  // untouched: the user-agent suffix future builds append (appendUserAgent in
  // capacitor.config.ts), and the `sc_shell` cookie the sc-boot script plants
  // the first time it detects the shell — which is what makes this live for
  // builds already installed, whose UA carries no token. First-ever launch
  // still falls back to sc-boot's client-side redirect (and plants the
  // cookie); every launch after that is redirected here, before any homepage
  // HTML is sent — one navigation instead of two, no hidden-page gap. Placed
  // after the claims read so it can branch on the real session — a signed-out user
  // goes straight to /login rather than bouncing through /dashboard's guard.
  if (
    request.nextUrl.pathname === "/" &&
    ((request.headers.get("user-agent") ?? "").includes("SwiftCardApp") ||
      request.cookies.get("sc_shell")?.value === "1")
  ) {
    // When auth is unreachable, route by cookie PRESENCE — a UX-only choice
    // of redirect TARGET, never an auth decision: both destinations verify
    // the session themselves, so a spoofed cookie just lands on a dashboard
    // that bounces it to /login. Routing cookie-holders to /dashboard keeps a
    // real user's cold open out of the login screen during a brownout.
    const looksSignedIn = userId !== null ||
      (authUnavailable && request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token")));
    return redirectWithAuthCookies(new URL(looksSignedIn ? "/dashboard" : "/login", request.url));
  }

  // NOTE: /templates is deliberately NOT here. The marketing nav and footer
  // both link to it, so gating it bounced every signed-out visitor to /login
  // the moment they clicked "Templates" — it's a gallery of designs with
  // sample data and makes no authenticated calls.
  const protectedPaths = ["/dashboard", "/onboarding", "/profile", "/cards", "/settings", "/office", "/contacts"];
  const isProtected = protectedPaths.some((p) => request.nextUrl.pathname.startsWith(p));

  // Guest card builder: /cards/new is deliberately open with NO login wall — a
  // guest builds a full card here and is only gated on protected actions
  // (publish/save/share) inside the wizard. Every other /cards/* route (e.g.
  // editing an existing card) still requires auth. Signed-in users fall through
  // to the deleted-account check below like any other protected page.
  const isGuestCardBuilder =
    request.nextUrl.pathname === "/cards/new" ||
    request.nextUrl.pathname.startsWith("/cards/new/");

  // FAIL-OPEN BY DESIGN when authUnavailable: this wall is a UX pre-filter,
  // not the security boundary. Every protected page (and the office admin
  // guard) performs its own server-side session check — pinned exhaustively
  // in tests/proxy-auth-hop.test.ts — so a request that passes here during an
  // auth outage still renders nothing without a valid session. Failing CLOSED
  // instead would hard-bounce every signed-in user to /login for the length
  // of any Supabase brownout.
  if (!userId && !authUnavailable && isProtected && !isGuestCardBuilder) {
    // Keep where they were going. A bare /login lost it: the app's "Add a
    // seat on swiftcard.me" opens /settings/flows?billing=1#billing in a
    // browser that isn't signed in, and after signing in the owner landed on
    // the dashboard with the seat purchase gone. /login only honours a
    // same-origin path (lib/safe-next); the #fragment never reaches a server.
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return redirectWithAuthCookies(login);
  }

  // A soft-deleted account's Supabase session/access-token stays valid for its
  // remaining lifetime (signOut only revokes the refresh token) — without this,
  // that live token could keep loading/editing a "deleted" account's pages for
  // up to an hour after deletion, contradicting the account-deleted messaging.
  if (userId && isProtected) {
    // Cached for 60s per user id: this lookup was a SERIAL DB round trip paid
    // before every protected page could even start rendering — the single
    // largest fixed cost on every in-app tap. The guard's job is to end a
    // soft-deleted account's still-valid access token (≤1h window); catching
    // that within a minute instead of instantly changes nothing real, and the
    // deletion flow signs the user out anyway — plus every protected page
    // re-checks _deleted itself server-side. Per-instance memory, so a cold
    // function simply pays the one read it always paid.
    const hit = deletedCheckCache.get(userId);
    if (hit && Date.now() - hit.at < DELETED_CHECK_TTL_MS) {
      if (hit.deleted) return redirectWithAuthCookies(new URL("/account-deleted", request.url));
    } else {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("customization")
          .eq("id", userId)
          .maybeSingle();
        const deleted = (profile?.customization as Record<string, unknown> | null)?._deleted === true;
        if (deletedCheckCache.size > 5000) deletedCheckCache.clear(); // unbounded-growth guard
        deletedCheckCache.set(userId, { deleted, at: Date.now() });
        if (deleted) {
          return redirectWithAuthCookies(new URL("/account-deleted", request.url));
        }
      } catch {
        // DB unreachable — let the page try; blocking here blanks the app.
      }
    }
  }

  // ── The two-device limit ──────────────────────────────────────────────────
  //
  // FAILS OPEN, like everything else in this file. If the claim cannot be
  // evaluated — RPC missing because the migration has not been run, database
  // unreachable, timeout — the request proceeds. Locking somebody out of their
  // own account because a query failed is far worse than a third device
  // getting in during an outage.
  //
  // The cookie is planted only here, on authenticated paths, so the marketing
  // site never sets a long-lived identifier on a visitor who has not signed in.
  if (userId && isProtected && !request.nextUrl.pathname.startsWith("/settings/devices")) {
    let deviceId = request.cookies.get(DEVICE_COOKIE)?.value;
    if (!isDeviceId(deviceId)) {
      deviceId = newDeviceId();
      // onto BOTH: `request` so anything later in this pass sees it, and the
      // response so the browser keeps it. httpOnly — no page script can read
      // or forge a device identity.
      request.cookies.set(DEVICE_COOKIE, deviceId);
      supabaseResponse.cookies.set(DEVICE_COOKIE, deviceId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: DEVICE_COOKIE_MAX_AGE,
      });
    }

    const key = `${userId}:${deviceId}`;
    const cached = deviceCheckCache.get(key);
    if (cached && cached.ok && Date.now() - cached.at < DEVICE_CHECK_TTL_MS) {
      // Known-good device, nothing to do.
    } else {
      try {
        const isNative = request.cookies.get("sc_shell")?.value === "1";
        const { data, error } = await supabase.rpc("claim_device_slot", {
          p_device_id: deviceId,
          p_label: deviceLabel(request.headers.get("user-agent"), isNative),
          p_user_agent: request.headers.get("user-agent"),
          p_is_native: isNative,
          p_limit: DEVICE_LIMIT,
        });
        // `error` covers the not-yet-migrated case: an absent function is an
        // error, not a `false`, and must not read as "denied".
        // ONLY SUCCESS IS CACHED. A denial is re-evaluated on every request,
        // which costs one query for the rare blocked device and buys the thing
        // that matters: the instant somebody signs a device out to free a slot,
        // the blocked device works again. Caching the denial would have left
        // them bounced for up to a minute AFTER doing exactly what the page
        // told them to do.
        if (!error && data === false) {
          deviceCheckCache.delete(key);
          return redirectWithAuthCookies(new URL("/settings/devices?full=1", request.url));
        }
        if (!error) {
          if (deviceCheckCache.size > 5000) deviceCheckCache.clear();
          deviceCheckCache.set(key, { ok: true, at: Date.now() });
        }
      } catch {
        // Unreachable or timed out — let the page through. Never cache this.
      }
    }
  }

  // ── Signup attribution for /cards/new?src= ────────────────────────────────
  // /cards/new used to write this cookie while RENDERING the page, which
  // Next.js does not allow — the write threw, the catch swallowed it, and every
  // link straight to /cards/new?src=… (the save-contact CTA, the signup popups,
  // the landing pages, the blog, the homepage hero) was recorded as "direct".
  // Found live 2026-09-22: ?src=badge set no cookie; /join?src=badge did.
  // Same rules the page had: validated, first touch wins, "referral" only ever
  // from /r/CODE — and, like /join, never written by a prefetch.
  if (request.nextUrl.pathname === "/cards/new" && request.headers.get("next-router-prefetch") !== "1") {
    const src = request.nextUrl.searchParams.get("src");
    if (src && src !== "referral" && isSignupSource(src) && !request.cookies.get(SRC_COOKIE)) {
      supabaseResponse.cookies.set(SRC_COOKIE, src, {
        maxAge: COOKIE_MAX_AGE, httpOnly: true, sameSite: "lax", path: "/", secure: true,
      });
    }
  }

  return supabaseResponse;
}

// Every AUTHENTICATED prefix has to be here, not just the obvious seven.
// Supabase rotates the refresh token when a Server Component refreshes the
// session, and only this proxy can persist the rotated cookies back to the
// browser. On a route it doesn't cover, the rotation happens and the new
// cookies are dropped — so once the old token falls outside Supabase's reuse
// grace window the user is silently signed out mid-session. Intermittent by
// nature, and near-impossible to reproduce on demand, which is why /admin,
// /grow, /welcome, /upgrade, /checkout/success and /join/[token] went
// unnoticed.
//
// This list does NOT gate anything. The login wall is `protectedPaths` above,
// which is unchanged — so /join/[token] (opened by signed-OUT invitees),
// /welcome, /upgrade and /checkout/success stay reachable exactly as before.
// The only effect of being here is that a rotated session cookie survives.
//
// /account-deleted is deliberately EXCLUDED: the proxy redirects there, and
// including it would mean the redirect target re-enters the same check.
export const config = {
  matcher: [
    // Exact "/" only (no :path*), for the native-shell redirect above. On the
    // website this just means the homepage also gets a session refresh, which
    // is harmless — it renders identically signed in or out.
    "/",
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/profile/:path*",
    "/cards/:path*",
    "/settings/:path*",
    "/office/:path*",
    "/contacts/:path*",
    "/admin/:path*",
    "/grow/:path*",
    "/welcome/:path*",
    "/upgrade/:path*",
    "/checkout/:path*",
    "/join/:path*",
    "/share/:path*",
    // The smart store link: phones are redirected before any HTML (see top).
    "/download",
    // App requests only: redirected to /dashboard before any HTML (see top).
    "/pricing",
  ],
};
