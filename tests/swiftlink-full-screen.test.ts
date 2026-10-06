import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── A Swift Links page fills the whole phone screen ─────────────────────────
//
// Owner report 2026-10-06: "on the bottom there is a black thick line". Two
// causes, both pinned here:
// • The phone `zoom: 0.92` also shrank the sheet's own min-h-[100dvh], so a
//   short page ended ~68px above the bottom of the screen (measured 776px of
//   844px) and the Look's darker page colour showed under it. The sheet now
//   grows to fill main, which zoom cannot shorten.
// • The site canvas under the page is near-black on a dark-mode phone, and
//   Safari shows it beneath its toolbar and in the bounce. The page now paints
//   the canvas itself — never in the embedded designer preview.

const src = readFileSync(join(process.cwd(), "src/components/SwiftLinkProfile.tsx"), "utf8");

describe("Swift Links page fills the phone", () => {
  it("main is a flex column and the sheet grows into it on phones", () => {
    expect(src).toContain(`"sc-sl-page min-h-[100dvh] flex flex-col"`);
    expect(src).toContain(`grow shrink-0 md:grow-0 min-h-[100dvh]`);
  });

  it("a glass Look's frosted panel runs to the bottom of the screen, no edge across the page", () => {
    expect(src).toContain(`"sc-sl-fillcol grow shrink-0`);
    expect(src).toContain("className={`sc-sl-body relative px-4 pb-9");
    expect(src).toContain(".sc-sl-fillcol > .sc-sl-body { flex-grow: 1; }");
  });

  it("the canvas under the page takes the page's colour, only on the public page", () => {
    expect(src).toContain("const canvasCss = embedded ? \"\" :");
    expect(src).toContain(":root:has(main.sc-sl-page) body");
  });

  it("only plain hex colours reach the stylesheet", () => {
    expect(src).toContain("/^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback");
    // Every colour interpolated into canvasCss passes through hex() or is the
    // color-mix built from hex() values.
    const css = src.slice(src.indexOf("const canvasCss"), src.indexOf("\n", src.indexOf("const canvasCss")));
    expect(css).not.toMatch(/\$\{(sheetBg|look\.page|pageStyle)/);
  });
});
