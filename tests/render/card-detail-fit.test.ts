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
import { detailLineBudget } from "@/components/card-templates/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Card details: as large as the card can carry, never larger ──────────────
//
// Owner, 2026-09-10: the details must be bigger and easier to read, phone and
// email above the rest, and a card carrying only two or three of them should
// use the room the others would have taken — "it looks very small... there is
// more space for that to take up" — while nothing may ever be cut off or
// overlap.
//
// Those two halves pull against each other, and only measurement can hold both.
// card-overflow.test.ts already proves nothing clips for two fixtures; this file
// adds the content scenarios a real user produces, an OVERLAP check (a distinct
// failure from clipping — grown text can collide with the QR or the footer
// while the card still reports no overflow), and the assertion that gives the
// change its point: a sparse card must render LARGER than a full one.

const TEMPLATES: Array<[string, React.ComponentType<{ data: CardData }>]> = [
  ["classic-pro", ClassicPro], ["modern-bold", ModernBold], ["photo-first", PhotoFirst],
  ["local-business", LocalBusiness], ["luxury-minimal", LuxuryMinimal], ["logo-first", LogoFirst],
];

const BASE: CardData = {
  name: "Alex Morgan", title: "Realtor", company: "Coastline Realty",
  phone: "(415) 555-0188", email: "alex@coastlinerealty.com", website: "coastlinehomes.com",
  initials: "AM", photoUrl: null, logoUrl: null, cardUrl: "swiftcard.me/card/alexmorgan",
};

/**
 * What people actually put on a card. Not adversarial input — every one of
 * these is a shape a working realtor or consultant produces, including the
 * three-line address and the extension nobody remembers to test.
 */
