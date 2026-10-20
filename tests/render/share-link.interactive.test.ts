import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { launchBrowser } from "./harness";

// INTERACTION test for "Share link" (ShareButton) on every kind of device.
//
// Owner, 2026-10-20: "When I press Share link on the computer, a share sheet
// doesn't pop up, which it should." Computers had been made to copy instead
// (2026-10-07), so a source scan of the old code looked perfectly deliberate.
// This bundles the REAL ShareButton, clicks it in Chromium as a Mac, a Windows
// PC, a browser with no share sheet, and a phone, and records what the click
// actually reached: the share sheet, or the clipboard.

let browser: Browser;
let bundle: string;
let tmp: string;

const URL = "https://swiftcard.me/alex-morgan";

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "sharelink-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import ShareButton from "@/components/ShareButton";
    (window as any).mount = () => {
      // warm={false}: no fetch of a card page from a test.
      createRoot(document.getElementById("root")!).render(
        h(ShareButton, { url: "${URL}", label: "Share link", variant: "ghost", ownCard: true, warm: false }));
    };
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_APP_URL": '"https://swiftcard.me"' },
    alias: { "@": resolve("src") },
    banner: { js: "var process = { env: { NODE_ENV: \"production\" } };" },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const UA = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
} as const;

/**
 * `share`: what navigator.share does when called — "resolve" (they picked an
 * app), an error name it rejects with, or "missing" (no share sheet at all).
 * The stand-ins record every call, so the test reads what the click reached.
 */
async function click(device: keyof typeof UA, share: "resolve" | "missing" | "AbortError" | "InvalidStateError" | "NotAllowedError", phone = false) {
  const page: Page = await browser.newPage({ userAgent: UA[device], hasTouch: phone, isMobile: phone });
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>${bundle}</script></body></html>`);
  await page.evaluate((mode) => {
    const w = window as unknown as { shareCalls: unknown[]; copied: string[] };
    w.shareCalls = [];
    w.copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { w.copied.push(t); } } });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: mode === "missing" ? undefined : async (data: unknown) => {
        w.shareCalls.push(data);
        if (mode !== "resolve") throw new DOMException("stand-in", mode);
      },
    });
  }, share);
  await page.evaluate(() => (window as unknown as { mount: () => void }).mount());
  await page.locator("button", { hasText: "Share link" }).click();
  await page.waitForTimeout(100);
  const result = await page.evaluate(() => {
    const w = window as unknown as { shareCalls: unknown[]; copied: string[] };
    return { shareCalls: w.shareCalls, copied: w.copied, text: document.body.innerText };
  });
  await page.close();
  return result;
}

describe("Share link opens the device's share sheet", () => {
  it("on a Mac: the share panel, with the bare link", async () => {
    const r = await click("mac", "resolve");
    expect(r.shareCalls).toEqual([{ url: URL }]);
    expect(r.copied).toEqual([]);
  });

  it("on a Windows PC: the share panel, with the bare link", async () => {
    const r = await click("windows", "resolve");
    expect(r.shareCalls).toEqual([{ url: URL }]);
    expect(r.copied).toEqual([]);
  });

  it("on a phone: the share sheet", async () => {
    const r = await click("iphone", "resolve", true);
    expect(r.shareCalls).toEqual([{ url: URL }]);
    expect(r.copied).toEqual([]);
  });
});

describe("…and a click never does nothing", () => {
  it("a browser with no share sheet (Firefox) copies the link and says so", async () => {
    const r = await click("firefox", "missing");
    expect(r.copied).toEqual([URL]);
    expect(r.text).toContain("Link copied!");
  });

  it("a share panel that refuses to open falls back to copying", async () => {
    const r = await click("windows", "NotAllowedError");
    expect(r.shareCalls).toHaveLength(1);
    expect(r.copied).toEqual([URL]);
  });

  it("closing the sheet is an answer: nothing is copied behind it", async () => {
    for (const closed of ["AbortError", "InvalidStateError"] as const) {
      const r = await click("mac", closed);
      expect(r.shareCalls, closed).toHaveLength(1);
      expect(r.copied, closed).toEqual([]);
      expect(r.text, closed).not.toContain("Link copied!");
    }
  });
});
