import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { SAMPLE_DATA, type CardData } from "@/components/card-templates/types";
import ClassicPro from "@/components/card-templates/ClassicPro";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { brightness, qrColors, qrInk, QR_MIN_GAP } from "@/lib/template-style";

// ── The "Accent / icons" picker colours the QR, on every template ────────────
//
// Owner, 2026-10-20: "when I choose a color for my accents and icons, it does
// not change the color of the QR code when adding or editing a card … we fixed
// this issue like ten times." Only Logo First had ever been fixed: Classic Pro
// pinned its code to navy, and Photo First to indigo on a dark info panel.
//
// Owner, 2026-11-12 (Glasshouse, accent #88f9c1 on a navy panel): the QR then
// came out GREEN — a light accent was darkened until it read on the QR's pale
// square, and darkened mint is #4b896a. "It has to be the exact same color
// that I choose." So the dots are now the accent EXACTLY, and a light accent
// moves onto a dark square instead (qrColors).
//
// This renders every template and reads the colours the QR was actually drawn
// in (MiniQR labels itself data-qr-bg / data-qr-fg — the same values Show QR
// and the PNG download copy), so a template that stops following the accent,
// or starts shading it again, fails here.

const TEMPLATES = { ClassicPro, LocalBusiness, LuxuryMinimal, ModernBold, PhotoFirst, LogoFirst } as Record<string, React.ComponentType<{ data: CardData }>>;
// Dark, mid and pale, including the Glasshouse mint and two near-whites.
const ACCENTS = ["#dc2626", "#16a34a", "#0891b2", "#fde047", "#88f9c1", "#e0f2fe", "#1e1b4b"];
const SURFACES = [undefined, "#111827", "#092e58", "#f5f5f4"];

function qrOf(C: React.ComponentType<{ data: CardData }>, customization: Record<string, unknown>) {
  const html = renderToStaticMarkup(React.createElement(C, { data: { ...SAMPLE_DATA, cardUrl: "https://swiftcard.me/card/x", customization } as CardData }));
  const m = html.match(/data-qr-bg="([^"]+)" data-qr-fg="([^"]+)"/);
  expect(m, "template rendered no QR").toBeTruthy();
  return { bg: m![1], fg: m![2] };
}

const custom = (accent: string, surface?: string) => ({ accentColor: accent, ...(surface ? { surfaceColor: surface, bgColor: surface } : {}) });

describe("the QR is the accent, exactly", () => {
  // Logo First lifts an accent that would vanish into its own ground (navy on
  // navy) before the icons use it; its QR is exactly what the icons show, so
  // only accents its ground leaves alone are compared to the picker here.
  for (const [name, C] of Object.entries(TEMPLATES)) {
    it(`${name}: the dots are the picked colour, never a shade of it`, () => {
      for (const surface of SURFACES) for (const accent of ACCENTS) {
        if (name === "LogoFirst" && Math.abs(brightness(accent) - brightness(surface ?? "#2c3a52")) < 60) continue;
        const { fg } = qrOf(C, custom(accent, surface));
        expect(fg.toLowerCase(), `${name} ${accent} on ${surface ?? "default"}`).toBe(accent);
      }
    });
  }

  it("Glasshouse: Photo First, #88f9c1 on its navy panel — mint dots on the navy itself", () => {
    expect(qrOf(PhotoFirst, { accentColor: "#88f9c1", bgColor: "#092e58", surfaceColor: "#092e58" })).toEqual({ fg: "#88f9c1", bg: "#092e58" });
  });

  it("a dark or mid accent keeps the template's own light square — those cards don't change", () => {
    expect(qrOf(ClassicPro, { accentColor: "#dc2626" })).toEqual({ fg: "#dc2626", bg: "#f0f5ff" });
    expect(qrOf(LuxuryMinimal, { accentColor: "#1e1b4b" })).toEqual({ fg: "#1e1b4b", bg: "#f5f0e8" });
    expect(qrOf(PhotoFirst, { accentColor: "#0891b2" })).toEqual({ fg: "#0891b2", bg: "#f5f0ff" });
  });
});

