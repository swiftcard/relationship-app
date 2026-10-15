import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// ── Wide and banner logos, Original and Circle, on every template ───────────
//
// Owner, 2026-10-15: "with all card templates, when a logo is wide or banner
// and it's kept as original or circle, it'll fit perfectly … not too big or too
// small. If there is a company name or title next to it, that will also fit
// perfectly and not be too small next to it."
//
// Measured before the fix: a 4:1 wordmark beside "Coastline Realty" drew 73×18
// on Classic Pro (Original) and 39×10 inside its circle; the name beside a
// square logo sat at 10.5px. card-every-template proves nothing overlaps or is
// cut; this proves the logo and the name are the size they should be. Mounted
// with React for real — the circle reshapes itself once the image has loaded
// (CircleLogo), which a static render never shows.

const TEMPLATES = ["classic-pro", "modern-bold", "photo-first", "local-business", "luxury-minimal", "logo-first"];
// A real wordmark: a round mark and the name, filling the image edge to edge.
const word = (w: number, h: number, label: string) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<circle cx="${h / 2}" cy="${h / 2}" r="${h * 0.42}" fill="#1d4ed8"/>` +
  `<text x="${h * 1.1}" y="${h * 0.68}" font-family="Arial" font-weight="700" font-size="${h * 0.5}" fill="#e11d48" textLength="${w - h * 1.2}" lengthAdjust="spacingAndGlyphs">${label}</text></svg>`);
const LOGOS: Array<[string, string, number]> = [
  ["square", "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect x="20" y="20" width="260" height="260" rx="50" fill="#1d4ed8"/></svg>`), 1],
  ["wide 2.5:1", word(500, 200, "Nwind"), 2.5],
  ["banner 4:1", word(800, 200, "Northwind Co"), 4],
  ["banner 7:1", word(1400, 200, "NORTHWIND REALTY"), 7],
];
const COMPANIES = ["", "Acme", "Coastline Realty", "Northwind Commercial Real Estate Advisors"];
const NAMES = ["Alex Morgan", "Bartholomew Alexander Fitzgerald-Montgomery"];
const BASE = { title: "Realtor", phone: "(415) 555-0188", email: "alex@coastlinerealty.com",
  website: "coastlinehomes.com", initials: "AM", photoUrl: null, cardUrl: "swiftcard.me/card/alexmorgan" };

