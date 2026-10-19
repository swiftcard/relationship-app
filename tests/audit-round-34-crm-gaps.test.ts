import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { waitsForReconnect } from "@/lib/crm-outbox";

// ── Audit round 34 (2026-10-18): what the CRM rewrite left open ─────────────
//
// I-02  A contact captured while a CRM refused SwiftCard (401/403) was never
//       queued, so it was lost even after the user reconnected. Behaviour is
//       pinned in tests/crm-provider-contract.test.ts; this file pins that
//       every way of reconnecting sends what waited.
// I-04  A deployment with no client secret turned a 401 into a "reconnect"
//       banner on a working connection (behaviour: crm-provider-contract).
// I-06  The Free contact lock read the raw plan column, so an expired free
//       month kept capturing unlocked contacts until the nightly job ran.

const read = (p: string) => readFileSync(p, "utf8");

describe("I-02: a reconnect sends what waited", () => {
  it("only a refusal of SwiftCard itself waits for a reconnect", () => {
    expect(waitsForReconnect(401)).toBe(true);
    expect(waitsForReconnect(403)).toBe(true);
    for (const s of [null, undefined, 400, 404, 422, 429, 500, 503]) expect(waitsForReconnect(s)).toBe(false);
  });

  it("all five connect routes start the catch-up for their own CRM", () => {
    const routes: [string, string, string][] = [
      ["src/app/api/integrations/google/callback/route.ts", "userId", "google"],
      ["src/app/api/integrations/salesforce/callback/route.ts", "userId", "salesforce"],
      ["src/app/api/integrations/hubspot/token/route.ts", "user.id", "hubspot"],
      ["src/app/api/integrations/pipedrive/token/route.ts", "user.id", "pipedrive"],
      ["src/app/api/integrations/highlevel/token/route.ts", "user.id", "highlevel"],
    ];
    for (const [f, who, p] of routes) expect(read(f)).toContain(`catchUpAfterReconnect(${who}, "${p}");`);
    expect(read("src/lib/crm-outbox-drain.ts")).toContain("drainCrmOutbox({ ownerId, provider, dueNow: true, deadlineMs: 25_000 })");
  });
});

describe("I-06: the contact lock reads the plan as it is now", () => {
  it("both capture routes use the effective plan", () => {
    const leads = read("src/app/api/leads/route.ts");
    expect(leads).toContain("const ownerSelect = `id, name, email, phone, company, ${PLAN_COLUMNS}`;");
    expect(leads).toContain("if (!isPaidProfile(ownerProfile) && ownerProfile?.id) {");
    expect(leads).not.toMatch(/isPaidPlan\(ownerProfile/);
    const manual = read("src/app/api/leads/manual/route.ts");
    expect(manual).toContain("const paid = isPaidProfile(profile);");
    expect(manual).toContain(".select(`username, ${PLAN_COLUMNS}`)");
  });
});
