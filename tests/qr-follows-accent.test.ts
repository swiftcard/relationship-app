import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SAMPLE_DATA, type CardData } from "@/components/card-templates/types";
import ClassicPro from "@/components/card-templates/ClassicPro";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { brightness } from "@/lib/template-style";

// ── The "Accent / icons" picker colours the QR, on every template ────────────
//
// Owner, 2026-10-20: "when I choose a color for my accents and icons, it does
// not change the color of the QR code when adding or editing a card … we fixed
// this issue like ten times." Only Logo First had ever been fixed: Classic Pro
// pinned its code to navy, and Photo First to indigo on a dark info panel.
// This renders every template and reads the colour the QR was actually drawn
// in (MiniQR labels itself data-qr-fg — the same value Show QR and the PNG
// download copy), so a template that stops following the accent fails here.

const TEMPLATES = { ClassicPro, LocalBusiness, LuxuryMinimal, ModernBold, PhotoFirst, LogoFirst } as Record<string, React.ComponentType<{ data: CardData }>>;
const ACCENTS = ["#dc2626", "#16a34a", "#0891b2", "#fde047"];
const SURFACES = [undefined, "#111827"];

function qrOf(C: React.ComponentType<{ data: CardData }>, customization: Record<string, unknown>) {
  const html = renderToStaticMarkup(React.createElement(C, { data: { ...SAMPLE_DATA, cardUrl: "https://swiftcard.me/card/x", customization } as CardData }));
  const m = html.match(/data-qr-bg="([^"]+)" data-qr-fg="([^"]+)"/);
  expect(m, "template rendered no QR").toBeTruthy();
  return { bg: m![1], fg: m![2] };
}

const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Same hue family: the QR colour is the accent, or the accent darkened. */
function sameHue(accent: string, fg: string) {
  const [a, b] = [rgb(accent), rgb(fg)];
  const ia = a.indexOf(Math.max(...a)), ib = b.indexOf(Math.max(...b));
  return ia === ib;
}

describe("the QR follows the accent", () => {
  for (const [name, C] of Object.entries(TEMPLATES)) {
    it(`${name}: a different accent gives a different QR colour, in that accent's hue`, () => {
      for (const surface of SURFACES) {
        const seen = new Set<string>();
        for (const accent of ACCENTS) {
          const { fg } = qrOf(C, { accentColor: accent, ...(surface ? { surfaceColor: surface, bgColor: surface } : {}) });
          expect(sameHue(accent, fg), `${name} ${accent} on ${surface ?? "default"} drew ${fg}`).toBe(true);
          seen.add(fg.toLowerCase());
        }
        expect(seen.size, `${name} on ${surface ?? "default"}`).toBe(ACCENTS.length);
      }
    });
  }
});

describe("…without ever making the code unscannable", () => {
  // Modern Bold is left out on purpose: its code is light-on-dark over a plate
  // made FROM the accent (qrPlate), a design of its own that predates this and
  // was not changed by it.
  for (const [name, C] of Object.entries(TEMPLATES).filter(([n]) => n !== "ModernBold")) {
    it(`${name}: every accent clears the QR's own background`, () => {
      for (const surface of SURFACES) for (const accent of ACCENTS) {
        const { bg, fg } = qrOf(C, { accentColor: accent, ...(surface ? { surfaceColor: surface, bgColor: surface } : {}) });
        expect(Math.abs(brightness(fg) - brightness(bg)), `${name} ${accent}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(100);
      }
    });
  }
});

describe("no accent picked, no change", () => {
  it("each template keeps its own QR colour", () => {
    expect(qrOf(ClassicPro, {}).fg).toBe("#0e1b35");
    expect(qrOf(LocalBusiness, {}).fg).toBe("#b45309");
    expect(qrOf(LuxuryMinimal, {}).fg).toBe("#b08d57");
    expect(qrOf(PhotoFirst, {}).fg).toBe("#6d28d9");
    expect(qrOf(PhotoFirst, { bgColor: "#111827" }).fg).toBe("#1e1b4b");
  });
});
