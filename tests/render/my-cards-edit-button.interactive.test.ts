import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── The Edit button on every card in My Cards ───────────────────────────────
//
// Owner, 2026-09-29: editing moves from Settings → Cards and sharing onto each
// card in the dashboard's My Cards — "it should not cut anything off or overlap
// words. It should not make these boxes bigger."
//
// Those are GEOMETRY promises, so they are measured: the REAL MyCardsList is
// bundled and laid out in Chromium with the app's Tailwind (same harness shape
// as my-cards-switcher.interactive.test.ts), and every row is checked for its
// height, for the button sitting wholly inside it, and for nothing overlapping.

let browser: Browser;
let bundle: string;
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "mycards-edit-"));
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement } from "react";
    export default function Link(props: any) {
      const { href, children, scroll, ...rest } = props;
      return createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
    }
    export function useLinkStatus() { return { pending: false }; }
  `);
  writeFileSync(join(tmp, "plangate-stub.tsx"), `
    export function PlanGate({ children }: any) { return children; }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement } from "react";
    import MyCardsList from "@/components/dashboard/MyCardsList";
    (window as any).mount = (props: any) => {
      createRoot(document.getElementById("root")!).render(createElement(MyCardsList, { ...props, upsell: null }));
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: {
      "next/link": join(tmp, "link-stub.tsx"),
      "@/components/PlanGate": join(tmp, "plangate-stub.tsx"),
      "@": resolve("src"),
    },
  });
  bundle = out.outputFiles[0].text;
  if (!bundle || bundle.length < 1000) throw new Error("MyCardsList bundle is empty — the esbuild step failed");
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

type Card = { id: string; username: string; label: string | null; name: string | null };

const card = (i: number, label: string, name = "Aaron Malve"): Card => ({ id: `id${i}`, username: `card${i}`, label, name });

const SHORT = [card(1, "Work card"), card(2, "Nadlan Realty"), card(3, "Side project")];
const LONG = [
  card(1, "Northwind Commercial Real Estate Advisors — Downtown Office", "Maximilian Alexander Richardson-Montgomery"),
  card(2, "Work"),
  card(3, "Coastline Realty"),
];
// Enough cards to wrap the desktop row down to its minimum tile width.
const MANY = Array.from({ length: 7 }, (_, i) => card(i + 1, ["Work card", "Nadlan Realty", "Side project", "Home", "Coastline Realty", "Consulting", "Events"][i]));


/**
 * The rows' real container on the dashboard: the page's px-5 plus the My Cards
 * box's p-5 and 1px border — 82px narrower than the phone. On a computer the
 * page is max-w-5xl (1024px) minus the same, 942px.
 */
const phoneBox = (w: number) => w - 82;
const DESKTOP_BOX = 942;

async function mount(width: number, cards: Card[], active: string, containerWidth?: number, isPro = true): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1000 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:0;background:#030712}#root{${containerWidth ? `width:${containerWidth}px` : ""}}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  await page.evaluate(
    (p) => (window as unknown as { mount: (x: unknown) => void }).mount(p),
    { cards, activeUsername: active, isPro, freeCardLimit: 1, view: "notifications", sortBy: "newest" },
  );
  await page.waitForSelector("[role=radiogroup]");
  // Mobile: open the dropdown so every row (and its Edit) is on screen.
  const toggle = await page.$("button[aria-expanded=false]");
  if (toggle && (await toggle.isVisible())) await toggle.click();
  return page;
}

type RowReport = {
  label: string;
  height: number;
  /** The same row measured again with its Edit button taken out. */
  heightWithoutEdit: number;
  editInside: boolean;
  overlaps: string[];
  editText: string;
  editHref: string;
  nameClipped: boolean;
  /** Width the name and slug get. */
  textRoom: number;
  /** The name is shortened with an ellipsis. */
  nameTruncated: boolean;
};

