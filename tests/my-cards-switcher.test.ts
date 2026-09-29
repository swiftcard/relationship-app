import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const code = (p: string) =>
  readFileSync(join(root, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LIST = "src/components/dashboard/MyCardsList.tsx";
const DASHBOARD = "src/app/dashboard/page.tsx";

// On mobile, My Cards collapses to just the SELECTED card plus a chevron; the
// rest drop down beneath it. Desktop shows every card, as before. The risk in
// that change is entirely about PLANS — the Free upsell tile and the
// positional LINK OFF badge — so that is what these pin.

describe("the dropdown cannot appear when there is nothing to switch to", () => {
  it("the chevron is gated on having more than one card", () => {
    // This is the Free-plan guarantee: one card means no toggle at all, so a
    // single-card account renders exactly what it did before.
    const c = code(LIST);
    expect(c).toMatch(/const hasMultiple = cards\.length > 1/);
    expect(c).toMatch(/isActive && hasMultiple &&/);
  });

  it("the chevron is mobile-only", () => {
    const c = code(LIST);
    const btn = c.slice(c.indexOf("isActive && hasMultiple"));
    expect(btn).toMatch(/className="sm:hidden/);
  });

  it("only the SELECTED card carries the chevron", () => {
    expect(code(LIST)).toMatch(/\{isActive && hasMultiple && \(/);
  });
});

describe("the Free-plan upsell is never swallowed by the dropdown", () => {
  it("is a slot rendered outside the collapsing rows", () => {
    const c = code(LIST);
    // It must sit after the map, not inside it.
    const mapEnd = c.lastIndexOf("})}");
    const upsellAt = c.lastIndexOf("{upsell}");
    expect(upsellAt).toBeGreaterThan(mapEnd);
  });

  it("carries no collapse/visibility logic of its own", () => {
    const c = code(LIST);
    const tail = c.slice(c.lastIndexOf("{upsell}"));
    expect(tail).not.toMatch(/expanded/);
  });

  // The standing upsell is GONE (owner, 2026-09-11). It sat under My Cards on
  // every single dashboard visit whether or not the person wanted another card.
  // The pitch moved behind the Add card button, which a Free account now sees
  // too — so the offer arrives when they ask for a second card, and never
  // otherwise. The slot itself stays, because MyCardsList still owns where an
  // upsell would render if one ever comes back.
  it("no longer parks a standing upsell under the card list", () => {
    const c = code(DASHBOARD);
    expect(c).toMatch(/upsell=\{null\}/);
    expect(c, "the permanent upsell box is back").not.toMatch(/Ready for a second card/);
  });

  it("the second-card offer moved to the Add card button", () => {
    const btn = code("src/components/AddCardButton.tsx");
    // It opens on PRESS, not on render — that is the whole change.
    expect(btn).toMatch(/onClick=\{\(\) => setOpen\(true\)\}/);
    expect(btn).toContain("More than one card is part of Pro");
    // And it shares the one offer, so the phone cannot drift from the laptop.
    // Parity and the App Store rules are measured on rendered output in
    // tests/render/pro-offer-parity.test.ts.
    expect(btn).toContain("ProOfferBlock");
    expect(btn).toContain("ProOfferCta");
  });
});

describe("hiding a row never renumbers another", () => {
  it("planInactive is still computed from the FULL list index", () => {
    // The LINK OFF — PRO ONLY badge marks cards past the Free limit by
    // POSITION. The map has to run over every card, with only visibility
    // changing, or a downgraded account's badges would move.
    // Since 2026-09-16 the live card can be CHOSEN when Pro ends, so the badge
    // keys off the live id list the dashboard passes (same helper as the public
    // pages), with the positional rule kept as the fallback.
    const c = code(LIST);
    expect(c).toMatch(/cards\.map\(\(card, cardIdx\) =>/);
    expect(c).toMatch(/const planInactive = !isPro && \(liveCardIds \? !liveCardIds\.includes\(card\.id\) : cardIdx >= freeCardLimit\)/);
  });

  it("collapsing is CSS, not conditional rendering", () => {
    // Rows stay in the DOM so one tree serves both viewports.
    const c = code(LIST);
    expect(c).toMatch(/"hidden sm:flex"/);
    expect(c, "rows are being filtered out instead of hidden").not.toMatch(
      /cards\.filter\([^)]*isActive/,
    );
  });

  it("keeps the LINK OFF badge on non-selected rows", () => {
    // The badge lives inside the mapped row, so a hidden row still has it and
    // it reappears correctly when the dropdown opens.
    const c = code(LIST);
    const rowStart = c.indexOf("cards.map(");
    const rowEnd = c.lastIndexOf("{upsell}");
    expect(c.slice(rowStart, rowEnd)).toMatch(/LINK OFF — PRO ONLY/);
  });
});

describe("desktop is unaffected", () => {
  it("every row is visible at sm+", () => {
    const c = code(LIST);
    // Selected row: plain flex. Others: hidden on mobile, flex from sm up.
    expect(c).toMatch(/"flex order-first sm:order-none"/);
    expect(c).toMatch(/"hidden sm:flex"/);
  });

  it("the selected card only jumps to the top on mobile", () => {
    // order-first without sm:order-none would reorder the desktop row too.
    expect(code(LIST)).toMatch(/order-first sm:order-none/);
  });

  it("the container and row classes are unchanged", () => {
    const c = code(LIST);
    expect(c).toMatch(/className="flex flex-wrap gap-2" role="radiogroup"/);
    // 240, not 200, since each row gained its Edit pencil (2026-09-29): the
    // tile minimum grew by exactly that footprint so the name kept its room.
    // Measured in tests/render/my-cards-edit-button.interactive.test.ts.
    expect(c).toMatch(/rounded-xl px-4 py-3 transition-all border flex-1 min-w-full sm:min-w-\[240px\]/);
  });
});

describe("selecting a card closes the dropdown", () => {
  it("the row link collapses on click", () => {
    // A soft navigation keeps this component mounted, so without this the
    // panel would stay open over the card just chosen.
    expect(code(LIST)).toMatch(/onClick=\{\(\) => setExpanded\(false\)\}/);
  });

  it("the toggle is a real button with expanded state announced", () => {
    const c = code(LIST);
    expect(c).toMatch(/type="button"/);
    expect(c).toMatch(/aria-expanded=\{expanded\}/);
    expect(c).toMatch(/aria-label=\{expanded \?/);
  });
});
