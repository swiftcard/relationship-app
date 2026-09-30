import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FREE_REASONS,
  PRO_REASONS,
  RETENTION_DISCOUNT_MONTHS,
  RETENTION_DISCOUNT_PERCENT,
  RETENTION_GRANT_DAYS,
  giftEndLabel,
  keepStep,
  lossLines,
  offerStep,
  progressLabel,
  reasonById,
  reasonsFor,
  stepsFor,
  type AccountFacts,
  type Eligibility,
} from "@/lib/retention";

// ── Deleting an account is a conversation, not a switch ──────────────────────
//
// Owner order 2026-09-04: it was one question and a typed DELETE. It is now six
// steps — two questions, two offers, the real cost, then the confirmation — and
// Free and Pro walk different paths with different offers.
//
// Two things must never regress, and they pull against each other:
//   • the sequence must actually make a case for staying (the owner's ask), and
//   • deletion must stay reachable and completable (Apple 5.1.1(v)), with no
//     price or purchase anywhere inside the shell (3.1.1).

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const NONE: Eligibility = { grant: false, discount: false, downgrade: false };
const ALL: Eligibility = { grant: true, discount: true, downgrade: true };
const facts = (over: Partial<AccountFacts> = {}): AccountFacts => ({
  contacts: 0, views: 0, cards: 0, cardUrl: null, since: null, isOfficeOwner: false, ...over,
});