async function measureRows(page: Page): Promise<RowReport[]> {
  return page.$$eval("[role=radiogroup] > div", (rows) =>
    rows
      .filter((r) => getComputedStyle(r).display !== "none")
      .map((row) => {
        const rr = row.getBoundingClientRect();
        const edit = row.querySelector('a[href$="/edit"]') as HTMLElement | null;
        const er = edit?.getBoundingClientRect();
        const within = (a: DOMRect, b: DOMRect) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
        const overlaps: string[] = [];
        if (er) {
          // Every other visible leaf in the row must stay clear of the button.
          for (const el of Array.from(row.querySelectorAll<HTMLElement>("p, span, button, svg"))) {
            if (edit!.contains(el)) continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || getComputedStyle(el).display === "none") continue;
            const ox = Math.min(r.right, er.right) - Math.max(r.left, er.left);
            const oy = Math.min(r.bottom, er.bottom) - Math.max(r.top, er.top);
            if (ox > 0.5 && oy > 0.5) overlaps.push((el.textContent || el.tagName).trim().slice(0, 30));
          }
        }
        const title = row.querySelector("[role=radio] p") as HTMLElement;
        // "Bigger" is measured, not assumed: take this row's Edit out, read the
        // height, and put it back.
        let heightWithoutEdit = rr.height;
        if (edit) {
          const next = edit.nextSibling;
          edit.remove();
          heightWithoutEdit = row.getBoundingClientRect().height;
          row.insertBefore(edit, next);
        }
        return {
          label: (title?.textContent || "").trim().slice(0, 40),
          height: Math.round(rr.height),
          heightWithoutEdit: Math.round(heightWithoutEdit),
          editInside: !!er && within(er, rr),
          overlaps,
          // innerText: what is actually visible, not the hidden phone-width word.
          editText: (edit?.innerText || "").trim(),
          editHref: edit?.getAttribute("href") ?? "",
          // Truncation with an ellipsis is the design; spilling past the row is not.
          textRoom: Math.round(((row.querySelector("[role=radio] > div.min-w-0") as HTMLElement | null)?.getBoundingClientRect().width) ?? 0),
          nameTruncated: title ? title.scrollWidth > title.clientWidth + 0.5 : false,
          nameClipped: title ? title.getBoundingClientRect().right > (er ? er.left : rr.right) + 0.5 : false,
        };
      }),
  );
}

/**
 * [case, viewport, cards, container, the least room the NAME may have, whether
 * ordinary card names must read in full].
 *
 * Ordinary names ("Nadlan Realty", "Coastline Realty") are never shortened, on
 * any phone down to 320px (where the decorative initial gives way) or on a
 * computer. Only an absurd name ("Northwind Commercial Real Estate Advisors —
 * Downtown Office") ends in an ellipsis, as it always did.
 */
const CASES: Array<[string, number, Card[], number, number, boolean]> = [
  ["phone 390, dropdown open", 390, SHORT, phoneBox(390), 110, true],
  ["phone 375, dropdown open", 375, SHORT, phoneBox(375), 100, true],
  ["phone 375, long names", 375, LONG, phoneBox(375), 100, false],
  ["phone 360 (small Android)", 360, SHORT, phoneBox(360), 90, true],
  ["phone 320 (smallest iPhone)", 320, SHORT, phoneBox(320), 90, true],
  ["computer, three cards", 1280, SHORT, DESKTOP_BOX, 130, true],
  ["computer, long names", 1280, LONG, DESKTOP_BOX, 130, false],
  ["computer, seven cards wrapping to the narrowest tiles", 1280, MANY, DESKTOP_BOX, 94, true],
];

