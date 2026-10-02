import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TRIAL_EXTENDED_META_KEY,
  TRIAL_EXTENSION_TOTAL_DAYS,
  trialExtensionFor,
} from "@/lib/trial-extension";
import { offerStep, keepStep, stepsFor, trialExtensionOffer, type Eligibility } from "@/lib/retention";

// Owner, 2026-10-02: someone on the 14-day Pro trial who tries to leave is
// offered free Pro until a month from the day the trial STARTED — one free
// month per person, whichever door it came through.

const DAY = 86_400;
const START = 1_790_000_000; // a trial start, in Unix seconds
const trial = (over: Record<string, unknown> = {}) => ({
  status: "trialing",
  trial_start: START,
  trial_end: START + 14 * DAY,
  cancel_at_period_end: false,
  metadata: {},
  ...over,
});
const at = (days: number) => (START + days * DAY) * 1000;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("trialExtensionFor — the date is fixed to the trial's start", () => {
  it("a month from the start, whichever day of the trial they ask", () => {
    for (const day of [0.1, 1, 7, 13, 13.9]) {
      const ext = trialExtensionFor(trial(), at(day));
      expect(ext, `day ${day}`).not.toBeNull();
      expect(ext!.untilUnix).toBe(START + TRIAL_EXTENSION_TOTAL_DAYS * DAY);
      expect(ext!.until).toBe(new Date((START + 30 * DAY) * 1000).toISOString());
      expect(ext!.currentEnd).toBe(new Date((START + 14 * DAY) * 1000).toISOString());
      expect(ext!.extraDays).toBe(16);
    }
  });

  it("is 30 days in total — the same free month as the Free plan's gift", () => {
    expect(TRIAL_EXTENSION_TOTAL_DAYS).toBe(30);
  });

  it("refuses what it cannot honour", () => {
    expect(trialExtensionFor(trial({ status: "active" }), at(7))).toBeNull();
    expect(trialExtensionFor(trial({ status: "past_due" }), at(7))).toBeNull();
    expect(trialExtensionFor(trial({ trial_start: null }), at(7))).toBeNull();
    expect(trialExtensionFor(trial({ trial_end: null }), at(7))).toBeNull();
    // Already cancelled: accepting would re-enable a charge they turned down.
    expect(trialExtensionFor(trial({ cancel_at_period_end: true }), at(7))).toBeNull();
    // Already stretched once (Stripe-side stamp).
    expect(trialExtensionFor(trial({ metadata: { [TRIAL_EXTENDED_META_KEY]: "x" } }), at(7))).toBeNull();
    // A promo trial that already runs a month or more has nothing to gain.
    expect(trialExtensionFor(trial({ trial_end: START + 30 * DAY }), at(7))).toBeNull();
    expect(trialExtensionFor(trial({ trial_end: START + 60 * DAY }), at(7))).toBeNull();
    // The trial is over.
    expect(trialExtensionFor(trial(), at(14.01))).toBeNull();
  });
});

const EXT: Eligibility = {
  grant: false,
  discount: false,
  downgrade: true,
  extend: true,
  extendUntil: new Date((START + 30 * DAY) * 1000).toISOString(),
  extendDays: 16,
  trialEndsAt: new Date((START + 14 * DAY) * 1000).toISOString(),
  chargeCents: 499,
  chargeInterval: "month",
};

describe("the offer, on the web and in the app", () => {
  it("is step 5 of 6 for a trial, on web AND native", () => {
    for (const native of [false, true]) {
      expect(stepsFor("pro", EXT, native)).toEqual(["why", "detail", "keep", "loss", "offer", "confirm"]);
      const o = offerStep("pro", EXT, native)!;
      expect(o.action).toBe("extend");
      expect(o.title).toMatch(/^Keep your free trial going until \w+ \d+$/);
      expect(o.accept).toMatch(/^Keep my trial until \w+ \d+$/);
      expect(o.body).toContain("16 more days of Pro, free");
      expect(o.decline).toBe("No thanks, continue to delete");
    }
  });

  it("the web names the charge; the app never quotes a price or a charge (3.1.1)", () => {
    const web = offerStep("pro", EXT, false)!;
    expect(web.priceLine).toMatch(/^Then \$4\.99\/month from \w+ \d+$/);
    expect(web.fineprint).toMatch(/Nothing to pay today/);
    const app = offerStep("pro", EXT, true)!;
    expect(app.priceLine).toBeNull();
    const all = [app.title, app.body, app.fineprint, app.accept, ...(app.bullets ?? [])].join(" ");
    expect(all).not.toMatch(/\$|charge|subscri|billing|pay/i);
  });

  it("an annual trial quotes the yearly price", () => {
    expect(trialExtensionOffer({ until: EXT.extendUntil!, currentEnd: null, extraDays: 16, chargeCents: 4999, chargeInterval: "year" }, false, "x").priceLine)
      .toMatch(/^Then \$49\.99\/year from /);
  });

  it("without the stretch, a native Pro still gets no money offer", () => {
    const noExt: Eligibility = { grant: false, discount: true, downgrade: true };
    expect(offerStep("pro", noExt, true)).toBeNull();
    expect(stepsFor("pro", { ...EXT, extend: false }, true)).not.toContain("offer");
  });

  it("the keep step on a trial never claims a paid period", () => {
    const k = keepStep("pro", EXT, "stripe", null);
    expect(k.title).toBe("Cancel your trial instead of deleting");
    expect(k.accept).toBe("Cancel my trial, keep my account");
    expect(k.action).toBe("downgrade");
    expect(k.body).not.toMatch(/paid for/);
    // A paying subscriber's wording is unchanged.
    expect(keepStep("pro", { grant: false, discount: false, downgrade: true }, "stripe", null).title).toBe("Switch to Free instead of deleting");
  });
});

