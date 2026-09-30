import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// STRUCTURAL GUARD (labelled as such).
//
// This is the test that would have caught the second 3.1.1 rejection.
//
// 1.0.0 (7) was rejected because LoginForm's "SwiftCard.me" link opened the
// MARKETING SITE with @capacitor/browser — an SFSafariViewController sheet.
// `detectNativeApp()` is false inside that sheet (no
// webkit.messageHandlers.bridge), so the native guards on /pricing and
// /upgrade switched off, and the reviewer reached the $4.99 plan and Stripe
// checkout without ever leaving the app. Apple attached the screenshot.
//
// The rule this enforces: an in-app browser sheet may only be pointed at
// `/api/*` round trips (OAuth, file downloads) or an off-site absolute URL.
// Anything that could render a swiftcard.me PAGE — where the site nav, and
// therefore pricing, is one tap away — must go through the native
// ExternalPurchase plugin (UIApplication.open → the default browser), which is
// what Guideline 3.1.1(a)'s US-storefront allowance actually permits.
//
// If you are here because this test failed: do not add your file to ALLOWED to
// make it pass. Route the link through openInDefaultBrowser() in
// lib/external-purchase.ts instead.

// Verified 2026-08-17 by resolving each variable back to its literal. Every one
// is an /api/* route: no page chrome, no site nav, no route to /pricing. They
// are listed here only because the URL is passed in as a prop/argument, so the
// literal is not visible at the Browser.open call site.
const ALLOWED: Record<string, string> = {
  "src/components/NativeAppBridge.tsx":
    "Browser.close() only — closes a sheet, never opens one.",
  "src/components/IntegrationsSettings.tsx":
    "openConnect(connectUrl) — connectUrl is '/api/integrations/google/connect' (line 558). OAuth round trip; the sheet is required so it shares Safari's cookies.",
  "src/components/ProfilePhotoSuggest.tsx":
    "openLinkedInConnect() — '/api/integrations/linkedin/connect' (lines 89, 95). Same OAuth round trip.",
  "src/lib/native-file.ts":
    "openFileViaSystemBrowser(href) — every caller passes an /api/* file route: /api/card/*/vcard, /api/leads/vcard, /api/leads/export, /api/office/analytics/export. The sheet is what renders iOS's real 'Add to Contacts' / file preview.",
};

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const ROOT = join(__dirname, "..");

describe("in-app browser sheets never open a selling surface", () => {
  it("every Browser.open target is an /api route or an off-site URL", () => {
    const offenders: string[] = [];

    for (const file of walk(join(ROOT, "src"))) {
      // Forward slashes on every platform: ALLOWED is keyed that way, and on
      // Windows a raw slice hands back "src\components\…", which matches no
      // entry — so both allowlisted OAuth call sites were reported as 3.1.1
      // leaks on the owner's machine while CI (Linux) stayed green.
      const rel = file.slice(ROOT.length + 1).split(/[\\/]/).join("/");
      const src = stripComments(readFileSync(file, "utf8"));
      if (!/Browser\.open\s*\(/.test(src)) continue;
      if (ALLOWED[rel]) continue;

      // The URL handed to the sheet is built just above the call in every one
      // of these call sites, so the surrounding window is what we inspect.
      const idx = src.indexOf("Browser.open");
      const window = src.slice(Math.max(0, idx - 600), idx + 200);

      // Safe: an /api/* path (no page chrome, no nav to /pricing) or a URL that
      // came from an off-site provider (Supabase OAuth, LinkedIn).
      const safe =
        /["'`]\/api\//.test(window) ||
        /data\.url|provider|oauth|authUrl/i.test(window);

      if (!safe) offenders.push(rel);
    }

    expect(
      offenders,
      `These files open an in-app browser sheet on something other than an /api route.\n` +
        `A swiftcard.me page inside that sheet exposes the pricing nav and Stripe\n` +
        `checkout INSIDE the app — the exact Guideline 3.1.1 violation that got\n` +
        `1.0.0 (7) rejected. Use openInDefaultBrowser() from lib/external-purchase.ts.`
    ).toEqual([]);
  });

  it("the sign-in screen no longer links out at all (in-app signup, 2026-08-27)", () => {
    // The site-link deflection this test used to pin is GONE: with IAP live,
    // the app creates accounts itself, so LoginForm has no reason to open ANY
    // browser — in-app or default. The regression to catch now is a link-out
    // creeping back in.
    const src = readFileSync(join(ROOT, "src/components/LoginForm.tsx"), "utf8");
    const code = stripComments(src);
    expect(code).not.toMatch(/@capacitor\/browser/);
    expect(code).not.toMatch(/openInDefaultBrowser|canOpenInDefaultBrowser/);
    expect(code).not.toMatch(/Accounts are created on/);
  });
});
