import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { launchBrowser, appCss } from "./harness";

import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import type { CardData } from "@/components/card-templates/types";

// ── Card details start at the top and fill downward ─────────────────────────
//
// Owner, 2026-09-18: "I just created a card and I only put my phone number on
// it. For some reason my phone number is on the bottom of the card where the
// details go. It should normally start filling from the top and then go down."
//
// Four templates laid the details column out as `justify-between` over
// [header, details, QR]. A full card hides that — there is no spare height to
// hand out — so it only ever showed on a SPARSE card, which is exactly what a
// new account's first card is. Measured before the fix, phone only:
// Local Business put the row at 159px of a 206px card (a full card starts at
// 107), Photo First and Luxury Minimal 24px below their header, Logo First 18.
//
// Only a browser can see this: the markup is identical either way, and the
// defect is where the spare pixels go. card-detail-fit.test.ts holds the other
// half (nothing clipped, nothing overlapping, sparse cards render larger).

const TEMPLATES: Array<[string, React.ComponentType<{ data: CardData }>]> = [
  ["classic-pro", ClassicPro], ["modern-bold", ModernBold], ["photo-first", PhotoFirst],
  ["local-business", LocalBusiness], ["luxury-minimal", LuxuryMinimal], ["logo-first", LogoFirst],
];

const BASE: CardData = {
  name: "Alex Morgan", title: "Realtor", company: "Coastline Realty",
  phone: "(415) 555-0188", email: "", website: "",
  initials: "AM", photoUrl: null, logoUrl: null, cardUrl: "swiftcard.me/card/alexmorgan",
};

/** Sparse on purpose — a packed card has no spare height to misplace. */
const SCENARIOS: Array<[string, CardData]> = [
  ["phone only", BASE],
  ["phone only, no title or company", { ...BASE, title: "", company: "" }],
  ["email only", { ...BASE, phone: "", email: "alex@coastlinerealty.com" }],
  ["website only", { ...BASE, phone: "", website: "coastlinehomes.com" }],
  ["phone + email", { ...BASE, email: "alex@coastlinerealty.com" }],
  ["address only", { ...BASE, phone: "", address: "1200 Ocean Ave\nSan Francisco, CA 94122" }],
];

/** The most a details block may sit below whatever is above it. DetailsGap is
 *  at most ~10px; the old layouts measured 18–52px. */
const MAX_GAP = 14;
/** The QR keeps the bottom of its column (its own padding + the accent bar). */
const MAX_QR_FROM_BOTTOM = 24;

describe("card details start right under the header, on every template", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  async function measure(Template: React.ComponentType<{ data: CardData }>, data: CardData, width: number) {
    const css = await appCss();
    const markup = renderToStaticMarkup(createElement(Template, { data }));
    const page = await browser.newPage({ viewportSize: { width: width + 80, height: 900 } });
    try {
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
         <style>body{margin:0;padding:20px;background:#fff}#h{width:${width}px}</style></head>
         <body class="sc-app"><div id="h">${markup}</div></body></html>`,
        { waitUntil: "load" },
      );
      return await page.evaluate(() => {
        const card = document.querySelector(".sc-card") as HTMLElement;
        const cr = card.getBoundingClientRect();
        // The details block: ContactRows' own container (it sets container-type).
        // The rows themselves: the block's size container stretches to the QR
        // by design (it is the room the rows may grow into), so where the
        // details START is the top of the rows inside it.
        const block = card.querySelector("[data-contact-block] > div") as HTMLElement;
        const top = block.getBoundingClientRect().top;

        const inFlow = (el: Element) => {
          const s = getComputedStyle(el as HTMLElement);
          const r = (el as HTMLElement).getBoundingClientRect();
          return s.position !== "absolute" && s.display !== "none" && el.getAttribute("aria-hidden") !== "true" && r.height > 0;
        };
        const prevInFlow = (el: Element) => {
          for (let p = el.previousElementSibling; p; p = p.previousElementSibling) if (inFlow(p)) return p as HTMLElement;
          return null;
        };

        // What sits directly above the details? The nearest in-flow sibling
        // walking up the tree, or — when the details are the first thing in
        // their column (Classic Pro, Modern Bold) — the column's own top edge.
        let gap = 0;
        for (let node: HTMLElement = block; ; node = node.parentElement as HTMLElement) {
          const prev = prevInFlow(node);
          if (prev) { gap = top - prev.getBoundingClientRect().bottom; break; }
          const par = node.parentElement as HTMLElement;
          const siblings = Array.from(par.children).filter(inFlow).length;
          // A column the details are the only thing in (the QR now lives
          // inside the details block on four templates — shared.tsx
          // DetailsQR) is still "their column": measure from its top rather
          // than climbing out into the panel beside it.
          const column = getComputedStyle(par).flexDirection === "column" && getComputedStyle(par).display.includes("flex");
          if (par === card || siblings > 1 || (column && par.getBoundingClientRect().width < cr.width * 0.9)) {
            gap = top - (par.getBoundingClientRect().top + parseFloat(getComputedStyle(par).paddingTop || "0"));
            break;
          }
        }

        const qr = (card.querySelector("[data-qr]") as HTMLElement).getBoundingClientRect();
        return {
          gap: Math.round(gap),
          qrFromBottom: Math.round(cr.bottom - qr.bottom),
          qrInside: qr.bottom <= cr.bottom + 1 && qr.top >= cr.top - 1,
          blockAboveQrBottom: block.getBoundingClientRect().top < qr.bottom,
        };
      });
    } finally {
      await page.close();
    }
  }

  for (const [name, Template] of TEMPLATES) {
    for (const [scenario, data] of SCENARIOS) {
      it(`${name} — ${scenario}`, async () => {
        // 460 is the width every real card is laid out at (CardScaler renders at
        // a fixed 460px and scales the result down to the screen); 400 is margin.
        for (const width of [400, 460]) {
          const m = await measure(Template, data, width);
          expect(m.gap, `${name} @${width}px: details sit ${m.gap}px below what is above them — they must start at the top and fill downward`).toBeLessThanOrEqual(MAX_GAP);
          expect(m.gap, `${name} @${width}px: details overlap what is above them`).toBeGreaterThanOrEqual(-1);
          expect(m.qrInside, `${name} @${width}px: the QR left the card`).toBe(true);
          expect(m.qrFromBottom, `${name} @${width}px: the QR is no longer pinned to the bottom (${m.qrFromBottom}px up)`).toBeLessThanOrEqual(MAX_QR_FROM_BOTTOM);
        }
      }, 120_000);
    }
  }
});
