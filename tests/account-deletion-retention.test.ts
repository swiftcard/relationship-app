import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FREE_REASONS,
  PRO_REASONS,
  RETENTION_DISCOUNT_MONTHS,
  RETENTION_DISCOUNT_PERCENT,
  RETENTION_GRANT_DAYS,
  dayLabel,
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
import { eligibilityOf, planOf, sourceOf, type RetentionRecord } from "@/lib/retention-eligibility";
import { reopenPatch } from "@/lib/account-reopen";

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
    expect(giftEndLabel(30, now)).toBe("October 30");
    expect(giftEndLabel(16, now)).toBe("October 16");
    // One format for every date in the flow, and nothing for a non-date.
    expect(dayLabel("2026-10-30T12:00:00Z")).toBe("October 30");
    expect(dayLabel("not a date")).toBe("");
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

// The route gathers the facts; lib/retention-eligibility decides. Both are the
// server, so the source pins below read them together.
const SERVER = () => read("src/app/api/account/retention/route.ts") + "\n" + read("src/lib/retention-eligibility.ts");

describe("the server is what decides eligibility", () => {
  const api = SERVER();

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

  it("going quiet sets BOTH opt-out flags, and never touches receipts", () => {
    // email-preference-center.sql: every write path sets both. And a Free
    // account that went quiet and later subscribed must still get receipts.
    const block = api.slice(api.indexOf("// ── Go quiet"), api.indexOf('await saved("quiet")'));
    const write = block.slice(block.indexOf(".upsert("), block.indexOf("{ onConflict"));
    expect(write).toMatch(/marketing_emails: false, marketing_opt_out: true/);
    expect(write).not.toMatch(/receipt_emails/);
  });

  it("the answers are stored even when the account is saved", () => {
    expect(api).toMatch(/action === "survey"/);
    expect(api).toMatch(/surveys/);
  });
});

