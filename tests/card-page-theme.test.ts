import { describe, it, expect } from "vitest";
import { cardPageTheme } from "@/lib/card-page-theme";
import { META } from "@/lib/template-style-presets";

// The public card page paints its action buttons in the card's accent, with
// white text. Since 2026-10-15 every card Look sets the accent — and several
// are bright mint, teal, sky or coral, which slipped under the old
// brightness-only darkening and gave white-on-mint buttons at under 2:1.

function contrastWithWhite(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (l + 0.05);
}

describe("card page buttons read, whatever the card's accent", () => {
  it("every Look's accent gives white text at 3:1 or better", () => {
    for (const [t, m] of Object.entries(META)) {
      for (const l of m.looks) {
        const { accent } = cardPageTheme(l.accent, t);
        expect(contrastWithWhite(accent), `${t}/${l.name} ${l.accent} → ${accent}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("every accent swatch the editor offers does too", () => {
    for (const [t, m] of Object.entries(META)) {
      for (const a of m.accent.presets) {
        const { accent } = cardPageTheme(a, t);
        expect(contrastWithWhite(accent), `${t} swatch ${a} → ${accent}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("an accent that already reads is left exactly as picked", () => {
    expect(cardPageTheme("#2563eb", "classic-pro").accent).toBe("#2563eb");
    expect(cardPageTheme("#b08d57", "luxury-minimal").accent).toBe("#b08d57");
    expect(cardPageTheme("#be123c", "local-business").accent).toBe("#be123c");
    // Each template's own default is untouched too.
    for (const t of Object.keys(META)) {
      const d = META[t].accent.fallback;
      if (contrastWithWhite(d) >= 3) expect(cardPageTheme(null, t).accent, t).toBe(d);
    }
  });
});
