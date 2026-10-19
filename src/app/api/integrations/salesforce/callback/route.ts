import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { catchUpAfterReconnect } from "@/lib/crm-outbox-drain";
import { encryptToken } from "@/lib/token-crypto";
import { CRM_CALL_TIMEOUT_MS } from "@/lib/crm-http";
import { verifyState } from "@/lib/oauth-state";
import { parseCardsParam } from "@/lib/crm-scope-server";
import { isSalesforceInstanceUrl } from "@/lib/sync-salesforce";

export const runtime = "nodejs";

// This deployment's own address — never production from a preview (lib/app-url, audit E-02).
const APP_URL = appUrl();

// Mirrors google/callback: native return leg, signed-state verification,
// encrypted token storage. Salesforce extras: `instance_url` (the customer
// org's API host — validated and stored in metadata; every sync call targets
// it) and no `expires_in` in the response — access tokens live per the org's
// session policy, so a conservative 90-minute expiry drives refresh.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const isNative = request.cookies.get("sf_native")?.value === "1";
  const DONE = (status: string) => {
    const res = isNative
      ? NextResponse.redirect(
          `swiftcard://salesforce-callback?status=${encodeURIComponent(status)}` +
            `&next=${encodeURIComponent("/settings/flows")}`,
        )
      : NextResponse.redirect(`${APP_URL}/settings/flows?integration=salesforce&status=${status}`);
    res.cookies.set("sf_native", "", { maxAge: 0, path: "/" });
    res.cookies.set("sf_pkce", "", { maxAge: 0, path: "/" });
    res.cookies.set("crm_scope", "", { maxAge: 0, path: "/" });
    return res;
  };

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  // Deny / Cancel on Salesforce's screen returns error=access_denied — a
  // choice, not a failure.
  if (error === "access_denied") return DONE("cancelled");
  if (error || !code || !state) return DONE("error");
  if (!process.env.SALESFORCE_CLIENT_ID || !process.env.SALESFORCE_CLIENT_SECRET) return DONE("unconfigured");

  const userId = verifyState(state);
  if (!userId) return DONE("error");

  // The card scope chosen before the redirect (see the connect leg). Ownership
  // was validated there; a tampered cookie can only mis-scope the tamperer's
  // own connection, and an unparseable one falls back to all cards. NO cookie
  // means a reconnect that never showed the chooser — leave the row's existing
  // scope untouched (upsert only writes listed columns).
  const scopeCookie = request.cookies.get("crm_scope")?.value;
  const scopeUpdate = scopeCookie === undefined ? {} : { card_ids: parseCardsParam(scopeCookie) ?? null };


  // PKCE verifier set by the connect leg — required by External Client Apps.
  const codeVerifier = request.cookies.get("sf_pkce")?.value;
  if (!codeVerifier) return DONE("error");

  // Bounded like every other provider call (lib/crm-http, audit I-01).
  const tokenRes = await fetch("https://login.salesforce.com/services/oauth2/token", {
    signal: AbortSignal.timeout(CRM_CALL_TIMEOUT_MS),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.SALESFORCE_CLIENT_ID,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET,
      redirect_uri: `${APP_URL}/api/integrations/salesforce/callback`,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  }).catch((e: unknown) => {
    console.error("[salesforce/callback] token exchange got no answer:", e instanceof Error ? e.message : e);
    return null;
  });
  if (!tokenRes) return DONE("error");
  if (!tokenRes.ok) {
    console.error("[salesforce/callback] token exchange failed:", tokenRes.status, await tokenRes.text().catch(() => ""));
    return DONE("error");
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    instance_url?: string;
  };
  if (!isSalesforceInstanceUrl(tokens.instance_url)) {
    console.error("[salesforce/callback] rejected instance_url:", tokens.instance_url);
    return DONE("error");
  }

  try {
    const admin = getAdminSupabase();
    const { error: dbErr } = await admin.from("integrations").upsert({
      user_id: userId,
      provider: "salesforce",
      access_token: encryptToken(tokens.access_token),
      refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      // Salesforce omits expires_in; 90 minutes is safely inside every org's
      // default session timeout, so refresh always runs before expiry.
      expires_at: Date.now() + 90 * 60 * 1000,
      metadata: { instance_url: tokens.instance_url },
      updated_at: new Date().toISOString(),
      ...scopeUpdate,
      sync_error: null,
    }, { onConflict: "user_id,provider" });
    if (dbErr) throw dbErr;
  } catch (e) {
    console.error("[salesforce/callback] save failed:", e);
    return DONE("error");
  }

  // Contacts that waited while it was disconnected go now (audit I-02).
  catchUpAfterReconnect(userId, "salesforce");
  return DONE("connected");
}
