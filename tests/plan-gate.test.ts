import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PlanGate, PlanNotice, PlanBadge } from "@/components/PlanGate";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// In the Node/SSR render path (no window, useEffect does not run),
// useIsNativeApp() resolves false — so PlanGate takes the WEB branch and
// renders children verbatim. This mirrors both the server render and the first
// client paint on every platform.

describe("PlanGate web branch renders children byte-for-byte", () => {
  it("passes today's web UI straight through, unchanged", () => {
    const web = h("div", { className: "banner" }, "Upgrade to Pro →");
    const out = renderToStaticMarkup(
      h(PlanGate, { feature: "demo", nativeCopy: "Pro feature — demo." }, web)
    );
    expect(out).toBe('<div class="banner">Upgrade to Pro →</div>');
  });

  // Lock the exact web strings for 3 real call sites the gate wraps in step 3.
  // If a future refactor changes the web copy, PlanGate still emits it verbatim
  // (it just forwards children), so these guard the strings at the source.
  const CALL_SITE_STRINGS: Array<[string, string]> = [
    // Second card (dashboard)
    ["Ready for a second card? Go unlimited with Pro.", "second-card"],
    // Second card CTA (dashboard)
    ["Upgrade to Pro →", "second-card-cta"],
    // Custom designer tile (CustomDesignCard)
    ["Make it unmistakably yours — unlock the custom designer with Pro →", "custom-designer"],
  ];

  for (const [str, key] of CALL_SITE_STRINGS) {
    it(`web branch preserves the exact "${key}" string`, () => {
      const out = renderToStaticMarkup(
        h(PlanGate, { feature: key, nativeCopy: "Pro feature — x." }, h("span", null, str))
      );
      expect(out).toContain(str);
    });
  }
});

