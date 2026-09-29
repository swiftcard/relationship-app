import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isHostedImageUrl, buildClaimInsert } from "@/lib/draft-claim";
import { sanitizeCustomizationForPlan, convertCustomizationToFreeClosest } from "@/lib/plan";
import { buildCardData } from "@/lib/card-data";

// ── Going to Free keeps everything Free: the logo above all ─────────────────
// Owner, 2026-09-29: built a card with every Pro feature, chose Free ("Continue
// with Free" over the 14-day trial) — and the LOGO was gone. The logo is a Free
// feature. Root cause: a guest's wizard draft carries the logo only in
// images.logo (payload.logo_url is null), and /api/drafts/claim accepted only
// data: URLs there — so the suggested company logo (an https URL from
// img.logo.dev) was dropped when the account was created, before the plan step.

const read = (p: string) => readFileSync(p, "utf8");
const LOGO = "https://img.logo.dev/dwightcapital.com?token=pk_test";

describe("the claim keeps an already-hosted logo and headshot", () => {
  it("recognises https image URLs — and nothing else", () => {
    expect(isHostedImageUrl(LOGO)).toBe(true);
    expect(isHostedImageUrl("https://grxmovpmlgmjncnyiyrt.supabase.co/storage/v1/object/public/x/logo.png")).toBe(true);
    for (const bad of ["http://x.test/a.png", "data:image/png;base64,AAAA", "javascript:alert(1)", "", null, 42, "not a url", `https://x.test/${"a".repeat(2100)}`]) {
      expect(isHostedImageUrl(bad)).toBe(false);
    }
  });

  it("the route falls back to a hosted images.logo / images.photo when there is nothing to upload", () => {
    const route = read("src/app/api/drafts/claim/route.ts");
    expect(route).toMatch(/else if \(!insert\.logo_url && isHostedImageUrl\(imgs\.logo\)\) \{[\s\S]{0,200}insert\.logo_url = imgs\.logo;/);
    expect(route).toMatch(/else if \(!cust\.photoUrl && isHostedImageUrl\(imgs\.photo\)\) \{[\s\S]{0,200}cust\.photoUrl = imgs\.photo;/);
  });

  it("the wizard's guest draft really does carry the logo only in images (why the fallback is needed)", () => {
    const wizard = read("src/app/cards/new/NewCardWizard.tsx");
    expect(wizard).toMatch(/logo_url: null,/);
    expect(wizard).toMatch(/\.\.\.\(logoUrl \? \{ logo: logoUrl \} : \{\}\)/);
  });
});

describe("the Free conversion never touches the logo or the headshot", () => {
  const proCard = {
    bgColor: "#123456", textColor: "#abcdef", accentColor: "#fe12dc", finish: "brushed",
    panelMedia: "https://x.test/v.mp4", panelMediaType: "video",
    photoUrl: "https://x.test/me.jpg", logoShape: "circle",
    customLayout: { blocks: [{ id: "logo", type: "logo", zone: "left", on: true }] },
  };

  it.each(["classic-pro", "modern-bold", "logo-first", "photo-first", "luxury-minimal", "local-business", "custom"])(
    "%s: headshot and logo shape survive, the card still renders the logo on Free",
    (template) => {
      const free = sanitizeCustomizationForPlan(proCard, false, template);
      expect(free.photoUrl).toBe(proCard.photoUrl);
      expect(free.logoShape).toBe("circle");
      const { data, template: rendered } = buildCardData(
        { username: "t", name: "Test Person", company: "Co", template, logo_url: LOGO, customization: proCard } as Parameters<typeof buildCardData>[0],
        { appUrl: "https://swiftcard.me", isPro: false, accountPhotoUrl: null },
      );
      expect(data.logoUrl).toBe(LOGO);
      expect(rendered).not.toBe("custom");
    },
  );

  it("a claimed guest card keeps its logo through the plan step (buildClaimInsert passes logo_url through)", () => {
    const built = buildClaimInsert("00000000-0000-4000-8000-000000000000", { username: "t-co", name: "T", template: "custom", logo_url: LOGO, customization: proCard }, true);
    expect(built.ok && built.insert.logo_url).toBe(LOGO);
  });

  it("the converter only changes design keys", () => {
    const { customization } = convertCustomizationToFreeClosest(proCard, "classic-pro");
    expect(customization.photoUrl).toBe(proCard.photoUrl);
    expect(customization.logoShape).toBe("circle");
  });
});

describe("choosing Free converts a custom card's template too", () => {
  it("writes classic-pro when the custom layout is dropped, so the row never says 'custom' with no layout", () => {
    const c = read("src/app/api/account/choose-plan/route.ts");
    expect(c).toMatch(/const afterTemplate = beforeTemplate === "custom" \? "classic-pro" : beforeTemplate;/);
    expect(c).toMatch(/\{ customization: afterCust, template: afterTemplate \}/);
    // …and it never writes logo_url or the headshot.
    expect(c).not.toMatch(/logo_url\s*:/);
    expect(c).not.toMatch(/photoUrl\s*[:=]/);
  });
});
