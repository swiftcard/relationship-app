import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentProps } from "react";
import { launchBrowser, appCss } from "./harness";

import SwiftLinkProfile from "@/components/SwiftLinkProfile";

// ── "View Contact Info →" sits right under Connect, measured ───────────────
//
// Owner order 2026-11-06: the quiet link to the owner's card moved from the
// very bottom of the Swift Links page (below every link, where visitors rarely
// got to it) to directly under the "Connect with …" button, and it must look
// clean there and still obey the "Link to your business card" switch.
//
// A source scan can prove the markup ORDER; only a browser can prove the
// things the owner actually asked for: that it hugs Connect rather than
// floating between sections, that it is centred under it, that it is a real
// tap target, that nothing overlaps, and that switching it off leaves no gap
// behind — Connect to the links stays the plain 24px it was before.

type ProfileProps = ComponentProps<typeof SwiftLinkProfile>;

const BASE: ProfileProps = {
  name: "Kelsie Blevins",
  username: "kelsie",
  photoUrl: null,
  logoUrl: null,
  subtitle: "Realtor",
  bio: "Helping buyers and sellers.",
  verified: false,
  socials: [],
  links: [
    { emoji: "", label: "My listings", url: "https://example.com/a", size: "compact" },
    { emoji: "", label: "Book a showing", url: "https://example.com/b", size: "compact" },
  ],
  appUrl: "https://swiftcard.me",
  embedded: true,
  paidTiles: true,
  brandingFooter: false,
};

type Box = { top: number; bottom: number; left: number; right: number; height: number; cx: number };

describe("the View Contact Info link under Connect", () => {
  let browser: Browser;
  let css: string;
  beforeAll(async () => { browser = await launchBrowser(); css = await appCss(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  async function probe(props: Partial<ProfileProps>, width: number) {
    const markup = renderToStaticMarkup(createElement(SwiftLinkProfile, { ...BASE, ...props }));
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
         <style>body{margin:0}</style></head>
         <body><div style="width:${width}px">${markup}</div></body></html>`,
        { waitUntil: "load" },
      );
      await page.waitForTimeout(150);
      return await page.evaluate(() => {
        const box = (el: Element | null | undefined): Box | null => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, cx: r.left + r.width / 2 };
        };
        const connect = [...document.querySelectorAll("button")].find((b) => /Connect with/.test(b.textContent || ""));
        const links = [...document.querySelectorAll('a[href*="source=swift_links"]')];
        const link = links[0] as HTMLElement | undefined;
        // The words themselves, not the padded tap row around them.
        let text: Box | null = null;
        if (link?.firstChild) {
          const range = document.createRange();
          range.selectNodeContents(link);
          text = box(range as unknown as Element);
        }
        const anchor = document.querySelector('[data-sl-section="links"]');
        const tilesWrap = anchor?.nextElementSibling ?? null;
        const firstTile = tilesWrap ? [...tilesWrap.children].find((c) => c.tagName !== "STYLE") : null;
        const footer = document.querySelector('a[href*="src=badge"]');
        const sheet = document.querySelector(".sc-sl-body");
        // Phones draw the whole sheet at zoom 0.92 (SwiftLinkProfile's
        // max-width:767px rule), so measured pixels are CSS pixels × zoom.
        const zoomEl = document.querySelector(".sc-sl-sheet");
        const zoom = zoomEl ? Number(getComputedStyle(zoomEl).zoom) || 1 : 1;
        return {
          zoom,
          count: links.length,
          label: link?.textContent?.trim() ?? null,
          opacity: link ? getComputedStyle(link).opacity : null,
          connect: box(connect),
          link: box(link),
          text,
          tilesWrap: box(tilesWrap),
          firstTile: box(firstTile),
          footer: box(footer),
          sheet: box(sheet),
        };
      });
    } finally {
      await page.close();
    }
  }

  // A light and a dark solid Look, and a light and a dark glass Look under a
  // cover header — the families whose sheets are built differently.
  const LOOKS: { look: string; heroStyle: "avatar" | "cover" }[] = [
    { look: "paper", heroStyle: "avatar" },
    { look: "onyx", heroStyle: "avatar" },
    { look: "frost", heroStyle: "cover" },
    { look: "aurora", heroStyle: "cover" },
  ];

  // A phone, a big phone, and a computer (no zoom there).
  for (const width of [390, 430, 1280]) {
    for (const { look, heroStyle } of LOOKS) {
      it(`${look} at ${width}px, switch ON: right under Connect, centred, a real tap target, nothing overlaps`, async () => {
        const r = await probe({ pageStyle: { look, heroStyle }, showCardLink: true }, width);
        expect(r.count).toBe(1);
        expect(r.label).toBe("View Contact Info →");
        expect(r.opacity).toBe("0.5");
        const { connect, link, text, tilesWrap, firstTile, sheet, zoom } = r;
        expect(connect && link && text && tilesWrap && firstTile && sheet).toBeTruthy();
        expect(zoom).toBe(width < 768 ? 0.92 : 1);
        const css = (px: number) => px / zoom;
        // Hugs Connect: the words sit ~22px under the button…
        const gapAbove = css(text!.top - connect!.bottom);
        expect(gapAbove, "the link drifted away from Connect").toBeGreaterThanOrEqual(14);
        expect(gapAbove).toBeLessThanOrEqual(32);
        // …and closer to Connect than to the links, so it reads as Connect's
        // second option rather than a stray line between sections.
        const gapBelow = css(firstTile!.top - text!.bottom);
        expect(gapBelow).toBeGreaterThan(gapAbove);
        // The links keep their own 24px from whatever sits above them.
        expect(Math.abs(css(tilesWrap!.top - link!.bottom) - 24)).toBeLessThanOrEqual(1);
        // Centred under the button.
        expect(Math.abs(link!.cx - connect!.cx)).toBeLessThanOrEqual(1);
        // A full tap target (Apple's 44pt), not a 32px sliver.
        expect(css(link!.height)).toBeGreaterThanOrEqual(43.5);
        // No overlap with Connect or the first tile, and inside the sheet.
        expect(link!.top).toBeGreaterThanOrEqual(connect!.bottom - 0.5);
        expect(link!.bottom).toBeLessThanOrEqual(firstTile!.top + 0.5);
        expect(link!.left).toBeGreaterThanOrEqual(sheet!.left);
        expect(link!.right).toBeLessThanOrEqual(sheet!.right);
      }, 60_000);

      it(`${look} at ${width}px, switch OFF: gone, and Connect → links is the plain 24px`, async () => {
        const r = await probe({ pageStyle: { look, heroStyle }, showCardLink: false }, width);
        expect(r.count).toBe(0);
        expect(Math.abs((r.tilesWrap!.top - r.connect!.bottom) / r.zoom - 24)).toBeLessThanOrEqual(1);
      }, 60_000);
    }
  }

  it("no links, Free footer: Connect, then the link, then the footer — no overlap", async () => {
    const r = await probe({ pageStyle: { look: "paper", heroStyle: "avatar" }, links: [], brandingFooter: true, showCardLink: true }, 390);
    expect(r.count).toBe(1);
    expect(r.link!.top).toBeGreaterThanOrEqual(r.connect!.bottom - 0.5);
    expect(r.footer).toBeTruthy();
    expect(r.footer!.top).toBeGreaterThanOrEqual(r.link!.bottom);
  }, 60_000);
});
