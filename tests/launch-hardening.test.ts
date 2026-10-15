import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Pinned before the 2026 marketing push: each guard is what keeps a traffic
// spike (or a bot riding one) from becoming an outage or a bill.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("a slow database fails fast instead of piling up functions", () => {
  it("the service-role client caps every call, longer for storage, and keeps a caller's own signal", () => {
    const s = read("src/lib/supabase-admin.ts");
    expect(s).toContain("global: { fetch: cappedFetch }");
    expect(s).toMatch(/AbortSignal\.timeout\(href\.includes\("\/storage\/v1\/"\) \? ADMIN_STORAGE_TIMEOUT_MS : ADMIN_TIMEOUT_MS\)/);
    expect(s).toContain("AbortSignal.any([init.signal, cap])");
  });
});

describe("public AI has one daily ceiling across all visitors", () => {
  it("sales chat, guest logo search and guest card design each share a global key", () => {
    expect(read("src/app/api/ai/sales/route.ts")).toContain('isRateLimited("ai-global:sales-chat"');
    expect(read("src/app/api/logo-suggest/route.ts")).toMatch(/!user && \(await isRateLimited\("ai-global:logo-suggest:guest"/);
  });
  it("a guest past the design ceiling still gets a design, from the engine, never an error", () => {
    expect(read("src/app/api/design-generate/route.ts")).toContain(
      'if (useModel && (await isRateLimited("ai-global:design-generate:guest", 5000, DAY))) useModel = false;',
    );
  });
});

describe("every call Supabase's CAPTCHA switch guards carries the human-check token", () => {
  // Turning the switch on with one of these missing would break that path for
  // every real person: sign-in, sign-up, the reset email, the delete re-check.
  const guarded: [string, RegExp][] = [
    ["src/components/LoginForm.tsx", /signInWithPassword\(\{ email: emailNow, password: passwordNow, options: \{ captchaToken \} \}\)/],
    ["src/components/LoginForm.tsx", /signUp\(\{ email: emailNow, password: passwordNow, options: \{ emailRedirectTo, captchaToken \} \}\)/],
    ["src/components/LoginForm.tsx", /resetPasswordForEmail\(emailNow, \{[\s\S]{0,600}captchaToken,\s*\}\)/],
    ["src/components/ResetPasswordForm.tsx", /resetPasswordForEmail\(target, \{[\s\S]{0,400}captchaToken,\s*\}\)/],
    ["src/components/ManageAccount.tsx", /signInWithPassword\(\{ email, password, options: \{ captchaToken \} \}\)/],
  ];
  it.each(guarded)("%s passes captchaToken", (file, re) => {
    expect(read(file)).toMatch(re);
  });
  it("no client auth call that the switch guards is left without a token", () => {
    for (const f of ["src/components/LoginForm.tsx", "src/components/ResetPasswordForm.tsx", "src/components/ManageAccount.tsx"]) {
      const s = read(f);
      const calls = (s.match(/\.auth\.(signInWithPassword|signUp|resetPasswordForEmail|signInWithOtp)\(/g) ?? []).length;
      const tokens = (s.match(/captchaToken = await human\.token\(\)/g) ?? []).length;
      expect(tokens, f).toBe(calls);
    }
  });
  it("the check is inert until a site key exists, and never hard-blocks the button", () => {
    const s = read("src/components/HumanCheck.tsx");
    expect(s).toContain('const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";');
    expect(s).toContain("if (!SITE_KEY) return undefined;");
    expect(s).toContain("resolve(undefined);"); // gives up waiting; Supabase decides
  });
  it("QA signs in by link, not through the guarded form", () => {
    for (const f of ["qa-flows", "qa-sweep", "qa-office-links-brand", "qa-notifications", "qa-office-shell", "qa-a11y", "qa-mac"]) {
      expect(read(`scripts/${f}.mjs`), f).toContain('from "./lib/qa-sign-in.mjs"');
    }
  });
});

describe("an error storm is one alert, not thousands of writes", () => {
  it("rows are capped per fingerprint (Bo's detector still sees 3+) and the chat alert is once per window", () => {
    const s = read("src/lib/report-error.ts");
    expect(s).toMatch(/isRateLimited\(`report-error:row:\$\{fingerprint\}`, 20, STORM_WINDOW\)/);
    expect(s).toMatch(/isRateLimited\(`report-error:alert:\$\{fingerprint\}`, 1, STORM_WINDOW\)/);
    expect(s).toContain("if (!rowCapped) {");
  });
});