describe("one free month per person — pinned at source", () => {
  const route = read("src/app/api/stripe/subscription/extend-trial/route.ts");
  const server = read("src/lib/trial-extension-server.ts");
  const retention = read("src/app/api/account/retention/route.ts");

  it("the apply route moves trial_end once, idempotently, and records it after Stripe accepts", () => {
    expect(route).toMatch(/trial_end: offer\.untilUnix/);
    expect(route).toMatch(/cancel_at_period_end: false/);
    expect(route).toMatch(/proration_behavior: "none"/);
    expect(route).toMatch(/idempotencyKey: `trial-extend:\$\{subId\}:\$\{offer\.untilUnix\}`/);
    // Deterministic metadata, or a racing retry breaks the idempotency key.
    expect(route).toMatch(/\[TRIAL_EXTENDED_META_KEY\]: offer\.until/);
    const update = route.indexOf("subscriptions.update(");
    expect(update).toBeGreaterThan(0);
    expect(route.indexOf(`ledgerAdd("email_retention"`)).toBeGreaterThan(update);
    expect(route.indexOf("trialExtendedAt: now")).toBeGreaterThan(update);
  });

  it("refuses Office, Apple, a second time, and the ledger", () => {
    expect(route).toMatch(/officeSubUserBlockMessage/);
    expect(server).toMatch(/if \(opts\.plan !== "pro"\) return null;/);
    expect(server).toMatch(/if \(isApplePaid\(opts\.cust\)\) return null;/);
    expect(server).toMatch(/mapped\.plan !== "pro"/);
    expect(server).toMatch(/retentionTimeTakenOnAccount\(opts\.cust\)/);
    expect(server).toMatch(/ledgerHas\("email_retention", opts\.email\)/);
  });

  it("the Free gift and the stretch exclude each other on the account", () => {
    expect(retention).toMatch(/grant: plan === "free" && !rec\.grantedAt && !rec\.trialExtendedAt/);
    expect(retention).toMatch(/extend: individualPro && \(!!opts\.extension \|\| opts\.extendOk === true\) && !rec\.grantedAt && !rec\.trialExtendedAt/);
  });

  it("the delete flow applies it through the same route Billing uses", () => {
    const block = retention.slice(retention.indexOf('if (action === "extend")'), retention.indexOf("// ── Go quiet"));
    expect(block).toMatch(/import\("@\/app\/api\/stripe\/subscription\/extend-trial\/route"\)/);
    expect(block).not.toMatch(/subscriptions\.update/);
    expect(block.indexOf("await extend()")).toBeLessThan(block.indexOf('savedBy: "extend"'));
    expect(block).toMatch(/await saved\("extend"\)/);
    expect(retention).toMatch(/\["survey", "grant", "discount", "downgrade", "quiet", "extend"\]/);
  });

  it("Billing offers it for any reason, and only for the caller's own Pro", () => {
    const bm = read("src/components/BillingManager.tsx");
    expect(bm).toMatch(/canOfferPro \|\| canOfferDiscount \|\| canOfferExtension \? "offer" : "confirming"/);
    expect(bm).toMatch(/fetch\("\/api\/stripe\/subscription\/extend-trial", \{ method: "POST" \}\)/);
    const sub = read("src/app/api/stripe/subscription/route.ts");
    expect(sub).toMatch(/base\.trialEnd && dbPlan === "pro" && !managingOrgBilling && !personalSubOnly/);
  });
});
