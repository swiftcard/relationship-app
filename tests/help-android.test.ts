import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { KNOWLEDGE } from "@/lib/knowledge";
import { fillPlaceholders } from "@/lib/knowledge/derived";
import { instantAnswer } from "@/lib/knowledge/retrieval";
import { ANDROID_RULES, NATIVE_RULES } from "@/lib/knowledge/personas";

// ── The help assistant in the Android app sells nothing either (F-HELP-01) ──
//
// The Android app shows no price, no trial and no button that buys (owner,
// 2026-10-08; tests/render/android-sells-nothing). Its assistant still
// answered with the iPhone's answers — "subscribe to Pro right in the app",
// "manage it in your Apple account" — because the request said only
// "native". It now says which app, and Android gets `androidAnswer`.

// The same list tests/render/android-sells-nothing holds the Android screens to.
const FORBIDDEN_ON_ANDROID = [
  /\$\s?\d/, /\/\s?month/i, /Get Pro/i, /Upgrade/i, /Keep Pro/i, /Try (Pro|it) free/i, /free trial/i, /days? free/i,
  /Restore Purchases/i, /Apple account/i, /App Store/i, /cancel anytime/i, /renews/i, /Billed by Apple/i,
];

// Answers that name something real and sell nothing, each with the ONE
// pattern it is allowed to match and why.
const ALLOWED: Record<string, { pattern: string; why: string }> = {
  analytics: { pattern: String(/\/\s?month/i), why: 'the "Today / Week / Month" control is the label on the dashboard' },
  "ios-app-availability": { pattern: String(/App Store/i), why: "the question is about the iPhone app; it describes where that app is" },
  "help-us-grow": { pattern: String(/App Store/i), why: "it explains that the App Store rating is not shown on Android" },
  "trial-days-left": { pattern: String(/free trial/i), why: '"Free trial" is the row\'s label in Settings → Profile' },
};

const androidPath = (d: (typeof KNOWLEDGE)[number]) => d.androidAnswer ?? d.nativeAnswer ?? d.answer;

describe("every answer an Android session can get", () => {
  it("names nothing the Android app doesn't have, and sells nothing", () => {
    const bad: string[] = [];
    for (const d of KNOWLEDGE) {
      if (!d.audience.includes("user")) continue;
      const text = fillPlaceholders(androidPath(d), { native: true });
      const hits = FORBIDDEN_ON_ANDROID.filter((re) => re.test(text)).map(String);
      const allowed = ALLOWED[d.id];
      const unexpected = hits.filter((h) => h !== allowed?.pattern);
      if (unexpected.length) bad.push(`${d.id}: ${unexpected.join(" ")}`);
    }
    expect(bad).toEqual([]);
  });

  it("each allowance is still needed (a doc that no longer matches drops off the list)", () => {
    for (const [id, { pattern }] of Object.entries(ALLOWED)) {
      const d = KNOWLEDGE.find((x) => x.id === id);
      expect(d, id).toBeDefined();
      const re = FORBIDDEN_ON_ANDROID.find((r) => String(r) === pattern)!;
      expect(re.test(fillPlaceholders(androidPath(d!), { native: true })), `${id} no longer needs its allowance`).toBe(true);
    }
  });

  it("every commerce doc whose iPhone answer describes buying has an Android one", () => {
    for (const d of KNOWLEDGE) {
      if (!d.commerce || !d.nativeAnswer) continue;
      const ios = fillPlaceholders(d.nativeAnswer, { native: true });
      if (FORBIDDEN_ON_ANDROID.some((re) => re.test(ios))) expect(d.androidAnswer, `${d.id} needs an androidAnswer`).toBeTruthy();
    }
  });
});

describe("the instant answer picks the right app", () => {
  const ask = (q: string, platform?: "ios" | "android") => instantAnswer(KNOWLEDGE, q, { audience: "user", native: true, platform });

  it("Android hears that subscribing isn't in the app; the iPhone still hears how to subscribe", () => {
    expect(ask("how do I upgrade to pro", "android")).toMatch(/Subscribing isn.t available in the Android app/);
    expect(ask("how do I upgrade to pro", "ios")).toMatch(/subscribe to Pro right in the app/);
  });

  it("cancelling and billing never send an Android user to an Apple account", () => {
    const cases: [string, RegExp][] = [
      ["how do i cancel my subscription", /nothing to cancel here/],
      ["where is plan and billing", /Nothing in the Android app buys or changes a plan/],
      ["where do i enter a promo code", /Promo codes aren.t used in the Android app/],
    ];
    for (const [q, expected] of cases) {
      const a = ask(q, "android");
      expect(a, q).toMatch(expected);
      expect(a, q).not.toMatch(/Apple account|App Store|Upgrade/i);
    }
  });

  it("a doc with no Android answer is the same for both apps", () => {
    expect(ask("how do i edit my card", "android")).toBe(ask("how do i edit my card", "ios"));
  });
});

describe("the wiring", () => {
  it("the widget says which app; the route turns it into the scope and the rules", () => {
    expect(readFileSync("src/components/HelpWidget.tsx", "utf8")).toContain('...(native ? { platform: android ? "android" : "ios" } : {})');
    const route = readFileSync("src/app/api/ai/help/route.ts", "utf8");
    expect(route).toContain('const platform: Scope["platform"] = native ? (body.platform === "android" ? "android" : "ios") : undefined;');
    expect(route).toContain('native ? (platform === "android" ? ANDROID_RULES : NATIVE_RULES) : ""');
  });

  it("the Android rules forbid what the iPhone rules allow", () => {
    expect(NATIVE_RULES).toMatch(/subscribe in the app/);
    expect(ANDROID_RULES).toMatch(/sells nothing/);
    expect(ANDROID_RULES).toMatch(/Never tell the user to upgrade, subscribe, buy/);
  });
});
