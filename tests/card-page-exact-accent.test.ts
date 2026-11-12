import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Owner, 2026-11-12 (Glasshouse, accent #88f9c1): the QR and every card page
// button came out green — the accent was darkened for white text and for the
// QR's pale square, and the Save Contact button flipped to a fixed green once
// saved. "It has to be the exact same color that I choose."
//
// card-page-theme.test.ts pins the colours; this pins the wiring: the card
// page's accent buttons take their text colour from --sc-accent-text (dark on
// a light accent) instead of a hard-coded white, and the darkening is gone.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Every JSX opening tag (button) whose style reads --sc-accent as its background. */
function accentButtons(src: string): string[] {
  return [...src.matchAll(/<button[\s\S]*?>/g)].map((m) => m[0]).filter((t) => /background: [^,}]*var\(--sc-accent,/.test(t));
}

describe("card page buttons follow the exact accent", () => {
  for (const file of ["src/components/SaveContactButton.tsx", "src/components/LeadCaptureForm.tsx"]) {
    it(`${file}: accent buttons read --sc-accent-text, never a fixed white`, () => {
      const tags = accentButtons(read(file));
      expect(tags.length, file).toBeGreaterThan(0);
      for (const t of tags) {
        expect(t, file).toContain("var(--sc-accent-text");
        expect(t, file).not.toMatch(/\btext-white\b/);
      }
    });
  }

  it("ShareButton: the primary button and its \"Link copied!\" state read the accent", () => {
    const src = read("src/components/ShareButton.tsx");
    expect(src).toContain('background: "var(--sc-accent, linear-gradient(to right, #16a34a, #15803d))", color: "var(--sc-accent-text, #fff)"');
    expect(src).toContain('background: "var(--sc-accent, #2563eb)", color: "var(--sc-accent-text, #fff)"');
  });

  it("Save Contact stays the accent once saved (no fixed green on a card page)", () => {
    const src = read("src/components/SaveContactButton.tsx");
    expect(src).toContain('saved ? "var(--sc-accent, #16a34a)"');
    expect(src).not.toContain('saved ? "#16a34a"');
  });

  it("the card page passes the text and ink colours down", () => {
    const page = read("src/app/[username]/page.tsx");
    expect(page).toContain('["--sc-accent-text" as string]: theme.accentText');
    expect(page).toContain('["--sc-accent-ink" as string]: theme.accentInk');
  });

  it("nothing darkens the accent any more", () => {
    expect(read("src/lib/card-page-theme.ts")).not.toMatch(/darken/);
    for (const t of ["PhotoFirst", "ClassicPro", "LuxuryMinimal", "LocalBusiness"]) {
      expect(read(`src/components/card-templates/${t}.tsx`), t).not.toContain("qrInk(");
    }
  });
});
