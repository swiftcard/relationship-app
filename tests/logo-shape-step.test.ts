import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// Owner, 2026-10-14: the logo's Original / Circle choice moved out of the
// "Logo & headshot" upload area and into the numbered design steps, beside
// Photo shape — on every screen that designs a card. One control, one place.
describe("Logo shape lives in the design steps", () => {
  const controls = read("src/components/card-templates/TemplateStyleControls.tsx");

  it("is a step in TemplateStyleControls, right after the panels and before the name colour", () => {
    expect(controls).toMatch(/key: "logo-shape",\s*label: "Logo shape"/);
    const surface = controls.indexOf("photoShapeStep(meta.surface)");
    const logo = controls.indexOf("...logoShapeStep,");
    const name = controls.indexOf('{ key: "text", label: meta.text.label');
    expect(surface).toBeGreaterThan(-1);
    expect(logo).toBeGreaterThan(surface);
    expect(name).toBeGreaterThan(logo);
  });

  // [file, the exact `logo=` the TemplateStyleControls call must carry]
  const CALLERS: [string, string][] = [
    // Create + Edit: an office card's logo is the office's, so no step there.
    ["src/app/cards/[id]/edit/CardEditForm.tsx", "logo={!org && cardLogoUrl ? { shape: logoShape, onChange: setLogoShape } : undefined}"],
    ["src/app/cards/new/NewCardWizard.tsx", "logo={!org && logoUrl ? { shape: logoShape, onChange: setLogoShape } : undefined}"],
    ["src/components/OfficeBranding.tsx", "logo={logoUrl ? { shape: logoShape, onChange: setLogoShape } : undefined}"],
    ["src/components/site/TeamsDashboard.tsx", "logo={logoUrl ? { shape: logoShape, onChange: setLogoShape } : undefined}"],
    ["src/components/site/CardMiniBuilder.tsx", "logo={sketch.logo ? { shape: sketch.logoShape, onChange: (v) => patch({ logoShape: v }) } : undefined}"],
    ["src/components/site/SignatureMiniBuilder.tsx", "logo={sketch.logo ? { shape: sketch.logoShape, onChange: (v) => patch({ logoShape: v }) } : undefined}"],
  ];

  it.each(CALLERS)("%s hands the logo shape to the design steps, gated on having a logo", (file, prop) => {
    expect(read(file)).toContain(prop);
  });

  it.each(CALLERS)("%s no longer has its own toggle under the logo upload", (file) => {
    const src = read(file);
    expect(src).not.toContain("Logo shape on the card");
    expect(src).not.toMatch(/LogoShapeToggle/);
  });
});
