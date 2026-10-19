import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 28 (2026-10-18): the admin console tells the truth and can't
//    mail a segment twice ───────────────────────────────────────────────────
//
// F-ADMIN-04  "Create card for business" always said the login email went,
//             even when it didn't — and the server's fallback link was ignored.
// F-ADMIN-03  "Email to users" on a promo code: no confirm, no idempotency, no
//             warm-up cap, no campaign record — the broadcast had all four.
// F-ADMIN-06  The broadcast and create-card routes had no length caps.

const read = (p: string) => readFileSync(p, "utf8");

describe("F-ADMIN-04: the create-card result says what happened", () => {
  const ui = read("src/app/admin/users/UsersClient.tsx");

  it("reads loginEmailed and the setup link from the server", () => {
    expect(ui).toContain("setCreateResult({ cardUrl: data.cardUrl, loginEmailed: data.loginEmailed !== false, setupLink: data.setupLink ?? null });");
  });

  it("only claims the email went when it did, and hands over the link when it didn't", () => {
    expect(ui).toContain("{createResult.loginEmailed ? (");
    expect(ui).toContain("The login email couldn&apos;t be sent. Send the business owner this link to set their password:");
  });
});

describe("F-ADMIN-03: a promo blast has the broadcast's protections", () => {
  const route = read("src/app/api/admin/promo-codes/send/route.ts");

  it("a campaign row with the send key is written BEFORE any mail, and a repeat key sends nothing", () => {
    const camp = route.indexOf('.from("admin_email_campaigns")');
    expect(camp).toBeGreaterThan(0);
    expect(camp).toBeLessThan(route.indexOf("for (const profile of targets) {"));
    expect(route).toContain('if (campErr?.code === "23505" && key) {');
    expect(route).toContain("return NextResponse.json({ duplicate: true,");
  });

  it("the warm-up cap counts broadcasts and promos together, in both senders", () => {
    expect(route).toContain('like("type", "promo:%")');
    expect(route).toMatch(/if \(already \+ targets\.length > dailyCap\) \{/);
    expect(read("src/app/api/admin/broadcast/route.ts")).toContain('like("type", "promo:%")');
  });

  it("the console asks first, with the reach, and sends a key of its own", () => {
    const ui = read("src/app/admin/marketing/MarketingClient.tsx");
    expect(ui).toContain("if (!window.confirm(`Email the ${promoSend.code} offer to ${who}? This can't be undone.`)) return;");
    expect(ui).toContain("body: JSON.stringify({ ...promoSend, sendKey }),");
  });
});

describe("F-ADMIN-06: admin text is bounded on the server", () => {
  it("the broadcast and the promo blast cap their fields", () => {
    expect(read("src/app/api/admin/broadcast/route.ts")).toContain("message.length > 5000");
    expect(read("src/app/api/admin/promo-codes/send/route.ts")).toContain("headline.length > 200 || message.length > 5000");
  });

  it("create-card clamps what the card prints", () => {
    const route = read("src/app/api/admin/create-card/route.ts");
    for (const f of ["name", "company", "title", "phone"]) expect(route).toContain(`const ${f} = clampField("${f}", txt(raw.${f}));`);
  });
});
