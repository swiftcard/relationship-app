import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { encryptToken } from "@/lib/token-crypto";
import { verifyState, stateBoundToBrowser, oauthBindCookieName } from "@/lib/oauth-state";
import { safeNextPath } from "@/lib/safe-next";
import { exchangeLinkedInCode, fetchLinkedInProfile, GUEST_STATE, isLinkedInEnabled } from "@/lib/sync-linkedin";
import { fetchLinkedInPhoto } from "@/lib/linkedin-photo";

export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export async function GET(request: NextRequest) {
  // Return the user to where they started the connect (set by /connect?next=…,
  // same-origin paths only) — default is Settings. Clear the cookie either way.
  const returnRaw = request.cookies.get("li_return_to")?.value ?? "";
  const returnTo = safeNextPath(returnRaw) ?? "/settings/flows";
  // Set by /connect?native=1 — this run started inside the iOS shell's in-app
  // browser rather than the webview itself.
  const isNative = request.cookies.get("li_native")?.value === "1";

  const DONE = (status: string) => {
    // NATIVE RETURN LEG.
    //
    // linkedin.com is not in capacitor.config's allowNavigation, so the shell
    // cannot run this OAuth in its own webview — it hands the URL to the system
    // browser. Finishing at an https://swiftcard.me URL therefore left the user
    // looking at the WEBSITE in Safari, with the app still sitting on the page
    // they started from and no photo imported. That is the "it takes me to our
    // website" report.
    //
    // A swiftcard:// URL instead re-enters the app: iOS hands it to
    // NativeAppBridge's appUrlOpen listener, which closes the browser sheet and
    // navigates the WEBVIEW to `next`. Same custom-scheme mechanism the Google
    // and Apple sign-in flows already return through.
    const res = isNative
      ? NextResponse.redirect(
          `swiftcard://linkedin-callback?status=${encodeURIComponent(status)}` +
            `&next=${encodeURIComponent(returnTo)}`,
        )
      : (() => {
          const url = new URL(returnTo, APP_URL);
          url.searchParams.set("integration", "linkedin");
          url.searchParams.set("status", status);
          return NextResponse.redirect(url.toString());
        })();
    res.cookies.set("li_return_to", "", { maxAge: 0, path: "/" });
    res.cookies.set("li_native", "", { maxAge: 0, path: "/" });
    return res;
  };

  if (!isLinkedInEnabled()) return DONE("error");

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // The user declined consent (or LinkedIn returned an error) — not a failure
  // on our side, just send them back cleanly. Logged (no PII: LinkedIn's own
  // error code + description) because a silent DONE("error") is exactly what
  // made "it just glitches out" undiagnosable from the server side.
  if (error || !code || !state) {
    console.warn("[linkedin/callback] bounced:", error ?? (code ? "no state" : "no code"), searchParams.get("error_description") ?? "");
    return DONE("error");
  }

  // Reject a forged/unsigned state (arbitrary user_id) so tokens can't be
  // written onto another user's row.
  const userId = verifyState(state);
  if (!userId) return DONE("error");
  // …and finish in the browser that started it, or not at all.
  if (!stateBoundToBrowser(state, request.cookies.get(oauthBindCookieName("linkedin"))?.value)) {
    console.warn("[linkedin/callback] state not bound to this browser");
    return DONE("error");
  }

  const tokens = await exchangeLinkedInCode(code);
  if (!tokens?.access_token) {
    console.warn("[linkedin/callback] token exchange failed (client id/secret or redirect_uri mismatch?)");
    return DONE("error");
  }

  // ── Guest one-shot photo import ────────────────────────────────────────────
  // A signed-out visitor on the free-card builder: there is no account row to
  // store tokens on, so nothing is persisted — we use the access token once,
  // right here, to read the consented userinfo photo, copy it into our storage
  // (LinkedIn CDN URLs expire), and hand the durable URL back to the builder
  // via ?li_photo=. The token is then simply dropped.
  if (userId === GUEST_STATE) {
    const profile = await fetchLinkedInProfile(tokens.access_token);
    if (!profile?.picture) return DONE("nophoto");
    try {
      // Largest rendition LinkedIn will give, enhanced if it is only the
      // thumbnail — see lib/linkedin-photo.
      const photo = await fetchLinkedInPhoto(profile.picture);
      if (!photo) throw new Error("source unavailable");
      const body = photo.body;

      const admin = getAdminSupabase();
      const path = `guest-linkedin/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await admin.storage
        .from("card-uploads")
        .upload(path, body, { contentType: "image/jpeg", upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = admin.storage.from("card-uploads").getPublicUrl(path);

      // The photo rides back as a query param the builder reads and applies to
      // the draft (mirrors DONE, plus li_photo).
      const url = new URL(returnTo, APP_URL);
      url.searchParams.set("li_photo", publicUrl);
      // A guest inside the iOS shell (Sign up → the card builder, signed out)
      // ran this in the in-app browser sheet. Finishing at an https URL here
      // left the WEBSITE's builder showing inside that sheet while the app's
      // own builder sat behind it with no photo — the guest twin of the bug
      // DONE fixes. Same exit as DONE: a swiftcard:// URL re-enters the app
      // and NativeAppBridge steers the webview to `next` (it appends
      // integration/status itself), where the wizard's ?li_photo= reader
      // applies the photo.
      const res = isNative
        ? NextResponse.redirect(
            `swiftcard://linkedin-callback?status=photo&next=${encodeURIComponent(url.pathname + url.search)}`,
          )
        : (() => {
            url.searchParams.set("integration", "linkedin");
            url.searchParams.set("status", "photo");
            return NextResponse.redirect(url.toString());
          })();
      res.cookies.set("li_return_to", "", { maxAge: 0, path: "/" });
      res.cookies.set("li_native", "", { maxAge: 0, path: "/" });
      return res;
    } catch (e) {
      console.error("[linkedin/callback] guest photo import failed:", e);
      return DONE("error");
    }
  }

  try {
    const admin = getAdminSupabase();
    const { error: dbErr } = await admin.from("integrations").upsert({
      user_id: userId,
      provider: "linkedin",
      access_token: encryptToken(tokens.access_token),
      refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      expires_at: Date.now() + (tokens.expires_in ?? 0) * 1000,
      updated_at: new Date().toISOString(),
      sync_error: null, // upsert only touches listed columns — clear on reconnect
    }, { onConflict: "user_id,provider" });
    if (dbErr) throw dbErr;
  } catch (e) {
    console.error("[linkedin/callback] save failed:", e);
    return DONE("error");
  }

  // Connected. The user still explicitly APPROVES importing the photo from the
  // LinkedIn card in Settings — we never auto-apply it here.
  return DONE("connected");
}
