import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { templateStyle } from "@/lib/template-style";
import { sanitizeCustomizationForPlan, convertCustomizationToFreeClosest, PRO_CUSTOMIZATION_KEYS } from "@/lib/plan";
import { OFFICE_DESIGN_KEYS, overlayOfficeDesign, extractDesign } from "@/lib/office-brand";

// Photo First's Photo shape — Original (the photo fills the left panel) or
// Circle (the photo in a circle on the panel's colour). Owner, 2026-10-09.
// The layout itself is measured in tests/render/photo-first-circle-photo; this
// pins the plumbing: one key, customization.photoShape, read and written by
// every surface that shows the Photo shape step.

const src = (p: string) => readFileSync(p, "utf8");

describe("customization.photoShape", () => {
  it("is only ever 'circle' or absent — absent is every card saved before it existed", () => {
    expect(templateStyle({ customization: { photoShape: "circle" } }).photoShape).toBe("circle");
    expect("photoShape" in templateStyle({ customization: {} })).toBe(false);
    expect("photoShape" in templateStyle({ customization: { photoShape: "square" } as never })).toBe(false);
    expect("photoShape" in templateStyle({ customization: { photoShape: null } as never })).toBe(false);
  });

  it("is on every plan: not a Pro key, and Free keeps it", () => {
    expect(PRO_CUSTOMIZATION_KEYS as readonly string[]).not.toContain("photoShape");
    expect(sanitizeCustomizationForPlan({ photoShape: "circle" }, false, "photo-first").photoShape).toBe("circle");
    expect(convertCustomizationToFreeClosest({ photoShape: "circle", surfaceColor: "#0e1b35" }, "photo-first").customization.photoShape).toBe("circle");
  });

  it("follows the office's locked look, like the colours do", () => {
    expect(OFFICE_DESIGN_KEYS as readonly string[]).toContain("photoShape");
    const locked = { lockTemplate: true, template: "photo-first" };
    expect(overlayOfficeDesign({}, { ...locked, design: { photoShape: "circle" } } as never).photoShape).toBe("circle");
    // A locked office that did not pick Circle keeps every card on Original.
    expect(overlayOfficeDesign({ photoShape: "circle" }, { ...locked, design: { bgColor: "#ffffff" } } as never).photoShape).toBeUndefined();
    // Unlocked, the member's own choice stands.
    expect(overlayOfficeDesign({ photoShape: "circle" }, { lockTemplate: false, design: {} } as never).photoShape).toBe("circle");
    expect(extractDesign({ photoShape: "circle" })?.photoShape).toBe("circle");
  });
});

describe("every editor reads and writes it", () => {
  it("Edit card loads it, keeps it on the Free version, and saves it (null clears it)", () => {
    const f = src("src/app/cards/[id]/edit/CardEditForm.tsx");
    expect(f).toMatch(/photoShape: card\.customization\?\.photoShape === "circle" \? "circle" : undefined/);
    expect(f).toMatch(/photoShape: c\.photoShape === "circle" \? "circle" : undefined/);
    expect(f).toMatch(/photoShape: templateStyleState\.photoShape \?\? null/);
    expect(f).toMatch(/hasPhoto=\{!!photoState\}/);
  });

  it("the card builder restores it after a reload, takes it from the homepage builder, and keeps it on Free", () => {
    const f = src("src/app/cards/new/NewCardWizard.tsx");
    expect(f).toMatch(/if \(cust\.photoShape === "circle"\) style\.photoShape = "circle";/);
    expect(f).toMatch(/if \(p\.photoShape === "circle"\) next\.photoShape = "circle";/);
    expect(f.match(/photoShape: result\.customization\.photoShape === "circle" \? "circle" : undefined/g)?.length).toBe(2);
    // Saved by the spread of the design state, like every other design key.
    expect(f).toMatch(/\.\.\.saveTemplateStyle,/);
    expect(f).toMatch(/hasPhoto=\{!!headshotUrl\}/);
  });

  it("the homepage builders carry it into the wizard", () => {
    expect(src("src/lib/prefill.ts")).toMatch(/photoShape\?: "circle";/);
    expect(src("src/components/site/useProductSketch.ts")).toMatch(/photoShape: p\.photoShape === "circle" \? "circle" : undefined/);
    expect(src("src/components/site/CardMiniBuilder.tsx")).toMatch(/hasPhoto=\{!!sketch\.headshot\}/);
  });

  it("Office branding reads it back, so the step it shows saves", () => {
    expect(src("src/components/OfficeBranding.tsx")).toMatch(/d\.photoShape === "circle" \? \{ photoShape: "circle" as const \}/);
  });

  it("the design panel gives Photo First a Photo shape step whose colour opens with Circle", () => {
    const f = src("src/components/card-templates/TemplateStyleControls.tsx");
    expect(f).toMatch(/template === "photo-first"\s*\n?\s*\? photoShapeStep\(meta\.surface\)/);
    expect(f).toMatch(/label: "Photo shape"/);
    expect(f).toMatch(/\{ value: "original", label: "Original" \}/);
    expect(f).toMatch(/\{ value: "circle", label: "Circle" \}/);
    expect(f).toMatch(/photoCircle \|\| hasPhoto !== true \?/);
  });
});
