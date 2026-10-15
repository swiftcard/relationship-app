import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fitPx, fitTitle, fitName, fitOneLineLimit, titleLoad, contactRowCount } from "@/components/card-templates/shared";
import type { CardData } from "@/components/card-templates/types";

// Deterministic half of the card-layout guard. The browser harness
// (tests/render/) measures real pixels but needs Chromium; these run everywhere
// in milliseconds and pin the two things that actually caused text to be cut off:
//
//   1. the fitting curve's real limit, which used to be undocumented, and
//   2. which fields are routed through fitting at all — title and phone were not,
//      which is why they overflowed while everything around them was fine.

const base = 13;

describe("fitPx keeps rendered width constant — up to a limit it must not hide", () => {
  it("does not touch text at or under the comfy length", () => {
    expect(fitPx(base, "short", 22)).toBe(base);
    expect(fitPx(base, "x".repeat(22), 22)).toBe(base);
  });

  it("holds rendered width constant while the curve is in charge", () => {
    // width == length * fontSize. That product is the whole promise.
    const ref = 22 * base;
    for (const len of [23, 30, 40, fitOneLineLimit(22)]) {
      const width = len * fitPx(base, "x".repeat(len), 22);
      expect(width, `len ${len}`).toBeCloseTo(ref, 0);
    }
  });

  it("STOPS holding it past the floor — and fitOneLineLimit says exactly where", () => {
    // This is the bug that shipped: the floor silently took over and rendered
    // width started growing again, while the comment above fitPx still promised
    // it was constant. Pinning the limit means the next person reads the truth.
    const limit = fitOneLineLimit(22);
    const beyond = limit + 20;
    const widthAtLimit = limit * fitPx(base, "x".repeat(limit), 22);
    const widthBeyond = beyond * fitPx(base, "x".repeat(beyond), 22);
    expect(widthBeyond).toBeGreaterThan(widthAtLimit);
    // Callers past this point MUST be able to wrap; nowrap + this = text off the card.
    expect(limit).toBeGreaterThan(40);
  });

  it("never returns a size that would be illegible", () => {
    expect(fitPx(base, "x".repeat(500), 22)).toBeGreaterThanOrEqual(base * 0.3);
  });
});

describe("titles", () => {
  it("leaves ordinary job titles completely alone", () => {
    // If this breaks, every existing card with a normal title shifts — the exact
    // kind of silent visual regression this whole exercise is meant to prevent.
    for (const t of ["Realtor", "Chief Marketing Officer", "Senior Vice President"]) {
      expect(fitTitle(9.5, t), t).toBe(9.5);
      expect(titleLoad({ title: t } as CardData), t).toBe(0);
    }
  });

  it("shrinks and buys layout budget only once a title is genuinely long", () => {
    const long = "Senior Vice President of Business Development & Strategic Partnerships";
    expect(fitTitle(9.5, long)).toBeLessThan(9.5);
    expect(titleLoad({ title: long } as CardData)).toBeGreaterThan(0);
  });

  it("caps the budget a title can take, so it cannot crush the rest of the card", () => {
    expect(titleLoad({ title: "x".repeat(400) } as CardData)).toBeLessThanOrEqual(1.1);
  });

  it("counts a long title as card density, which is what stopped it being clipped", () => {
    const withShort = { title: "Realtor", email: "a@b.co" } as CardData;
    const withLong = { title: "x".repeat(90), email: "a@b.co" } as CardData;
    expect(contactRowCount(withLong)).toBeGreaterThan(contactRowCount(withShort));
  });
});

describe("fitName still guards the single-long-word case", () => {
  it("shrinks for a long unbreakable first name", () => {
    expect(fitName(24, "Bartholomewfitzgerald Smith", 16)).toBeLessThan(24);
  });
  it("leaves an ordinary name alone", () => {
    expect(fitName(24, "Alex Morgan", 16)).toBe(24);
  });
});

// ── Coverage guard ───────────────────────────────────────────────────────────
//
// The reason the title bug existed at all: name, company, email and website were
// each fitted, and nobody noticed title wasn't. Reading the source doesn't make
// that obvious — every template looked fine on its own. This makes a skipped
// field fail the build instead.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const STOCK_TEMPLATES = ["ClassicPro", "ModernBold", "PhotoFirst", "LocalBusiness", "LuxuryMinimal", "LogoFirst"];

