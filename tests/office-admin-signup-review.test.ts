import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { receiptEmail, trialStartedEmail, paymentFailedEmail, trialChargeSoonEmail } from "@/lib/email-templates";

// ── Office admin: sign-up → checkout → setup → dashboard tour ────────────────
// Pins what the 2026-09-22 end-to-end review of the Office-admin journey found.
// Each block names the defect it exists to stop coming back.

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const U = "https://swiftcard.me/settings/flows?billing=1";

describe("after paying, a new Office owner lands on THEIR dashboard", () => {
  it("the /welcome setup step never routes Office into the admin console", () => {
    // Owner, 2026-09-22: never straight into /office/admin. checkout/success and
    // the wizard were fixed in c4302b96; this step still sent Office there.
    const w = code("src/components/WelcomePlan.tsx");
    expect(w).not.toMatch(/"\/office\/admin"/);
    expect(w).toMatch(/setupFor \? LANDING \+ "&upgraded=true"/);
    expect(w).not.toContain("Go to my Office dashboard");
  });

  it("the ?upgraded banner and its event name Office for an Office buyer", () => {
    const d = code("src/app/dashboard/page.tsx");
    expect(d).toMatch(/props=\{\{ plan: isEnterprise \? "office" : "pro" \}\}/);
    expect(d).toContain("Welcome to Office!");
  });
});

