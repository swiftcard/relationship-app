import { NextResponse } from "next/server";
import {
  GOOGLE_AUTH_URL,
  NATIVE_AUTH_CALLBACK,
  NATIVE_GOOGLE_REDIRECT_PATH,
  NATIVE_GOOGLE_SCOPES,
  isHandoffHash,
  signNativeGoogleState,
} from "@/lib/native-google-login";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

export const runtime = "nodejs";

/**
 * Entry point for the iOS shell's Google sign-in. The app opens THIS url in the
 * system browser; we redirect on to Google with swiftcard.me as the redirect_uri,
 * which is what makes the account chooser read "to continue to swiftcard.me"
 * instead of the raw *.supabase.co project host. See src/lib/native-google-login.ts.
 *
 * `hs` is the SHA-256 of the handoff secret the webview just generated and kept;
 * it is signed into the state so the return leg can seal the ID token to exactly
 * that webview. Nothing here is authenticated — it only builds a Google URL —
 * but a malformed `hs` is refused so junk can never ride the state.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;

  // DIAGNOSTIC BEACON, not a sign-in. The webview posts here (fetch, no
  // navigation) when it could not set the sealed handoff up and is about to
  // fall back to the Supabase-brokered flow — the one that shows the
  // *.supabase.co host on Google's chooser. Without this the fallback is
  // invisible: the only symptom is the old consent screen, which is
  // indistinguishable from the app simply running pre-deploy JS. One log line
  // tells the two apart. 204, so nothing about the caller changes.
  const fallback = query.get("fallback");
  if (fallback) {
    console.warn(`[native-google-login] fell back to the Supabase-brokered flow: ${fallback.slice(0, 40)}`);
    return new Response(null, { status: 204 });
  }

  // Public and unauthenticated: 120 starts per 10 minutes per address is far
  // above a whole office signing in at once, and stops a loop from running
  // this function all day. Same redirect the app already handles on error.
  if (await isRateLimited(`native-google-start:${clientIp(request)}`, 120, 10 * 60 * 1000)) {
    return NextResponse.redirect(`${NATIVE_AUTH_CALLBACK}?error=oauth&reason=rate`);
  }

  const hs = query.get("hs");
  // Bounce back into the app rather than dead-ending in the browser sheet.
  if (!isHandoffHash(hs)) return NextResponse.redirect(`${NATIVE_AUTH_CALLBACK}?error=oauth&reason=handoff`);
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.error("[native-google-login] GOOGLE_CLIENT_ID missing in this environment");
    return NextResponse.redirect(`${NATIVE_AUTH_CALLBACK}?error=oauth&reason=config`);
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_URL}${NATIVE_GOOGLE_REDIRECT_PATH}`,
    response_type: "code",
    scope: NATIVE_GOOGLE_SCOPES,
    // Force the chooser every time — matches the web flow, and without it anyone
    // with one Google session already open is signed straight in with no choice.
    prompt: "select_account",
    // Login only: we never call a Google API on the user's behalf here, so no
    // refresh token is requested. (The CRM connect flow asks for offline access
    // separately, on its own scopes.)
    access_type: "online",
    state: signNativeGoogleState(hs),
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params}`);
}
