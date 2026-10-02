import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Owner, 2026-10-02: deleted the app, reinstalled, opened it — the first
// screen offered "Sign in" / "Create account" instead of "Sign in" / "Get
// Started", and creating an account dropped them on an empty dashboard
// ("Create Card") without ever building a card.
//
// Cause: on the FIRST launch after install there is no sc_shell cookie, so the
// proxy cannot redirect "/" — sc-boot does it client-side, and it sent everyone
// to /dashboard. Signed out, the proxy bounced that to /login?next=/dashboard,
// and a sign-in screen WITH a destination shows the bare "Create account" form.
// Every later launch had the cookie and worked, which is why it looked random.
//
// Three layers, each pinned: the first-launch redirect, the sign-in screen
// ignoring a dashboard "destination", and onboarding never landing a brand-new
// account on the dashboard.

const read = (p: string) => readFileSync(p, "utf8");

describe("a fresh app install opens on Sign in / Get Started", () => {
  it("sc-boot sends a signed-out first launch to /login, not /dashboard", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain(
      "location.replace(document.documentElement.hasAttribute('data-sc-authed')?'/dashboard':'/login');",
    );
    expect(layout).not.toContain("location.replace('/dashboard');");
    // The flag it reads must still be set earlier in the same script.
    expect(layout.indexOf("setAttribute('data-sc-authed','')")).toBeGreaterThan(-1);
    expect(layout.indexOf("setAttribute('data-sc-authed','')")).toBeLessThan(layout.indexOf("hasAttribute('data-sc-authed')"));
  });

  it("/login?next=/dashboard is treated as no destination, so Get Started stays", () => {
    const login = read("src/app/login/page.tsx");
    expect(login).toContain('const next = rawNext === "/dashboard" ? undefined : rawNext;');
    expect(login).toContain("<LoginForm redirectTo={next}");
  });

  it("Get Started still opens the card builder when there is no destination", () => {
    expect(read("src/components/LoginForm.tsx")).toContain(
      'if (m === "signup" && !redirectTo && mode !== "signup") { window.location.assign("/cards/new"); return; }',
    );
  });

  it("a brand-new account is never landed on the dashboard by onboarding", () => {
    const src = read("src/app/onboarding/page.tsx");
    expect(src).toContain('const newAccountNext = safeNext?.split("?")[0] === "/dashboard" ? null : safeNext;');
    expect(src).toContain('redirect(newAccountNext ?? (await inviteLanding(user.email, user.id)) ?? "/cards/new?add=1");');
  });
});
