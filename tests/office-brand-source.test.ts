import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The primary-card concept is GONE (owner decision, Jul 2026): the office
// Branding page is the single source of the team brand, seeded once from the
// owner's first card at provision, and every SUB-USER card under the office
// carries the brand uniformly. The OWNER's personal cards are individual to
// the admin and are never rebranded. Accounts are identified by their AUTH
// signup email, never the email typed on a card. These tests pin these
// doctrines at the source level so none quietly comes back.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("the primary card is gone", () => {
  it("no source file references the primary-card machinery", () => {
    const banned = /ensurePrimaryCard|syncBrandFromPrimaryCard|adoptPrimaryCardForOwner|getPrimaryCardId|primary_card_id/;
    const offenders = walk("src").filter((f) => banned.test(read(f)));
    expect(offenders, offenders.join(", ")).toEqual([]);
  });

  it("office-primary.ts itself is deleted", () => {
    expect(() => read("src/lib/office-primary.ts")).toThrow();
  });

  it("the dashboard no longer renders a PRIMARY CARD badge", () => {
    expect(read("src/app/dashboard/page.tsx")).not.toMatch(/PRIMARY CARD/);
  });

  it("card saves apply the brand uniformly — no per-card exemption", () => {
    for (const f of ["src/app/api/cards/[id]/route.ts", "src/app/api/office/cards/[id]/route.ts"]) {
      expect(read(f), f).not.toMatch(/isPrimaryCard/);
    }
  });
});

describe("the Branding page is the brand source", () => {
  it("the brand route accepts identity AND the design (colors/fonts)", () => {
    const src = read("src/app/api/office/brand/route.ts");
    for (const field of ["logoUrl", "company", "website", "template", "design"]) {
      expect(src, field).toMatch(new RegExp(`body\\.${field}|"${field}" in body`));
    }
    expect(src).toContain("brand_design");
    // Only known design keys, only strings — no arbitrary JSON into member cards.
    expect(src).toContain("OFFICE_DESIGN_KEYS");
  });

  it("the branding form is editable and carries the card editor's own style controls", () => {
    const src = read("src/components/OfficeBranding.tsx");
    expect(src).toContain("TemplateStyleControls");
    expect(src).toContain("setCompany");
    expect(src).toContain("setTemplate");
    expect(src).toContain("ImageUpload");
    expect(src).not.toMatch(/Primary Card/);
  });

  it("fresh offices seed the brand ONCE from the owner's first card", () => {
    const lib = read("src/lib/office-brand.ts");
    expect(lib).toContain("seedBrandFromOwnersFirstCard");
    // Never overwrites a brand the admin already set.
    expect(lib).toMatch(/alreadyBranded/);
    // Wired to every provisioning path.
    for (const f of [
      "src/app/api/cards/route.ts",
      "src/app/api/office/route.ts",
      "src/lib/office-billing-sync.ts",
      "src/lib/office-admin-guard.ts",
    ]) {
      expect(read(f), f).toContain("seedBrandFromOwnersFirstCard");
    }
  });

  it("brand propagation targets MEMBERS only — never the owner's personal cards", () => {
    // Owner decision (Jul 2026): the admin's own cards are individual. An
    // earlier version propagated the brand to the owner too, which rewrote
    // the admin's personal cards with the office template.
    const lib = read("src/lib/office-brand.ts");
    expect(lib).toContain("propagateBrandToOfficeCards");
    // Through the same target rule as the Branding route: owner excluded, and
    // only members still verifiably in the office (audit C02-A02).
    expect(lib).toMatch(/resolveBrandTargetIds\(ownerId \?\? "", memberIds, verifiedInOffice\)/);
    expect(read("src/lib/office-brand-targets.ts")).toMatch(/id !== ownerId && verified\.has\(id\)/);
    // And the card-write overlays resolve the brand member-only.
    expect(lib).toContain("getMemberBrandForUser");
    for (const f of [
      "src/app/api/cards/route.ts",
      "src/app/api/cards/[id]/route.ts",
      "src/app/api/profile/route.ts",
      "src/app/api/drafts/claim/route.ts",
    ]) {
      expect(read(f), f).toContain("getMemberBrandForUser");
    }
  });
});

describe("accounts are identified by their auth signup email", () => {
  const SITES: Array<[string, string]> = [
    ["src/app/api/stripe/checkout/route.ts", "getAccountEmail"],
    ["src/app/api/admin/users/route.ts", "getAccountEmailMap"],
    ["src/app/api/admin/users/[id]/route.ts", "getAccountEmail"],
    ["src/app/api/admin/users/export/route.ts", "getAccountEmailMap"],
    ["src/lib/office-team.ts", "getAccountEmailMap"],
    ["src/lib/office-analytics.ts", "getAccountEmail"],
    ["src/lib/office-cards.ts", "getAccountEmailMap"],
    ["src/lib/referral-server.ts", "getAccountEmail"],
  ];
  for (const [file, helper] of SITES) {
    it(`${file} resolves identity via ${helper}`, () => {
      expect(read(file), file).toContain(helper);
    });
  }
});
