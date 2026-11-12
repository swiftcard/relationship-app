import { describe, it, expect } from "vitest";
import { cardPageTheme, ACCENT_DARK_TEXT } from "@/lib/card-page-theme";
import { META } from "@/lib/template-style-presets";

// The public card page paints its action buttons in the card's accent.
//
// Owner, 2026-11-12 (Glasshouse, accent #88f9c1): "on the Save Contact button
// and all those other buttons, it comes up as green… It has to be the exact
// same color that I choose." The theme used to DARKEN a light accent until
// white text read on it — mint became #4b896a. Now the button is the accent
// exactly and the TEXT changes: white where it reads, dark ink where it doesn't.

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const everyAccent = (): [string, string][] => {
  const out: [string, string][] = [];
  for (const [t, m] of Object.entries(META)) {
    for (const l of m.looks) out.push([t, l.accent]);
    for (const a of m.accent.presets) out.push([t, a]);
  }
  for (const a of ["#88f9c1", "#34d399", "#fde047", "#ffffff", "#e0f2fe", "#2563eb", "#000000"]) out.push(["photo-first", a]);
  return out.filter(([, a]) => /^#[0-9a-f]{6}$/i.test(a));
};

describe("card page buttons are the card's accent, exactly", () => {
  it("every Look, every editor swatch, and the Glasshouse mint come back untouched", () => {
    for (const [t, a] of everyAccent()) {
      expect(cardPageTheme(a, t).accent, `${t} ${a}`).toBe(a.toLowerCase());
    }
  });

  it("Glasshouse: #88f9c1 stays #88f9c1, with dark text", () => {
    const th = cardPageTheme("#88f9c1", "photo-first");
    expect(th.accent).toBe("#88f9c1");
    expect(th.accentText).toBe(ACCENT_DARK_TEXT);
    expect(th.accentInk).toBe(ACCENT_DARK_TEXT);
  });

  it("each template's own default is untouched", () => {
    for (const t of Object.keys(META)) {
      const d = META[t].accent.fallback;
      if (/^#[0-9a-f]{6}$/i.test(d)) expect(cardPageTheme(null, t).accent, t).toBe(d);
    }
  });
});

describe("…and the text on them always reads", () => {
  it("text on every accent is at 3:1 or better", () => {
    for (const [t, a] of everyAccent()) {
      const th = cardPageTheme(a, t);
      expect(contrast(th.accentText, th.accent), `${t} ${a} → ${th.accentText}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("an accent that already carried white text keeps white", () => {
    for (const a of ["#2563eb", "#b08d57", "#be123c", "#1d4ed8", "#6d28d9"]) {
      expect(cardPageTheme(a, "classic-pro").accentText, a).toBe("#ffffff");
      expect(cardPageTheme(a, "classic-pro").accentInk, a).toBe(a);
    }
  });

  it("an outline label on white reads too", () => {
    for (const [t, a] of everyAccent()) {
      const th = cardPageTheme(a, t);
      expect(contrast(th.accentInk, "#ffffff"), `${t} ${a} → ${th.accentInk}`).toBeGreaterThanOrEqual(3);
    }
  });
});
