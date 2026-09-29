import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Stripe from "stripe";

// ── The Pro trial: opt-in, card-backed, once per person ──────────────────────
//
// Owner, 2026-09-16: new accounts start on Free; the 14-day Pro trial is chosen
// at the plan step and takes a card. The work pinned here closes the holes in
// that path:
//   • a second trial from a new email, a new account, or the same card;
//   • a first charge that fails still getting a 7-day grace (21 free days);
//   • Pro ending in silence, with the oldest card kept for them;
//   • the delete flow handing an ex-trial user 30 more days;
//   • trial state invisible in billing until the card was charged.

// The ledger is backed by a table; stand it in with an in-memory set.
const ledger = new Set<string>();
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      let kind = "";
      let key = "";
      q.select = () => q;
      q.eq = (col: string, v: string) => {
        if (col === "kind") kind = v;
        if (col === "key_hash") key = v;
        return q;
      };
      q.maybeSingle = async () => ({ data: ledger.has(`${kind}|${key}`) ? { kind } : null, error: null });
      q.upsert = (row: { kind: string; key_hash: string }) => {
        const id = `${row.kind}|${row.key_hash}`;
        const fresh = !ledger.has(id);
        ledger.add(id);
        return { select: async () => ({ data: fresh ? [row] : [], error: null }) };
      };
      return q;
    },
  }),
}));

const { isProTrialEligible } = await import("@/lib/trial-eligibility");
const { ledgerAdd, ledgerHas, ledgerKey } = await import("@/lib/trial-ledger");
const billing = await import("@/lib/billing-state");
const { sanitizeCustomizationForPlan, PLAN_LIMITS, TRIAL_DAYS } = await import("@/lib/plan");
const { appleGrantPatch } = await import("@/lib/iap-entitlement");
const { offerStep, RETENTION_GRANT_DAYS, RETENTION_GRANT_DAYS_AFTER_TRIAL } = await import("@/lib/retention");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const noStripe = { subscriptions: { list: async () => { throw new Error("must not be called"); } } } as unknown as Stripe;

