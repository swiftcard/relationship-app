import { NextResponse } from "next/server";
import { resolveConnectUserId } from "@/lib/connect-user";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { signState, oauthBindCookieName, oauthBindCookieValue, OAUTH_BIND_COOKIE_OPTIONS } from "@/lib/oauth-state";
import { parseCardsParam, scopeIsOwned } from "@/lib/crm-scope-server";
import { getAdminSupabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const SCOPES = "https://www.googleapis.com/auth/contacts";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export async function GET(request: Request) {
  const userId = await resolveConnectUserId(request);
  if (!userId) return NextResponse.redirect(`${APP_URL}/login`);
  const user = { id: userId };

  // Integrations are a Pro/Office feature.
  const { data: profile } = await getAdminSupabase().from("profiles").select(PLAN_COLUMNS).eq("id", user.id).single();
  // The shell opens this in an SFSafariViewController where the native
  // guards can't run — never send it to the pricing page (3.1.1).
  const fromShell = new URL(request.url).searchParams.get("native") === "1";
  if (!isPaidProfile(profile)) return NextResponse.redirect(`${APP_URL}${fromShell ? "/dashboard" : "/pricing"}`);

  // Not configured on this deployment — land back on Settings with a clear
  // status instead of sending the user to Google with client_id=undefined.
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(`${APP_URL}/settings/flows?integration=google&status=unconfigured`);
  }

  // Pre-connect card scope. The settings UI makes the user choose all-cards
  // vs only-these BEFORE the OAuth redirect; the choice rides this cookie to
  // the callback, which stores it on the integrations row it creates. Junk or
  // a card that isn't theirs bounces back to Settings rather than connecting
  // with a scope the user didn't pick.
  const cardsParam = new URL(request.url).searchParams.get("cards");
  const scope = parseCardsParam(cardsParam);
  if (scope === undefined || !(await scopeIsOwned(getAdminSupabase(), user.id, scope))) {
    return NextResponse.redirect(`${APP_URL}/settings/flows?integration=google&status=error`);
  }

  const state = signState(user.id);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/integrations/google/callback`,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  // Ties the callback to THIS browser (lib/oauth-state, stateBoundToBrowser).
  res.cookies.set(oauthBindCookieName("google"), oauthBindCookieValue(state), OAUTH_BIND_COOKIE_OPTIONS);
  // Cookie only when a choice was SENT. A reconnect link carries no `cards`
  // param, and the callback must then leave the row's existing scope alone —
  // an absent cookie is how it knows not to touch it.
  if (cardsParam !== null) {
    res.cookies.set("crm_scope", scope === null ? "all" : scope.join(","), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  } else {
    res.cookies.set("crm_scope", "", { maxAge: 0, path: "/" });
  }

  // `?native=1` — started from the iOS shell, which runs this in an in-app
  // browser because accounts.google.com is not in capacitor.config's
  // allowNavigation (and Google blocks embedded-webview OAuth anyway). The
  // callback reads this cookie to finish at a swiftcard:// URL that re-opens
  // the app, instead of an https one that strands the user on the website with
  // the app still showing "Connect". Google's registered redirect_uri is fixed,
  // so nothing about this run can ride in the URL. Same shape as LinkedIn.
  if (new URL(request.url).searchParams.get("native") === "1") {
    res.cookies.set("g_native", "1", { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  }
  return res;
}
