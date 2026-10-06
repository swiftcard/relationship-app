import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser, Page } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { launchBrowser, appCss } from "./harness";
import { SCENARIOS, FONTS, withFont } from "./card-fixtures";

import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import CustomCard, { FaceCard } from "@/components/card-templates/CustomCard";
import { withoutSocials, type CardData } from "@/components/card-templates/types";
import { LAYOUT_PRESETS, buildPreset } from "@/lib/custom-layout";
import { HEADSHOT } from "./card-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// EVERY TEMPLATE, FROM TWO FIELDS TO EVERY FIELD AT THE LIMITS.
//
// Owner, 2026-10-02: "card details will always maximize their space on the
// card but will never overlap on top of each other or cut off on the QR code
// (no matter how many things, even if every single field is added to the card
// or if two things are added to the card). For every card template."
//
// The card exactly as the public page draws it (socials stripped, real logo
// and headshot images), in every typeface, measured in Chromium:
//   1. no text or image leaves the card or is clipped;
//   2. nothing lands on anything else — text, logo, headshot;
//   3. the QR is whole, on the card, uncovered, and big enough to scan;
//   4. the details fill the room they are given.
// The fixtures stop at lib/card-limits — the ceiling the editor enforces.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES: Array<[string, React.ComponentType<{ data: CardData }>]> = [
  ["classic-pro", ClassicPro],
  ["modern-bold", ModernBold],
  ["photo-first", PhotoFirst],
  ["local-business", LocalBusiness],
  ["luxury-minimal", LuxuryMinimal],
  ["logo-first", LogoFirst],
];

const WIDTH = 460;
/** Smallest QR the templates draw (qrSize in shared.tsx) — still scans. */
const QR_MIN_PX = 54;
/** DETAIL_MAX_PX in shared.tsx — a lead row at the ceiling is full by design. */
const CEILING_PX = 24;

type Probe = { escapes: string[]; overlaps: string[]; qr: string[]; thin: string | null };

