import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { encryptToken } from "@/lib/token-crypto";
import { verifyState, stateBoundToBrowser, oauthBindCookieName } from "@/lib/oauth-state";
import { parseCardsParam } from "@/lib/crm-scope-server";
import { isNativeGoogleLoginState } from "@/lib/native-google-login";
import { handleNativeGoogleLoginCallback } from "@/lib/native-google-login-server";

export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // ── Google SIGN-IN return leg — NOT a CRM connect ──────────────────────────
  // Authorized redirect URIs are Google Cloud console config, and this path is
  // the only swiftcard.me URI registered on the OAuth client. So the iOS shell's
  // Google LOGIN lands here too and is told apart by its state prefix. (Belt and
  // braces: that state shape fails verifyState() below anyway, so a login state
  // can never be mistaken for a user binding.) Dispatched before any CRM work —
  // a login carries no user_id, no g_native cookie and no crm_scope, and must
  // never touch an integrations row. See src/lib/native-google-login.ts.
  if (isNativeGoogleLoginState(searchParams.get("state"))) {
    return handleNativeGoogleLoginCallback(request);
  }

  // NATIVE RETURN LEG (set by /connect?native=1).
  //
  // accounts.google.com is not in capacitor.config's allowNavigation, so the
  // shell cannot run this OAuth in its own webview — it hands the flow to the
  // system browser. Finishing at an https://swiftcard.me URL therefore left the
  // user looking at the WEBSITE showing "Connected", while the app sat behind
  // it still showing "Connect" and no integration attached to what they could
  // see. A swiftcard:// URL re-enters the app instead: NativeAppBridge closes
  // the sheet and navigates the WEBVIEW to Settings, so the UI matches reality.
  const isNative = request.cookies.get("g_native")?.value === "1";
  const DONE = (status: string) => {
    const res = isNative
      ? NextResponse.redirect(
          `swiftcard://google-callback?status=${encodeURIComponent(status)}` +
            `&next=${encodeURIComponent("/settings/flows")}`,
        )
      : NextResponse.redirect(`${APP_URL}/settings/flows?integration=google&status=${status}`);
    // Cleared on EVERY exit: a stale g_native would send a later WEB connect
    // into a swiftcard:// redirect the browser cannot follow.
    res.cookies.set("g_native", "", { maxAge: 0, path: "/" });
    res.cookies.set("crm_scope", "", { maxAge: 0, path: "/" });
    return res;
  };

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Pressing Cancel (or Back) on Google's screen comes back as
  // error=access_denied. That is a choice, not a failure — Settings says
  // "cancelled" instead of "connection failed".
  if (error === "access_denied") return DONE("cancelled");
  if (error || !code || !state) {
    return DONE("error");
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return DONE("unconfigured");

  // State must carry a valid signature — an unsigned/forged state (arbitrary
  // user_id) is rejected, so tokens can't be written onto another user's row.
  const userId = verifyState(state);
  if (!userId) {
    return DONE("error");
  }
  // …and finish in the browser that started it, or not at all.
  if (!stateBoundToBrowser(state, request.cookies.get(oauthBindCookieName("google"))?.value)) {
    return DONE("error");
  }

  // The card scope chosen before the redirect (see the connect leg). Ownership
  // was validated there; a tampered cookie can only mis-scope the tamperer's
  // own connection, and an unparseable one falls back to all cards. NO cookie
  // means a reconnect that never showed the chooser — leave the row's existing
  // scope untouched (upsert only writes listed columns).
  const scopeCookie = request.cookies.get("crm_scope")?.value;
  const scopeUpdate = scopeCookie === undefined ? {} : { card_ids: parseCardsParam(scopeCookie) ?? null };


  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${APP_URL}/api/integrations/google/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return DONE("error");
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  try {
    const admin = getAdminSupabase();
    const { error } = await admin.from("integrations").upsert({
      user_id: userId,
      provider: "google",
      access_token: encryptToken(tokens.access_token),
      refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      expires_at: Date.now() + tokens.expires_in * 1000,
      updated_at: new Date().toISOString(),
      ...scopeUpdate,
      sync_error: null, // upsert only touches listed columns — must clear explicitly on reconnect
    }, { onConflict: "user_id,provider" });
    if (error) throw error;
  } catch (e) {
    console.error("[google/callback] save failed:", e);
    return DONE("error");
  }

  return DONE("connected");
}
