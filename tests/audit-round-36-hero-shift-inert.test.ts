import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 36 (2026-10-19): marketing pages that hold still ────────────
//
// P-04     /templates scored CLS 0.61 on a phone and 0.33 on a computer
//          (measured on a production build, slow 4G, 4× CPU). Two causes, both
//          measured, neither the one the audit guessed: the hero's glow was a
//          ::before box sized in % of the hero, so it "shifted" every time the
//          hero settled; and the headline wrapped in the fallback font (677px
//          in a 672px column) and snapped to one line when Bricolage arrived.
//          After: 0.001 and 0.044. Every other hero page was screenshotted
//          before and after — identical to within 6/255 on a few pixels.
// F-MKT-06 The homepage's phone mockup was aria-hidden but not inert, so its
//          real tel:/mailto:/social links sat in the Tab order on 19 pages.
//          The nightly sweep now checks every page for this.

const read = (p: string) => readFileSync(p, "utf8");

describe("P-04: the hero glow is a background, not a growing box", () => {
  const css = read("src/app/home.css");

  it("no ::before on the page hero, and the same light painted as the section's background", () => {
    expect(css).not.toMatch(/\.hp-page-hero::before/);
    const rule = css.slice(css.indexOf(".hp-page-hero {"), css.indexOf("}", css.indexOf(".hp-page-hero {")));
    expect(rule).toContain("radial-gradient(60% 54% at 50% -13%, rgba(77,168,245,.16), transparent 70%), #fff");
    expect(rule).toContain("position: relative");
    expect(rule).toContain("overflow: hidden");
  });

  it("the /templates headline has room for its fallback font on one line", () => {
    const src = read("src/components/site/AiDesignerShowcase.tsx");
    expect(src).toContain('className="rd-h2 text-[clamp(2.2rem,5vw,3.6rem)] text-slate-900 mt-4 lg:-mx-6"');
  });
});

describe("F-MKT-06: a decorative mockup takes nothing out of the Tab order", () => {
  it("the homepage phone is inert as well as aria-hidden", () => {
    expect(read("src/components/site/HomeCardPhone.tsx")).toContain('<div inert aria-hidden="true" className="pointer-events-none select-none">');
  });

  it("the nightly sweep flags anything focusable inside aria-hidden that isn't inert", () => {
    const sweep = read("scripts/qa-sweep.mjs");
    expect(sweep).toContain('out.push(["focusable-in-aria-hidden", desc(el)])');
    expect(sweep).toContain('if (!el.closest(\'[aria-hidden="true"]\') || el.closest("[inert]") || el.tabIndex < 0 || el.disabled) continue;');
  });
});
