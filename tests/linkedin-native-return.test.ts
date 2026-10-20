import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── LinkedIn headshot import must return INTO the app ────────────────────────
//
// The bug, reported from a phone: tapping "Connect LinkedIn" to import a
// headshot "takes me to our website page".
//
// Why it happened. The button was a plain <a href> to /api/integrations/
// linkedin/connect, which 302s to linkedin.com. linkedin.com is NOT in
// capacitor.config.ts's allowNavigation, so the shell refuses to load it in its
// own webview and hands the URL to the SYSTEM BROWSER. The user then authorised
// in Safari, LinkedIn redirected to https://swiftcard.me/... in Safari, and the
// journey ended on the marketing site — in a different app from the one they
// started in, with no photo imported and the editor untouched behind it.
//
// The fix has three halves and they only work together, which is why they are
// pinned in one place:
//   1. the button opens the flow in @capacitor/browser with ?native=1
//   2. the callback, seeing that flag, finishes at a swiftcard:// URL
//   3. NativeAppBridge catches that URL and puts the webview back on `next`
// Break any one and the user lands on the website again — silently, because
// every individual piece still "works".

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("LinkedIn connect leaves the webview correctly on iOS", () => {
  const suggest = read("src/components/ProfilePhotoSuggest.tsx");

  it("opens the in-app browser instead of navigating the webview", () => {
    expect(suggest).toMatch(/@capacitor\/browser/);
    expect(suggest).toMatch(/Browser\.open/);
  });

  it("never leaves the connect as a bare link on native", () => {
    // A plain <a href> is exactly the shape that produced the bug: the shell
    // sees a cross-origin 302 and hands the whole flow to Safari.
    const anchors = suggest.match(/<a\b[^>]*connectHref[^>]*>/gs) ?? [];
    expect(anchors.length, "expected the connect anchors to still exist").toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a, `connect anchor must intercept its click:\n${a}`).toMatch(/onClick=/);
    }
  });

  it("flags the run as native so the callback knows how to finish", () => {
    expect(suggest).toMatch(/native=1/);
  });
});

