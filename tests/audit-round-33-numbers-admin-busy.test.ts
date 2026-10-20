import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LEADS_CAP_NATIVE_COPY, PLAN_LIMITS, PLAN_PRICES } from "@/lib/plan";
import { formatUsd } from "@/lib/currency";

// ── Audit round 33 (2026-10-18): one number per rule, and no stuck buttons ──
//
// F-DASH-01  The app's leads-cap notice said "5 free leads" and "Invite 3
//            friends … up to 3 months" by hand, beside a web banner that read
//            the constants.
// F-MKT-01   /compare typed SwiftCard's own prices and seat minimum.
// F-ADMIN-05 Admin lists and buttons stayed on "Loading…" or disabled after a
//            dropped connection, and Disconnect said it worked when it didn't.

const read = (p: string) => readFileSync(p, "utf8");

describe("F-DASH-01: the app's cap notice reads the plan", () => {
  it("the native copy is built from FREE_LEADS_PER_MONTH, with the words the app has always shown", () => {
    expect(LEADS_CAP_NATIVE_COPY).toBe(
      `Pro feature — You've used your ${PLAN_LIMITS.FREE_LEADS_PER_MONTH} free leads this month. Unlimited leads are only available on the Pro plan`,
    );
    expect(read("src/lib/plan.ts")).toContain("${PLAN_LIMITS.FREE_LEADS_PER_MONTH} free leads this month");
  });

  it("no screen types the cap or the referral numbers", () => {
    const dash = read("src/app/dashboard/page.tsx");
    const modal = read("src/components/AddContactModal.tsx");
    for (const src of [dash, modal]) expect(src).not.toMatch(/used your \d+ free leads/);
    expect(dash).not.toMatch(/Invite \d+ friends|up to \d+ months/);
    expect(dash.split("Invite {REFERRAL.SIGNUPS_PER_REWARD} friends").length - 1).toBe(2);
    expect(dash.split("(up to {REFERRAL.MAX_REFERRAL_REWARDS * REFERRAL.REFERRER_FREE_MONTHS} months)").length - 1).toBe(2);
    expect(modal).toContain("nativeCopy={LEADS_CAP_NATIVE_COPY}");
  });
});

describe("F-MKT-01: the compare pages quote lib/plan", () => {
  it("SwiftCard's price and seat minimum are never literal", () => {
    for (const f of ["src/app/compare/page.tsx", "src/app/compare/[slug]/page.tsx"]) {
      const src = read(f);
      expect(src).toContain("const PRO = formatUsd(PLAN_PRICES.PRO_MONTHLY_CENTS);");
      expect(src).not.toMatch(/swiftcard: "\$/);
      expect(src).not.toMatch(/SwiftCard(?: Pro)? is \$\d|Pro is \$\d|\$3\.99|\b2-seat\b|min 2\b/);
    }
    expect(formatUsd(PLAN_PRICES.PRO_MONTHLY_CENTS)).toMatch(/^\$\d+\.\d\d$/);
  });
});

describe("F-ADMIN-05: a dropped connection never leaves an admin screen stuck", () => {
  it("every loader and action settles in a finally or a catch", () => {
    const users = read("src/app/admin/users/UsersClient.tsx");
    expect(users).toContain('setLoadError("Couldn\'t reach the server.");');
    expect(users).toMatch(/\} finally \{\n\s+setLoading\(false\);/);
    expect(users).toContain("loadError && users.length === 0");

    const detail = read("src/app/admin/users/[id]/UserDetailClient.tsx");
    expect(detail).toContain('else setError("Couldn\'t reach the server. Reload the page to try again.");');

    const plans = read("src/app/admin/plans/PlansClient.tsx");
    expect(plans).toMatch(/\} finally \{\n\s+setSaving\(null\);/);

    const mkt = read("src/app/admin/marketing/MarketingClient.tsx");
    expect(mkt).toMatch(/\} finally \{\n\s+setDomainChecking\(false\);/);
    expect(mkt).toContain('const res = await fetch("/api/admin/promo-codes").catch(() => null);');
  });

  it("Disconnect only says so when the row is really gone", () => {
    expect(read("src/lib/agent-connections.ts")).toContain("if (error) throw new Error(`agent_connections delete failed: ${error.message}`);");
    expect(read("src/app/api/admin/connect/[provider]/route.ts")).toMatch(/catch \{\n\s+return NextResponse\.json\(\{ error: "Couldn't disconnect — try again\." \}, \{ status: 500 \}\);/);
  });
});
