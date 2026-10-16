// ── The same offer on the phone and on the computer ─────────────────────────
//
// The owner's report: "the pop-up on the phone is not the same pop-up as the
// one on the computer." It wasn't. The web sheet had a headline, a list, a
// price and a button; the shell swapped the middle out for a different
// component with different words and a different shape.
//
// Both dialogs now render one offer (components/ProOffer), so this measures the
// thing that was actually wrong: that the two platforms produce the SAME sheet.
// And because that meant leaving PlanGate — which used to carry the App Store
// rules for free — the two rules it enforced are asserted here directly, on
// rendered output, which is stronger than the copy-string check it replaced:
//
//   • 3.1.2 — a price shown in the shell must be the price Apple charges. Apple
//     charges in the viewer's own currency, so the shell may never print a
//     hardcoded dollar amount. It reads StoreKit or it shows no figure.
//   • 3.1.3(b) — a subscription the app unlocks is bought by in-app purchase,
//     never by sending someone to a website.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

type Dialog = "save" | "addcard";

async function render(dialog: Dialog, native: boolean, trialEligible = true) {
  vi.resetModules();
  vi.doMock("@/lib/platform", () => ({
    useIsNativeApp: () => native,
    useIsAndroidApp: () => false,
    detectNativeApp: () => native,
    isNativeApp: native,
  }));
  if (dialog === "save") {
    const { default: D } = await import("@/components/ProRequiredDialog");
    return renderToStaticMarkup(
      createElement(D, { features: ["Carbon finish", "Background video"], trialEligible, onSaveWithoutPro: () => {}, onCancel: () => {} }),
    );
  }
  const { SecondCardSheet } = await import("@/components/AddCardButton");
  return renderToStaticMarkup(createElement(SecondCardSheet, { trialEligible, onClose: () => {} }));
}

/** Visible text, with markup and whitespace collapsed away. */
const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

// The primary button cannot be compared through static markup. On native it is
// IapSubscribeButton, which resolves StoreKit availability in an EFFECT — and
// renderToStaticMarkup never runs effects, so it renders nothing here while
// rendering fine in the real shell. Its presence is asserted from the source
// instead, below; the sheet BODY is what these comparisons cover.
const CTA = /Start my 14-day free trial|Upgrade to Pro/g;
const body = (html: string) => text(html).replace(CTA, "").replace(/\s+/g, " ").trim();

describe.each<[string, Dialog]>([
  ["Save Changes dialog", "save"],
  ["Add card dialog", "addcard"],
])("%s", (_name, dialog) => {
  it("says the SAME words on both platforms, bar the price", async () => {
    // The price line is the one licensed difference, so drop any figure and the
    // "then … a month" clause before comparing.
    const strip = (t: string) => t.replace(/then \$?[\d.,]*\s*[^ ]* a month/gi, "").replace(/\$[\d.,]+/g, "").replace(/\s+/g, " ").trim();
    expect(strip(body(await render(dialog, true)))).toBe(strip(body(await render(dialog, false))));
  });

  it("offers the trial in the same words on both", async () => {
    for (const native of [false, true]) {
      const t = text(await render(dialog, native));
      expect({ native, hasTrial: /14-day free trial/.test(t) }).toMatchObject({ hasTrial: true });
    }
  });

  it("web spells out the price as 'then $4.99 a month'", async () => {
    expect(text(await render(dialog, false))).toContain("then $4.99 a month");
  });

  // ── App Store 3.1.2 ──
  it("the shell prints no hardcoded price", async () => {
    const app = await render(dialog, true);
    expect(app).not.toMatch(/\$\s?\d/);
    expect(app).not.toContain("4.99");
  });

  // ── App Store 3.1.3(b) ──
  it("the shell links to no website purchase", async () => {
    const app = await render(dialog, true);
    expect(app).not.toContain("/checkout");
    expect(app).not.toContain("/upgrade");
    expect(app).not.toContain("swiftcard.me");
  });

  it("the web keeps its checkout link, and the trial one", async () => {
    // React escapes & in an href, so the rendered attribute is &amp;.
    const web = (await render(dialog, false)).replace(/&amp;/g, "&");
    expect(web).toContain("/checkout?plan=pro&interval=monthly");
    expect(web).not.toContain("trial=0");
    const noTrial = (await render(dialog, false, false)).replace(/&amp;/g, "&");
    expect(noTrial).toContain("/checkout?plan=pro&interval=monthly&trial=0");
  });

  it("an ex-subscriber is never promised a second trial", async () => {
    for (const native of [false, true]) {
      const t = text(await render(dialog, native, false));
      expect({ native, promises: /free trial/i.test(t) }).toMatchObject({ promises: false });
    }
  });
});

// The button itself, from the source — see the note above on why it cannot be
// measured through static markup.
describe("the primary button goes the right way on each platform", () => {
  const OFFER = readFileSync(join(process.cwd(), "src/components/ProOffer.tsx"), "utf8");

  it("native subscribes through StoreKit, web opens checkout", () => {
    expect(OFFER).toContain("IapSubscribeButton");
    // The native branch returns BEFORE the web Link is reached.
    const nativeAt = OFFER.indexOf("if (native) {");
    const iapAt = OFFER.indexOf("IapSubscribeButton", nativeAt);
    const linkAt = OFFER.indexOf("/checkout?plan=pro", nativeAt);
    expect(nativeAt).toBeGreaterThan(-1);
    expect(iapAt).toBeGreaterThan(nativeAt);
    expect(linkAt).toBeGreaterThan(iapAt);
  });

  it("both platforms label it identically", () => {
    // One `label` const, used by both branches — so the words cannot drift.
    expect(OFFER).toMatch(/const label = trialEligible \? `Start my \$\{TRIAL_DAYS\}-day free trial` : "Upgrade to Pro";/);
  });

  it("the shell's price can only come from StoreKit", () => {
    expect(OFFER).toContain("getIapPackages");
    expect(OFFER).toMatch(/const price = native \? iapPrice : webPrice;/);
    // And it renders nothing rather than a wrong figure.
    expect(OFFER).toMatch(/\{price && \(/);
  });
});