async function probe(page: Page, css: string, Template: React.ComponentType<{ data: CardData }>, data: CardData, keepSocials = false): Promise<Probe> {
  // Presets are drawn without socials (the public page strips them); a custom
  // card shows them, so it is measured with them.
  const markup = renderToStaticMarkup(createElement(Template, { data: keepSocials ? data : withoutSocials(data) }));
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:20px;background:#fff}#h{width:${WIDTH}px}</style></head>
     <body class="sc-app"><div id="h">${markup}</div></body></html>`,
    { waitUntil: "load" },
  );
  return page.evaluate(({ QR_MIN_PX, CEILING_PX }) => {
    const card = document.querySelector(".sc-card") as HTMLElement;
    const cr = card.getBoundingClientRect();
    const TOL = 1;
    const escapes: string[] = [];
    const edge = (r: DOMRect) => [
      r.right > cr.right + TOL ? `${Math.round(r.right - cr.right)}px past the right` : "",
      r.left < cr.left - TOL ? `${Math.round(cr.left - r.left)}px past the left` : "",
      r.bottom > cr.bottom + TOL ? `${Math.round(r.bottom - cr.bottom)}px below the bottom` : "",
      r.top < cr.top - TOL ? `${Math.round(cr.top - r.top)}px above the top` : "",
    ].filter(Boolean).join(", ");
    const decorative = (el: Element) => {
      for (let a: Element | null = el; a && a !== card; a = a.parentElement) {
        if (a.getAttribute("aria-hidden") === "true") return true;
      }
      return false;
    };
    const clippedBy = (r: DOMRect, el: Element) => {
      for (let a: HTMLElement | null = el as HTMLElement; a && a !== card; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        const ar = a.getBoundingClientRect();
        if (r.right > ar.right + TOL || r.bottom > ar.bottom + TOL || r.left < ar.left - TOL || r.top < ar.top - TOL) return true;
      }
      return false;
    };

    type Box = { label: string; rect: DOMRect; el: Element };
    const boxes: Box[] = [];

    // Text, by Range (see card-fit-sweep: a bare text node beside a child
    // element is invisible to an element-only walk).
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || "").trim();
      const el = n.parentElement;
      if (!text || !el || decorative(el)) continue;
      if (el.closest("[data-qr]")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      for (const r of rects) {
        const o = edge(r);
        if (o) escapes.push(`"${text.slice(0, 30)}" ${o}`);
        if (clippedBy(r, el)) escapes.push(`"${text.slice(0, 30)}" clipped by its container`);
      }
      boxes.push({ label: `"${text.slice(0, 22)}"`, rect: el.getBoundingClientRect(), el });
    }

    // Pictures: the logo and the headshot are content, and they can collide
    // with text or sit on the QR just as text can.
    for (const img of Array.from(card.querySelectorAll("img"))) {
      if (decorative(img) || img.closest("[data-qr]")) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // A full-bleed photo panel is a background the template draws text on
      // deliberately; it is never "covered". Only a framed picture is content.
      if (r.width >= cr.width * 0.9 || r.height >= cr.height * 0.9) continue;
      const o = edge(r);
      if (o) escapes.push(`[${img.alt || "image"}] ${o}`);
      if (clippedBy(r, img)) escapes.push(`[${img.alt || "image"}] clipped by its container`);
      boxes.push({ label: `[${img.alt || "image"}]`, rect: r, el: img });
    }

    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const oy = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        // Text boxes are judged on their layout boxes, which stacked display
        // lines overlap by ~2px as ordinary typography (card-fit-sweep).
        if (ox > 2 && oy > 2) overlaps.push(`${a.label} over ${b.label} (${Math.round(ox)}×${Math.round(oy)}px)`);
      }
    }

    const qrIssues: string[] = [];
    const qr = card.querySelector("[data-qr]") as HTMLElement | null;
    if (!qr) qrIssues.push("no QR on the card");
    else {
      const q = qr.getBoundingClientRect();
      const o = edge(q);
      if (o) qrIssues.push(`QR ${o}`);
      if (clippedBy(q, qr)) qrIssues.push("QR clipped by its container");
      if (Math.min(q.width, q.height) < QR_MIN_PX - 0.5) qrIssues.push(`QR only ${Math.round(Math.min(q.width, q.height))}px`);
      for (const b of boxes) {
        const ox = Math.min(q.right, b.rect.right) - Math.max(q.left, b.rect.left);
        const oy = Math.min(q.bottom, b.rect.bottom) - Math.max(q.top, b.rect.top);
        if (ox > 1 && oy > 1) qrIssues.push(`${b.label} covers the QR (${Math.round(ox)}×${Math.round(oy)}px)`);
      }
    }

    // Fills its room: by height, by width, or the lead row at the ceiling
    // (card-detail-fill's rule).
    let thin: string | null = null;
    const block = card.querySelector("[data-contact-block]") as HTMLElement | null;
    const inner = block?.firstElementChild as HTMLElement | null;
    if (block && inner && inner.children.length) {
      const b = block.getBoundingClientRect();
      let widest = 0, lead = 0;
      for (const row of Array.from(inner.children) as HTMLElement[]) {
        const r = document.createRange();
        r.selectNodeContents(row);
        widest = Math.max(widest, r.getBoundingClientRect().right - b.left);
        const t = row.querySelector("span:last-child") as HTMLElement | null;
        if (t) lead = Math.max(lead, parseFloat(getComputedStyle(t).fontSize));
      }
      const h = inner.getBoundingClientRect().height / b.height;
      const w = widest / b.width;
      if (!(h >= 0.8 || w >= 0.8 || lead >= CEILING_PX - 0.1)) {
        thin = `details fill only ${Math.round(h * 100)}% tall, ${Math.round(w * 100)}% wide (lead ${lead.toFixed(1)}px)`;
      }
    }

    return { escapes: [...new Set(escapes)], overlaps: [...new Set(overlaps)], qr: [...new Set(qrIssues)], thin };
  }, { QR_MIN_PX, CEILING_PX });
}

describe("every template: fills its space, nothing overlaps, the QR is never covered or cut", () => {
  let browser: Browser;
  let page: Page;
  let css: string;
  beforeAll(async () => {
    browser = await launchBrowser();
    css = await appCss();
    page = await browser.newPage({ viewport: { width: WIDTH + 80, height: 900 } });
  }, 180_000);
  afterAll(async () => { await browser?.close(); });

  for (const [tname, Template] of TEMPLATES) {
    it(`${tname}: two fields to every field at the limits, every typeface, both logo shapes`, async () => {
      const failures: string[] = [];
      for (const [fname, fontFamily] of FONTS) {
        for (const [sname, base] of SCENARIOS) {
          const shapes: Array<"auto" | "circle"> = base.logoUrl ? ["auto", "circle"] : ["auto"];
          for (const logoShape of shapes) {
            const data = withFont({ ...base, customization: { ...(base.customization ?? {}), logoShape } }, fontFamily);
            const r = await probe(page, css, Template, data);
            const tag = `[${fname}${logoShape === "circle" ? ", circle logo" : ""}] ${sname}`;
            for (const e of r.escapes) failures.push(`${tag}: CUT ${e}`);
            for (const o of r.overlaps) failures.push(`${tag}: OVERLAP ${o}`);
            for (const q of r.qr) failures.push(`${tag}: QR ${q}`);
            if (r.thin) failures.push(`${tag}: UNDERFILLED ${r.thin}`);
            if (process.env.SHOT_DIR && fname === "default" && logoShape === "auto") {
              await page.locator(".sc-card").screenshot({ path: `${process.env.SHOT_DIR}/${tname}--${sname.replace(/[^a-z0-9]+/gi, "-")}.png` });
            }
          }
        }
      }
      expect(failures, `${tname}: ${failures.length} problem(s)\n  ${failures.join("\n  ")}`).toEqual([]);
    }, 600_000);
  }
});

// ── Custom cards ─────────────────────────────────────────────────────────────
// Every starting design the Pro designer offers (each skeleton: split, mirror,
// stacked), with the same content shapes plus socials — a custom card prints
// them — and the uploaded-design card, whose only live element is the QR.
const SOCIALS = { instagram: "alexmorgan.realtor", linkedin: "alex-morgan-realtor", twitter: "alexmorganre", tiktok: "alexmorganhomes" };

describe("custom cards: every starting design, two fields to every field, nothing overlaps, QR clear", () => {
  let browser: Browser;
  let page: Page;
  let css: string;
  beforeAll(async () => {
    browser = await launchBrowser();
    css = await appCss();
    page = await browser.newPage({ viewport: { width: WIDTH + 80, height: 900 } });
  }, 180_000);
  afterAll(async () => { await browser?.close(); });

  for (const key of Object.keys(LAYOUT_PRESETS)) {
    it(`custom "${key}": every content shape, every typeface`, async () => {
      const failures: string[] = [];
      for (const [fname, fontFamily] of FONTS) {
        for (const [sname, base] of SCENARIOS) {
          for (const socials of [false, true]) {
            const layout = buildPreset(key);
            if (fontFamily) layout.fontFamily = fontFamily;
            const data: CardData = { ...base, ...(socials ? SOCIALS : {}), customization: { ...(base.customization ?? {}), customLayout: layout } };
            const r = await probe(page, css, CustomCard, data, true);
            const tag = `[${fname}${socials ? ", socials" : ""}] ${sname}`;
            for (const e of r.escapes) failures.push(`${tag}: CUT ${e}`);
            for (const o of r.overlaps) failures.push(`${tag}: OVERLAP ${o}`);
            // A custom card's QR scales with its density down to QR_MIN_PX (34)
            // in lib/custom-layout — its own floor, not the presets' 54.
            for (const q of r.qr.filter((m) => !/^QR only/.test(m) || Number(/(\d+)px/.exec(m)?.[1] ?? 0) < 34)) failures.push(`${tag}: QR ${q}`);
            // A FULL custom card uses its height: the details plus the QR
            // fill at least 70% of the main column. Before the density model
            // counted wrapping at the drawn size, every field at the limits
            // sat in the top half of the card with the rest empty.
            if (/^everything/.test(sname)) {
              const { fill, density } = await page.evaluate(() => {
                const card = document.querySelector(".sc-card") as HTMLElement;
                const qr = card.querySelector("[data-qr]") as HTMLElement;
                const col = qr.closest(".justify-between") as HTMLElement;
                const cs = getComputedStyle(col);
                const inner = col.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
                const used = Array.from(col.children).reduce((n, c) => n + (c as HTMLElement).getBoundingClientRect().height, 0);
                return { fill: used / inner, density: Number(card.dataset.density ?? 0) };
              });
              // At the density ceiling (1.14) every block is already as large
              // as it may be — what is left over is spare, not wasted (the same
              // rule as a preset's lead row at its 24px ceiling).
              // 70%: the model keeps SAFETY (10%) and must budget a logo as if
              // it were square — it cannot know the image's shape — so a wide
              // banner logo leaves ~24px of the band unused by design.
              if (fill < 0.7 && density < 1.13) failures.push(`${tag}: UNDERFILLED details + QR use ${Math.round(fill * 100)}% of the column at density ${density}`);
            }
            if (process.env.SHOT_DIR && fname === "default" && socials) {
              await page.locator(".sc-card").screenshot({ path: `${process.env.SHOT_DIR}/custom-${key}--${sname.replace(/[^a-z0-9]+/gi, "-")}.png` });
            }
          }
        }
      }
      expect(failures, `custom ${key}: ${failures.length} problem(s)\n  ${failures.join("\n  ")}`).toEqual([]);
    }, 600_000);
  }

  it("the uploaded-design card: its QR is whole, on the card and uncovered", async () => {
    const Face = ({ data }: { data: CardData }) => createElement("div", { className: "sc-card" }, createElement(FaceCard, { data, src: HEADSHOT }));
    const r = await probe(page, css, Face, { ...SCENARIOS[0][1] }, true);
    expect([...r.escapes, ...r.overlaps, ...r.qr.filter((m) => !/^QR only/.test(m))]).toEqual([]);
  }, 60_000);
});