describe("leaving Stripe keeps the Office selection", () => {
  it("both cancel URLs carry plan, interval, seats and promo", () => {
    const r = code("src/app/api/stripe/checkout/route.ts");
    expect(r).toMatch(/const selection = `plan=\$\{planKey\}&interval=\$\{interval\}\$\{isOffice \? `&seats=\$\{quantity\}` : ""\}/);
    expect(r).toContain("`/welcome?${selection}&canceled=1`");
    expect(r).toContain("`/checkout?${selection}&canceled=1`");
    expect(r).not.toContain('"/welcome?canceled=1"');
  });
});

describe("the login page only speaks of an invitation to someone invited", () => {
  it("'accept your invitation' is reserved for /join links", () => {
    const l = code("src/app/login/page.tsx");
    expect(l).toMatch(/next\?\.startsWith\("\/join\/"\)\s*\n?\s*\? initialMode === "signup"/);
    expect(l).not.toMatch(/\{next\s*\n\s*\? "Sign in to accept your invitation\."/);
  });
});

describe("billing email quotes the whole Office bill", () => {
  it("trial amounts are unit price × quantity, in both places they are stored", () => {
    const w = code("src/app/api/stripe/webhook/route.ts");
    expect(w).toContain("item.price.unit_amount * (item.quantity ?? 1)");
    expect(w).toContain("trialPrice.unit_amount * (trialItem?.quantity ?? 1)");
    expect(w).not.toMatch(/recurringCents = sub\.items\?\.data\?\.\[0\]\?\.price\?\.unit_amount \?\? null/);
  });

  it("the payment-failed email says Office, never Enterprise", () => {
    const w = code("src/app/api/stripe/webhook/route.ts");
    // From the failed invoice's own price (a member's own Pro is "Pro", not
    // their seat's plan), with the profile only as the fallback.
    expect(w).toContain("invoicePlanName(opts.invoice, profile.plan as string | null)");
    expect(w).toContain('return fallbackPlan === "enterprise" ? "Office" : "Pro";');
  });

  it("receipts show the seats, and never greet 'there'", () => {
    const r = receiptEmail({ firstName: "", email: "a@b.co", planName: "Office", amount: "$19.95", interval: "Monthly", paymentDate: "Sep 22, 2026", invoiceNumber: "SC-1", manageUrl: U, seats: 5 });
    expect(r.html).toContain("5 (incl. you)");
    expect(r.html).toContain("Thank you. Your payment");
    expect(r.html).not.toContain("there.");
    const named = receiptEmail({ firstName: "Dana", email: "a@b.co", planName: "Pro", amount: "$4.99", interval: "Monthly", paymentDate: "x", invoiceNumber: "SC-1", manageUrl: U });
    expect(named.html).toContain("Thank you, Dana.");
    expect(named.html).not.toContain("Seats");
    const t = trialStartedEmail({ firstName: "", planName: "Office", amount: "$19.95", interval: "Monthly", firstChargeDate: "Oct 6, 2026", manageUrl: U, seats: 5 });
    expect(t.html).toContain("You're all set. You haven't been charged");
    expect(t.html).toContain("5 (incl. you)");
  });

  it("the payment-failed email promises a grace week only when one exists", () => {
    const grace = paymentFailedEmail({ firstName: "Dana", planName: "Office", amount: "$19.95", manageUrl: U, situation: "grace" });
    expect(grace.html).toContain("You have 7 days");
    const retry = paymentFailedEmail({ firstName: "Dana", planName: "Office", amount: "$19.95", manageUrl: U, situation: "retry" });
    expect(retry.html).not.toContain("7 days");
    const ended = paymentFailedEmail({ firstName: "", planName: "Office", amount: "$19.95", manageUrl: U, situation: "trial_ended" });
    expect(ended.html).not.toContain("7 days");
    // The team is saved, and a teammate paying for their own Pro keeps it —
    // not "your teammates move to Free too".
    expect(ended.html).toContain("your teammates keep their first card");
    expect(ended.html).not.toContain("move to Free too");
    expect(ended.subject).toContain("has ended");
    // The email is sent AFTER the never-paid decision, not before it.
    const w = code("src/app/api/stripe/webhook/route.ts");
    const handler = w.slice(w.indexOf('event.type === "invoice.payment_failed"'));
    expect(handler.indexOf('await sendFailed("trial_ended")')).toBeLessThan(handler.indexOf("subscriptions.cancel(invoiceSubId)"));
  });

  it("the 7-day Office trial notice says the team moves to Free", () => {
    const o = trialChargeSoonEmail({ firstName: "Dana", planName: "Office", chargeDate: "Oct 6, 2026", amountCents: 1995, intervalWord: "monthly", manageUrl: U });
    expect(o.html).toContain("Your team's seats end");
    expect(o.html).toContain("$19.95 monthly");
    const p = trialChargeSoonEmail({ firstName: "Dana", planName: "Pro", chargeDate: "Oct 6, 2026", manageUrl: U });
    expect(p.html).not.toContain("Your team's seats end");
  });
});

describe("the sample contact is never a team lead", () => {
  // Every new card gets "Jordan Rivera" (lib/demo-contact, tagged demo). The
  // office side counted it: a pre-ticked "Capture your first lead", "1 team
  // lead is waiting" pushed to a brand-new owner, and a teammate's real first
  // lead counting 2 so the first-lead alert never fired.
  const files: [string, number][] = [
    ["src/lib/office-analytics.ts", 3],
    ["src/lib/office-leads.ts", 1],
    ["src/lib/office-team.ts", 2],
    ["src/lib/team-alerts.ts", 1],
    ["src/app/api/push/recap/route.ts", 4],
  ];
  for (const [f, n] of files) {
    it(`${f} excludes it from every leads query`, () => {
      const c = code(f);
      const queries = c.split('from("leads")').length - 1;
      const excluded = c.split('.not("tags", "cs", "{demo}")').length - 1;
      expect(queries).toBe(n);
      expect(excluded).toBe(n);
    });
  }
});

describe("the rest of the journey", () => {
  it("the builder's save gate doesn't promise a plan choice already made", () => {
    const g = code("src/components/GuestGateModal.tsx");
    expect(g).toMatch(/\[\?&\]plan=\(office\|pro\)/);
    expect(g).toContain("Next you&apos;ll check out for {pickedPlan}");
  });

  it("a paused main tour ignores the keyboard (the admin tour owns it)", () => {
    expect(code("src/components/GuidedTour.tsx")).toContain("if (!running || paused) return;");
  });

  it("a failed plan write makes the webhook fail, so Stripe retries", () => {
    const w = code("src/app/api/stripe/webhook/route.ts");
    expect(w).toContain("const { error: planWriteError } = await admin.from(\"profiles\").update({");
    expect(w).toContain("if (planWriteError) throw new Error(");
  });
});

describe("a granted Office ends for the whole team", () => {
  it("grant expiry releases the team, like a cancelled subscription", () => {
    const r = code("src/lib/referral-server.ts");
    const fn = r.slice(r.indexOf("export async function expireFreeMonths"));
    expect(fn).toMatch(/if \(u\.plan === "enterprise"\) \{\s*await tearDownOfficeForOwner\(admin, u\.id as string\)/);
    // only after the conditional downgrade actually wrote (paid rows skipped)
    expect(fn.indexOf("tearDownOfficeForOwner")).toBeGreaterThan(fn.indexOf("if (!(wrote ?? []).length) continue;"));
  });
});

describe("the Custom team-size box can be typed into", () => {
  // Clamping on every keystroke turned the "1" of "12" into 2 (→ "22"), so no
  // team of 10–19 could be typed on /pricing or the plan step.
  // One seat picker (PlanTierCards) for every surface that sells Office.
  it("the shared seat picker clamps on blur, not per keystroke", () => {
    const c = code("src/components/PlanTierCards.tsx");
    expect(c).toContain("value={seatsDraft ?? seats}");
    expect(c).toContain("onBlur={() => setSeatsDraft(null)}");
    expect(c).not.toMatch(/Math\.max\(OFFICE_MIN_SEATS, Math\.floor\(Number\(e\.target\.value\)/);
  });
  for (const f of ["src/app/pricing/page.tsx", "src/components/PlanCards.tsx", "src/app/upgrade/UpgradeClient.tsx"]) {
    it(`${f} uses the shared seat picker`, () => {
      const c = code(f);
      // lockedSeats: an Office promo code made for a team of N (lib/promo).
      expect(c).toMatch(/<OfficeSeatPicker seats=\{seats\} onSeats=\{setSeats\}(?: lockedSeats=\{\w+\})? \/>/);
      expect(c).not.toMatch(/type="number"/);
    });
  }
});

describe("every charge gets exactly one receipt", () => {
  const w = () => code("src/app/api/stripe/webhook/route.ts");

  it("adding seats / upgrading to Office (charged at once) sends a receipt", () => {
    const c = w();
    const block = c.slice(c.indexOf('invoice.billing_reason === "subscription_update" && (invoice.amount_paid ?? 0) > 0'));
    expect(block.length).toBeGreaterThan(100);
    expect(block).toContain("await sendReceiptForUser({");
    expect(block).toContain("invoiceNumber: invoice.number ?? null");
    expect(block).toContain("Seats added · ");
    expect(block).toContain("Upgrade to ");
    expect(block).toContain("Switched to ");
  });

  it("de-duplicates on Stripe's invoice number, so two different charges both get theirs", () => {
    const c = w();
    expect(c).toContain('dedupe.ilike("subject", `%#${invoiceNo');
    // the trial-start email has no number in its subject → keeps the window
    expect(c).toContain("const invoiceNo = (!opts.trialFirstChargeDate && opts.invoiceNumber?.trim()) || null;");
    expect(c).toContain("numberInSubject: !!invoiceNo");
  });

  it("a receipt's subject carries the Stripe number only when it is Stripe's", () => {
    const base = { firstName: "Dana", email: "a@b.co", planName: "Office", amount: "$19.95", interval: "Monthly", paymentDate: "x", manageUrl: U };
    expect(receiptEmail({ ...base, invoiceNumber: "A1B2C3D4-0002", numberInSubject: true }).subject).toBe("Your SwiftCard receipt #A1B2C3D4-0002 — $19.95");
    expect(receiptEmail({ ...base, invoiceNumber: "SC-12345678" }).subject).toBe("Your SwiftCard receipt — $19.95");
  });

  it("a repeat-card trial ended on the spot is receipted once, from its real invoice", () => {
    const c = w();
    expect(c).toMatch(/trialFirstChargeDate = null;\s*trialEndedEarly = true;/);
    expect(c).toContain("if (!trialEndedEarly) try {");
  });
});

describe("the Teams page sells Office", () => {
  it("has a Get Office button, preselecting Office at the minimum seats, hidden in the app", () => {
    const p = code("src/app/products/[slug]/page.tsx");
    expect(p).toContain("const GET_OFFICE_HREF = `/cards/new?plan=office&interval=monthly&seats=${PLAN_LIMITS.OFFICE_MIN_SEATS}`;");
    const uses = p.split('{slug === "teams" && <NativeHidden><Link href={GET_OFFICE_HREF}').length - 1;
    expect(uses).toBe(2);
  });
});

describe("the owner's first card becomes the office brand — the branding half only", () => {
  const seed = () => {
    const c = code("src/lib/office-brand.ts");
    return c.slice(c.indexOf("export async function seedBrandFromOwnersFirstCard"), c.indexOf("export async function stripBrandFromUserCards"));
  };

  it("copies company, logo, website, office phone, fax, address, card and Swift Links design", () => {
    const s = seed();
    for (const k of ["brand_logo_url", "brand_company", "brand_website", "brand_template", "brand_phone", "brand_fax", "brand_address", "brand_design", "brand_link_design"]) {
      expect(s).toContain(`${k}:`);
    }
    // the company number is the one labelled office — never their mobile
    expect(s).toContain('p?.label === "office"');
  });

  it("never copies anything personal: name, title, photo, email, mobile, own header photo", () => {
    const s = seed();
    expect(s).toContain('.select("id, logo_url, company, website, template, customization")');
    expect(s).not.toMatch(/photo_url|\bname\b:|\btitle\b:|brand_email/);
    expect(s).toContain("withoutFaceImage(cust.customLayout");
    expect(s).toContain('if (linkDesign.linkHeroContent === "custom") delete linkDesign.linkHeroContent;');
    expect(s).toContain("delete linkDesign.linkHeroImage;");
  });

  it("runs on every path an office comes into being, or its owner's first card does", () => {
    expect(code("src/lib/office-billing-sync.ts")).toContain("seedBrandFromOwnersFirstCard(officeId, ownerId)");
    expect(code("src/app/api/cards/route.ts")).toContain("seedBrandFromOwnersFirstCard(owned.id as string, user.id)");
    expect(code("src/lib/office-admin-guard.ts")).toContain("seedBrandFromOwnersFirstCard(");
  });

  it("the Branding page says it was prefilled, until the first save", () => {
    const p = code("src/app/office/admin/branding/page.tsx");
    expect(p).toContain("We started this from your card");
    expect(p).toContain("locks?.saved !== true");
    expect(p.replace(/\s+/g, " ")).toContain("Your name, title, photo, mobile and email stay on your card only.");
  });
});