const SCENARIOS: Array<[string, CardData]> = [
  ["ordinary", BASE],
  ["email + website + address only", { ...BASE, phone: "", address: "1200 Ocean Ave\nSan Francisco, CA 94122" }],
  ["email only", { ...BASE, phone: "", website: "" }],
  ["phone only", { ...BASE, email: "", website: "" }],
  ["phone + email", { ...BASE, website: "" }],
  ["website + address only", { ...BASE, phone: "", email: "", address: "1200 Ocean Ave\nSan Francisco, CA 94122" }],
  ["a very long email", { ...BASE, email: "bartholomew.fitzgerald-montgomery@northwind-commercial-advisors.com" }],
  ["a very long website", { ...BASE, website: "northwind-commercial-real-estate-advisors-international.com" }],
  ["four-line address", { ...BASE, address: "1200 Ocean Avenue, Suite 400\nBuilding C, North Tower\nSan Francisco, CA 94122\nUnited States" }],
  ["three phones with labels", { ...BASE, customization: { phones: [
    { number: "+1 (512) 555-0147 ext. 8891", label: "mobile", showOnCard: true },
    { number: "(415) 555-0199", label: "office", showOnCard: true },
    { number: "(415) 555-0177", label: "direct", showOnCard: true }] } }],
  ["no details at all", { ...BASE, phone: "", email: "", website: "" }],
  ["website only", { ...BASE, phone: "", email: "" }],
  ["address only", { ...BASE, phone: "", email: "", website: "", address: "1200 Ocean Ave\nSan Francisco, CA 94122" }],
  ["email with nothing to break on", { ...BASE, email: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.com" }],
  ["one unbroken address line", { ...BASE, address: "Unit 14B Kensington Court Mansions Cromwell Road London SW7 4QH United Kingdom" }],
  ["four phones", { ...BASE, customization: { phones: [
    { number: "(415) 555-0188", label: "mobile", showOnCard: true },
    { number: "(415) 555-0199", label: "office", showOnCard: true },
    { number: "(415) 555-0177", label: "direct", showOnCard: true },
    { number: "(415) 555-0166", label: "home", showOnCard: true }] } }],
  ["email and fax only", { ...BASE, phone: "", website: "", customization: { fax: "(415) 555-0100" } }],
  ["accented name and address", { ...BASE, name: "Zoë Müller-Ståhl", company: "Ståhl & Compagnie Immobilière",
    email: "zoe.muller-stahl@immobiliere-cote-dazur.fr", address: "12 Rue de l\u2019Église\n06400 Cannes, France" }],
  ["long company and long address", { ...BASE,
    company: "Northwind Commercial Real Estate Advisors International",
    address: "1200 Ocean Avenue, Suite 400\nBuilding C, North Tower\nSan Francisco, CA 94122" }],
  ["single characters", { ...BASE, name: "A B", title: "X", company: "Y", phone: "5", email: "a@b.co", website: "c.co" }],
  // Owner sheet review 2026-09-17: the busiest real card — three labelled
  // phones, fax, a two-line address AND an email long enough to wrap.
  ["three phones, fax, address and a long email", { ...BASE,
    email: "alexander.morgan-whitfield@coastlinerealtygroup.com",
    address: "1200 Ocean Ave, Suite 400\nSan Francisco, CA 94122",
    customization: { fax: "(415) 555-0100", phones: [
      { number: "(415) 555-0188", label: "mobile", showOnCard: true },
      { number: "(415) 555-0199", label: "office", showOnCard: true },
      { number: "(415) 555-0177", label: "direct", showOnCard: true }] } }],
  ["everything at once", { ...BASE,
    title: "Senior Vice President of Business Development",
    address: "1200 Ocean Avenue, Suite 400\nSan Francisco, CA 94122\nUnited States",
    customization: {
      phones: [{ number: "(415) 555-0188", label: "mobile", showOnCard: true },
               { number: "(415) 555-0199", label: "office", showOnCard: true }],
      fax: "(415) 555-0100" } }],
];

type Probe = {
  clipped: string[];
  overlaps: string[];
  phonePx: number;
  emailPx: number;
  websitePx: number;
  addressPx: number;
  minTextPx: number;
};

describe("card details fit, never collide, and grow into spare room", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  async function probe(Template: React.ComponentType<{ data: CardData }>, data: CardData, width: number): Promise<Probe> {
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
        const anchor = card.querySelector('a[href^="tel:"], a[href^="mailto:"]') as HTMLElement | null;
        const block = anchor?.parentElement as HTMLElement | null;

        const clipped: string[] = [];
        const overlaps: string[] = [];

        // ── Nothing cut off ────────────────────────────────────────────────
        // Leaf text only: a wrapper "overflows" merely because its child does.
        const texts: Array<{ el: HTMLElement; r: DOMRect; t: string }> = [];
        for (const el of Array.from(card.querySelectorAll<HTMLElement>("*"))) {
          if (el.children.length > 0) continue;
          const t = (el.textContent || "").trim();
          if (!t) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          texts.push({ el, r, t });
          if (r.bottom > cr.bottom + 1 || r.right > cr.right + 1 || r.left < cr.left - 1) {
            clipped.push(`${t.slice(0, 34)} escapes the card`);
          }
          // Self-clipping only counts where the element actually clips. A
          // display glyph set at line-height 1 reports scrollHeight a few px
          // over clientHeight because its ascent and descent exceed the line
          // box — with overflow:visible nothing is hidden, and the card's own
          // overflow:hidden is already covered by the escape check above.
          // LuxuryMinimal's 100px "AM" monogram is exactly that case.
          const ov = getComputedStyle(el);
          const clips = ov.overflowX !== "visible" || ov.overflowY !== "visible";
          if (clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
            clipped.push(`${t.slice(0, 34)} clipped inside itself`);
          }
        }

        // ── Nothing overlapping ────────────────────────────────────────────
        // The failure grown text produces that clipping does not: a detail row
        // sliding under the QR or the footer while the card still fits.
        //
        // Scoped to pairs involving the CONTACT BLOCK, and skipping watermarks.
        // Some templates layer type on purpose — LuxuryMinimal sets a 100px
        // faded "AM" monogram behind the name — and a blanket "no two boxes
        // may intersect" rule calls that a defect. What this change could
        // actually break is a detail row landing on something, so that is what
        // is measured.
        const faded = (el: HTMLElement) => {
          let o = 1;
          for (let n: HTMLElement | null = el; n && n !== card; n = n.parentElement) {
            o *= parseFloat(getComputedStyle(n).opacity || "1");
          }
          return o < 0.35;
        };
        for (let i = 0; i < texts.length; i++) {
          for (let j = i + 1; j < texts.length; j++) {
            const a = texts[i], b = texts[j];
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            const inBlock = (e: HTMLElement) => !!block && block.contains(e);
            if (!inBlock(a.el) && !inBlock(b.el)) continue;
            if (faded(a.el) || faded(b.el)) continue;
            const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
            const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
            if (ox > 1 && oy > 1) overlaps.push(`"${a.t.slice(0, 20)}" over "${b.t.slice(0, 20)}"`);
          }
        }

        // ── The QR must stay clear ─────────────────────────────────────────
        // Called out by name (owner, 2026-09-10). It is the one element on the
        // card that stops WORKING when something lands on it — a covered QR
        // still looks like a QR and simply will not scan — so it gets its own
        // check rather than relying on the general overlap sweep.
        const qr = card.querySelector("[data-qr]") as HTMLElement | null;
        if (qr && block) {
          const q = qr.getBoundingClientRect();
          const bb = block.getBoundingClientRect();
          const ox = Math.min(q.right, bb.right) - Math.max(q.left, bb.left);
          const oy = Math.min(q.bottom, bb.bottom) - Math.max(q.top, bb.top);
          // On four templates the QR is the block's own corner (shared.tsx
          // DetailsQR), so the block's box contains it by design; what must
          // never touch it is a ROW — checked one by one below.
          if (!block.contains(qr) && ox > 1 && oy > 1) overlaps.push(`contact block covers the QR by ${Math.round(ox)}x${Math.round(oy)}px`);
          // …and every individual row, in case the block's own box is roomier
          // than the text inside it.
          for (const t of texts) {
            if (!block.contains(t.el)) continue;
            const rx = Math.min(q.right, t.r.right) - Math.max(q.left, t.r.left);
            const ry = Math.min(q.bottom, t.r.bottom) - Math.max(q.top, t.r.top);
            if (rx > 1 && ry > 1) overlaps.push(`"${t.t.slice(0, 20)}" covers the QR`);
          }
          if (q.right > cr.right + 1 || q.bottom > cr.bottom + 1) clipped.push("the QR escapes the card");
        }

        const px = (sel: string) => {
          const el = block?.querySelector(sel) as HTMLElement | null;
          return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
        };
        const rowText = (href: string) => {
          const a = block?.querySelector(`a[href^="${href}"]`) as HTMLElement | null;
          const span = a ? [...a.querySelectorAll("span")].find((s) => (s.textContent || "").trim().length > 3) : null;
          return span ? parseFloat(getComputedStyle(span).fontSize) : 0;
        };
        const bodyPx = texts
          .filter((t) => block?.contains(t.el))
          .map((t) => parseFloat(getComputedStyle(t.el).fontSize))
          .filter((n) => n > 0);

        return {
          clipped: [...new Set(clipped)],
          overlaps: [...new Set(overlaps)].slice(0, 4),
          phonePx: rowText("tel:"),
          emailPx: rowText("mailto:"),
          websitePx: rowText("http"),
          addressPx: px("span[style*='pre-line']"),
          minTextPx: bodyPx.length ? Math.min(...bodyPx) : 0,
        };
      });
    } finally {
      await page.close();
    }
  }

  // ── Nothing is ever cut off or overlapping, in any scenario ──────────────
  for (const [tname, Template] of TEMPLATES) {
    it(`${tname}: every content scenario fits with nothing overlapping`, async () => {
      for (const [sname, data] of SCENARIOS) {
        const r = await probe(Template, data, 460);
        expect(r.clipped, `${tname} — ${sname}`).toEqual([]);
        expect(r.overlaps, `${tname} — ${sname}`).toEqual([]);
      }
    }, 180_000);
  }

  // ── Phone and email lead the block ──────────────────────────────────────
  it("phone and email are larger than the website and the address", async () => {
    for (const [tname, Template] of TEMPLATES) {
      const r = await probe(Template, { ...BASE, address: "1200 Ocean Ave\nSan Francisco, CA 94122" }, 460);
      expect(r.phonePx, `${tname} phone vs website`).toBeGreaterThan(r.websitePx);
      expect(r.emailPx, `${tname} email vs website`).toBeGreaterThan(r.websitePx);
      expect(r.phonePx, `${tname} phone vs address`).toBeGreaterThan(r.addressPx);
      expect(r.emailPx, `${tname} email vs address`).toBeGreaterThan(r.addressPx);
      expect(r.phonePx, `${tname} phone vs email`).toBeGreaterThanOrEqual(r.emailPx);
    }
  }, 180_000);

  // ── The point of the change: spare room becomes size ─────────────────────
  it("a sparse card renders its details larger than a full one", async () => {
    const full = SCENARIOS.find(([n]) => n === "everything at once")![1];
    const sparse = SCENARIOS.find(([n]) => n === "email + website + address only")![1];
    for (const [tname, Template] of TEMPLATES) {
      const f = await probe(Template, full, 460);
      const s = await probe(Template, sparse, 460);
      // The email is the same address on both, and on both it now reaches the
      // edge of its panel — a full card no longer shrinks it. The rows that are
      // bound by HEIGHT, not width, are where spare room must show.
      expect(s.emailPx, `${tname}: a sparse card must not render smaller than a full one`).toBeGreaterThanOrEqual(f.emailPx);
      expect(s.addressPx, `${tname}: the sparse card's address must take its spare room`).toBeGreaterThan(f.addressPx);
    }
  }, 180_000);

  it("a card with one detail uses noticeably more of the space than a busy one", async () => {
    const one = SCENARIOS.find(([n]) => n === "phone only")![1];
    const busy = SCENARIOS.find(([n]) => n === "everything at once")![1];
    for (const [tname, Template] of TEMPLATES) {
      const a = await probe(Template, one, 460);
      const b = await probe(Template, busy, 460);
      expect(a.phonePx / b.phonePx, `${tname} one-detail vs busy`).toBeGreaterThan(1.25);
    }
  }, 180_000);

  // ── The policy itself, without a browser ────────────────────────────────
  it("budgets the height of every row it will draw", () => {
    // 100cqh ÷ this budget is the largest lead size at which the block fits,
    // so every row that renders must add to it — a row missing from the budget
    // is a row the block will grow straight past the QR to make room for.
    const none = detailLineBudget({ ...BASE, phone: "", email: "", website: "" });
    const one = detailLineBudget({ ...BASE, email: "", website: "" });
    const three = detailLineBudget(BASE);
    const withAddr = detailLineBudget({ ...BASE, address: "1200 Ocean Ave\nSan Francisco, CA 94122" });
    const withFax = detailLineBudget({ ...BASE, customization: { fax: "(415) 555-0100" } });
    const longEmail = detailLineBudget({ ...BASE, email: "bartholomew.fitzgerald-montgomery@northwind-commercial-advisors.com" });
    expect(none).toBe(1);
    expect(three).toBeGreaterThan(one);
    expect(withAddr).toBeGreaterThan(three);
    expect(withFax).toBeGreaterThan(three);
    // A long email wraps, so it is budgeted as two lines, not one.
    expect(longEmail).toBeGreaterThan(three);
  });

  it("reaches every template, and every place a card is rendered", () => {
    // The sizing lives inside ContactRows, but it sizes to the box its
    // template gives it — so every template must render it as a flex item that
    // takes the column's leftover height (card-detail-fill measures that).
    const dir = "src/components/card-templates";
    for (const file of ["ClassicPro", "ModernBold", "PhotoFirst", "LocalBusiness", "LuxuryMinimal", "LogoFirst"]) {
      const src = readFileSync(join(process.cwd(), `${dir}/${file}.tsx`), "utf8");
      expect(src, `${file} must render ContactRows`).toContain("<ContactRows");
      expect(src, `${file} still passes the retired contact scale`).not.toMatch(/contactScale|scale={/);
    }

    // …and the public card page — the link people actually share — must route
    // to those same six. A seventh template added here without the prop above
    // would render details at the old size on the real page while every
    // preview in the app looked right.
    const page = readFileSync(join(process.cwd(), "src/app/[username]/page.tsx"), "utf8");
    const registry = page.slice(page.indexOf("const TEMPLATES"), page.indexOf("};", page.indexOf("const TEMPLATES")));
    for (const id of ["classic-pro", "modern-bold", "photo-first", "local-business", "luxury-minimal", "logo-first"]) {
      expect(registry, `${id} missing from the public card page`).toContain(`"${id}"`);
    }
    // CustomCard is deliberately not in that list of six: its fields are
    // positioned by hand, so it has no shared contact block to size.
    expect(registry).toContain('"custom"');
  });

  it("never grows without bound, whatever the data", async () => {
    // A lone phone number stops at the design ceiling (DETAIL_MAX_PX) — the
    // same size as the person's name — however much room its panel has.
    const one = SCENARIOS.find(([n]) => n === "phone only")![1];
    for (const [tname, Template] of TEMPLATES) {
      expect((await probe(Template, one, 460)).phonePx, tname).toBeLessThanOrEqual(24.01);
    }
  }, 180_000);
});