describe("the LinkedIn callback returns to the app, not the website", () => {
  const callback = read("src/app/api/integrations/linkedin/callback/route.ts");
  const connect = read("src/app/api/integrations/linkedin/connect/route.ts");

  it("connect records the native flag for the callback to read back", () => {
    // LinkedIn's registered redirect_uri is fixed, so nothing about this run
    // can ride in the URL — it has to be a cookie, same as the return path.
    expect(connect).toMatch(/li_native/);
    expect(connect).toMatch(/native.*===\s*"1"|"native"\)\s*===\s*"1"/s);
  });

  it("finishes at a swiftcard:// URL when the run started in the shell", () => {
    expect(callback).toMatch(/swiftcard:\/\/linkedin-callback/);
    expect(callback).toMatch(/li_native/);
  });

  it("still finishes at an https URL on the web", () => {
    // The web path must be untouched — this is the same route for both.
    expect(callback).toMatch(/NextResponse\.redirect\(url\.toString\(\)\)/);
  });

  it("clears every cookie on every exit", () => {
    // DONE() and the photo exit both go through clearCookies. A stale
    // li_native would send a LATER web connect into a swiftcard:// page that a
    // browser cannot follow; a stale ticket would file a later photo under it.
    const clear = callback.slice(callback.indexOf("const clearCookies"), callback.indexOf("const DONE"));
    expect(clear).toMatch(/li_return_to["']\s*,\s*["']{2}/);
    expect(clear).toMatch(/li_native["']\s*,\s*["']{2}/);
    expect(clear).toMatch(/LINKEDIN_TICKET_COOKIE\s*,\s*["']{2}/);
    expect(callback.match(/return clearCookies\(res\);/g)?.length).toBe(2);
  });
});

describe("the app handles the LinkedIn return leg", () => {
  const bridge = read("src/components/NativeAppBridge.tsx");

  it("routes swiftcard://linkedin-callback before the auth handler", () => {
    // Both are swiftcard: URLs. completeNativeOAuth would reject this one (no
    // code to exchange), so ordering is load-bearing, not cosmetic.
    const li = bridge.indexOf("swiftcard://linkedin-callback");
    const auth = bridge.indexOf('url.startsWith("swiftcard:")');
    expect(li, "linkedin-callback branch missing").toBeGreaterThan(-1);
    expect(li, "linkedin branch must come before the generic swiftcard: branch").toBeLessThan(auth);
  });

  it("only ever steers the webview to a same-origin path", () => {
    // appUrlOpen is attacker-reachable: any installed app can open a
    // swiftcard:// URL, so `next` is untrusted input aimed at window.location.
    const branch = bridge.slice(
      bridge.indexOf("swiftcard://linkedin-callback"),
      bridge.indexOf('url.startsWith("swiftcard:")'),
    );
    // One shared guard now, rejecting "//" and "/\\" alike.
    expect(branch).toMatch(/safeNextPath\(nextRaw\)/);
  });
});

describe("connecting from the headshot section applies the photo by itself", () => {
  const suggest = read("src/components/ProfilePhotoSuggest.tsx");

  it("no second click: the page picks the photo up by its ticket and opens the crop tool", () => {
    // Owner bug report 2026-09-02: connect finished, nothing happened — the
    // user had to press "Suggest my profile picture" again to see the photo.
    // Then 2026-10-20: the photo was stored but never reached the page. The
    // page now asks for it by ticket (lib/linkedin-photo-return).
    expect(suggest).toMatch(/startLinkedInPhoto\(scope\)/);
    for (const f of ["src/app/cards/[id]/edit/CardEditForm.tsx", "src/components/ProfileForm.tsx"]) {
      expect(read(f), f).toMatch(/useLinkedInPhotoPickup\(/);
    }
  });

  it("strips a failure's params so a refresh can't re-show it", () => {
    const effect = suggest.slice(suggest.indexOf("useEffect(() =>"), suggest.indexOf("async function suggest"));
    expect(effect).toMatch(/integration.*linkedin/);
    expect(effect).toMatch(/replaceState/);
    expect(effect.indexOf("replaceState")).toBeLessThan(effect.indexOf("oneShotFailure("));
  });
});

// ── The consent hop must not cost the user their unsaved card ───────────────
//
// Verified 2026-09-15: tapping "Connect LinkedIn" from the card editor was a
// full-page navigation, so an unsaved title was gone on return. Worse, the
// callback landed back on /cards/<id>/edit, which always opens on the "content"
// tab — and the importer lives on the "design" tab, so it never mounted and the
// photo was never imported at all. Both halves are pinned here.
describe("the LinkedIn hop preserves the page the user was editing", () => {
  const suggest = read("src/components/ProfilePhotoSuggest.tsx");
  const relay = read("src/app/linkedin-connected/page.tsx");
  const editorPage = read("src/app/cards/[id]/edit/page.tsx");
  const editor = read("src/app/cards/[id]/edit/CardEditForm.tsx");

  it("runs the web consent hop in a window of its own so the editor never unloads", () => {
    expect(suggest).toMatch(/window\.open\(opts\.awayHref/);
    expect(suggest).toMatch(/if \(!opts\.sameTab\)/);
  });

  it("still falls back to a normal navigation when the popup is blocked", () => {
    // window.open returns null when blocked; a dead button would be worse than
    // losing the edits we are trying to protect.
    expect(suggest).toMatch(/window\.location\.href = opts\.hopHref/);
  });

  it("keeps native on the in-app sheet — never the popup", () => {
    // The shell's hop is ASWebAuthenticationSession via @capacitor/browser and
    // must stay that way: the LinkedIn app cannot return an authorization code
    // to our redirect_uri, so deep-linking it would import nothing.
    const nativeBranch = suggest.slice(
      suggest.indexOf("async function openLinkedInConnect"),
      suggest.indexOf("// \"Suggest my profile picture\""),
    );
    const nativeIdx = nativeBranch.indexOf("detectNativeApp()");
    const popupIdx = nativeBranch.indexOf("window.open(");
    expect(nativeIdx).toBeGreaterThan(-1);
    expect(popupIdx).toBeGreaterThan(-1);
    // Native is handled and returned FIRST, so it can never reach window.open.
    expect(nativeIdx).toBeLessThan(popupIdx);
    expect(nativeBranch).toMatch(/Browser\.open/);
  });

  it("the relay sends nothing anywhere: it only closes", () => {
    expect(relay).not.toMatch(/postMessage\(/);
    expect(relay).toMatch(/window\.close\(\)/);
  });

  it("the relay refuses an off-site ?to=", () => {
    // Same class of hole as ?next= — it ends up in window.location.
    expect(relay).toMatch(/safeNextPath\(/);
  });

  it("the editor opens the tab that owns the headshot when returning", () => {
    // Decided on the server so the first paint is right and hydration matches.
    expect(editorPage).toMatch(/integration === "linkedin"/);
    expect(editorPage).toMatch(/initialTab/);
    expect(editor).toMatch(/useState<TabId>\(initialTab \?\? "content"\)/);
  });
});