describe("PlanGate native notice is neutral — no selling", () => {
  const NATIVE_COPY =
    "Pro feature — You've used your 5 free leads this month. Unlimited leads are only available on the Pro plan";
  const rawOut = renderToStaticMarkup(h(PlanNotice, { tier: "pro" as const, copy: NATIVE_COPY }));
  // React escapes text nodes for HTML; decode the entities React emits so we can
  // compare against the exact human copy string.
  const decode = (s: string) =>
    s
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  const out = decode(rawOut);

  it("shows the neutral copy, with the site phrase stripped (IAP era)", () => {
    // The gate STRINGS still say "on the Pro plan on swiftcard.me" for the
    // surfaces without a purchase path, but PlanNotice carries the IAP
    // subscribe button — naming the website directly above a button that
    // sells the plan right here is untrue and reads as steering. The notice
    // strips the phrase at render time.
    const text = out.replace(/<[^>]+>/g, "");
    expect(text).toContain("Unlimited leads are only available on the Pro plan");
    expect(text).not.toContain("swiftcard.me");
  });

  it("contains no link, no button, no price, and no 'upgrade' verb", () => {
    expect(out).not.toMatch(/<a[\s>]/i);
    expect(out).not.toMatch(/<button/i);
    expect(out).not.toMatch(/href=/i);
    expect(out).not.toMatch(/\$\d/);
    // "upgrade" must not appear anywhere in the native output.
    expect(out).not.toMatch(/upgrade/i);
    expect(out).not.toMatch(/pricing/i);
  });

  // History: the domain was banned here, then named on purpose (owner
  // decision, 2026-08-12) so a Free user could learn where the plan lives,
  // and is now stripped again — PlanNotice sells via In-App Purchase, so the
  // purchase path IS this surface and the site mention became steering. The
  // surfaces without a purchase path (nativeContent overrides) still name it,
  // inert, via GateCopy.
  it("carries no link, no URL, and nothing announced as actionable", () => {
    expect(out).not.toMatch(/<a[\s>]/i);
    expect(out).not.toMatch(/href=/i);
    expect(out).not.toMatch(/https?:\/\//i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/role="(link|button)"/i);
  });

  it("renders a plain PRO / OFFICE text badge", () => {
    expect(renderToStaticMarkup(h(PlanBadge, { tier: "pro" as const }))).toContain("PRO");
    expect(renderToStaticMarkup(h(PlanBadge, { tier: "office" as const }))).toContain("OFFICE");
  });
});

// Purchase-path history, each posture pinned by a rejection: 1.0.0 (3) inert
// notice → rejected (no way to buy). 1.0.0 (7) external link to the default
// browser → rejected (App Review requires IAP under 3.1.3(b), US link-out
// allowance notwithstanding). Now the notice sells via In-App Purchase, and
// what needs pinning is that the paywall is the ONLY purchase surface and the
// link-out era cannot silently resurface.
describe("the purchase path is In-App Purchase, wired through PlanNotice", () => {
  const gate = read("src/components/PlanGate.tsx");
  const paywall = read("src/components/NativePaywall.tsx");
  const lib = read("src/lib/iap.ts");

  it("PlanNotice renders the IAP subscribe button, not the old link-out", () => {
    expect(gate).toMatch(/<IapSubscribeButton/);
    expect(gate).not.toMatch(/<ExternalPurchaseButton/);
  });

  it("the purchase path is visible whenever the shell has a signed-in user", () => {
    // REWRITTEN after the 2026-08-31 3.1.1 rejection. The library still fails
    // closed about the ENVIRONMENT (not the shell / no key → nothing), and the
    // sheet still refuses to invent a price. What changed: a StoreKit hiccup
    // no longer HIDES the button, because a locked feature with no visible way
    // to buy is exactly what got the app rejected.
    expect(lib).toMatch(/if \(!detectNativeApp\(\)\) return null/);
    expect(lib).toMatch(/if \(!process\.env\.NEXT_PUBLIC_RC_APPLE_API_KEY\)/);
    // Only "not native" and "signed out" suppress the button…
    expect(paywall).toMatch(/if \(!detectNativeApp\(\)\) return "unavailable"/);
    expect(paywall).toMatch(/if \(!uid\) return "needs-account"/);
    // …and a signed-out surface that CAN start signup still renders a CTA, so
    // the guest card wizard never shows a Pro card with no way forward.
    expect(paywall).toMatch(/onNeedsAccount/);
    // …while neither a missing key nor a failed RevenueCat configure hides it:
    // canOfferIap/ensureIapConfigured are best-effort, after the decision.
    expect(paywall).toMatch(/if \(await canOfferIap\(\)\) \{[\s\S]{0,160}\}\s*\n\s*return "ready";/);
    // And the sheet still tells the truth when there is nothing to sell.
    expect(paywall).toMatch(/Plans aren&apos;t available right now/);
  });

  it("the first-run guest Pro card offers a way forward, not just a price", () => {
    // A brand-new download builds a card BEFORE it has an account
    // (/cards/new is deliberately open, and /signup redirects into it). The
    // native Pro card there rendered a feature list, a "14 days free" line and
    // NO button, because IapSubscribeButton returns null with no session — a
    // Pro card you cannot buy, on the very first screen that offers Pro. That
    // is the shape of the 3.1.1 rejection.
    const cards = read("src/components/PlanCards.tsx");
    const wizard = read("src/app/cards/new/NewCardWizard.tsx");
    // The native card takes a signup starter…
    expect(cards).toMatch(/onNeedsAccount=\{onCreateAccountForPro\}/);

    // …and as of 2026-09-15 the wizard no longer supplies one, because a guest
    // is not shown a plan there at all: the gate is authed-only, so the rejected
    // shape cannot occur on that screen. The prop stays wired through PlanCards
    // (asserted above) for any surface that DOES show a guest a native Pro card.
    //
    // Written as an either/or on purpose. The rule being protected is not "this
    // exact line exists" — it is "a guest never meets a Pro price with no way
    // forward". Pinning the line would have failed the moment the guest gate was
    // removed, which is a fix, while a guest gate added back WITHOUT a signup
    // starter is the actual regression. This still catches that one.
    const guestCanReachGate = !/showAuthedFirstCardGate = !guest &&/.test(wizard);
    if (guestCanReachGate) {
      expect(
        wizard,
        "a guest can reach the wizard's plan gate again, so it MUST hand the native Pro card a way to start an account (App Store 3.1.1)",
      ).toMatch(/onCreateAccountForPro=\{/);
    }
    // It must be its OWN prop: onPaid is the web checkout hand-off and the
    // native branch may never be able to reach it (tests/wallet-hardening).
    // The native path is the `if (native)` hand-off plus everything from
    // NativePlanChooser to the end of the file (the web render sits between).
    const nativeBranch =
      cards.slice(cards.indexOf("if (native) {"), cards.indexOf("{/* Monthly / annual toggle")) +
      cards.slice(cards.indexOf("function NativePlanChooser("));
    expect(cards.indexOf("function NativePlanChooser(")).toBeGreaterThan(-1);
    expect(nativeBranch).not.toMatch(/onPaid\(/);
  });

  it("purchases identify as the Supabase uid before any purchase", () => {
    // The RevenueCat app_user_id is what maps a purchase to a profile row in
    // the webhook; an anonymous purchase would grant Pro to nobody.
    // Read from the LOCAL session (no network round trip per mount) — the
    // uid is still the Supabase user id, which is all the webhook needs.
    expect(paywall).toMatch(/getSession\(\)/);
    expect(paywall).toMatch(/session\?\.user\?\.id/);
    expect(paywall).toMatch(/ensureIapConfigured\(uid\)/);
  });
});
