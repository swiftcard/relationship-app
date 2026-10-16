import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trialEndingSoonEmail, trialEndedEmail, trialChargeSoonEmail, paymentFailedEmail } from "@/lib/email-templates";

// ── Every email, right for the account it goes to (2026-09-23 review) ───────
// Owner: "For all plans and account types … make sure it works perfectly
// according to that account type. For example subusers should not be getting
// the receipt for the admin's payments in the office plan."

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const U = "https://swiftcard.me/settings/flows?billing=1";
const text = (e: { html: string; subject: string }) => `${e.subject} ${e.html}`;

describe("billing mail goes only to the account that pays", () => {
  const hook = code("src/app/api/stripe/webhook/route.ts");

  it("renewals, changes and failures are addressed by the Stripe CUSTOMER — the owner, never a teammate", () => {
    // Every billing email resolves its recipient from the paying customer.
    expect(hook.match(/\.eq\("stripe_customer_id", invoice\.customer as string\)/g)?.length).toBeGreaterThanOrEqual(1);
    expect(hook).toContain('.eq("stripe_customer_id", opts.customerId)');
    // Paid invoices: by customer, or (before checkout has stored the customer,
    // audit B-04) by the account that checkout tagged the subscription with —
    // never one already paying through a different customer.
    expect(hook).toContain("const profile = await invoiceOwnerProfile(admin, invoice);");
    expect(hook).toContain('.eq("stripe_customer_id", customerId).single();');
    expect(hook).toContain("if (byAccount.stripe_customer_id && byAccount.stripe_customer_id !== customerId) return null;");
    // And nothing iterates a team to send it billing mail.
    expect(hook).not.toMatch(/for \(const m of [^)]*\)[\s\S]{0,400}sendReceiptForUser/);
  });

  it("the plan named on a receipt or a failure is the one the INVOICE is for", () => {
    // A teammate's own Pro renewal said "Office · 1 seat" — their seat's plan.
    expect(hook).toContain("const renewalPlan = invoicePlanName(invoice, profile.plan as string | null);");
    expect(hook).toContain('seats: renewalPlan === "Office" ? line?.quantity ?? null : null,');
    expect(hook).toContain("invoicePlanName(opts.invoice, profile.plan as string | null)");
    expect(hook).toMatch(/situation,\n\s+invoice,\n\s+\}\);/);
  });
});

describe("a teammate's OWN Pro subscription", () => {
  it("failed payment: says their team access is unchanged, never 'moves to the Free plan'", () => {
    const grace = paymentFailedEmail({ firstName: "Mia", planName: "Pro", amount: "$4.99", manageUrl: U, situation: "grace", teamMember: true });
    expect(grace.subject).toContain("your team access is unchanged");
    expect(grace.html).toContain("Your team seat already includes everything in Pro");
    expect(grace.html).not.toContain("move to the Free plan");
    const ended = paymentFailedEmail({ firstName: "Mia", planName: "Pro", amount: "$4.99", manageUrl: U, situation: "trial_ended", teamMember: true });
    expect(ended.html).toContain("you're still on your team");
    expect(ended.html).not.toContain("back on Free");
    expect(code("src/app/api/stripe/webhook/route.ts")).toContain('teamMember: !!seat && !owns && planName === "Pro",');
  });

  it("trial ending: not 'What changes on Free' — the seat already covers Pro", () => {
    const e = trialChargeSoonEmail({ firstName: "Mia", planName: "Pro", chargeDate: "Oct 6, 2026", amountCents: 499, intervalWord: "monthly", manageUrl: U, teamMember: true });
    expect(e.html).toContain("your team seat already includes everything in Pro");
    expect(e.html).not.toContain("What changes on Free");
  });

  it("which trial it is comes from what they OWN, not from their seat's plan", () => {
    const t = code("src/lib/trial-notice.ts");
    expect(t).toContain('planName: owned ? "Office" : "Pro",');
    expect(t).toContain("teamMember: !owned && !!seat,");
    expect(t).not.toContain('planName: u.plan === "enterprise" ? "Office" : "Pro"');
  });
});

describe("an Office owner", () => {
  it("a granted Office ending is about Office and the team — no Pro, no Pro price", () => {
    const soon = trialEndingSoonEmail({ firstName: "Dana", daysLeft: 3, isTrial: false, office: true });
    expect(soon.subject).toBe("3 days left of your free Office access");
    expect(text(soon)).not.toMatch(/free month of Pro|upgrading to Pro|\$4\.99/);
    expect(soon.html).toContain("your teammates keep their first card");
    const ended = trialEndedEmail({ firstName: "Dana", isTrial: false, office: true });
    expect(ended.subject).toBe("Your free Office access has ended");
    expect(text(ended)).not.toMatch(/Pro has ended|Upgrade back to Pro/);
    const r = code("src/app/api/reminders/route.ts");
    expect(r).toContain("office: !!ownedOffice,");
    expect(r).toContain('office: u.plan === "enterprise",');
  });

  it("the team is described truthfully everywhere: saved, not 'everyone moves to Free'", () => {
    const office = trialChargeSoonEmail({ firstName: "Dana", planName: "Office", chargeDate: "Oct 6, 2026", manageUrl: U });
    expect(office.html).toContain("your team is saved for when you come back");
    const failed = paymentFailedEmail({ firstName: "Dana", planName: "Office", amount: "$19.95", manageUrl: U, situation: "trial_ended" });
    for (const e of [office, failed, trialEndingSoonEmail({ firstName: "Dana", daysLeft: 2, isTrial: false, office: true })]) {
      expect(e.html).not.toMatch(/moves to Free too|move to Free too|team dashboard closes/);
    }
  });

  it("never gets a promo code: they already have the top plan", () => {
    const s = code("src/app/api/admin/promo-codes/send/route.ts");
    expect(s).toContain('appliesTo === "pro" ? isPaidPlan(plan) : isOfficePlan(plan);');
    expect(s).toContain('const planWords = appliesTo === "office" ? "SwiftCard Office"');
  });
});

describe("Free and Pro keep what they had", () => {
  it("the Pro price is the real one, from plan.ts", () => {
    const soon = trialEndingSoonEmail({ firstName: "Sam", daysLeft: 1, isTrial: false });
    expect(soon.subject).toBe("1 day left of your free month of Pro");
    expect(soon.html).toContain("(just $4.99/mo)");
  });

  it("a failed Pro payment for an ordinary account still explains the 7-day window", () => {
    const e = paymentFailedEmail({ firstName: "Sam", planName: "Pro", amount: "$4.99", manageUrl: U, situation: "grace" });
    expect(e.subject).toBe("Action needed: your SwiftCard payment failed");
    expect(e.html).toContain("You have 7 days");
    expect(e.html).toContain("$4.99");
  });
});

describe("emails sent on a person's behalf", () => {
  it("the scanner email is signed with the card's name, not 'Someone'", () => {
    const s = code("src/app/api/scanner/send/route.ts");
    expect(s).toContain('.from("cards").select("name").eq("username", slug)');
    expect(s).toContain(".trim().split(/\\s+/)[0] || \"Someone\";");
  });
});
