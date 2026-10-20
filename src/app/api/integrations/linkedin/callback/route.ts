import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { encryptToken } from "@/lib/token-crypto";
import { verifyState, stateBoundToBrowser, oauthBindCookieName } from "@/lib/oauth-state";
import { safeNextPath } from "@/lib/safe-next";
import { exchangeLinkedInCode, fetchLinkedInProfile, GUEST_STATE, isLinkedInEnabled } from "@/lib/sync-linkedin";
import { fetchLinkedInPhoto } from "@/lib/linkedin-photo";
import {
  BLANK_GIF, isLinkedInTicket, LINKEDIN_TICKET_COOKIE, LINKEDIN_TICKET_FOLDER,
  ticketPhotoPath, ticketStatusPath, type TicketFailure,
} from "@/lib/linkedin-ticket";

export const runtime = "nodejs";

// This deployment's own address — never production from a preview (lib/app-url, audit E-02).
const APP_URL = appUrl();

const escapeHtml = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The app's way back: a page, not a bare 302 to swiftcard://. In the in-app
 * sheet iOS can ask before following a custom-scheme redirect, or follow
 * nothing at all, and a 302 left nothing on screen — the user tapped Done and
 * was back where they started with no photo, although it had been saved
 * (2026-10-20). The page tries the link at once (meta refresh, no script) and
 * keeps a real button for it. The app also picks the photo up by its ticket
 * when the sheet is closed, so even "Done" ends with the photo.
 */
function nativeReturnPage(appLink: string, status: string): NextResponse {
  const href = escapeHtml(appLink);
  const ok = status === "photo" || status === "connected";
  const said =
    status === "photo" ? "Your LinkedIn photo is ready."
      : status === "connected" ? "LinkedIn is connected."
        : status === "nophoto" ? "Your LinkedIn profile doesn't have a photo to import."
          : "LinkedIn didn't finish connecting.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${href}">
<title>Back to SwiftCard</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#030712;color:#e5e7eb;font:15px/1.5 -apple-system,system-ui,sans-serif;text-align:center;padding:0 24px}
a{display:inline-block;margin-top:16px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px}
p{margin:0;max-width:280px}small{display:block;margin-top:14px;color:#6b7280;font-size:12px}</style></head>
<body><main><p>${said}</p>
<a href="${href}">Back to SwiftCard</a>
<small>Or tap Done. ${ok ? "It will be there." : "You can try again from SwiftCard."}</small></main></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  // Return the user to where they started the connect (set by /connect?next=…,
  // same-origin paths only) — default is Settings. Clear the cookie either way.
  const returnRaw = request.cookies.get("li_return_to")?.value ?? "";
  const returnTo = safeNextPath(returnRaw) ?? "/settings/flows";
  // Set by /connect?native=1 — this run started inside the iOS shell's in-app
  // browser rather than the webview itself.
  const isNative = request.cookies.get("li_native")?.value === "1";

  // The page's ticket for this attempt (set by /connect?t=…), if it sent one.
  const ticketRaw = request.cookies.get(LINKEDIN_TICKET_COOKIE)?.value;
  const ticket = isLinkedInTicket(ticketRaw) ? ticketRaw : null;

  const clearCookies = (res: NextResponse) => {
    res.cookies.set("li_return_to", "", { maxAge: 0, path: "/" });
    res.cookies.set("li_native", "", { maxAge: 0, path: "/" });
    res.cookies.set(LINKEDIN_TICKET_COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  };

  const DONE = async (status: string) => {
    // A one-shot import that came back without a photo says so under its
    // ticket, so the page that is waiting for it can tell the user instead of
    // waiting forever. Best effort: the URL return below still carries it.
    if (ticket && (status === "nophoto" || status === "error")) {
      try {
        await getAdminSupabase().storage
          .from("card-uploads")
          .upload(ticketStatusPath(ticket, status as TicketFailure), BLANK_GIF, { contentType: "image/gif", upsert: true });
      } catch (e) {
        console.warn("[linkedin/callback] could not mark the ticket:", e);
      }
    }
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
    // picks the photo up by its ticket. Same custom-scheme mechanism the Google
    // and Apple sign-in flows already return through.
    const res = isNative
      ? nativeReturnPage(
          `swiftcard://linkedin-callback?status=${encodeURIComponent(status)}` +
            `&next=${encodeURIComponent(returnTo)}`,
          status,
        )
      : (() => {
          const url = new URL(returnTo, APP_URL);
          url.searchParams.set("integration", "linkedin");
          url.searchParams.set("status", status);
          return NextResponse.redirect(url.toString());
        })();
    return clearCookies(res);
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
      // Under the page's ticket when it sent one, so the page can find it by
      // itself (lib/linkedin-ticket); a fresh name otherwise.
      const path = ticket ? ticketPhotoPath(ticket) : `${LINKEDIN_TICKET_FOLDER}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await admin.storage
        .from("card-uploads")
        .upload(path, body, { contentType: "image/jpeg", upsert: !!ticket });
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
      // and NativeAppBridge has the page pick the photo up by its ticket.
      const res = isNative
        ? nativeReturnPage(
            `swiftcard://linkedin-callback?status=photo&next=${encodeURIComponent(url.pathname + url.search)}`,
            "photo",
          )
        : (() => {
            url.searchParams.set("integration", "linkedin");
            url.searchParams.set("status", "photo");
            return NextResponse.redirect(url.toString());
          })();
      return clearCookies(res);
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
