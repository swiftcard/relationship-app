import { detectNativeApp } from "@/lib/platform";

/**
 * Native file-handoff for the Capacitor iOS shell.
 *
 * WHY: a WKWebView cannot save a Blob/anchor `download` or an
 * `attachment`-disposition response — the tap silently no-ops. That is a real
 * App Review 2.1 "the button does nothing" risk for our download surfaces
 * (Save Contact .vcf, CSV export, card/QR images). The reliable native path is
 * to open the file's URL in the SYSTEM browser sheet
 * (@capacitor/browser → SFSafariViewController), which natively renders a
 * vCard "Add to Contacts" preview and offers Save/Share for other file types.
 *
 * Web is completely untouched: `detectNativeApp()` is false on web/SSR, so
 * these helpers return false and callers keep their existing Blob/anchor path.
 */

/**
 * On native, open an absolute (or root-relative) URL in the system browser and
 * return true (handled). On web, return false so the caller runs its normal
 * download path. Best-effort: if the Browser plugin is missing (old shell
 * build) we fall back to a top-level navigation, which at least lets iOS's
 * document handler take over instead of a dead Blob click.
 */
export async function openFileViaSystemBrowser(url: string): Promise<boolean> {
  if (!detectNativeApp()) return false;
  const abs = url.startsWith("http")
    ? url
    : `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
  const authed = await withDownloadToken(abs);
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: authed });
    return true;
  } catch {
    try {
      window.location.href = authed;
    } catch {
      /* ignore */
    }
    return true;
  }
}

/**
 * Attach a signed `?dl=` token when the target needs a session.
 *
 * THE BUG: the system browser (SFSafariViewController) has SAFARI's cookie jar,
 * not the webview's, so the Supabase session does not travel with the URL.
 * Every authenticated download — Export CSV on Contacts, Export CSV in the
 * office analytics, "Save to phone" on a contact — opened a Safari sheet
 * showing Unauthorized or the login page. The public downloads routed through
 * here (a card's vCard, the Wallet pass) were unaffected, which is exactly why
 * it went unnoticed.
 *
 * Identity therefore has to ride in the URL. This mints a 60-second token bound
 * to this user AND this path, from inside the webview where the session still
 * works. See lib/download-token.ts.
 *
 * Anything not on the allowlist is returned untouched — those URLs are public
 * and adding a token would be noise.
 */
async function withDownloadToken(absUrl: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(absUrl);
  } catch {
    return absUrl;
  }
  const AUTHED = ["/api/leads/export", "/api/leads/vcard", "/api/office/analytics/export", "/api/office/leads/export"];
  if (!AUTHED.includes(u.pathname)) return absUrl;

  try {
    const res = await fetch("/api/download-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: u.pathname }),
    });
    if (!res.ok) return absUrl;
    const { token } = (await res.json()) as { token?: string };
    if (token) u.searchParams.set("dl", token);
  } catch {
    // Offline or the mint failed — fall through with the bare URL. The sheet
    // then shows the login page, which is the OLD behaviour: no worse, and the
    // alternative (silently doing nothing) hides the failure completely.
  }
  return u.toString();
}
