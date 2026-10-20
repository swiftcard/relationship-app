import { NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { safeNextPath } from "@/lib/safe-next";
import { resolveConnectUserId } from "@/lib/connect-user";
import { signState, oauthBindCookieName, oauthBindCookieValue, OAUTH_BIND_COOKIE_OPTIONS } from "@/lib/oauth-state";
import { GUEST_STATE, isLinkedInEnabled, LINKEDIN_AUTH_URL, LINKEDIN_REDIRECT_URI, LINKEDIN_SCOPES } from "@/lib/sync-linkedin";
import { isLinkedInTicket, LINKEDIN_TICKET_COOKIE } from "@/lib/linkedin-ticket";

export const runtime = "nodejs";

// This deployment's own address — never production from a preview (lib/app-url, audit E-02).
const APP_URL = appUrl();

/** Where-to-return cookies: 30 min, past the signed state's 15 (see below). */
const LI_COOKIE_MAX_AGE = 30 * 60;

// GET /api/integrations/linkedin/connect → redirect the user into LinkedIn's
// official OAuth consent screen. Profile-photo import is a card-building
// convenience, so it's available to any signed-in user (not Pro-gated).
// `?next=<same-origin path>` returns the user to where they started (the card
// editor's "Suggest my headshot") instead of Settings.
//
// `?guest=1` — a signed-out visitor on the free-card builder. They have no
// account to store tokens on, so the callback runs a one-shot photo import
// instead (nothing persisted, state marked GUEST_STATE) and hands the photo
// back to the builder. Without this, the Connect button had to route guests
// through signup first — which read as "it takes me to create an account".
export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextRaw = url.searchParams.get("next") ?? "";
  // Same-origin relative paths only — anything else falls back to Settings.
  const next = safeNextPath(nextRaw) ?? "";
  const guestRequested = url.searchParams.get("guest") === "1";

  // Fail safe: with no credentials the feature is off — send the user back
  // rather than to a broken LinkedIn error page.
  if (!isLinkedInEnabled()) {
    return NextResponse.redirect(`${APP_URL}/settings/flows?integration=linkedin&status=error`);
  }

  const userId = guestRequested ? null : await resolveConnectUserId(request);
  const user = userId ? { id: userId } : null;
  if (!user && !guestRequested) return NextResponse.redirect(`${APP_URL}/login`);

  // guest=1 means "I want my photo back, now" — it is only ever sent by the
  // homepage builders, which know nothing about sessions and can only receive
  // the ?li_photo= return. This used to let a session win ("do the real
  // connect so the token lands on their account"), which stored a token and
  // came back with status=connected and NO photo — so every SIGNED-IN visitor
  // of "See how your card / SwiftLink would look", the owner included, saw
  // nothing happen (2026-09-22). The one-shot photo import serves them just as
  // well; the account connect is still one tap away in the card editor.
  //
  // Signed state binds this user_id + issue time so a forged/unsigned state
  // can't write LinkedIn tokens onto another user's row. Guests carry the
  // GUEST_STATE marker instead of a user id — the callback never writes
  // tokens for it.
  const state = signState(user ? user.id : GUEST_STATE);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri: LINKEDIN_REDIRECT_URI,
    scope: LINKEDIN_SCOPES,
    state,
  });

  const res = NextResponse.redirect(`${LINKEDIN_AUTH_URL}?${params}`);
  // Ties the callback to THIS browser (lib/oauth-state, stateBoundToBrowser).
  res.cookies.set(oauthBindCookieName("linkedin"), oauthBindCookieValue(state), OAUTH_BIND_COOKIE_OPTIONS);
  // The redirect_uri registered with LinkedIn is fixed, so the return path
  // rides in a short-lived cookie the callback reads back. It outlives the
  // signed state (15 min): it used to last 10, so someone slow at LinkedIn's
  // sign-in (a forgotten password, a 2FA code) came back to Settings — or, as a
  // guest, to the login page — instead of the builder they left. Now even an
  // attempt that ran out of time returns to that builder, saying so.
  // Each attempt sets both cookies or clears them, so an abandoned attempt's
  // leftovers can never steer this one somewhere else.
  if (next) {
    res.cookies.set("li_return_to", next, { httpOnly: true, sameSite: "lax", maxAge: LI_COOKIE_MAX_AGE, path: "/" });
  } else {
    res.cookies.set("li_return_to", "", { maxAge: 0, path: "/" });
  }
  // `?t=<uuid>` — the page's ticket for this attempt (lib/linkedin-ticket).
  // The callback stores the photo under it, so the page can pick it up however
  // it gets control back. Anything that isn't a UUID is dropped.
  const ticket = url.searchParams.get("t");
  if (isLinkedInTicket(ticket)) {
    res.cookies.set(LINKEDIN_TICKET_COOKIE, ticket, { httpOnly: true, sameSite: "lax", maxAge: LI_COOKIE_MAX_AGE, path: "/" });
  } else {
    res.cookies.set(LINKEDIN_TICKET_COOKIE, "", { maxAge: 0, path: "/" });
  }
  // `?native=1` — started from the iOS shell, which runs this in an in-app
  // browser because linkedin.com cannot load in the app's own webview. The
  // callback reads this to finish at a swiftcard:// URL that re-opens the app,
  // instead of an https one that would strand the user on the website.
  if (url.searchParams.get("native") === "1") {
    res.cookies.set("li_native", "1", { httpOnly: true, sameSite: "lax", maxAge: LI_COOKIE_MAX_AGE, path: "/" });
  } else {
    res.cookies.set("li_native", "", { maxAge: 0, path: "/" });
  }
  return res;
}
