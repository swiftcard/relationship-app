import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { isNativeRequest } from "@/lib/native-request";

// ── The app creates accounts too ─────────────────────────────────────────────
//
// Owner decision 2026-08-27, the day In-App Purchase went live: the old
// sign-in-only posture (signup deflected to swiftcard.me) is GONE. The shell
// renders the same two-tab form as the web — Create account opens a real
// signup form, and Pro is bought in-app via IAP. The deflection copy
// ("Accounts are created on SwiftCard.me") must never render again: above a
// working IAP paywall it is untrue, and it is the steering signal a 3.1.1
// reviewer flags.
//
// Rendered rather than grepped, as before: the point is what each tab PAINTS.

vi.mock("@supabase/ssr", () => ({ createBrowserClient: () => ({ auth: {} }) }));
vi.mock("@/components/GoogleSignInButton", () => ({
  default: () => createElement("div", { "data-testid": "gis" }),
}));

const OLD_DEFLECTION = "Accounts are created on";

async function render(props: Record<string, unknown>) {
  const { default: LoginForm } = await import("@/components/LoginForm");
  return renderToStaticMarkup(createElement(LoginForm, props));
}

describe("isNativeRequest — which requests get the app treatment", () => {
  it("detects the shell from the user-agent token", () => {
    expect(isNativeRequest("Mozilla/5.0 (iPhone) SwiftCardApp", null)).toBe(true);
  });

  it("detects an already-installed build from the sc_shell cookie", () => {
    expect(isNativeRequest("Mozilla/5.0 (iPhone)", "1")).toBe(true);
  });

  it("leaves the website alone", () => {
    expect(isNativeRequest("Mozilla/5.0 (Macintosh) Safari/605", null)).toBe(false);
    expect(isNativeRequest(null, null)).toBe(false);
    expect(isNativeRequest("Mozilla/5.0", "0")).toBe(false);
  });
});

describe("Create account is a real form everywhere", () => {
  it("signup mode renders the actual signup form, not a website deflection", async () => {
    const html = await render({ initialMode: "signup" });
    expect(html).not.toContain(OLD_DEFLECTION);
    expect(html).not.toContain("Create your account on SwiftCard.me");
    // The real form: email + password fields and the terms line.
    expect(html).toMatch(/type="email"/);
    expect(html).toMatch(/type="password"/);
    expect(html).toContain("By creating an account you agree");
  });

  it("keeps both toggle tabs", async () => {
    const html = await render({ initialMode: "signin" });
    expect(html).toContain(">Sign in<");
    // A plain visit offers "Get Started" (the card builder first, like the
    // website); arriving with somewhere to return to keeps "Create account".
    expect(html).toContain(">Get Started<");
    const gated = await render({ initialMode: "signin", redirectTo: "/cards/new?claim=1" });
    expect(gated).toContain(">Create account<");
  });

  it("Get Started opens the card builder rather than a bare account form", () => {
    const src = readFileSync("src/components/LoginForm.tsx", "utf8");
    expect(src).toContain('if (m === "signup" && !redirectTo && mode !== "signup") { window.location.assign("/cards/new"); return; }');
  });

  it("the login page no longer strips signup mode for the shell", () => {
    const src = readFileSync("src/app/login/page.tsx", "utf8");
    expect(src).not.toMatch(/signInOnly/);
    expect(src).toMatch(/mode === "signup" \? "signup" : "signin"/);
  });

  it("LoginForm has no signInOnly deflection path left", () => {
    const src = readFileSync("src/components/LoginForm.tsx", "utf8");
    expect(src).not.toMatch(/signInOnly|signupRedirect/);
    expect(src).not.toContain("Accounts are created on");
  });
});

describe("the native /upgrade screen sells via IAP only", () => {
  it("gates on canOfferIap and shows StoreKit-priced paywall, never web prices", () => {
    const src = readFileSync("src/app/upgrade/UpgradeClient.tsx", "utf8");
    expect(src).toMatch(/canOfferIap/);
    // The app's Pro card (StoreKit prices, IapSubscribeButton inside).
    expect(src).toMatch(/<NativeProUpgrade /);
    // The native branch must not interpolate any web price constant.
    const nativeBranch = src.slice(src.indexOf("if (native) {"), src.indexOf("return (", src.indexOf("if (native) {") + 20));
    expect(nativeBranch).not.toMatch(/PLAN_PRICES|proCents|money\(/);
  });
});
