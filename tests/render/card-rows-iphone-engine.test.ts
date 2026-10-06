import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { appCss } from "./harness";
import { BASE, HEADSHOT, LOGOS, FONTS, withFont } from "./card-fixtures";

import ClassicPro from "@/components/card-templates/ClassicPro";
import ModernBold from "@/components/card-templates/ModernBold";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import LocalBusiness from "@/components/card-templates/LocalBusiness";
import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { withoutSocials, type CardData } from "@/components/card-templates/types";

// ─────────────────────────────────────────────────────────────────────────────
// THE ROWS READ THE SAME IN THE IPHONE'S ENGINE.
//
// Owner, 2026-10-05, on their Photo First card: "where the phone number is,
// Mobile went under the number… it should always be to the right of the number
// and the number should be aligned with the phone icon. My email shifted… and
// put the M under the whole email."
//
// Every layout sweep ran in Chromium. The iPhone app and Safari are WebKit,
// and the QR-in-the-corner layout (shared.tsx DetailsQR) rendered differently
// there: the rows were squeezed beside the QR from the top of the block down.
// So an ordinary card is measured in BOTH engines here, row by row:
//   • a phone's label sits on the number's line, never under it;
//   • an ordinary email and website stay on one line;
//   • each value is vertically centred on its own icon.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES: Array<[string, React.ComponentType<{ data: CardData }>]> = [
  ["classic-pro", ClassicPro], ["modern-bold", ModernBold], ["photo-first", PhotoFirst],
  ["local-business", LocalBusiness], ["luxury-minimal", LuxuryMinimal], ["logo-first", LogoFirst],
];

const ph = (number: string, label: "mobile" | "office") => ({ number, label, showOnCard: true });
// Cards like the owner's: a labelled mobile and an ordinary email, with and
// without the rest of an everyday card.
const CASES: Array<[string, CardData]> = [
  ["mobile + email", { ...BASE, email: "aaron@malvecapital.com", customization: { phones: [ph("(347) 555-0188", "mobile")] } }],
  ["mobile + email + website", { ...BASE, email: "aaron@malvecapital.com", website: "malvecapital.com",
    customization: { phones: [ph("(347) 555-0188", "mobile")] } }],
  ["two phones + email + website + photo + logo", { ...BASE, email: "aaron@malvecapital.com", website: "malvecapital.com",
    photoUrl: HEADSHOT, logoUrl: LOGOS.square,
    customization: { phones: [ph("(347) 555-0188", "mobile"), ph("(212) 555-0199", "office")] } }],
  ["typical + address", { ...BASE, email: "alex@coastlinerealty.com", website: "coastlinehomes.com",
    address: "1200 Ocean Ave, Suite 400\nSan Francisco, CA 94122", customization: { phones: [ph("(415) 555-0188", "mobile")] } }],
];

async function rowsOf(page: Page, css: string, Template: React.ComponentType<{ data: CardData }>, data: CardData) {
  const markup = renderToStaticMarkup(createElement(Template, { data: withoutSocials(data) }));
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:20px;background:#fff}#h{width:460px}</style></head>
     <body class="sc-app"><div id="h">${markup}</div></body></html>`,
    { waitUntil: "load" },
  );
  return page.evaluate(() => {
    const block = document.querySelector("[data-contact-block]") as HTMLElement;
    const problems: string[] = [];
    const lines = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set(Array.from(r.getClientRects()).filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
    };
    // Phones: number and label share a line, and the number is centred on its icon.
    for (const a of Array.from(block.querySelectorAll('a[href^="tel:"]'))) {
      const icon = a.querySelector("svg")!.getBoundingClientRect();
      const spans = a.querySelectorAll(":scope > span:last-child > span");
      const num = spans[0] as HTMLElement;
      const label = spans[1] as HTMLElement | undefined;
      const n = num.getBoundingClientRect();
      if (label) {
        const l = label.getBoundingClientRect();
        if (l.top >= n.bottom - 2) problems.push(`"${label.textContent}" dropped under "${num.textContent}"`);
      }
      const iconMid = (icon.top + icon.bottom) / 2, numMid = (n.top + n.bottom) / 2;
      if (Math.abs(iconMid - numMid) > Math.max(3, n.height * 0.3)) problems.push(`"${num.textContent}" is not level with its icon (${Math.round(numMid - iconMid)}px)`);
    }
    // Email and website: one line, level with the icon.
    for (const sel of ['a[href^="mailto:"]', 'a[target="_blank"]']) {
      const a = block.querySelector(sel);
      if (!a) continue;
      const text = a.querySelector(":scope > span:last-child") as HTMLElement;
      if (lines(text) > 1) problems.push(`"${text.textContent}" wrapped onto ${lines(text)} lines`);
      const icon = a.querySelector("svg")!.getBoundingClientRect();
      const t = text.getBoundingClientRect();
      if (Math.abs((icon.top + icon.bottom) / 2 - (t.top + t.bottom) / 2) > Math.max(3, t.height * 0.3)) problems.push(`"${text.textContent}" is not level with its icon`);
    }
    // The QR, where it is in the block, is at the BOTTOM of it.
    const qr = block.querySelector("[data-qr]");
    if (qr) {
      const q = qr.getBoundingClientRect(), b = block.getBoundingClientRect();
      if (b.bottom - q.bottom > 4) problems.push(`QR sits ${Math.round(b.bottom - q.bottom)}px above the bottom of the details`);
    }
    return problems;
  });
}

for (const [engine, launcher] of [["Chromium", chromium], ["WebKit (iPhone)", webkit]] as const) {
  describe(`${engine}: phone labels beside the number, emails on one line, everything level with its icon`, () => {
    let browser: Browser;
    let page: Page;
    let css: string;
    beforeAll(async () => {
      browser = await launcher.launch();
      css = await appCss();
      page = await browser.newPage({ viewport: { width: 540, height: 900 } });
    }, 180_000);
    afterAll(async () => { await browser?.close(); });

    for (const [tname, Template] of TEMPLATES) {
      it(`${tname}`, async () => {
        const failures: string[] = [];
        for (const [fname, fontFamily] of FONTS) {
          for (const [cname, data] of CASES) {
            for (const p of await rowsOf(page, css, Template, withFont(data, fontFamily))) failures.push(`[${fname}] ${cname}: ${p}`);
          }
        }
        expect(failures, `${engine} ${tname}\n  ${failures.join("\n  ")}`).toEqual([]);
      }, 300_000);
    }
  });
}
