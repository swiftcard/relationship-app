import { NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { resolveConnectUserId } from "@/lib/connect-user";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { signState } from "@/lib/oauth-state";
import { parseCardsParam, scopeIsOwned } from "@/lib/crm-scope-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createHash, randomBytes } from "crypto";

export const runtime = "nodejs";

// This deployment's own address — never production from a preview (lib/app-url, audit E-02).
const APP_URL = appUrl();

// Salesforce OAuth 2.0 web-server flow. Mirrors google/connect exactly:
// signed state, paid gate, native-shell cookie. Scopes: `api` (data access)
// + `refresh_token` (offline). Login host is production — sandbox orgs
// (test.salesforce.com) are deliberately out of scope for v1.
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

  // Not configured yet (Connected App credentials pending) — land back on
  // Settings with a clear status instead of a broken Salesforce URL.
  if (!process.env.SALESFORCE_CLIENT_ID || !process.env.SALESFORCE_CLIENT_SECRET) {
    return NextResponse.redirect(`${APP_URL}/settings/flows?integration=salesforce&status=unconfigured`);
  }

  // Pre-connect card scope. The settings UI makes the user choose all-cards
  // vs only-these BEFORE the OAuth redirect; the choice rides this cookie to
  // the callback, which stores it on the integrations row it creates. Junk or
  // a card that isn't theirs bounces back to Settings rather than connecting
  // with a scope the user didn't pick.
  const cardsParam = new URL(request.url).searchParams.get("cards");
  const scope = parseCardsParam(cardsParam);
  if (scope === undefined || !(await scopeIsOwned(getAdminSupabase(), user.id, scope))) {
    return NextResponse.redirect(`${APP_URL}/settings/flows?integration=salesforce&status=error`);
  }

  const state = signState(user.id);
  // PKCE (S256) — Salesforce External Client Apps require it and won't let
  // orgs turn it off. The verifier rides a short-lived httpOnly cookie to the
  // callback leg; only its hash goes to Salesforce.
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: process.env.SALESFORCE_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/integrations/salesforce/callback`,
    response_type: "code",
    scope: "api refresh_token",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const res = NextResponse.redirect(`https://login.salesforce.com/services/oauth2/authorize?${params}`);
  // Cookie only when a choice was SENT. A reconnect link carries no `cards`
  // param, and the callback must then leave the row's existing scope alone —
  // an absent cookie is how it knows not to touch it.
  if (cardsParam !== null) {
    res.cookies.set("crm_scope", scope === null ? "all" : scope.join(","), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  } else {
    res.cookies.set("crm_scope", "", { maxAge: 0, path: "/" });
  }
  res.cookies.set("sf_pkce", codeVerifier, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  // Same native-shell return leg as Google — see google/connect.
  if (new URL(request.url).searchParams.get("native") === "1") {
    res.cookies.set("sf_native", "1", { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  }
  return res;
}