describe("every text field on a card goes through a fitter", () => {
  for (const t of STOCK_TEMPLATES) {
    it(`${t} fits its name, title and company`, () => {
      const src = read(`src/components/card-templates/${t}.tsx`);
      expect(src, `${t}: name not fitted`).toMatch(/fitName\(/);
      expect(src, `${t}: title not fitted — this is exactly how titles got cut off`).toMatch(/fitTitle(Fluid)?\(/);
      // …and it is the FLUID one: a short title has to grow into the room it
      // has (owner, 2026-09-17: "my title, which says CEO, is tiny"), measured
      // against the column its parent declares with titleBox.
      expect(src, `${t}: the title does not grow into its column`).toMatch(/fitTitleFluid\(/);
      expect(src, `${t}: the title has no container to measure against`).toMatch(/titleBox/);
      // fitCompany, not fitPx. Length-based fitting sizes text by how MANY
      // characters there are and knows nothing about the longest word, so a
      // company name next to a logo was still being split in the middle
      // ("COASTLIN / E REALTY"). fitCompany takes the column width and keeps the
      // longest word whole. Requiring it here rather than accepting either is
      // deliberate: fitPx alone is what allowed the split.
      // fitCompanyFluid is fitCompany measured against the column the name
      // actually gets (companyCell) — the same longest-word rule, in CSS.
      expect(src, `${t}: company not fitted`).toMatch(/fitCompany(Fluid)?\([^)]*data\.company/);
    });

    it(`${t} lets the name wrap rather than run off the card`, () => {
      // Fitting is length-based and cannot know the container's width, so a word
      // that is short by character count can still be too wide in pixels. The
      // wrap is the backstop that makes overflow impossible either way.
      const src = read(`src/components/card-templates/${t}.tsx`);
      expect(src, `${t}: name has no wrap escape hatch`).toMatch(/overflowWrap:\s*"anywhere"/);
    });
  }

  it("ContactRows fits the phone, email and website", () => {
    const src = read("src/components/card-templates/shared.tsx");
    expect(src, "phone not fitted — an extension used to run off the card").toMatch(/fitPx\([^)]*formatPhone/);
    // fitGrownPx is fitPx for rows that grow on a sparse card, capped so the
    // growth can never widen the line past the calibrated budget.
    expect(src, "fitGrownPx must still be built on fitPx").toMatch(/export function fitGrownPx[\s\S]*?fitPx\(base \* grow/);
    // Since 2026-09-22 every row is sized in CSS as the smallest of its share of
    // the block's HEIGHT and what fits ACROSS the block's width — so each row's
    // size must go through `across(` (width) and `u(` / --sc-u (height).
    const rows = src.slice(src.indexOf("export function ContactRows"));
    for (const [name, re] of [
      ["phone", /const phoneSize = [\s\S]*?var\(--sc-u\)[\s\S]*?across\(ROW_CHROME_PX, phoneBudget/],
      ["email", /const emailSize = [\s\S]*?u\(rel\.email\)[\s\S]*?across\(24, [^)]*email\.length/],
      ["website", /const webSize = [\s\S]*?u\(rel\.web\)[\s\S]*?across\(24, [^)]*web\.length/],
      ["fax", /const faxSize = [\s\S]*?u\(rel\.fax\)[\s\S]*?across\(ROW_CHROME_PX, phoneEm\(formatPhone\(fax\)/],
      ["address", /const addrSize = [\s\S]*?u\(rel\.addr\)[\s\S]*?across\(22, addrLongest/],
    ] as const) {
      expect(rows, `${name} row is not fitted to both the block's width and height`).toMatch(re);
    }
  });

  it("the email and website rows can wrap, because fitting alone cannot save them", () => {
    // They were `whiteSpace: nowrap` on the strength of a guarantee fitPx does
    // not make past its floor. nowrap + unfittable = text hanging off the card.
    const src = read("src/components/card-templates/shared.tsx");
    const rows = src.slice(src.indexOf("export function ContactRows"));
    expect(rows).toMatch(/overflowWrap:\s*"anywhere"/);
  });
});
