import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideRcEvent } from "@/lib/iap-entitlement";
import { overlayOfficeDesign, overlayOfficeLinks, releaseOfficeLinks, OWN_BIO, OWN_INSTAGRAM } from "@/lib/office-brand";
import { KNOWLEDGE } from "@/lib/knowledge";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── An Office team member's account, end to end (2026-09-23 audit) ──────────
// A member's plan is their company's seat: nothing may change it except the
// team, nothing may sell to them, and everything the admin does has to reach
// their card — and come back off it.

describe("nothing but the team changes a member's plan", () => {
  it("a lapsing Apple subscription never drops an Office seat", () => {
    for (const eventType of ["CANCELLATION", "BILLING_ISSUE"]) {
      expect(decideRcEvent({ eventType, currentPlan: "enterprise", planSource: "apple", hasStripeSubscription: false }).action).toBe("ignore");
      expect(decideRcEvent({ eventType, currentPlan: "pro", planSource: "apple", hasStripeSubscription: false, isOfficeMember: true }).action).toBe("ignore");
    }
    // It ending only stops Plan and billing saying Apple charges them — the plan stays.
    expect(decideRcEvent({ eventType: "EXPIRATION", currentPlan: "enterprise", planSource: "apple", hasStripeSubscription: false }).action).toBe("forget_apple");
    expect(decideRcEvent({ eventType: "EXPIRATION", currentPlan: "pro", planSource: "apple", hasStripeSubscription: false, isOfficeMember: true }).action).toBe("forget_apple");
    expect(decideRcEvent({ eventType: "EXPIRATION", currentPlan: "enterprise", planSource: "stripe", hasStripeSubscription: true }).action).toBe("ignore");
    const rc = code("src/app/api/iap/revenuecat/route.ts");
    const forget = rc.slice(rc.indexOf('decision.action === "forget_apple"'));
    // Only _planSource goes (lib/customization-merge, audit B-03); the plan is not touched.
    expect(forget).toMatch(/await mergeCustomization\(profile\.id as string, \{ set: \{\}, remove: \["_planSource"\] \}\);/);
    expect(forget.slice(0, forget.indexOf('return "forget_apple"'))).not.toMatch(/plan:/);
    // A plain Pro-by-Apple account still loses Pro when Apple says so.
    expect(decideRcEvent({ eventType: "EXPIRATION", currentPlan: "pro", planSource: "apple", hasStripeSubscription: false }).action).toBe("revoke");
  });

  it("a member's own Pro subscription renewing doesn't demote their seat to Pro", () => {
    const s = code("src/app/api/stripe/webhook/route.ts");
    expect(s).toMatch(/const seatOutranks =\s*targetDbPlan === "pro" && subProfile\.plan === "enterprise" && !!\(await getOfficeSubUserContext\(subProfile\.id\)\);/);
    expect(s).toContain("if (subProfile.plan !== targetDbPlan && !seatOutranks) {");
  });

  it("promo codes are refused before anything is recorded", () => {
    const s = code("src/app/api/promo/redeem/route.ts");
    const block = s.indexOf("await officeSubUserBlockMessage(user.id");
    const insert = s.indexOf('.from("promo_code_redemptions")\n    .insert(');
    expect(block).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(block);
  });

  it("the Apple trial check never offers a member a trial", () => {
    expect(code("src/app/api/iap/trial-eligible/route.ts")).toMatch(/if \(await getOfficeSubUserContext\(user\.id\)\) \{\s*return NextResponse\.json\(\{ eligible: false, teamMember: true \}/);
  });

  it("the pricing page sends a member home instead of telling them billing starts today", () => {
    expect(code("src/app/pricing/page.tsx")).toContain('if (d?.teamMember === true) { router.replace("/dashboard"); return; }');
  });
});

describe("a member still paying Apple for their own Pro is told, and can see it", () => {
  it("an Apple subscription counts as their own, exactly like a Stripe one", async () => {
    const { canSeeBilling } = await import("@/lib/office-roles");
    const member = { isOwner: false, role: "member" } as unknown as Parameters<typeof canSeeBilling>[0];
    expect(canSeeBilling(member, null)).toBe(false);
    expect(canSeeBilling(member, null, "apple")).toBe(true);
    expect(canSeeBilling(member, "sub_123")).toBe(true);
    expect(canSeeBilling(member, null, "stripe")).toBe(false);
    const roles = code("src/lib/office-roles.ts");
    expect(roles).toContain('if ((profile?.customization as { _planSource?: unknown } | null)?._planSource === "apple") return null;');
    for (const p of ["src/app/settings/flows/page.tsx", "src/app/profile/page.tsx"]) {
      expect(code(p)).toContain("(profile.customization as { _planSource?: unknown } | null)?._planSource);");
    }
  });
  it("joining says where to cancel it — on the iPhone, not in SwiftCard", () => {
    const join = code("src/app/api/join/route.ts");
    expect(join).toContain('?._planSource === "apple"');
    expect(join).toContain("Settings → Apple ID → Subscriptions");
    expect(code("src/components/JoinButton.tsx")).toContain('setPersonalSubApple(json.personalBilledBy === "apple");');
  });
  it("Plan and billing shows their own Apple Pro, never 'Office billed through Apple'", () => {
    const bm = code("src/components/BillingManager.tsx");
    expect(bm).toContain('if (sub.personalSubOnly && sub.planSource === "apple" && !sub.hasStripeSubscription) {');
    const nativeAt = bm.indexOf("if (native) {");
    const memberAt = bm.indexOf("if (sub.personalSubOnly) {", nativeAt);
    expect(memberAt).toBeGreaterThan(nativeAt);
    expect(memberAt).toBeLessThan(bm.indexOf("const nPlan = sub.plan"));
  });
});

describe("leaving a team never leaves a dark card behind", () => {
  it("joining records the plan as settled, and so does the webhook's release", () => {
    expect(code("src/app/api/join/route.ts")).toContain('[PLAN_CHOSEN_KEY]: "office_member"');
    const hook = code("src/app/api/stripe/webhook/route.ts");
    const release = hook.slice(hook.indexOf("async function releaseOfficeMember"), hook.indexOf("export async function POST"));
    expect(release).toContain('[PLAN_CHOSEN_KEY]: "office_member"');
  });
});

describe("what the admin sets reaches the card — and comes back off it", () => {
  it("a locked design with no stored colours is the template's own look", () => {
    const mine = { accentColor: "#ff0000", finish: "glass", panelMedia: "https://x/p.jpg", photoUrl: "me.jpg" };
    const out = overlayOfficeDesign(mine, { lockTemplate: true, design: null, template: "modern-bold" });
    expect(out.accentColor).toBeUndefined();
    expect(out.finish).toBeUndefined();
    expect(out.panelMedia).toBeUndefined();
    expect(out.photoUrl).toBe("me.jpg"); // their content is never touched
    // Unlocked, or nothing to lock to: untouched.
    expect(overlayOfficeDesign(mine, { lockTemplate: false, design: null, template: "modern-bold" }).accentColor).toBe("#ff0000");
    expect(overlayOfficeDesign(mine, { lockTemplate: true, design: null, template: null }).accentColor).toBe("#ff0000");
  });

  it("a locked Swift Links look with nothing chosen is the default look", () => {
    const mine = { linkBgColor: "#111", linkButtonColor: "#f00", bio: "me" };
    const out = overlayOfficeLinks(mine, { lockLinkDesign: true, linkDesign: null, linkBio: null, linkInstagram: null, links: null });
    expect(out.linkBgColor).toBeUndefined();
    expect(out.linkButtonColor).toBeUndefined();
    expect(out.bio).toBe("me");
  });

  it("removing the office's LAST pinned link takes it off, and keeps theirs", () => {
    const cust = { links: [{ label: "Open an account", url: "https://bank/open", office: true }, { label: "Mine", url: "https://me" }] };
    const out = overlayOfficeLinks(cust, { lockLinkDesign: false, linkDesign: null, linkBio: null, linkInstagram: null, links: null });
    expect(out.links).toEqual([{ label: "Mine", url: "https://me" }]);
  });

  it("clearing the company bio hands the member theirs back", () => {
    const cust = { bio: "Company bio", [OWN_BIO]: "My own bio" };
    const out = overlayOfficeLinks(cust, { lockLinkDesign: false, linkDesign: null, linkBio: null, linkInstagram: null, links: null });
    expect(out.bio).toBe("My own bio");
    expect(out[OWN_BIO]).toBeUndefined();
  });

  it("releasing only the links never throws away the member's own bio or handle", () => {
    const cust = { bio: "Company bio", [OWN_BIO]: "My own bio", [OWN_INSTAGRAM]: "me.ig", links: [] };
    const out = releaseOfficeLinks(cust, "company.ig", { linkBio: null, linkInstagram: null, links: [{ label: "X", url: "https://x" }] });
    expect(out.customization[OWN_BIO]).toBe("My own bio");
    expect(out.customization[OWN_INSTAGRAM]).toBe("me.ig");
    expect(out.instagram).toBe("company.ig");
  });

  it("de-branding a member with no Instagram of their own never writes a null handle (cards.instagram is NOT NULL)", async () => {
    const { overlayOfficeInstagram } = await import("@/lib/office-brand");
    // Their card showed the company handle and nothing of theirs was held — the
    // case that made Postgres reject the whole de-brand write on removal.
    const cust = { phones: [{ number: "1", office: true }], bio: "Company bio", links: [{ label: "X", url: "https://x", office: true }] };
    const out = releaseOfficeLinks(cust, "@company", { linkBio: "Company bio", linkInstagram: "@company", links: [{ label: "X", url: "https://x" }] });
    expect(out.instagram).toBe("");
    expect(out.customization.bio).toBe("");
    expect(out.customization.links).toEqual([]);
    expect(releaseOfficeLinks(cust, null, { linkBio: null, linkInstagram: null, links: null }).instagram).toBe("");
    // The office clearing its handle, same shape.
    expect(overlayOfficeInstagram({}, "@company", { linkInstagram: null }).instagram).toBe("@company");
    expect(overlayOfficeInstagram({ [OWN_INSTAGRAM]: 42 }, "@company", { linkInstagram: null }).instagram).toBe("");
    expect(overlayOfficeInstagram(null, null, null).instagram).toBe("");
    // And a failed write is logged, not dropped.
    const s = code("src/lib/office-brand.ts");
    expect(s).toContain('if (error) console.error("[office-brand] de-brand failed for card", c.id, error.message);');
    expect(s).toContain('if (error) console.error("[office-brand] brand pass failed for card", c.id, error.message);');
  });

  it("every brand pass reaches every card — no early return — even when everything was cleared", () => {
    const s = code("src/lib/office-brand.ts");
    const apply = s.slice(s.indexOf("export async function applyBrandToUserCards"), s.indexOf("export const EMPTY_OFFICE_BRAND"));
    expect(apply).not.toMatch(/\breturn;/);
    expect(apply).toContain("merged = overlayOfficeDesign(merged, brand);");
    expect(apply).toContain("merged = overlayOfficeLinks(merged, brand);");
    expect(apply).toContain("await refreshCardSurfaces(userId, { officeCardsOnly: true });");
    expect(s).toContain("const brand = (await getOfficeBrand(officeId)) ?? EMPTY_OFFICE_BRAND;");
  });

  it("the Branding save releases a cleared or replaced bio, Instagram and pinned links", () => {
    const s = code("src/app/api/office/brand/route.ts");
    expect(s).toContain("releaseOfficeLinks(c.customization as Record<string, unknown> | null, c.instagram as string | null, release)");
    const releaseAt = s.indexOf("releaseOfficeLinks(c.customization");
    const propagateAt = s.indexOf("await propagateBrandToOfficeCards(office.id as string);");
    expect(releaseAt).toBeGreaterThan(-1);
    expect(propagateAt).toBeGreaterThan(releaseAt); // release, then re-pin what the office still sets
  });
});

describe("the member's own card rules hold on the server", () => {
  const s = code("src/app/api/cards/[id]/route.ts");
  it("every number a member saves is their mobile; a forged office entry is dropped", () => {
    expect(s).toMatch(/\.filter\(\(p\) => p && typeof p === "object" && p\.office !== true\)\s*\.map\(\(p\) => \(\{ \.\.\.p, label: "mobile" \}\)\)/);
  });
  it("company fields the office doesn't set can't linger", () => {
    expect(s).toContain("if (!brand?.logoUrl) updates.logo_url = null;");
    expect(s).toContain('if (!brand?.company) updates.company = "";');
    expect(s).toContain('if (!brand?.website) updates.website = "";');
  });
});

describe("what a member sees", () => {
  it("no Bring online button for a card their admin took offline", () => {
    expect(read("src/app/settings/flows/page.tsx")).toContain("canRestore={!isOfficeSubUser}");
    expect(code("src/components/ManageCards.tsx")).toContain("card.is_offline === true && canRestore && (");
  });
  it("no Billing problems switch without billing", () => {
    expect(read("src/app/settings/flows/page.tsx")).toContain("<PushPreferencesForm billingAlerts={!isOfficeSubUser || showBilling} />");
    expect(code("src/components/PushPreferencesForm.tsx")).toContain('(billingAlerts || cat !== "billing_problem")');
  });
  it("an old upgrade link lands a member on the dashboard, not an empty billing page", () => {
    expect(code("src/app/upgrade/page.tsx")).toMatch(/if \(!canSeeBilling\(office, profile\?\.stripe_subscription_id as string \| null\)\) redirect\("\/dashboard"\);/);
  });
  it("the legacy profile editor sends a member to their company card", () => {
    expect(code("src/app/profile/card/page.tsx")).toMatch(/if \(await getOfficeSubUserContext\(user\.id\)\) \{[\s\S]{0,300}redirect\(companyCard\?\.id \? `\/cards\/\$\{companyCard\.id\}\/edit` : "\/dashboard"\);/);
  });
  it("the help assistant answers a member from a corpus with no selling in it", () => {
    const s = code("src/app/api/ai/help/route.ts");
    expect(s).toContain("const MEMBER_CORPUS = KNOWLEDGE.filter((d) => !d.commerce && !MEMBER_HIDDEN_DOCS.has(d.id));");
    expect(s).toContain("const corpus = member ? MEMBER_CORPUS : KNOWLEDGE;");
    expect(s).toContain("reply: member ? MEMBER_FALLBACK : fallback");
    // The docs it drops really are the selling ones.
    const dropped = KNOWLEDGE.filter((d) => d.commerce || ["referrals", "plan-limits-explained"].includes(d.id)).map((d) => d.id);
    expect(dropped).toEqual(expect.arrayContaining(["greeting", "settings-map", "referrals", "plan-limits-explained"]));
  });
});