describe("…without ever making the code unscannable", () => {
  // Modern Bold is left out on purpose, as it always was: its code is the
  // accent on a plate made FROM the accent (qrPlate), a design of its own that
  // predates qrColors and was not changed by it.
  for (const [name, C] of Object.entries(TEMPLATES).filter(([n]) => n !== "ModernBold")) {
    it(`${name}: every accent clears the QR's own square`, () => {
      for (const surface of SURFACES) for (const accent of ACCENTS) {
        const { bg, fg } = qrOf(C, custom(accent, surface));
        expect(Math.abs(brightness(fg) - brightness(bg)), `${name} ${accent} on ${surface ?? "default"}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(QR_MIN_GAP);
      }
    });
  }

  it("every colour there is gets a square it clears", () => {
    for (let v = 0; v < 0x1000000; v += 0x0f0f0f) {
      const accent = `#${v.toString(16).padStart(6, "0")}`;
      for (const qrBg of ["#ffffff", "#f0f5ff", "#f5f0e8", "#fff8e6", "#F2F4F7"]) {
        const { fg, bg } = qrColors(accent, qrBg, "#7f7f7f", "#000000");
        expect(fg, accent).toBe(accent);
        expect(Math.abs(brightness(fg) - brightness(bg)), `${accent}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(QR_MIN_GAP);
      }
    }
  });

  // Encode exactly as MiniQR does (level M), paint it in the Glasshouse colours
  // with a quiet zone of the same navy, and read it back. Light dots on a dark
  // square: the code Modern Bold has always printed.
  it("the Glasshouse code decodes", () => {
    const text = "https://swiftcard.me/aaronlavi-glasshouselending";
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const n = qr.modules.size, scale = 4, quiet = 4, w = (n + quiet * 2) * scale;
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [dot, sq] = [rgb("#88f9c1"), rgb("#092e58")];
    const px = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const r = Math.floor(y / scale) - quiet, c = Math.floor(x / scale) - quiet;
      const on = r >= 0 && c >= 0 && r < n && c < n && qr.modules.data[r * n + c];
      const [R, G, B] = on ? dot : sq;
      const i = (y * w + x) * 4;
      px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = 255;
    }
    expect(jsQR(px, w, w)?.data).toBe(text);
  });
});

describe("no accent picked, no change", () => {
  it("each template keeps its own QR colour", () => {
    expect(qrOf(ClassicPro, {}).fg).toBe("#0e1b35");
    expect(qrOf(LocalBusiness, {}).fg).toBe("#b45309");
    expect(qrOf(LuxuryMinimal, {}).fg).toBe("#b08d57");
    expect(qrOf(PhotoFirst, {}).fg).toBe("#6d28d9");
    expect(qrOf(PhotoFirst, { bgColor: "#111827" }).fg).toBe("#1e1b4b");
    expect(qrOf(ClassicPro, {}).bg).toBe("#f0f5ff");
    expect(qrOf(PhotoFirst, { bgColor: "#111827" }).bg).toBe("#ffffff");
  });
});

describe("qrColors reads every colour the accent field can hold", () => {
  it("a short #rgb is the same colour as its #rrggbb", () => {
    expect(qrColors("#f00", "#ffffff", undefined, "#000000")).toEqual(qrColors("#ff0000", "#ffffff", undefined, "#000000"));
    expect(qrColors("#FD4", "#f0f5ff", undefined, "#000000")).toEqual(qrColors("#ffdd44", "#f0f5ff", undefined, "#000000"));
  });

  it("a colour it can't measure gets the template's own ink, never an unchecked code", () => {
    expect(qrColors("red", "#ffffff", undefined, "#0e1b35")).toEqual({ fg: "#0e1b35", bg: "#ffffff" });
    expect(qrColors("rgb(255, 0, 0)", "#ffffff", undefined, "#0e1b35")).toEqual({ fg: "#0e1b35", bg: "#ffffff" });
    expect(qrInk("red", "#ffffff", "#0e1b35")).toBe("#0e1b35");
  });

  it("a light panel is never used as the square for a light accent", () => {
    expect(qrColors("#88f9c1", "#ffffff", "#f5f5f4", "#000000").bg).toBe("#0b0f16");
  });
});
