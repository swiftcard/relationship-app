import { describe, it, expect } from "vitest";
import { META, FALLBACK_META } from "@/lib/template-style-presets";

// ── One setting, one name ─────────────────────────────────────────────────────
//
// Owner report 2026-09-16: the accent control read "Accent / icons" on five
// templates and "Icons, title & QR" on Logo First. Same key (accentColor), same
// control, same Card design tab. A different name on one template reads as a
// different setting. What a colour paints on a particular template belongs in
// its hint; the label stays the same everywhere.
//
// These labels feed every card design surface at once: the new-card builder,
// Edit card (web and app), the homepage mini-builders and Office branding.
//
// Background and second-surface labels are deliberately NOT pinned: they name
// a different physical area on each layout ("Header stripe", "Photo panel").

const all = { ...META, fallback: FALLBACK_META };

describe("card design colour labels are the same on every template", () => {
  for (const field of ["accent", "text", "title", "company", "info"] as const) {
    it(`"${FALLBACK_META[field].label}" is called that on every template`, () => {
      const labels = Object.entries(all).map(([id, m]) => [id, m[field].label]);
      const off = labels.filter(([, l]) => l !== FALLBACK_META[field].label);
      expect(off, `these templates rename the ${field} control`).toEqual([]);
    });
  }
});