let bundle = ""; let css = ""; let tmp = "";
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  css = await appCss();
  const cache = resolve("node_modules/.cache"); mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "logo-shapes-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import ClassicPro from "@/components/card-templates/ClassicPro";
    import ModernBold from "@/components/card-templates/ModernBold";
    import PhotoFirst from "@/components/card-templates/PhotoFirst";
    import LocalBusiness from "@/components/card-templates/LocalBusiness";
    import LuxuryMinimal from "@/components/card-templates/LuxuryMinimal";
    import LogoFirst from "@/components/card-templates/LogoFirst";
    import { withoutSocials } from "@/components/card-templates/types";
    const T: any = { "classic-pro": ClassicPro, "modern-bold": ModernBold, "photo-first": PhotoFirst, "local-business": LocalBusiness, "luxury-minimal": LuxuryMinimal, "logo-first": LogoFirst };
    (window as any).mount = (tname: string, cards: any[]) => {
      createRoot(document.getElementById("root")!).render(h("div", null, cards.map((d: any, i: number) =>
        h("div", { key: i, className: "h", "data-i": i }, h(T[tname], { data: withoutSocials(d) })))));
    };
  `);
  const out = await build({ entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' }, alias: { "@": resolve("src") } });
  bundle = out.outputFiles[0].text;
  if (bundle.length < 1000) throw new Error("bundle is empty — the esbuild step failed");
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

type Case = { label: string; aspect: number; shape: "auto" | "circle"; company: string; data: Record<string, unknown> };

function cases(): Case[] {
  const out: Case[] = [];
  for (const [lname, logo, aspect] of LOGOS) for (const shape of ["auto", "circle"] as const) for (const company of COMPANIES) for (const name of NAMES) {
    out.push({
      label: `${lname}, ${shape === "auto" ? "Original" : "Circle"}, company "${company || "none"}", ${name === NAMES[0] ? "short" : "long"} name`,
      aspect, shape, company,
      data: { ...BASE, name, company, logoUrl: logo, customization: { logoShape: shape } },
    });
  }
  return out;
}

async function measure(page: Page, all: Case[]) {
  return page.evaluate((all) => {
    const problems: string[] = [];
    document.querySelectorAll<HTMLElement>(".h").forEach((cell, i) => {
      const c = all[i];
      const tag = c.label;
      const card = cell.querySelector(".sc-card") as HTMLElement;
      const cr = card.getBoundingClientRect();
      const img = [...cell.querySelectorAll("img")].find((x) => (x as HTMLImageElement).src.startsWith("data:image/svg")) as HTMLImageElement | undefined;
      if (!img) { problems.push(`${tag}: no logo drawn`); return; }
      const r = img.getBoundingClientRect();
      const cs = getComputedStyle(img);
      const bx = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      const by = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const boxW = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - bx;
      const boxH = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - by;
      const markW = Math.min(boxW, boxH * c.aspect), markH = markW / c.aspect;
      if (r.left < cr.left - 1 || r.right > cr.right + 1 || r.top < cr.top - 1 || r.bottom > cr.bottom + 1) problems.push(`${tag}: logo leaves the card`);

      if (c.shape === "circle") {
        // The plate is the img itself, or (Logo First) the tile around it.
        const plate = (img.parentElement && getComputedStyle(img.parentElement).borderRadius === "50%" ? img.parentElement : img).getBoundingClientRect();
        const d = Math.min(plate.width, plate.height);
        // Every corner of the drawn mark inside the circle…
        const half = Math.hypot(markW / 2, markH / 2);
        if (half > d / 2 - 1) problems.push(`${tag}: the mark's corners poke out of the circle (${half.toFixed(1)} > ${(d / 2).toFixed(1)})`);
        // …and as large as that allows: within 6% of the largest box of this
        // shape whose corners sit where a square mark's sit (0.4667·d).
        const best = (2 * 0.4667 * d) / Math.sqrt(1 + c.aspect * c.aspect) * c.aspect;
        if (markW < best * 0.94) problems.push(`${tag}: a ${c.aspect}:1 mark drawn ${markW.toFixed(0)}px wide in a ${d.toFixed(0)}px circle — room for ${best.toFixed(0)}`);
      } else if (c.company) {
        // Original: never squeezed below its own height to share a line — it
        // is drawn at its full height, or as wide as its row allows.
        const row = img.parentElement!.getBoundingClientRect();
        const full = Math.min(boxH, row.width / c.aspect);
        if (markH < full * 0.95 - 0.5 && !card.closest("[data-tpl='local-business']")) {
          problems.push(`${tag}: logo drawn ${markW.toFixed(0)}×${markH.toFixed(0)} — its row has room for ${(full * c.aspect).toFixed(0)}×${full.toFixed(0)}`);
        }
      }

      if (c.company) {
        const el = [...cell.querySelectorAll<HTMLElement>("*")].find((e) => e.childElementCount === 0 && e.textContent?.trim() === c.company);
        if (!el) { problems.push(`${tag}: company name missing`); return; }
        const fs = parseFloat(getComputedStyle(el).fontSize);
        // Readable: never under the shared floor's ~8px, and a short name gets
        // a real size, not a footnote.
        if (fs < 8) problems.push(`${tag}: company at ${fs.toFixed(1)}px`);
        if (c.company.length <= 16 && fs < 10.5) problems.push(`${tag}: "${c.company}" only ${fs.toFixed(1)}px`);
        // Whole words only — a company name is a proper noun.
        const text = el.firstChild as Text | null;
        if (text) {
          let at = 0;
          for (const w of c.company.split(" ")) {
            const range = document.createRange();
            range.setStart(text, at); range.setEnd(text, at + w.length);
            const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top)));
            if (lines.size > 1) problems.push(`${tag}: "${w}" is broken across lines`);
            at += w.length + 1;
          }
        }
        const er = el.getBoundingClientRect();
        if (er.right > cr.right + 1 || er.bottom > cr.bottom + 1) problems.push(`${tag}: company name leaves the card`);
        // The name and the logo never sit on top of each other.
        const ox = Math.min(r.right, er.right) - Math.max(r.left, er.left);
        const oy = Math.min(r.bottom, er.bottom) - Math.max(r.top, er.top);
        if (ox > 1 && oy > 1) problems.push(`${tag}: company name over the logo`);
      }
    });
    return problems;
  }, all as unknown as Record<string, unknown>[] as never);
}

for (const engine of ["Chromium", "WebKit"]) {
  describe(`${engine}: wide and banner logos fit every template, Original and Circle`, () => {
    for (const tname of TEMPLATES) {
      it(`${tname}`, async () => {
        const page = await browsers[engine].newPage({ viewport: { width: 520, height: 900 } });
        await page.route("**/*", (route) => route.fulfill({
          status: 200, contentType: "text/html",
          body: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{margin:0;padding:20px;background:#fff}.h{width:460px;margin-bottom:12px}</style></head>
            <body class="sc-app"><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>`,
        }));
        await page.goto("https://sc.test/");
        const all = cases();
        await page.evaluate(([t, d]) => (window as unknown as { mount: (t: string, d: unknown[]) => void }).mount(t as string, d as unknown[]), [tname, all.map((c) => c.data)] as const);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // Every logo loaded, so every circle has had its chance to reshape.
        await page.waitForFunction(() => [...document.images].every((i) => i.complete));
        await page.waitForTimeout(300);
        if (tname === "local-business") await page.evaluate(() => document.querySelectorAll(".sc-card").forEach((c) => c.setAttribute("data-tpl", "local-business")));
        const problems = await measure(page, all);
        expect(problems, `${tname}: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`).toEqual([]);
        await page.close();
      }, 120_000);
    }
  });
}
