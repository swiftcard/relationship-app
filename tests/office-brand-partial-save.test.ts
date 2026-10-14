import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Office audit 2026-09-16: each Branding tab saves only its own keys, and the
// brand route read an ABSENT key as "off"/"clear". Saving the Links tab deleted
// the office phone, fax and address from every member card and turned "Keep
// every card matching" back on; saving the Card tab turned "Keep every Swift
// Links page matching" off. An absent key must keep its stored value.

const route = () => readFileSync(join(process.cwd(), "src/app/api/office/brand/route.ts"), "utf8");

describe("a Branding tab save never touches the other tab's settings", () => {
  it("locks keep their stored value when the request omits them", () => {
    const s = route();
    expect(s).toMatch(/const lockTemplate = "lockTemplate" in body \? body\.lockTemplate !== false : storedLocks\?\.template !== false;/);
    expect(s).toMatch(/const lockLinkDesign = "lockLinkDesign" in body \? body\.lockLinkDesign === true : storedLocks\?\.linkDesign === true;/);
    expect(s).not.toMatch(/const lockTemplate = body\.lockTemplate !== false;/);
  });

  it("company phone, fax and address keep their stored value when omitted", () => {
    const s = route();
    expect(s).toMatch(/brand_phone: "phone" in body \?[\s\S]{0,120}: \(\(office\.brand_phone as string \| null\) \?\? null\)/);
    expect(s).toMatch(/brand_fax: "fax" in body \?[\s\S]{0,120}: \(\(office\.brand_fax as string \| null\) \?\? null\)/);
    expect(s).toMatch(/brand_address: "address" in body \?[\s\S]{0,80}: \(\(office\.brand_address/);
  });

  it("the two tabs really do send disjoint keys (which is why omission must mean keep)", () => {
    const card = readFileSync(join(process.cwd(), "src/components/OfficeBranding.tsx"), "utf8");
    const links = readFileSync(join(process.cwd(), "src/components/OfficeLinksBranding.tsx"), "utf8");
    expect(card).not.toMatch(/lockLinkDesign/);
    expect(links).not.toMatch(/JSON\.stringify\(\{[^}]*\bphone\b/);
  });
});

import { overlayOfficeDesign, cleanOfficeLinkStyle } from "@/lib/office-brand";

describe("Branding matches Card design and Social design (owner, 2026-09-16)", () => {
  it("the company logo's Original/Circle shape reaches every team card, locked or not", () => {
    expect(overlayOfficeDesign({}, { lockTemplate: false, design: { logoShape: "circle" } } as never).logoShape).toBe("circle");
    expect(overlayOfficeDesign({ logoShape: "circle" }, { lockTemplate: true, design: { logoShape: "auto" } } as never).logoShape).toBe("auto");
    const src = route();
    expect(src).toMatch(/if \(shape === "circle" \|\| shape === "auto"\) clean\.logoShape = shape;/);
  });

  it("company link looks (Featured/Grid/Compact, row style, photo) survive a save and are validated", () => {
    expect(cleanOfficeLinkStyle({ size: "featured", rowStyle: "solid", media: { url: "https://x.co/a.jpg", type: "image" } }))
      .toEqual({ size: "featured", rowStyle: "solid", media: { url: "https://x.co/a.jpg", type: "image" } });
    expect(cleanOfficeLinkStyle({ size: "huge", rowStyle: "neon", media: { url: "javascript:alert(1)", type: "image" } })).toEqual({});
    expect(route()).toMatch(/style: cleanOfficeLinkStyle\(l\)/);
  });

  it("the Card tab uses the shared template gallery and pins its preview on phones", () => {
    const card = readFileSync(join(process.cwd(), "src/components/OfficeBranding.tsx"), "utf8");
    expect(card).toMatch(/<TemplatePicker /);
    expect(card).toMatch(/<PinnedCardPreview stickBelow="\.sc-office-header">/);
    // Logo shape is a step in Card appearance (TemplateStyleControls), the same
    // place it sits on a teammate's Card design — not under the logo upload.
    expect(card).toMatch(/logo=\{logoUrl \? \{ shape: logoShape, onChange: setLogoShape \} : undefined\}/);
    expect(card).not.toContain("Logo shape on the card");
  });

  it("the Links tab has the Link buttons step and a pinned preview", () => {
    const links = readFileSync(join(process.cwd(), "src/components/OfficeLinksBranding.tsx"), "utf8");
    expect(links).toMatch(/<SwiftLinkStyleControls value=\{style\} onChange=\{patchStyle\} links=\{links\} onLinksChange=\{setLinks\} \/>/);
    expect(links).toMatch(/<PinnedLinkPreview stickBelow="\.sc-office-header">/);
  });
});