describe("every card row carries an Edit button that fits", () => {
  for (const [name, width, cards, container, minRoom, namesInFull] of CASES) {
    it(name, async () => {
      const page = await mount(width, cards, cards[1].username, container);
      try {
        const rows = await measureRows(page);
        expect(rows.length, "rows went missing").toBe(cards.length);
        for (const r of rows) {
          expect(r.editHref, `${r.label}: no Edit link`).toMatch(/^\/cards\/id\d+\/edit$/);
          expect(r.editInside, `${r.label}: Edit sticks out of its row`).toBe(true);
          expect(r.overlaps, `${r.label}: Edit covers ${r.overlaps.join(", ")}`).toEqual([]);
          expect(r.nameClipped, `${r.label}: the name runs under Edit`).toBe(false);
          expect(r.textRoom, `${r.label}: the name lost room to Edit (${r.textRoom}px)`).toBeGreaterThanOrEqual(minRoom);
          if (namesInFull) expect(r.nameTruncated, `${r.label}: the name is cut short`).toBe(false);
          // "It should not make these boxes bigger."
          expect(r.height, `${r.label}: Edit made the row ${r.height - r.heightWithoutEdit}px taller`).toBe(r.heightWithoutEdit);
        }
        if (process.env.SHOT_DIR) {
          await page.locator("[role=radiogroup]").screenshot({ path: `${process.env.SHOT_DIR}/${name.replace(/[^a-z0-9]+/gi, "-")}.png` });
        }
      } finally { await page.close(); }
    });
  }

  it("reads \"Edit\" on a computer, and is a labelled pencil on a phone", async () => {
    // Every tile on a computer with three cards reads "Edit". A phone shows the
    // pencil alone on every row (the button's aria-label still says Edit).
    const page = await mount(375, SHORT, "card2", phoneBox(375));
    try {
      for (const r of await measureRows(page)) expect(r.editText, r.label).toBe("");
      const labels = await page.$$eval('a[href$="/edit"]', (as) => as.map((a) => a.getAttribute("aria-label")));
      expect(labels).toEqual(["Edit Work card", "Edit Nadlan Realty", "Edit Side project"]);
    } finally { await page.close(); }
    const desk = await mount(1280, SHORT, "card2", DESKTOP_BOX);
    try {
      for (const r of await measureRows(desk)) expect(r.editText, r.label).toBe("Edit");
    } finally { await desk.close(); }
  });

  it("the row's own Edit is the one a tap reaches (not the card switcher)", async () => {
    const page = await mount(1280, SHORT, "card2", DESKTOP_BOX);
    try {
      const hit = await page.$eval('a[href="/cards/id3/edit"]', (a) => {
        const r = a.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el?.closest("a")?.getAttribute("href") ?? null;
      });
      expect(hit).toBe("/cards/id3/edit");
    } finally { await page.close(); }
  });
});

// A Free account that came down from Pro: its extra cards carry the LINK OFF —
// PRO ONLY badge. On the name line, beside the Edit pencil, the badge was the
// thing that got cut ("LINK OFF — PRO…") on a phone (live check, 2026-09-29).
// It now leads the second line, where the address is what gives way.
describe("a downgraded Free account's LINK OFF badge", () => {
  for (const [name, width, container] of [
    ["phone 390", 390, phoneBox(390)],
    ["phone 320", 320, phoneBox(320)],
    ["computer", 1280, DESKTOP_BOX],
  ] as const) {
    it(`shows in full, beside a name shown in full, with no taller row — ${name}`, async () => {
      const cards = [card(1, "Main card", "Sam Ortiz"), card(2, "Side card", "Sam Ortiz")];
      const page = await mount(width, cards, "card1", container, false);
      try {
        const m = await page.$$eval("[role=radiogroup] > div", (rows) => rows.filter((r) => getComputedStyle(r).display !== "none").map((r) => {
          const badge = Array.from(r.querySelectorAll("span")).find((x) => (x.textContent || "").trim() === "LINK OFF — PRO ONLY") as HTMLElement | undefined;
          const title = r.querySelector("[role=radio] p") as HTMLElement;
          const rr = r.getBoundingClientRect();
          const br = badge?.getBoundingClientRect();
          const edit = r.querySelector('a[href$="/edit"]')!.getBoundingClientRect();
          return {
            name: title.textContent?.trim(),
            height: Math.round(rr.height),
            badge: !!badge,
            badgeWhole: badge ? badge.scrollWidth <= badge.clientWidth + 0.5 && br!.right <= edit.left + 0.5 : null,
            nameWhole: title.scrollWidth <= title.clientWidth + 0.5,
          };
        }));
        const off = m.find((x) => x.badge)!;
        const on = m.find((x) => !x.badge)!;
        expect(off, "the badge is missing").toBeTruthy();
        expect(off.badgeWhole, "LINK OFF badge is cut or runs under Edit").toBe(true);
        expect(off.nameWhole, "the name is cut").toBe(true);
        expect(off.height, "the badge made its row taller").toBe(on.height);
      } finally { await page.close(); }
    });
  }
});
