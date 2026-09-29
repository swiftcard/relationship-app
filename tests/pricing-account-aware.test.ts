import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Owner, 2026-09-28, signed in on an Office account on the website:
//   1. /pricing flashed "Free for 14 days" and then turned into $4.99.
//   2. "Get Pro" led to a normal new-customer order for Pro — and paying would
//      have swapped the account from Office to Pro (Office there had no Stripe
//      subscription, so the duplicate-subscription guard never saw it).
//   3. "← Change plan, billing, or seats" jumped into the app's Billing
//      settings instead of back to the pricing page.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("signed-in /pricing shows the account, never a flash of the trial", () => {
  const boot = read("src/app/layout.tsx");
  const css = read("src/app/home.css");
  const pricing = read("src/app/pricing/page.tsx");

  it("the boot script marks a signed-in browser before paint, and keeps the mark", () => {
    expect(boot).toContain("sb-[^=]*-auth-token/.test(document.cookie))document.documentElement.setAttribute('data-sc-authed','')");
    expect(boot).toContain("'data-sc-authed']});");
  });

  it("the plan-dependent parts stay hidden only while signed in and unanswered", () => {
    expect(css).toContain("html[data-sc-authed] [data-acct-gate]:not([data-acct-ready]) { visibility: hidden; }");
    // Released on every outcome: answer, error, or a slow network.
    expect(pricing).toContain("setAcctReady(true);");
    expect(pricing).toContain(".catch(() => { if (!cancelled) setAcctReady(true); });");
    expect(pricing).toMatch(/const giveUp = setTimeout\(\(\) => \{ if \(!cancelled\) setAcctReady\(true\); \}, 4000\);/);
    // Price, Pro button + fine print, and Office button are all gated.
    expect(pricing.match(/<div \{\.\.\.gate\}>/g)?.length).toBe(3);
  });

  it("an Office account is not sold Pro, and a paying plan reads as current", () => {
    expect(pricing).toContain('const onOffice = acctPlan?.plan === "enterprise";');
    expect(pricing).toContain("{onOffice || onPaidPro ? (");
    expect(pricing).toContain('{onOffice ? "Included in your Office plan" : "Your current plan"} · Manage →');
    expect(pricing).toContain("Your current plan · Manage seats →");
    expect(read("src/app/api/iap/trial-eligible/route.ts")).toContain("NextResponse.json({ eligible, plan, onGrant }");
  });
});

describe("Office without a Stripe subscription can't buy Pro", () => {
  it("the checkout API refuses it", () => {
    expect(read("src/app/api/stripe/checkout/route.ts")).toContain(
      'if (profile.plan === "enterprise" && !profile.stripe_subscription_id && isPro) {',
    );
  });

  it("the order page says so instead of showing an order", () => {
    expect(read("src/app/checkout/page.tsx")).toContain(
      'officeCoversPro = wanted !== "office" && profile?.plan === "enterprise" && !profile?.stripe_subscription_id;',
    );
    expect(read("src/app/checkout/CheckoutClient.tsx")).toContain('if (officeCoversPro && plan === "pro") {');
  });
});

describe("\"Change plan, billing, or seats\" goes back where the plan was picked", () => {
  it("keys on ?trial=0 (set only by /upgrade), not on trial eligibility", () => {
    const client = read("src/app/checkout/CheckoutClient.tsx");
    expect(client).toContain('<Link href={params.get("trial") === "0" ? "/upgrade" : "/pricing"}');
    expect(client).not.toContain('href={trial ? "/pricing" : "/upgrade"}');
  });
});