describe("one Pro trial per person", () => {
  it("an account that has had a trial is refused before Stripe is asked", async () => {
    expect(await isProTrialEligible(null, noStripe, { proTrialStartedAt: "2026-09-01T00:00:00Z" })).toBe(false);
  });

  it("an email that trialled on another (or a purged) account is refused", async () => {
    await ledgerAdd("email_trial", "Dana.Smith+work@gmail.com");
    // Same person, different spelling: Gmail dots and +tags collapse.
    expect(await isProTrialEligible(null, noStripe, { accountEmail: "danasmith@gmail.com" })).toBe(false);
  });

  it("a genuinely new person is still eligible with no network call", async () => {
    expect(await isProTrialEligible(null, noStripe, { proTrialStartedAt: null, accountEmail: "new@person.com" })).toBe(true);
  });

  it("the ledger holds hashes, never the email or card itself", () => {
    const k = ledgerKey("card", "fp_abc123");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain("abc123");
  });

  it("recording is idempotent — a replayed webhook is not a first use", async () => {
    expect(await ledgerAdd("card", "fp_replay")).toBe(true);
    expect(await ledgerAdd("card", "fp_replay")).toBe(false);
    expect(await ledgerHas("card", "fp_replay")).toBe(true);
  });

  it("the checkout API passes the trial history it enforces with", () => {
    const c = read("src/app/api/stripe/checkout/route.ts");
    expect(c).toMatch(/isProTrialEligible\([\s\S]*?trialHistoryFor\(user\.id, user\.email\)/);
  });

  it("the webhook ends the trial when the CARD has trialled before (promo codes exempt)", () => {
    const c = read("src/app/api/stripe/webhook/route.ts");
    expect(c).toContain('ledgerHas("card", paymentFingerprint)');
    expect(c).toContain('trial_end: "now"');
    expect(c).toContain("!redemptionForTrial");
    // Replays must not end a trial the same account legitimately started.
    expect(c).toContain("!alreadyStamped");
    expect(c).toContain("recordProTrialStarted(userId, trialAccountEmail)");
  });

  it("an Apple intro offer counts as the trial too", () => {
    // (the event's period_type reaches applyEvent as opts.periodType)
    expect(read("src/app/api/iap/revenuecat/route.ts")).toMatch(/periodType: event\.period_type/);
    expect(read("src/app/api/iap/revenuecat/route.ts")).toMatch(/periodType\?\.toUpperCase\(\) === "TRIAL"[\s\S]*recordProTrialStarted/);
    expect(read("src/app/api/iap/sync/route.ts")).toContain('backing?.period_type === "trial"');
  });

  it("account purge never touches the ledger", () => {
    expect(read("src/lib/account-purge.ts")).not.toContain("trial_ledger");
    const sql = read("supabase/pro-trial-safeguards.sql");
    expect(sql).toContain("create table if not exists public.trial_ledger");
    expect(sql).toMatch(/new\.pro_trial_started_at\s+is distinct from old\.pro_trial_started_at/);
    expect(sql).toMatch(/new\.free_live_card_id\s+is distinct from old\.free_live_card_id/);
  });
});

describe("a trial whose first charge fails gets no grace week", () => {
  it("only money actually taken counts as paid", () => {
    expect(billing.anyInvoiceActuallyPaid([{ amount_paid: 0 }])).toBe(false);
    expect(billing.anyInvoiceActuallyPaid([{ amount_paid: 0 }, { amount_paid: 499 }])).toBe(true);
  });

  it("the webhook cancels a never-paid subscription instead of arming the grace", () => {
    const c = read("src/app/api/stripe/webhook/route.ts");
    const failed = c.slice(c.indexOf('event.type === "invoice.payment_failed"'), c.indexOf('event.type === "customer.subscription.updated"'));
    expect(failed).toContain("anyInvoiceActuallyPaid(paid.data)");
    expect(failed).toContain("getStripe().subscriptions.cancel(invoiceSubId)");
    // Only the subscription this profile is on, and only when Stripe confirms.
    expect(failed).toContain("invoiceSubId === profile.stripe_subscription_id");
    expect(failed.indexOf("neverPaid = !anyInvoiceActuallyPaid")).toBeLessThan(failed.indexOf("if (neverPaid)"));
  });

  it("a successful paid invoice marks the account as a paying customer", () => {
    const c = read("src/app/api/stripe/webhook/route.ts");
    expect(c).toContain("rest[EVER_PAID_KEY] = true");
  });
});

describe("when Pro ends it is never silent", () => {
  it("names a trial and a paid plan differently, and promises nothing was deleted", () => {
    expect(billing.proEndedNotice(true).title).toBe("Your Pro trial has ended");
    expect(billing.proEndedNotice(false).title).toBe("Your Pro plan has ended");
    expect(billing.proEndedNotice(true).body).toContain("Nothing has been deleted");
  });

  it("Stripe cancellation, Apple expiry and grant expiry all open the choice", () => {
    const hook = read("src/app/api/stripe/webhook/route.ts");
    expect(hook).toContain("if (stripeDowngraded) cust[PRO_ENDED_PENDING_KEY] = true");
    expect(hook).toMatch(/type: "pro_ended"/);
    expect(read("src/app/api/iap/revenuecat/route.ts")).toContain("markProEnded(");
    expect(read("src/lib/referral-server.ts")).toContain("markProEnded(u.id as string, { wasTrial, notify: false })");
  });

  it("a paid plan — Stripe or Apple — closes the open choice", () => {
    expect(read("src/app/api/stripe/webhook/route.ts")).toContain("delete srcCust[PRO_ENDED_PENDING_KEY]");
    const patch = appleGrantPatch({ _proEndedChoicePending: true });
    expect(patch.customization._proEndedChoicePending).toBeUndefined();
    expect(patch.customization._planChosen).toBe("pro");
  });

  it("the grant-expiry downgrade cannot undo a purchase that landed first", () => {
    const c = read("src/lib/referral-server.ts");
    expect(c).toMatch(/update\(\{ plan: "free", plan_expires_at: null, customization: nextCust \}\)\s*\.eq\("id", u\.id\)\s*\.is\("stripe_subscription_id", null\)/);
  });
});

describe("continuing on Free converts the design and deletes no content", () => {
  const cust = {
    accentColor: "#123456",
    links: Array.from({ length: PLAN_LIMITS.FREE_MAX_LINKS + 3 }, (_, i) => ({ label: `L${i}`, url: `https://x.test/${i}` })),
  };

  it("keepLinks keeps every Swift Link while the design still converts", () => {
    const out = sanitizeCustomizationForPlan(cust, false, "classic-pro", { keepLinks: true });
    expect((out.links as unknown[]).length).toBe(cust.links.length);
  });

  it("the new-account Free choice is unchanged (links capped as before)", () => {
    const out = sanitizeCustomizationForPlan(cust, false, "classic-pro");
    expect((out.links as unknown[]).length).toBe(PLAN_LIMITS.FREE_MAX_LINKS);
  });

  it("choose-plan keeps links only when Pro ENDED, and saves the chosen live card after an ownership check", () => {
    const c = read("src/app/api/account/choose-plan/route.ts");
    expect(c).toContain("{ keepLinks: proEnded }");
    expect(c).toMatch(/\.eq\("id", liveCardId\)\s*\.eq\("user_id", user\.id\)/);
    expect(c).toContain("delete next[PRO_ENDED_PENDING_KEY]");
  });
});

describe("trial state is visible before the card is charged", () => {
  it("the web line names the charge; the app line never shows a price", () => {
    const end = new Date(Date.now() + 3 * 86_400_000 - 60_000).toISOString();
    const web = billing.trialStatusLine({ trialEndsAt: end, amountCents: 499, native: false });
    const app = billing.trialStatusLine({ trialEndsAt: end, amountCents: 499, native: true });
    expect(web).toContain("3 days left");
    expect(web).toContain("$4.99");
    expect(app).not.toContain("$");
  });

  it("only a live trial has a trial end", () => {
    expect(billing.stripeTrialEndIso({ status: "trialing", trial_end: 1_800_000_000 })).toBe(new Date(1_800_000_000_000).toISOString());
    expect(billing.stripeTrialEndIso({ status: "active", trial_end: 1_800_000_000 })).toBeNull();
  });

});

describe("the delete flow after a trial gives the rest of 30 days, once", () => {
  it("16 days after a 14-day trial", () => {
    expect(RETENTION_GRANT_DAYS_AFTER_TRIAL).toBe(RETENTION_GRANT_DAYS - TRIAL_DAYS);
    const copy = offerStep("free", { grant: true, grantDays: RETENTION_GRANT_DAYS_AFTER_TRIAL, discount: false, downgrade: false }, false);
    expect(copy?.title).toContain(`${RETENTION_GRANT_DAYS_AFTER_TRIAL} days`);
    expect(copy?.accept).toContain(`${RETENTION_GRANT_DAYS_AFTER_TRIAL} days`);
  });

  it("everyone who never trialled still gets 30", () => {
    const copy = offerStep("free", { grant: true, discount: false, downgrade: false }, false);
    expect(copy?.title).toContain(`${RETENTION_GRANT_DAYS} days`);
  });

  it("the grant is once per person via the purge-proof ledger, and no discount mid-trial", () => {
    const c = read("src/app/api/account/retention/route.ts");
    expect(c).toContain("!opts.grantLedgerUsed");
    expect(c).toContain('ledgerAdd("email_retention", user.email)');
    expect(c).toContain("!opts.trialing");
    expect(c).toContain("elig.grantDays ?? RETENTION_GRANT_DAYS");
  });
});

describe("every new account sees the plan step once", () => {
  it("the dashboard sends a NEW, undecided, non-team account with a card to /welcome", () => {
    const c = read("src/app/dashboard/page.tsx");
    const gate = c.slice(c.indexOf("The plan step, once"), c.indexOf('redirect("/welcome")') + 30);
    for (const cond of ["hasCards", "!isPro", "!profile.office_id", "!pendingInvite", "!proEndedPending", "!profileCust[PLAN_CHOSEN_KEY]", "profile.created_at >= PLAN_STEP_REQUIRED_SINCE"]) {
      expect(gate, `missing ${cond}`).toContain(cond);
    }
  });

  it("existing accounts are never redirected (cutoff is after the rule shipped)", () => {
    expect(billing.PLAN_STEP_REQUIRED_SINCE >= "2026-09-16").toBe(true);
  });

  it("choosing Free in the wizard gate records the choice, so it is not asked again", () => {
    expect(read("src/app/cards/new/NewCardWizard.tsx")).toContain('showAuthedFirstCardGate ? { chosenPlan: "free" }');
    expect(read("src/app/api/cards/route.ts")).toMatch(/if \(!paid && chosenPlan === "free"\)[\s\S]*?\[PLAN_CHOSEN_KEY\]: "free"/);
  });

  it("checkout never promises a trial the account is not eligible for", () => {
    expect(read("src/app/checkout/page.tsx")).toContain("<CheckoutClient trialEligible={trialEligible} ");
    expect(read("src/app/checkout/CheckoutClient.tsx")).toContain('params.get("trial") !== "0" && trialEligible');
  });
});

describe("the Pro-ended panel follows the App Store rules", () => {
  const panel = read("src/components/ProEndedPanel.tsx");
  it("never shows a price, and keeps Pro through StoreKit in the app", () => {
    expect(panel).not.toMatch(/\$\d/);
    expect(panel).toMatch(/native \? \(\s*<IapSubscribeButton/);
    // No trial promise on the in-app button: whoever sees this has had Pro.
    expect(panel).toContain('sublabel=""');
  });
});

describe("QA seed accounts are never sent to the plan step", () => {
  // The dashboard sends a NEW account with a card and no recorded plan to
  // /welcome (PLAN_STEP_REQUIRED_SINCE). Every harness that seeds a throwaway
  // account with a card must record a plan, or from that date on every nightly
  // run lands on /welcome and reports the whole product as broken.
  for (const f of ["qa-sweep", "qa-flows", "qa-office-shell", "qa-office-links-brand", "qa-a11y", "qa-mac", "qa-prod-probe", "native-flows"]) {
    it(`${f} seeds a plan choice`, () => {
      expect(read(`scripts/${f}.mjs`)).toContain('_planChosen: "qa-seeded"');
    });
  }
});

// ── One free Pro period per person: the referral month counts (2026-09-17) ──
describe("a friend's referral month and the 14-day trial rule each other out", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("starting the referral month is recorded exactly like a trial", () => {
    const r = src("src/lib/referral-server.ts");
    const start = r.slice(r.indexOf("export async function startReferralGift"));
    expect(start).toMatch(/recordProTrialStarted\(userId, accountEmail\)/);
  });
  it("the referral month is refused to anyone who already had a trial", () => {
    const r = src("src/lib/referral-server.ts");
    const pending = r.slice(r.indexOf("export async function referralGiftPending"), r.indexOf("export async function startReferralGift"));
    expect(pending).toContain("return isProTrialEligible(null, undefined, { ...history, referralGiftOffered: false });");
    // …and while the month is on offer, no 14-day trial is offered or granted beside it.
    expect(src("src/lib/trial-eligibility.ts")).toContain("if (history?.referralGiftOffered) return false;");
  });
  it("the iOS paywall applies the ACCOUNT's history, not only the Apple ID's", () => {
    const iap = src("src/lib/iap.ts");
    expect(iap).toContain("/api/iap/trial-eligible");
    expect(iap).toContain("if (!(await accountTrialEligible())) for (const p of out) p.introPriceString = null;");
    expect(iap).toContain("all[NO_TRIAL_OFFERING]");
    expect(src("src/app/api/iap/trial-eligible/route.ts")).toMatch(/isProTrialEligible\(/);
  });
});
