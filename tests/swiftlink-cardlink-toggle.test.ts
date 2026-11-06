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
    // Owner order 2026-11-06: the link reads "View Contact Info", not the
    // product name. Same link, same switch, same ?source=swift_links tag.
    expect(src).toContain("View Contact Info →");
    expect(src).not.toContain("View SwiftCard →");
  });

  // Owner order 2026-11-06: the link sits right UNDER the Connect button, not
  // at the very bottom of the page below every link. One copy, between
  // Connect and the link tiles; the switch still decides whether it renders.
  it("the link sits under Connect, above the links — once", () => {
    const src = read("src/components/SwiftLinkProfile.tsx");
    const connect = src.indexOf("<ConnectButton");
    const cardLink = src.indexOf("{showCardLink && (");
    const tiles = src.indexOf("<SwiftLinkButtons");
    expect(src.split("{showCardLink && (").length - 1).toBe(1);
    expect(src.split("View Contact Info →").length - 1).toBe(1);
    expect(connect).toBeGreaterThan(0);
    expect(cardLink, "the card link is no longer right under Connect").toBeGreaterThan(connect);
    expect(tiles, "the card link fell back below the link tiles").toBeGreaterThan(cardLink);
    // The tap row is a full 44px and hugs Connect (mt-2), not the old mt-10 gap.
    const block = src.slice(cardLink, src.indexOf(")}", cardLink));
    expect(block).toContain('className="flex justify-center mt-2"');
    expect(block).toMatch(/min-h-\[44px\]/);
    expect(block).not.toMatch(/mt-10/);
  });

  it("the homepage hero mock-up shows it under its Connect too", () => {
    const hero = read("src/components/site/HeroShowcase.tsx");
    const connect = hero.indexOf("Connect with {first}");
    const link = hero.indexOf("View Contact Info →");
    const tiles = hero.indexOf("persona.featured");
    expect(connect).toBeGreaterThan(0);
    expect(link).toBeGreaterThan(connect);
    expect(tiles).toBeGreaterThan(link);
    expect(hero.split("View Contact Info →").length - 1).toBe(1);
  });

  it("the switch's help text says where the link is", () => {
    for (const f of ["src/app/cards/new/NewCardWizard.tsx", "src/app/cards/[id]/edit/CardEditForm.tsx", "src/components/site/SwiftLinkMiniBuilder.tsx"]) {
      const src = read(f);
      expect(src, f).toContain('help="A small link under your Connect button that opens your card."');
      expect(src, f).not.toContain("A small link at the bottom of your page");
    }
    const doc = read("src/lib/knowledge/docs/cards.ts");
    expect(doc).toContain('\\"View Contact Info\\" link under the Connect button');
    expect(doc).not.toMatch(/View Contact Info\\" link at the bottom/);
  });

  it("the homepage hero mock-up and the support docs use the same words", () => {
    expect(read("src/components/site/HeroShowcase.tsx")).toContain("View Contact Info →");
    expect(read("src/components/site/HeroShowcase.tsx")).not.toContain("View SwiftCard →");
    for (const f of ["src/lib/knowledge/docs/cards.ts", "src/lib/knowledge/docs/dashboard.ts"]) {
      const doc = read(f);
      expect(doc, f).toContain("View Contact Info");
      expect(doc, f).not.toContain("View SwiftCard");
    }
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
      // 2026-10-18: one switch size app-wide (48×28 track, 24px knob).
      .toMatch(/absolute top-0\.5 left-0\.5 w-6 h-6 rounded-full bg-white/);
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
