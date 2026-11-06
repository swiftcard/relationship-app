import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── One links list, everywhere a link list is built (owner, 2026-11-06) ─────
// Links and section headers are dragged into order and edited in place, and
// "+ Add a section header" sits ABOVE "Button text" / "Web address" (it used to
// sit under them). The list is LinkListEditor on every surface, so the five
// cannot drift: Edit card, the create-card wizard, Office Branding → Links,
// the homepage builder and the Teams demo of Office Links.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SURFACES = [
  "src/app/cards/[id]/edit/CardEditForm.tsx",
  "src/app/cards/new/NewCardWizard.tsx",
  "src/components/OfficeLinksBranding.tsx",
  "src/components/site/BuilderFields.tsx",
  "src/components/site/TeamsDashboard.tsx",
];

describe("every link surface uses the one list", () => {
  for (const f of SURFACES) {
    it(f, () => {
      const src = read(f);
      expect(src).toContain("<LinkListEditor");
      // The list (which carries "+ Add a section header") comes before the add
      // form, so the header button sits above "Button text" / "Web address".
      expect(src.indexOf("<LinkListEditor")).toBeLessThan(src.indexOf("<AddLinkForm"));
      // No second, hand-rolled header button left behind under the form.
      expect(src, "a stray section-header button outside the shared list").not.toMatch(/>\s*\+ Add a section header\s*</);
    });
  }

  it("the list itself offers the section header after the rows", () => {
    const src = read("src/components/LinkListEditor.tsx");
    const rows = src.indexOf("<ul ref={listRef}");
    const add = src.search(/>\s*\+ Add a section header\s*</);
    expect(rows).toBeGreaterThan(0);
    expect(add).toBeGreaterThan(rows);
  });
});

describe("company rows stay fixed on a member's card", () => {
  it("the editor and the wizard pass the company-row test through", () => {
    for (const f of SURFACES.slice(0, 2)) expect(read(f), f).toMatch(/<LinkListEditor[\s\S]{0,200}isLocked=\{isOfficeRow\}/);
  });

  it("a locked row has no grip, no edit and no remove", () => {
    const src = read("src/components/LinkListEditor.tsx");
    // The grip cell: a plain span with a lock for a company row.
    expect(src).toMatch(/const gripCell = lockedRow \? \(\s*<span/);
    // The remove cell: the word "Company" instead of a button.
    expect(src).toMatch(/const removeCell = lockedRow \? \(\s*<span[^>]*>Company<\/span>/);
    // The link body: a plain div for a company row, the edit button otherwise.
    expect(src).toMatch(/\{lockedRow \? \(\s*<div className="flex-1 min-w-0/);
    // The moves go through the lock-aware helper only.
    expect(src).not.toMatch(/\.splice\(/);
    expect(src).toContain("moveAmongUnlocked(links");
  });
});

describe("the drag and the edit behave on a phone", () => {
  const src = read("src/components/LinkListEditor.tsx");

  it("only the grip drags, and it never scrolls the page or opens the iOS callout", () => {
    expect(src).toMatch(/onPointerDown=\{\(e\) => startDrag\(e, i\)\}/);
    // Inline: globals.css sets touch-action: manipulation on every button
    // outside any layer, which beats Tailwind's touch-none class, and the
    // phone then scrolls instead of dragging.
    expect(src).toContain('style={{ touchAction: "none", WebkitTouchCallout: "none" }}');
    expect(src).toContain("setPointerCapture");
  });

  it("opening an edit, or a new header, focuses inside the same tap so the iPhone keyboard rises", () => {
    expect(src).toMatch(/flushSync\(\(\) => setEditing\(/);
    expect(src).toMatch(/flushSync\(\(\) => onChange\(\[\.\.\.links, row\]\)\)/);
  });

  it("an edited row keeps its identity, so typing in a header never loses the cursor", () => {
    expect(src).toMatch(/ROW_IDS\.set\(next, id\)/);
    expect(src, "index keys would remount every row on a reorder").not.toMatch(/key=\{i\}/);
  });

  it("the card editor counts a reorder or an edit as an unsaved change", () => {
    expect(read(SURFACES[0])).toMatch(/onChange=\{\(next\) => \{ noteTyped\(\); setLinks\(next\); \}\}/);
  });
});