describe("the two plans are asked different questions", () => {
  it("neither list is a copy of the other", () => {
    const free = FREE_REASONS.map((r) => r.id);
    const pro = PRO_REASONS.map((r) => r.id);
    expect(free).not.toEqual(pro);
    // The ones that only make sense for someone paying us.
    expect(pro).toContain("too-expensive");
    expect(pro).toContain("one-off");
    expect(free).not.toContain("too-expensive");
    // And the one that only makes sense for someone who never did.
    expect(free).toContain("testing");
    expect(pro).not.toContain("testing");
  });

  it("every reason earns its own follow-up question", () => {
    for (const list of [FREE_REASONS, PRO_REASONS]) {
      const followUps = new Set(list.map((r) => r.followUp));
      expect(followUps.size, "no two reasons share a follow-up").toBe(list.length);
      for (const r of list) {
        expect(r.followUp.trim().length).toBeGreaterThan(10);
        expect(r.placeholder.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("a reason resolves back to its own plan's copy", () => {
    expect(reasonById("pro", "too-expensive")?.followUp).toMatch(/worth it/i);
    expect(reasonById("free", "too-expensive")).toBeNull();
    expect(reasonsFor("free")).toBe(FREE_REASONS);
    expect(reasonsFor("pro")).toBe(PRO_REASONS);
  });
});

describe("the offers are real, plan-specific, and different from each other", () => {
  it("Free is offered free Pro time; Pro is offered money off", () => {
    const free = offerStep("free", ALL, false)!;
    const pro = offerStep("pro", ALL, false)!;
    expect(free.action).toBe("grant");
    expect(free.title).toContain(String(RETENTION_GRANT_DAYS));
    expect(pro.action).toBe("discount");
    expect(pro.title).toContain(String(RETENTION_DISCOUNT_PERCENT));
    expect(pro.title).toContain(String(RETENTION_DISCOUNT_MONTHS));
    expect(free.title).not.toBe(pro.title);
    expect(free.body).not.toBe(pro.body);
  });

  it("the second save is different in kind from the first", () => {
    // Step 3 costs us money; step 4 must not be the same offer reworded.
    expect(keepStep("free", ALL, null).action).toBe("quiet");
    expect(keepStep("pro", ALL, "stripe").action).toBe("downgrade");
    expect(keepStep("free", ALL, null).title).not.toBe(offerStep("free", ALL, false)!.title);
  });

  it("an offer we cannot honour is never shown", () => {
    expect(offerStep("free", NONE, false)).toBeNull();
    expect(offerStep("pro", NONE, false)).toBeNull();
    // Apple bills Apple: there is no discount for us to apply.
    expect(offerStep("pro", { ...ALL, discount: false }, false)).toBeNull();
    // And with no cancellable subscription, "switch to Free" loses its button
    // rather than offering an action that would 409.
    const k = keepStep("pro", { ...ALL, downgrade: false }, "stripe");
    expect(k.accept).toBeNull();
    expect(k.action).toBeNull();
  });

  it("the promotion card carries what's in it, and the Pro one names monthly", () => {
    const free = offerStep("free", ALL, false)!;
    expect(free.badge).toBeTruthy();
    expect(free.bullets?.length).toBe(4);
    expect(free.accept).toContain(String(RETENTION_GRANT_DAYS));
    expect(free.decline).toMatch(/continue to delete/i);
    // The server may shorten the gift after a trial — the card follows it.
    const after = offerStep("free", { ...ALL, grantDays: 16 }, false)!;
    expect(after.title).toContain("16 days");
    expect(after.days).toBe(16);
    const pro = offerStep("pro", ALL, false)!;
    expect(pro.priceLine).toMatch(/\/month/);
    expect(pro.body).toMatch(/monthly invoices/);
  });

  it("free Pro with nothing billing it is told it simply ends — no subscription talk", () => {
    const k = keepStep("pro", NONE, "grant", "2026-10-30T12:00:00Z");
    expect(k.title).toMatch(/ends on its own/i);
    expect(k.body).toMatch(/October 30/);
    expect(k.body).toMatch(/nothing is charged/i);
    expect(k.body).not.toMatch(/subscription/i);
    expect(k.action).toBeNull();
    // Unknown date still reads as a sentence.
    expect(keepStep("pro", NONE, "grant", null).body).toMatch(/^When it ends/);
  });

  it("the gift's end date label is the day the days run out", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(giftEndLabel(30, now)).toBe("Oct 30");
    expect(giftEndLabel(16, now)).toBe("Oct 16");
  });

  it("an Apple subscriber is told deleting does not stop their renewal", () => {
    const k = keepStep("pro", NONE, "apple");
    expect(k.body).toMatch(/auto-renew/i);
    expect(k.body).toMatch(/does not manage the subscription/i);
    expect(k.action).toBeNull();
  });
});

describe("Apple 3.1.1 — no selling inside the shell", () => {
  it("the native offer never quotes a price", () => {
    const n = offerStep("free", ALL, true)!;
    const nativeCopy = [n.badge, n.title, n.body, ...(n.bullets ?? []), n.priceLine ?? "", n.fineprint, n.accept, n.decline].join(" ");
    expect(nativeCopy).not.toMatch(/\$/);
    expect(n.priceLine).toBeNull();
    // The web one does, because that is the whole point of the offer there.
    expect(offerStep("free", ALL, false)!.priceLine).toMatch(/\$\d+\.\d{2}\/month/);
  });

  it("a gift is still allowed on native — the days are the same", () => {
    const native = offerStep("free", ALL, true)!;
    expect(native.action).toBe("grant");
    expect(native.body).toContain(String(RETENTION_GRANT_DAYS));
    expect(native.fineprint).toMatch(/no card/i);
    expect(native.days).toBe(RETENTION_GRANT_DAYS);
  });
});

describe("Apple 5.1.1 — deletion is never trapped", () => {
  it("every step has a way onward, and the last one is the confirmation", () => {
    for (const plan of ["free", "pro"] as const) {
      for (const elig of [NONE, ALL]) {
        for (const native of [false, true]) {
          const steps = stepsFor(plan, elig, native);
          expect(steps[0]).toBe("why");
          expect(steps[steps.length - 1]).toBe("confirm");
          expect(steps).toContain("loss");
          expect(new Set(steps).size).toBe(steps.length);
        }
      }
    }
  });

  it("the sequence is six steps when there is something to offer, and never longer", () => {
    expect(stepsFor("free", ALL, false)).toHaveLength(6);
    expect(stepsFor("pro", ALL, false)).toHaveLength(6);
    // Nothing to offer → the offer step is dropped rather than shown empty.
    expect(stepsFor("free", NONE, false)).toHaveLength(5);
  });

  it("declining an offer is a button, not a hidden link", () => {
    for (const copy of [offerStep("free", ALL, false)!, offerStep("pro", ALL, false)!, keepStep("free", ALL, null), keepStep("pro", ALL, "stripe")]) {
      expect(copy.decline.trim().length).toBeGreaterThan(0);
    }
  });

  it("the promotion is the step immediately before the typed DELETE (owner, 2026-09-30)", () => {
    for (const plan of ["free", "pro"] as const) {
      const steps = stepsFor(plan, ALL, false);
      expect(steps).toEqual(["why", "detail", "keep", "loss", "offer", "confirm"]);
    }
    // Free on native still gets the gift (a gift is not a sale)…
    expect(stepsFor("free", ALL, true)).toEqual(["why", "detail", "keep", "loss", "offer", "confirm"]);
    // …Pro on native does not get the discount, and nobody gets an empty step.
    expect(stepsFor("pro", ALL, true)).toEqual(["why", "detail", "keep", "loss", "confirm"]);
    expect(stepsFor("free", NONE, false)).toEqual(["why", "detail", "keep", "loss", "confirm"]);
  });

  it("the progress label tells you how much is left", () => {
    const steps = stepsFor("pro", ALL, false);
    expect(progressLabel(steps, "why")).toBe("Step 1 of 6");
    expect(progressLabel(steps, "confirm")).toBe("Step 6 of 6");
  });
});

describe("the cost of deleting is stated in the account's own numbers", () => {
  it("nothing is claimed that the account does not have", () => {
    const empty = lossLines("free", facts());
    expect(empty.some((l) => /contact/.test(l))).toBe(false);
    expect(empty.some((l) => /view/.test(l))).toBe(false);
    // The one thing that is always true.
    expect(empty.some((l) => /can't be used to sign up again/.test(l))).toBe(true);
  });

  it("real numbers and the real link are named", () => {
    const lines = lossLines("pro", facts({ contacts: 1, views: 42, cards: 1, cardUrl: "swiftcard.me/dana-acme" }));
    expect(lines.some((l) => l.startsWith("1 contact —"))).toBe(true);
    expect(lines.some((l) => l.includes("42 recorded card views"))).toBe(true);
    expect(lines.some((l) => l.includes("swiftcard.me/dana-acme"))).toBe(true);
  });

  it("a Free account is not told to download contacts it cannot export", () => {
    // CSV export is Pro-only; the promise would 403.
    expect(lossLines("free", facts({ contacts: 3 })).join(" ")).not.toMatch(/download/i);
    expect(lossLines("pro", facts({ contacts: 3 })).join(" ")).toMatch(/Download them first/);
  });

  it("Pro is warned about the automations, and an office owner about the team", () => {
    expect(lossLines("pro", facts()).join(" ")).toMatch(/automations stop/);
    expect(lossLines("free", facts()).join(" ")).not.toMatch(/automations stop/);
    expect(lossLines("pro", facts({ isOfficeOwner: true })).join(" ")).toMatch(/team's subscription is cancelled/);
  });
});

describe("the server is what decides eligibility", () => {
  const api = read("src/app/api/account/retention/route.ts");

  it("each offer can only ever be taken once per account", () => {
    expect(api).toMatch(/!rec\.grantedAt/);
    expect(api).toMatch(/!rec\.discountedAt/);
  });

  it("the free month is written with its own record in one update", () => {
    // Two writes could hand out Pro without the flag that stops it repeating.
    const block = api.slice(api.indexOf('if (action === "grant")'), api.indexOf('if (action === "discount")'));
    expect(block.match(/\.update\(/g)).toHaveLength(1);
    expect(block).toMatch(/plan_expires_at: expires/);
    expect(block).toMatch(/grantedAt/);
  });

  it("the discount is the SAME offer the billing flow makes, applied by the same route", () => {
    // Two implementations would mean two coupons and two flags — and Stripe
    // replaces the discount array, so the second would overwrite the first
    // while the customer believed they had taken two offers.
    const block = api.slice(api.indexOf('if (action === "discount")'), api.indexOf('if (action === "downgrade")'));
    expect(block).toMatch(/@\/app\/api\/stripe\/subscription\/discount\/route/);
    expect(block).not.toMatch(/coupons\.create/);
    // Recorded only after that route returned ok.
    expect(block.indexOf("await discount()")).toBeLessThan(block.indexOf("discountedAt"));
  });

  it("taking the offer in Billing closes it in the delete flow too", () => {
    expect(api).toMatch(/retentionUsed !== true/);
    expect(api).toMatch(/retentionUsed: cust\._retentionUsed/);
  });

  it("an Apple-billed account is never offered a Stripe discount", () => {
    expect(api).toMatch(/isApplePaid/);
    expect(api).toMatch(/const individualPro = plan === "pro" && rawPlan === "pro" && source === "stripe" && !!subId/);
    expect(api).toMatch(/discount: individualPro/);
  });

  it("a seat-billed team subscription is not discounted or self-cancelled here", () => {
    // enterprise is a paid plan, so `plan` is "pro" — but its price is derived
    // from the seat count, and /account/downgrade refuses it outright.
    expect(api).toMatch(/rawPlan === "pro"/);
    expect(api).toMatch(/downgrade: individualPro/);
  });

  it("cancelling Pro reuses the downgrade route rather than reimplementing it", () => {
    // That route cancels in Stripe FIRST and refuses to flip the plan if the
    // cancel fails — an account must never read as Free while still billed.
    expect(api).toMatch(/@\/app\/api\/account\/downgrade\/route/);
  });

  it("going quiet never silences a paying customer's receipts", () => {
    expect(api).toMatch(/plan === "free" \? \{ receipt_emails: false \}/);
  });

  it("the answers are stored even when the account is saved", () => {
    expect(api).toMatch(/action === "survey"/);
    expect(api).toMatch(/surveys/);
  });
});

describe("each promotion is once per PERSON, and billing honours it (owner, 2026-09-30)", () => {
  const api = read("src/app/api/account/retention/route.ts");
  const discount = read("src/app/api/stripe/subscription/discount/route.ts");
  const checkout = read("src/app/api/stripe/checkout/route.ts");
  const webhook = read("src/app/api/stripe/webhook/route.ts");

  it("the gift is recorded as this person's free Pro in the same write", () => {
    const block = api.slice(api.indexOf('if (action === "grant")'), api.indexOf('if (action === "discount")'));
    expect(block.match(/\.update\(/g)).toHaveLength(1);
    expect(block).toMatch(/pro_trial_started_at: now/);
    // Purge-proof: no second gift, and no Stripe/Apple trial on a new account.
    expect(block).toMatch(/ledgerAdd\("email_retention", user\.email\)/);
    expect(block).toMatch(/ledgerAdd\("email_trial", user\.email\)/);
  });

  it("the 50% offer is only shown where the coupon works, for someone who never had it", () => {
    expect(api).toMatch(/opts\.discountOk === true/);
    expect(api).toMatch(/discountRefusalFor\(sub\)/);
    expect(api).toMatch(/retentionDiscountTakenBy\(/);
  });

  it("the discount route refuses what it can't honour and records the person", () => {
    expect(discount).toMatch(/retentionDiscountTakenBy\(accountEmail, fingerprint\)/);
    expect(discount).toMatch(/discountRefusalFor\(sub\)/);
    // Checked BEFORE the coupon goes on, recorded AFTER Stripe accepted it.
    expect(discount.indexOf("discountRefusalFor(sub)")).toBeLessThan(discount.indexOf("subscriptions.update"));
    expect(discount.indexOf("subscriptions.update")).toBeLessThan(discount.indexOf("recordRetentionDiscount("));
  });

  it("subscribing during the gift bills from the day it ends, with no trial on top", () => {
    expect(checkout).toMatch(/retentionGiftEndsAt\(/);
    expect(checkout).toMatch(/subscription_data: \{ trial_end: bridgeTrialEnd \}/);
    expect(checkout).toMatch(/grant_bridge: "1"/);
    // Part of the idempotency key, like every other session parameter.
    expect(checkout).toMatch(/bridgeTrialEnd \?\? 0/);
    // The repeat-card rule must not end the rest of a gift.
    expect(webhook).toMatch(/const giftBridge = session\.metadata\?\.grant_bridge === "1"/);
    expect(webhook).toMatch(/!redemptionForTrial && !giftBridge/);
  });

  it("the billing screen only shows the 50% offer when the route would apply it", () => {
    const bm = read("src/components/BillingManager.tsx");
    expect(bm).toMatch(/sub\.discountOfferable === true/);
    expect(read("src/app/api/stripe/subscription/route.ts")).toMatch(/discountRefusalFor\(sub\) === null/);
  });
});

describe("the dialog wires the sequence up", () => {
  it("doesn't start counting steps until it knows whether there's a promotion", () => {
    const ui = read("src/components/ManageAccount.tsx");
    expect(ui).toMatch(/const \[ready, setReady\] = useState\(false\)/);
    expect(ui).toMatch(/disabled=\{!ready\}/);
    expect(ui).toMatch(/\{ready \? stepLabel : ""\}/);
    // Bounded — a hung request can never hold deletion hostage.
    expect(ui).toMatch(/ctrl\.abort\(\), 6000/);
  });

  const ui = read("src/components/ManageAccount.tsx");

  it("renders every step from the shared script", () => {
    for (const s of ["why", "detail", "offer", "keep", "loss", "confirm"]) {
      expect(ui).toContain(`step === "${s}"`);
    }
    expect(ui).toMatch(/from "@\/lib\/retention"/);
  });

  it("still takes a typed DELETE and a password re-check", () => {
    expect(ui).toMatch(/confirmText\.trim\(\)\.toUpperCase\(\) !== "DELETE"/);
    expect(ui).toMatch(/signInWithPassword/);
  });

  it("accepting an offer ends the flow instead of deleting anyway", () => {
    expect(ui).toMatch(/setSaved\(action\)/);
    expect(ui).toMatch(/\{saved \?/);
  });

  it("the export button is Pro-only and native-safe", () => {
    expect(ui).toMatch(/retPlan === "pro" && facts && facts\.contacts > 0/);
    expect(ui).toMatch(/<DownloadLink/);
  });
});

describe("the owner hears about it, and can read the answers", () => {
  const alert = () => readFileSync(join(process.cwd(), "src/lib/retention-alert.ts"), "utf8");

  it("alerts on every save and on the deletion — but not on the survey step", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/account/retention/route.ts"), "utf8");
    for (const outcome of ["grant", "discount", "downgrade", "quiet"]) {
      expect(route, `${outcome} does not alert`).toMatch(new RegExp(`await saved\\("${outcome}"\\)`));
    }
    // Someone who picks a reason and then takes the free month never left.
    const surveyBlock = route.slice(route.indexOf('if (action === "survey")'), route.indexOf('// ── 30 days of Pro'));
    expect(surveyBlock).not.toMatch(/saved\(|alertRetention/);
  });

  it("alerts when the account is actually deleted", () => {
    const del = readFileSync(join(process.cwd(), "src/app/api/account/delete/route.ts"), "utf8");
    expect(del).toMatch(/alertRetention\(/);
    expect(del).toMatch(/outcome: "deleted"/);
  });

  it("never lets a failed alert block a save or a deletion", () => {
    // App Review 5.1.1(v): deletion must complete.
    expect(alert()).toMatch(/catch \{[\s\S]{0,120}never block/);
    const del = readFileSync(join(process.cwd(), "src/app/api/account/delete/route.ts"), "utf8");
    const at = del.indexOf("alertRetention");
    expect(del.slice(at, at + 500)).toMatch(/catch/);
  });

  it("carries the reason and comment, not just the outcome", () => {
    expect(alert()).toMatch(/reason\?: string \| null/);
    expect(alert()).toMatch(/comment\?: string \| null/);
  });

  it("sends internal mail FROM support@ TO hello@ — never hello@ to itself", () => {
    const a = alert();
    expect(a).toMatch(/senderAddress\("support"/);
    expect(a).toMatch(/to: \[INBOX_ADDRESS\]/);
    expect(a).toMatch(/text: htmlToText\(html\)/);
  });

  it("escapes the user's own words before they reach the owner's inbox", () => {
    const a = alert();
    // The comment is interpolated directly; the reason goes through row(),
    // which escapes its value. What must never appear is either of them
    // reaching the HTML raw.
    expect(a).toMatch(/escapeHtml\(opts\.comment\)/);
    expect(a).toMatch(/escapeHtml\(v\)/);
    expect(a, "raw comment in HTML").not.toMatch(/\$\{opts\.comment\}/);
    expect(a, "raw reason in HTML").not.toMatch(/\$\{opts\.reason\}/);
  });

  it("computes the save rate over DECIDED attempts, not mid-flow ones", () => {
    const a = alert();
    expect(a).toMatch(/const decided = saved \+ deleted/);
    expect(a).toMatch(/decided \? Math\.round\(\(saved \/ decided\) \* 100\) : 0/);
  });

  it("is reachable in the admin nav", () => {
    const nav = readFileSync(join(process.cwd(), "src/app/admin/AdminNav.tsx"), "utf8");
    expect(nav).toMatch(/href: "\/admin\/retention"/);
  });
});
