import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import NativeHidden from "@/components/NativeHidden";
import UpgradeButton from "@/components/UpgradeButton";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Area 6 — native selling suppression. In the Node/SSR render path
// (useIsNativeApp resolves false, matching web + first client paint) every gated
// surface still renders its web content unchanged. The native branch (hidden)
// is locked via source assertions, since it only activates client-side in the
// Capacitor shell.

describe("web render is unchanged (native false in SSR)", () => {
  it("NativeHidden renders its children on web", () => {
    const out = renderToStaticMarkup(h(NativeHidden, null, h("span", null, "web-only")));
    expect(out).toBe("<span>web-only</span>");
  });

  it("UpgradeButton still renders the price CTA on web", () => {
    const out = renderToStaticMarkup(h(UpgradeButton, {}));
    expect(out).toContain("Upgrade ·");
    expect(out).toMatch(/\$\d/); // the price is present on web
  });
});

type Guard = { file: string; patterns: RegExp[] };

const GUARDS: Guard[] = [
  { file: "src/components/NativeHidden.tsx", patterns: [/if \(native\) return null/] },
  {
    file: "src/components/UpgradeButton.tsx",
    patterns: [/useIsNativeApp/, /if \(native\) return null/],
  },
  {
    file: "src/app/upgrade/UpgradeClient.tsx",
    // The page no longer bounces to /dashboard when canOfferIap() is false:
    // that was false for a missing key or one failed chunk fetch as well as
    // for an old shell, so a transient failure deleted the upgrade screen.
    // What must hold is that the native branch is separate and sells nothing
    // of its own — the price-free assertion lives in ios-final-audit.
    patterns: [/useIsNativeApp/, /if \(native\) \{/],
  },
  {
    // The "your card uses Pro design" moment is a selling surface: it offers
    // the trial by name and states the billing terms. Inside the shell it has
    // to fall back to the description plus Continue, with no trial CTA, no
    // day count and no billing line (App Store 3.1.1).
    file: "src/components/FreeDesignChoice.tsx",
    patterns: [/useIsNativeApp/, /\{!native && \(/],
  },
  {
    file: "src/components/site/SiteNav.tsx",
    patterns: [/useIsNativeApp/, /\{!native && <Link href="\/pricing"/],
  },
  {
    file: "src/components/site/SiteFooter.tsx",
    patterns: [/NativeHidden/, /l\.href === "\/pricing"/],
  },
  {
    file: "src/components/SettingsShell.tsx",
    patterns: [/hideOnNative/, /native && s\.hideOnNative/],
  },
  {
    // Billing's suppression moved INTO BillingManager (its native branch is an
    // IAP subscription panel, pinned in ios-final-audit.test.ts). Referrals
    // RETURNED to the app 2026-08-26 (owner order, IAP era) — the block must
    // NOT be re-wrapped in NativeHidden, and the component must not re-grow
    // its `if (native) return null` (both would silently hide a surface the
    // KB and the tour now promise the app has).
    file: "src/app/settings/flows/page.tsx",
    patterns: [/data-tour="settings-refer"/],
    absent: [/<NativeHidden>\s*\n\s*<div data-tour="settings-refer"/],
  },
  { file: "src/components/ReferAFriend.tsx", patterns: [], absent: [/if \(native\) return null/] },
  { file: "src/components/FirstLeadNudge.tsx", patterns: [/if \(!show \|\| native\) return null/] },
  { file: "src/components/GrowShare.tsx", patterns: [/native\s*\n?\s*\?/, /help more people discover SwiftCard/] },
  { file: "src/app/grow/page.tsx", patterns: [/<NativeHidden>/] },
  {
    // The bell is the app's one notification list (the dashboard's went with
    // Quick Contacts, 2026-09-29): referral claims never show in the app.
    file: "src/components/NotificationBell.tsx",
    patterns: [/\.filter\(\(n\) => n\.type !== "referral_claim" && !NATIVE_HIDDEN_TYPES\.has\(n\.type\)\)/],
  },
  {
    file: "src/components/HelpWidget.tsx",
    patterns: [/NATIVE_GREETING/, /NATIVE_SUGGESTIONS/, /useIsNativeApp\(\)/],
  },
  { file: "src/components/SignupNudgeHost.tsx", patterns: [/if \(!source \|\| native\) return null/] },
  // The guard may carry EXTRA conditions (it now also hides while the iOS app
  // is unpublished — see lib/app-store.ts), so this asserts what the test is
  // actually for: `native` still short-circuits the render. Pinning the exact
  // string made an unrelated addition to the same line look like a regression.
  { file: "src/components/AppStorePopup.tsx", patterns: [/if \(!open \|\| native(?: \|\| [^)]+)*\) return null/] },
  {
    // Web push can't work inside the Capacitor WKWebView, and the web fallback
    // ("Add to Home Screen") is impossible instructions inside a native app.
    // Native must short-circuit to its own honest not-available state.
    file: "src/components/EnablePushButton.tsx",
    patterns: [/detectNativeApp\(\)/, /state === "native"/, /native: true/],
  },
  // ── App Store 3.1.1 leak fixes (overnight iOS review audit) ────────────────
  // Dashboard trial banner: status info may stay, the "Keep Pro →" /pricing CTA
  // must not render on native.
  { file: "src/components/TrialBanner.tsx", patterns: [/useIsNativeApp/, /\{!native && !billedFrom && \(/, /\{!native && billedFrom && \(/] },
  // The shared plan chooser (welcome + card-wizard guest step): native gets ONLY
  // the free continue action — no prices, no paid plans, no checkout.
  { file: "src/components/PlanCards.tsx", patterns: [/useIsNativeApp/, /if \(native\) \{/] },
  // /checkout order summary + Stripe hand-off: client redirect on native, same
  // pattern as /pricing and /upgrade.
  { file: "src/app/checkout/CheckoutClient.tsx", patterns: [/detectNativeApp\(\)\) router\.replace\("\/dashboard"\)/] },
  // /welcome: a stored paid-plan intent must never resume its checkout panel
  // inside the shell.
  { file: "src/components/WelcomePlan.tsx", patterns: [/detectNativeApp\(\) \? null : presetIntent\)/] },
  // Office team invite: the one-tap prorated seat PURCHASE (price, charge-today,
  // Stripe seats API) never renders on native; fallback copy is neutral.
  {
    file: "src/components/office/TeamActions.tsx",
    patterns: [/useIsNativeApp/, /!native && canManageSeats && seatInfo\?\.billable && seatPrice/, /Remove an existing team member to free up a seat/],
  },
  // Marketing sales assistant discusses pricing: gated internally AND at its
  // render site.
  { file: "src/components/site/SalesChat.tsx", patterns: [/if \(native\) return null/] },
  { file: "src/components/site/SiteFooter.tsx", patterns: [/<NativeHidden><SalesChat \/><\/NativeHidden>/] },
  // Latent ungated seat purchase (dead code today) — must stay gated if revived.
  { file: "src/components/AddSeatButton.tsx", patterns: [/if \(native\) return null/] },
  // Account deletion stays fully reachable on native (5.1.1), but its
  // "cancel in Plan and billing" pointer targets a section hidden on native —
  // web only.
  { file: "src/components/ManageAccount.tsx", patterns: [/isPro && !native && \(/] },
  // Raw marketing "See pricing"/"Pricing" links wrapped in NativeHidden.
  // The homepage's "See pricing" button is GONE (owner, 2026-09-11) — the
  // closing CTA is one button now. There is nothing left to wrap, so the rule
  // is asserted the other way round, below, in "no bare /pricing link".
  { file: "src/app/products/[slug]/page.tsx", patterns: [/<NativeHidden><Link href="\/pricing"/] },
  { file: "src/app/testimonials/page.tsx", patterns: [/<NativeHidden><Link href="\/pricing"/] },
  // The cream pages (legal, company, blog, /compare, the SEO landing pages) no
  // longer each hand-roll their footer — SiteFooterMini is the one copy, so its
  // Pricing link is the one that has to stay gated. /compare keeps its own
  // guard because it also drops the price ROWS from the comparison table.
  { file: "src/components/site/SiteFooterMini.tsx", patterns: [/<NativeHidden><Link href="\/pricing"/] },
  { file: "src/app/compare/page.tsx", patterns: [/row\.pricing \? <NativeHidden/] },
];

describe("native suppression guards are present at each site", () => {
  for (const g of GUARDS) {
    const src = read(g.file);
    for (const p of g.patterns) {
      it(`${g.file} matches ${p}`, () => {
        expect(src).toMatch(p);
      });
    }
    for (const p of (g as { absent?: RegExp[] }).absent ?? []) {
      it(`${g.file} must NOT match ${p}`, () => {
        expect(src).not.toMatch(p);
      });
    }
  }
});

describe("HelpWidget native greeting/suggestions drop the upgrade prompt", () => {
  const src = read("src/components/HelpWidget.tsx");
  it("NATIVE_GREETING contains no 'upgrade to Pro' prompt", () => {
    const m = src.match(/const NATIVE_GREETING: Msg = \{[\s\S]*?\};/);
    expect(m).not.toBeNull();
    expect((m as RegExpMatchArray)[0]).not.toMatch(/upgrade to Pro/i);
  });
  it("web GREETING is unchanged and still mentions the upgrade example", () => {
    const m = src.match(/const GREETING: Msg = \{[\s\S]*?\};/);
    expect((m as RegExpMatchArray)[0]).toMatch(/How do I upgrade to Pro\?/);
  });
  it("NATIVE_SUGGESTIONS is derived by filtering out the upgrade question", () => {
    expect(src).toMatch(/NATIVE_SUGGESTIONS = SUGGESTIONS\.filter\(\(s\) => s !== "How do I upgrade to Pro\?"\)/);
  });
});

// The homepage used to carry a "See pricing" link wrapped in <NativeHidden>.
// The button was removed outright, so the wrapper check above no longer has a
// subject — but the underlying rule still has to hold: the iOS shell must never
// be shown a route to pricing. Assert the absence directly, so deleting the
// link cannot quietly delete the protection with it.
describe("the homepage offers the shell no way to pricing", () => {
  it("carries no /pricing link at all, wrapped or otherwise", () => {
    const src = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(src).not.toMatch(/href="\/pricing"/);
  });
});
