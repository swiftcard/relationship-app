import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ── The "View SwiftCard →" toggle (owner order 2026-09-02) ───────────────────
// Social design gained a switch controlling the faint card link at the bottom
// of the Swift Links page. Pins: shown by DEFAULT everywhere, hidden only by
// an explicit hideCardLink: true, editable from both the wizard and the
// editor, and available on every plan (sanitize must not touch it).
describe("the View SwiftCard button toggle", () => {
  it("the profile hides the link only on the explicit prop, default shown", () => {
    const src = read("src/components/SwiftLinkProfile.tsx");
    expect(src).toMatch(/showCardLink = true,/);
    expect(src).toMatch(/\{showCardLink && \(/);
    expect(src).toContain("View SwiftCard →");
  });

  it("the public page maps hideCardLink !== true → shown", () => {
    expect(read("src/app/links/[username]/page.tsx")).toMatch(/showCardLink=\{customization\.hideCardLink !== true\}/);
  });

  it("both editors carry the switch and persist the flag", () => {
    const wizard = read("src/app/cards/new/NewCardWizard.tsx");
    const editor = read("src/app/cards/[id]/edit/CardEditForm.tsx");
    for (const src of [wizard, editor]) {
      // Both editors render the SHARED Switch now (2026-09-15) rather than each
      // hand-rolling a track and a knob. The label reads identically; it is a
      // prop instead of markup rather than a nested <span>.
      // Plain words since 2026-09-29 — nobody knew what "Show the 'View
      // SwiftCard' button" meant.
      expect(src).toContain('label="Link to your business card"');
      expect(src).not.toContain("Show the “View SwiftCard” button");
      expect(src).toMatch(/<Switch\b/);
      expect(src).toMatch(/showCardLinkBtn/);
    }
    // The knob must stay anchored: absolute WITHOUT a left offset takes its
    // static (centered) position inside the button, and the translate then
    // pushes it out past the track's right edge (owner bug report 2026-09-01:
    // "the toggle falls out"). One implementation now, so this is asserted
    // once, where it lives.
    expect(read("src/components/ui/DesignControls.tsx"))
      .toMatch(/absolute top-\[3px\] left-\[3px\] w-5 h-5 rounded-full bg-white/);
    // Wizard writes the flag only when hidden (fresh rows stay clean)…
    expect(wizard).toMatch(/showCardLinkBtn \? \{\} : \{ hideCardLink: true \}/);
    // …the editor sends it explicitly both ways, so the server merge can CLEAR it.
    expect(editor).toMatch(/hideCardLink: showCardLinkBtn \? null : true,/);
    // The editor initializes from the stored card, not a hardcoded default.
    expect(editor).toMatch(/useState\(card\.customization\?\.hideCardLink !== true\)/);
  });

  it("the switch comes LAST, after the design steps — not above step 1", () => {
    for (const f of ["src/app/cards/new/NewCardWizard.tsx", "src/app/cards/[id]/edit/CardEditForm.tsx", "src/components/site/SwiftLinkMiniBuilder.tsx"]) {
      const src = read(f);
      const panel = src.indexOf("<SwiftLinkStyleControls");
      const sw = src.indexOf('label="Link to your business card"');
      expect(panel, `${f}: no design panel`).toBeGreaterThan(0);
      expect(sw, `${f}: the card-link switch is back above the design steps`).toBeGreaterThan(panel);
    }
  });

  it("the live preview reflects the toggle", () => {
    expect(read("src/components/SwiftLinkLivePreview.tsx")).toMatch(/showCardLink=\{showCardLink\}/);
    expect(read("src/app/cards/new/NewCardWizard.tsx")).toMatch(/showCardLink=\{showCardLinkBtn\}/);
    expect(read("src/app/cards/[id]/edit/CardEditForm.tsx")).toMatch(/showCardLink=\{showCardLinkBtn\}/);
  });

  it("every plan may use it — the Free sanitizer never touches the key", () => {
    expect(read("src/lib/plan.ts")).not.toMatch(/hideCardLink/);
  });
});
