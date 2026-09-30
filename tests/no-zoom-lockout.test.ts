import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Every .tsx under src/ — the only place a form control can be declared. */
function globSrc(dir = join(process.cwd(), "src"), out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) globSrc(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// ── Never disable pinch-zoom again ───────────────────────────────────────────
//
// sc-boot used to append `maximum-scale=1, user-scalable=no` to the viewport
// meta whenever it detected the native shell, on the theory that it stopped iOS
// auto-zooming when a field is focused. It does not. iOS decides to zoom from
// the CONTROL's computed font-size (under 16px → zoom), and the viewport flags
// do not enter into that decision. What they DO remove is the user's ability to
// pinch back out afterwards — so the app zoomed in on "Add Contact", and then
// stayed zoomed in with no way back. They also fail WCAG 1.4.4 (Resize Text).
//
// The actual fix is the 16px floor in globals.css, measured by
// tests/render/ios-input-zoom.test.ts. This guard exists because the viewport
// hack is the "obvious" fix someone will reach for again — it reads like it
// should work, and reintroducing it re-creates the lockout with no test failure
// anywhere else.
//
// Source scan rather than a render test on purpose: the string never reaching
// production is the invariant, and that is a property of the source.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Source with comments removed.
 *
 * The comments explaining WHY zoom must not be disabled necessarily quote the
 * very strings being banned, so a raw match flags the documentation as the
 * defect. Only executable content counts.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FILES = [
  "src/app/layout.tsx",
  "src/components/NativeAppBridge.tsx",
  "src/app/globals.css",
  "capacitor.config.ts",
];

describe("pinch-zoom is never disabled", () => {
  for (const file of FILES) {
    it(`${file} does not disable user scaling`, () => {
      const src = code(read(file));
      expect(src).not.toMatch(/user-scalable\s*=\s*no/);
      expect(src).not.toMatch(/userScalable\s*:\s*false/);
      // maximum-scale caps zoom-IN, which is the half that traps the user.
      expect(src).not.toMatch(/maximum-scale/);
    });
  }

  it("the viewport export sets no scale limits", () => {
    const src = read("src/app/layout.tsx");
    const block = src.slice(src.indexOf("export const viewport"), src.indexOf("export default"));
    expect(block).not.toMatch(/maximumScale|minimumScale|userScalable/);
  });

  it("globals.css keeps the 16px form-control floor that replaced it", () => {
    // If someone deletes the floor because "the viewport handles it", the zoom
    // comes back. The floor and the absence of the hack are one fix.
    const css = read("src/app/globals.css");
    expect(css).toMatch(/font-size:\s*max\(16px/);
  });

  it("the floor is keyed on any-pointer, so a keyboard-attached iPad still gets it", () => {
    // `pointer:`/`hover:` describe the PRIMARY pointer. An iPad with a Magic
    // Keyboard reports pointer: fine + hover: hover while keeping the
    // touchscreen that causes the zoom, so those two queries silently miss it.
    // Narrowing this back to `pointer: coarse` is a real regression on tablets.
    const css = read("src/app/globals.css");
    expect(css).toMatch(/@media\s*\(any-pointer:\s*coarse\)/);
  });
});

describe("the app never zooms, and cannot strand the user zoomed", () => {
  // Two layers, and they are one feature. The gestures are disabled so the app
  // feels native; the 16px floor makes iOS's automatic zoom-on-focus impossible
  // so there is no zoomed state to be stuck in. Shipping the first without the
  // second is exactly the bug this whole area came from.
  it("disables pinch/double-tap zoom in the shell via touch-action", () => {
    const css = code(read("src/app/globals.css"));
    expect(css).toMatch(/html\.native-app[^{]*\{[^}]*touch-action:\s*pan-x pan-y/s);
  });

  it("scopes the gesture lock to the shell, never the website", () => {
    // The marketing site must keep pinch-zoom: it is a public web page and
    // WCAG 1.4.4 applies to it with no native app wrapper to excuse it.
    const css = code(read("src/app/globals.css"));
    const bare = css.match(/^\s*(html|body)\s*(,\s*(html|body)\s*)*\{[^}]*touch-action:\s*(none|pan-x pan-y)/m);
    expect(bare, "touch-action zoom lock must be scoped to html.native-app").toBeNull();
  });

  it("keeps the floor that makes the gesture lock safe", () => {
    // Guarded here as well as above because deleting the floor is what turns
    // the gesture lock back into a trap, and that connection is not obvious
    // from either rule on its own.
    const css = read("src/app/globals.css");
    expect(css).toMatch(/font-size:\s*max\(16px/);
  });

  it("disables zoom natively too, which is the only layer iframes cannot escape", () => {
    // CSS cannot cross a cross-origin iframe boundary, so a third-party embed
    // with 14px fields would still zoom the page. Webview zoom IS the scroll
    // view's zoom, so this covers it.
    const swift = read("ios/App/App/MainViewController.swift");
    expect(swift).toMatch(/minimumZoomScale\s*=\s*1\.0/);
    expect(swift).toMatch(/maximumZoomScale\s*=\s*1\.0/);
    expect(swift).toMatch(/pinchGestureRecognizer\?\.isEnabled\s*=\s*false/);
    expect(swift).toMatch(/bouncesZoom\s*=\s*false/);
  });

  it("re-applies the native pin on every navigation, not just at launch", () => {
    // capacitorDidLoad() runs once. The shell loads a REMOTE url and does full
    // document navigations — the first is sc-boot's redirect to /dashboard, so
    // a one-shot pin is already undone before the user sees a screen. WebKit
    // re-derives the zoom scales per document.
    const swift = read("ios/App/App/MainViewController.swift");
    expect(swift, "zoom pin must be re-applied on url change").toMatch(/observe\(\\?\.url/);
    // Must NOT take Capacitor's delegates to do it — the bridge hangs off both.
    expect(swift).not.toMatch(/scrollView\.delegate\s*=/);
    expect(swift).not.toMatch(/webView\?\.navigationDelegate\s*=/);
  });

  it("keeps PostHog surveys off — they render sub-16px fields in a shadow root", () => {
    // A shadow boundary is precisely what the globals.css floor cannot cross,
    // so a survey textarea would zoom the page. Surveys default to ON.
    const src = read("src/lib/events.ts");
    expect(src).toMatch(/disable_surveys:\s*true/);
  });
});

describe("full-screen overlays clear the status bar", () => {
  // A `fixed inset-0` overlay is NOT moved by body's safe-area padding, and it
  // does not carry .sc-app/.sc-tabbar, the two classes that get the inset. Under
  // viewport-fit=cover that puts its top bar under the clock — the contact
  // detail's back button was completely untappable in the native shell.
  //
  // env(safe-area-inset-*) is always 0 in headless Chromium, so this cannot be
  // measured in the render harness; the wiring is what gets pinned.
  it("the contact detail back bar opts into the safe-area inset", () => {
    const src = read("src/components/ContactsClient.tsx");
    const bar = src.split("\n").find((l) => l.includes("sticky top-0") && l.includes("h-12"));
    expect(bar, "no mobile back bar found in the contact detail").toBeDefined();
    expect(bar).toMatch(/sc-overlay-topbar/);
  });

  it("globals.css insets that bar only in the native shell", () => {
    const css = code(read("src/app/globals.css"));
    const rule = css.slice(css.indexOf("html.native-app .sc-overlay-topbar"));
    // The inset is read through a custom property whose FALLBACK is the same
    // env() — so on iOS and the web the computed value is unchanged, while
    // MainActivity.java can override it on Android, where env() reports 0
    // under a status bar the page is genuinely drawn beneath.
    expect(rule).toMatch(/padding-top:\s*var\(--sc-inset-top, env\(safe-area-inset-top\)\)/);
    // Border-box: without a matching height bump the padding eats the bar's
    // 48px and pushes the button back out of reach.
    expect(rule).toMatch(/height:\s*calc\(3rem \+ var\(--sc-inset-top, env\(safe-area-inset-top\)\)\)/);
  });
});

describe("no control asks for a size the floor would silently shrink", () => {
  // The floor is `max(16px, 1em)` with a `revert-layer` opt-out listing NAMED
  // utilities (text-lg…text-4xl). An ARBITRARY value — text-[18px] — is not on
  // that list, so it would be quietly reduced to 16px on phones and nowhere
  // else. A hand-maintained allowlist cannot be completed by hand, so this
  // finds the case instead of trying to enumerate it.
  const CONTROL = /<(input|select|textarea)\b[^>]*>/gs;
  const ARBITRARY = /text-\[(\d+(?:\.\d+)?)(px|rem)\]/g;

  it("flags any input/select/textarea with an arbitrary size above 16px", () => {
    const files = globSrc();
    const bad: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const tag of src.match(CONTROL) ?? []) {
        for (const m of tag.matchAll(ARBITRARY)) {
          const px = m[2] === "rem" ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
          if (px > 16) {
            bad.push(`${file.replace(root + "/", "")}: ${m[0]} (${px}px)`);
          }
        }
      }
    }

    expect(
      bad,
      "these controls ask to be larger than 16px with an arbitrary value, which " +
        "the floor's named-utility opt-out in globals.css does not cover — they " +
        "would be shrunk to 16px on touch devices only. Add the value to the " +
        "`revert-layer` rule, or use a named text-* utility.",
    ).toEqual([]);
  });
});