describe("each promotion is once per PERSON, and billing honours it (owner, 2026-09-30)", () => {
  const api = SERVER();
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
    expect(checkout).toMatch(/bridgeTrialEnd \? \{ trial_end: bridgeTrialEnd \} : trialDays \?/);
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
    // The password check and the offers load side by side, not one after the other.
    expect(ui).toMatch(/await Promise\.all\(\[/);
    // A close-and-reopen can't receive the first opening's answer, and
    // nothing from the last opening is offered again.
    expect(ui).toMatch(/const seq = \+\+openSeq\.current/);
    expect(ui).toMatch(/setElig\(\{ grant: false, discount: false, downgrade: false \}\)/);
  });

  it("asks Stripe once per action, and only when it could change the answer", () => {
    const api = read("src/app/api/account/retention/route.ts");
    // GET: never for Free/Apple/Office/used/trialling, and in parallel.
    expect(api).toMatch(/const discountWorthChecking =/);
    expect(api).toMatch(/await Promise\.all\(\[\s*trialFactsFor/);
    // POST: the discount route makes the checks — no second Stripe call here.
    expect(api).toMatch(/discountOk: action === "discount" \? true : null/);
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

  // Retention is a tab of Company Analytics since 2026-10-27 (the owner asked
  // for it not to be a page of its own); the old address redirects there.
  it("is reachable from the admin nav: Company Analytics › Retention", () => {
    const nav = readFileSync(join(process.cwd(), "src/app/admin/AdminNav.tsx"), "utf8");
    expect(nav).toMatch(/href: "\/admin\/analytics", label: "Company Analytics"/);
    const tabs = readFileSync(join(process.cwd(), "src/app/admin/analytics/tabs.ts"), "utf8");
    expect(tabs).toMatch(/key: "retention"/);
    const old = readFileSync(join(process.cwd(), "src/app/admin/retention/page.tsx"), "utf8");
    expect(old).toContain('redirect("/admin/analytics?tab=retention")');
  });
});

// ── Every account type, end to end (review 2026-11-04) ──────────────────────
//
// What each kind of account is offered and told, decided by the SAME pure
// functions the server (lib/retention-eligibility) and the dialog
// (lib/retention + ManageAccount's keep context) use — on the web and inside
// the iPhone app. The owner asked for the whole flow to be checked for every
// account type; this table is that check, kept.
describe("every account type walks the flow it should, on web and in the app", () => {
  const DAY = 86_400_000;
  const NOW = Date.parse("2026-11-04T12:00:00Z");
  const OLD = new Date(NOW - 40 * DAY).toISOString();
  const NEW = new Date(NOW - 3 * DAY).toISOString();
  const TRIAL_START = NOW - 7 * DAY;
  const extension = {
    until: new Date(TRIAL_START + 30 * DAY).toISOString(),
    untilUnix: Math.floor((TRIAL_START + 30 * DAY) / 1000),
    currentEnd: new Date(TRIAL_START + 14 * DAY).toISOString(),
    extraDays: 16,
    chargeCents: 499,
    chargeInterval: "month" as const,
  };

  type Account = {
    rawPlan: string | null;
    cust?: Record<string, unknown>;
    subId?: string | null;
    planExpiresAt?: string | null;
    created?: string;
    hadTrial?: boolean;
    grantLedgerUsed?: boolean;
    discountLedgerUsed?: boolean;
    /** The live-subscription answer the GET would get from Stripe. */
    discountOk?: boolean | null;
    extension?: typeof extension | null;
    /** What Settings passes the dialog. */
    officeOwner?: boolean;
    billedBy?: "stripe" | "apple" | null;
  };

  function walk(a: Account, native: boolean) {
    const cust = a.cust ?? {};
    const plan = planOf(a.rawPlan);
    const source = sourceOf(a.rawPlan, cust, a.subId ?? null, a.planExpiresAt ?? null);
    const trialEndsAt = typeof cust._trialEndsAt === "string" ? (cust._trialEndsAt as string) : null;
    const e = eligibilityOf({
      plan,
      rawPlan: a.rawPlan,
      source,
      rec: (cust._retention as RetentionRecord | undefined) ?? {},
      planExpiresAt: a.planExpiresAt ?? null,
      subId: a.subId ?? null,
      retentionUsed: cust._retentionUsed,
      hadTrial: a.hadTrial,
      grantLedgerUsed: a.grantLedgerUsed,
      discountLedgerUsed: a.discountLedgerUsed,
      trialing: !!trialEndsAt,
      accountCreatedAt: a.created ?? OLD,
      discountOk: a.discountOk ?? null,
      extension: a.extension ?? null,
      trialEndsAt,
      nowMs: NOW,
    });
    // Exactly what ManageAccount hands keepStep once the server has answered.
    const keep = keepStep(plan, e, source, source === "grant" ? a.planExpiresAt ?? null : null, {
      officeOwner: !!a.officeOwner,
      unbilled: plan === "pro" && (a.billedBy ?? null) === null && source === null,
      native,
    });
    const offer = offerStep(plan, e, native);
    return { e, source, steps: stepsFor(plan, e, native).length, keep, offer };
  }

  type Expect = [steps: number, keepTitle: string, offerTitle: RegExp | null];
  const TYPES: { name: string; a: Account; web: Expect; app: Expect }[] = [
    { name: "Free, two weeks or older", a: { rawPlan: "free" },
      web: [6, "Or just make it go quiet", /^Try Pro free for 30 days/], app: [6, "Or just make it go quiet", /^Try Pro free for 30 days/] },
    { name: "Free, after a Pro trial", a: { rawPlan: "free", hadTrial: true },
      web: [6, "Or just make it go quiet", /^Try Pro free for 16 days/], app: [6, "Or just make it go quiet", /^Try Pro free for 16 days/] },
    { name: "Free, brand new (under 14 days)", a: { rawPlan: "free", created: NEW },
      web: [5, "Or just make it go quiet", null], app: [5, "Or just make it go quiet", null] },
    { name: "Pro, Stripe monthly, paying", a: { rawPlan: "pro", subId: "sub_1", discountOk: true, billedBy: "stripe", cust: { _planSource: "stripe" } },
      web: [6, "Switch to Free instead of deleting", /50% off/], app: [5, "Switch to Free instead of deleting", null] },
    { name: "Pro, Stripe yearly (the coupon can't apply)", a: { rawPlan: "pro", subId: "sub_1", discountOk: false, billedBy: "stripe" },
      web: [5, "Switch to Free instead of deleting", null], app: [5, "Switch to Free instead of deleting", null] },
    { name: "Pro, Stripe card trial", a: { rawPlan: "pro", subId: "sub_1", billedBy: "stripe", extension, cust: { _trialEndsAt: extension.currentEnd } },
      web: [6, "Cancel your trial instead of deleting", /^Keep your free trial going until/], app: [6, "Cancel your trial instead of deleting", /^Keep your free trial going until/] },
    { name: "Pro, billed by Apple", a: { rawPlan: "pro", billedBy: "apple", cust: { _planSource: "apple" } },
      web: [5, "You can stop paying without losing anything", null], app: [5, "You can stop paying without losing anything", null] },
    { name: "Free Pro time (gift or referral month)", a: { rawPlan: "pro", planExpiresAt: new Date(NOW + 10 * DAY).toISOString() },
      web: [5, "Your free Pro ends on its own", null], app: [5, "Your free Pro ends on its own", null] },
    { name: "Office owner, paying", a: { rawPlan: "enterprise", subId: "sub_team", discountOk: true, billedBy: "stripe", officeOwner: true },
      web: [5, "Cancel Office instead of deleting", null], app: [5, "Cancel Office instead of deleting", null] },
    { name: "Pro with nothing billing it (comped)", a: { rawPlan: "pro" },
      web: [5, "Nothing is being charged", null], app: [5, "Nothing is being charged", null] },
  ];

  for (const t of TYPES) {
    it(t.name, () => {
      const runs: [boolean, Expect][] = [[false, t.web], [true, t.app]];
      for (const [native, [steps, keepTitle, offerTitle]] of runs) {
        const r = walk(t.a, native);
        const where = `${t.name} (${native ? "app" : "web"})`;
        expect(r.steps, where).toBe(steps);
        expect(r.keep.title, where).toBe(keepTitle);
        if (offerTitle) expect(r.offer?.title, where).toMatch(offerTitle);
        else expect(r.offer, where).toBeNull();
        // Never a price or a billing pointer inside the app (3.1.1), and every
        // keep step has a way onward (5.1.1).
        if (native) {
          expect(JSON.stringify(r.offer ?? {}), where).not.toMatch(/\$/);
          expect(JSON.stringify(r.keep), where).not.toMatch(/\$|Plan and billing/);
        }
        expect(r.keep.decline, where).toBeTruthy();
      }
    });
  }

  it("Office and team plans are never discounted or self-cancelled from here", () => {
    const owner = walk({ rawPlan: "enterprise", subId: "sub_team", discountOk: true, billedBy: "stripe", officeOwner: true }, false).e;
    expect(owner.discount).toBe(false);
    expect(owner.downgrade).toBe(false);
    expect(owner.extend).toBe(false);
    // A team member's seat: nothing billed to them, nothing offered.
    const member = walk({ rawPlan: "enterprise" }, false);
    expect(member.source).toBeNull();
    expect(member.e).toMatchObject({ grant: false, discount: false, downgrade: false, extend: false });
  });

  it("team members never see the section; the delete API refuses them too", () => {
    const page = read("src/app/settings/flows/page.tsx");
    expect(page).toMatch(/\.\.\.\(isOfficeSubUser \? \[\] : \[\{\s*id: "advanced"/);
    expect(read("src/app/api/account/delete/route.ts")).toMatch(/officeSubUserBlockMessage\(user\.id/);
  });

  it("ONE promotion per person: whoever had 50% off is never offered the free month (owner, 2026-11-04)", () => {
    const free = (over: Partial<Account>) => walk({ rawPlan: "free", ...over }, false).e.grant;
    expect(free({})).toBe(true);
    // Took 50% here, then moved to Free and came back to Delete.
    expect(free({ cust: { _retention: { discountedAt: "2026-10-01T00:00:00Z" } } })).toBe(false);
    // Took it in Billing's cancel flow.
    expect(free({ cust: { _retentionUsed: true } })).toBe(false);
    // Took it on an older account under the same email.
    expect(free({ discountLedgerUsed: true })).toBe(false);
    // Someone who simply cancelled (no promotion taken) is still offered it.
    expect(free({ cust: { _retention: { savedBy: "downgrade" } } })).toBe(true);
  });

  it("the route asks the ledger about the 50% offer, and GET and POST decide through one function", () => {
    const route = read("src/app/api/account/retention/route.ts");
    expect(route).toMatch(/ledgerHas\("email_retention_discount", email\)/);
    expect(route).toMatch(/from "@\/lib\/retention-eligibility"/);
    expect(route.match(/eligibilityOf\(\{/g)).toHaveLength(2);
  });

  it("a failed look-up never tells a payer 'nothing is being charged'", () => {
    const ui = read("src/components/ManageAccount.tsx");
    expect(ui).toMatch(/unbilled: retPlan === "pro" && billedBy === null && facts !== null && source === null/);
  });
});

describe("the dialog's own words match the account (review 2026-11-04)", () => {
  const ui = read("src/components/ManageAccount.tsx");
  const page = read("src/app/settings/flows/page.tsx");

  it("inside the app, cancelling Pro never points at the Plan-and-billing section it doesn't have", () => {
    expect(ui).toMatch(/saved === "downgrade" && !elig\.trialEndsAt && !native && " Changed your mind\? Keep Subscription is in Settings → Plan and billing\."/);
    expect(ui).toMatch(/saved === "downgrade" && elig\.trialEndsAt && !native && " Changed your mind\?/);
    // Those two lines are the only places it is said.
    expect(ui.match(/Keep Subscription is in Settings → Plan and billing/g)).toHaveLength(2);
  });

  it("'Just want to stop paying?' is for people who pay, and names who stops it", () => {
    expect(ui).toMatch(/\{billedBy === "stripe" && !native && \(/);
    expect(ui).toMatch(/\{billedBy === "apple" && \(/);
    expect(ui).not.toMatch(/\{isPro && !native && \(/);
    // Settings derives it from the account: Apple, SwiftCard's Stripe, or nobody.
    expect(page).toMatch(/_planSource === "apple"\s*\?\s*"apple"\s*:\s*profile\.stripe_subscription_id\s*\?\s*"stripe"\s*:\s*null/);
    expect(page).toMatch(/billedBy=\{billedBy\}/);
  });
});

describe("reopening gives back what the account is still owed (review 2026-11-04)", () => {
  const DAY = 86_400_000;
  const NOW = Date.parse("2026-11-04T12:00:00Z");
  const deleted = (plan: string, extra: Record<string, unknown> = {}) => ({
    _deleted: true,
    _deletion: { reason: "x", comment: "", plan, at: new Date(NOW - 2 * DAY).toISOString() },
    _retention: { grantedAt: "2026-10-01T00:00:00Z" },
    ...extra,
  });

  it("an App Store subscriber Apple is still billing gets Pro back", () => {
    const r = reopenPatch({ customization: deleted("pro", { _planSource: "apple" }), planExpiresAt: null, hasSubscription: false, appleActive: true, nowMs: NOW });
    expect(r.restored).toBe("apple");
    expect(r.columns).toEqual({ plan: "pro", plan_expires_at: null });
    expect(r.customization._planSource).toBe("apple");
  });

  it("an Apple subscription that lapsed, or that RevenueCat can't confirm, stays on Free", () => {
    for (const appleActive of [false, null]) {
      const r = reopenPatch({ customization: deleted("pro", { _planSource: "apple" }), planExpiresAt: null, hasSubscription: false, appleActive, nowMs: NOW });
      expect(r.restored).toBeNull();
      expect(r.columns).toEqual({});
    }
  });

  it("free Pro days still left come back; days that ran out don't", () => {
    const left = reopenPatch({ customization: deleted("pro"), planExpiresAt: new Date(NOW + 9 * DAY).toISOString(), hasSubscription: false, appleActive: null, nowMs: NOW });
    expect(left.restored).toBe("grant");
    expect(left.columns).toEqual({ plan: "pro" });
    const gone = reopenPatch({ customization: deleted("pro"), planExpiresAt: new Date(NOW - DAY).toISOString(), hasSubscription: false, appleActive: null, nowMs: NOW });
    expect(gone.restored).toBeNull();
    expect(gone.columns).toEqual({});
  });

  it("a subscription whose cancellation failed is still being paid for, so the plan comes back", () => {
    const r = reopenPatch({ customization: deleted("pro", { _planSource: "stripe" }), planExpiresAt: null, hasSubscription: true, appleActive: null, nowMs: NOW });
    expect(r.restored).toBe("subscription");
    expect(r.columns).toEqual({ plan: "pro" });
  });

  it("a website subscription cancelled at deletion comes back on Free with nothing stale left", () => {
    const r = reopenPatch({
      customization: deleted("pro", { _planSource: "stripe", _trialEndsAt: "2026-11-10T00:00:00Z", _cancelAtPeriodEnd: true, _cancelAt: "2026-11-10T00:00:00Z", _cancelReason: "x" }),
      planExpiresAt: null, hasSubscription: false, appleActive: null, nowMs: NOW,
    });
    expect(r.restored).toBeNull();
    expect(r.columns).toEqual({});
    for (const k of ["_deleted", "_deletion", "_trialEndsAt", "_cancelAtPeriodEnd", "_cancelAt", "_cancelReason"]) expect(r.customization).not.toHaveProperty(k);
    // Like every Pro that ends: choose which card stays live.
    expect(r.customization._proEndedChoicePending).toBe(true);
  });

  it("a former Office owner comes back on Free, without Pro's panel", () => {
    const r = reopenPatch({ customization: deleted("enterprise", { _planSource: "stripe" }), planExpiresAt: null, hasSubscription: false, appleActive: null, nowMs: NOW });
    expect(r.columns).toEqual({});
    expect(r.customization).not.toHaveProperty("_proEndedChoicePending");
  });

  it("a Free account comes back exactly as it was, and its promotion record stays", () => {
    const r = reopenPatch({ customization: deleted("free"), planExpiresAt: null, hasSubscription: false, appleActive: null, nowMs: NOW });
    expect(r.columns).toEqual({});
    expect(r.customization).toEqual({ _retention: { grantedAt: "2026-10-01T00:00:00Z" } });
  });

  it("the route uses it, asks RevenueCat only for Apple, and writes only what changed", () => {
    const route = read("src/app/api/account/reopen/route.ts");
    expect(route).toMatch(/reopenPatch\(\{/);
    expect(route).toMatch(/isApplePaid\(customization\) && isPaidPlan\(deletedPlanOf\(customization\)\) \? await rcProActive\(user\.id\) : null/);
    expect(route).toMatch(/writeCustomizationChanges\(user\.id, customization, patch\.customization\)/);
    expect(route).not.toMatch(/update\(\{ customization: restored \}\)/);
  });
});

describe("no second, unguarded coupon route (review 2026-11-04)", () => {
  it("/api/account/retain is gone: nothing called it, and it skipped every once-per-person check", () => {
    expect(() => read("src/app/api/account/retain/route.ts")).toThrow();
  });
});

describe("the email switches agree with what is sent (review 2026-11-04)", () => {
  it("Settings writes both opt-out flags and shows 'off' when either is off", () => {
    const route = read("src/app/api/settings/email-preferences/route.ts");
    expect(route).toMatch(/marketing_emails: marketing,\s*marketing_opt_out: !marketing,/);
    const page = read("src/app/settings/flows/page.tsx");
    expect(page).toMatch(/initialMarketing=\{emailPrefs\?\.marketing_emails !== false && emailPrefs\?\.marketing_opt_out !== true\}/);
    expect(page).toMatch(/select\("marketing_emails, marketing_opt_out, receipt_emails"\)/);
  });
});
