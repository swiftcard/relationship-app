import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright";
import { appCss } from "./harness";

// Create + (link anything to your SwiftCard), measured in real browsers.
//
// The promise to the owner (2026-10-07): whatever is pasted keeps its EXACT
// look, every part of it opens their SwiftCard, and one Copy works anywhere.
// So, for real pastes from Gmail, Outlook and Apple Mail, plain text, a picture
// and a hostile paste, this checks — in Chromium AND WebKit (the iPhone app):
//   • every visible word and picture sits inside a link to the share link,
//     and no old link survives;
//   • every word renders with the same colour, size, weight, style, family and
//     underline as it did in the original;
//   • nothing that could act survives (scripts, handlers, frames, forms,
//     remote CSS) and nothing reaches out to a host it shouldn't;
//   • pasted pictures are uploaded, unreachable ones are reported;
//   • the box itself: paste → linked → Copy puts the linked HTML and the share
//     link on the clipboard; it's remembered; Start over clears it.

const ORIGIN = "https://create.test";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// A 40×40 opaque PNG as a data URL (big enough to be a real picture).
let PNG40 = "";

const FIXTURES = {
  gmail: `<meta charset="utf-8"><div dir="ltr"><table style="color:rgb(34,34,34);font-family:Arial,Helvetica,sans-serif"><tbody><tr><td style="padding-right:12px"><img src="${ORIGIN}/logo.png" width="64" height="64" style="border-radius:8px"></td><td style="border-left:2px solid rgb(201,162,75);padding-left:12px"><b style="color:rgb(15,42,74);font-size:16px">Dana Ellis</b><br><span style="color:rgb(85,85,85)">Principal Broker · Northbeam</span><br><a href="https://northbeam.com" style="color:rgb(17,85,204)">northbeam.com</a> | <a href="mailto:dana@northbeam.com">dana@northbeam.com</a></td></tr></tbody></table></div>`,
  outlook: `<html><head><style>p.MsoNormal{margin:0;font-size:11pt;font-family:Calibri,sans-serif} .Name{color:#1F4E79;font-weight:bold;font-size:14pt} .Tag{font-style:italic;text-decoration:underline;color:#7F7F7F}</style></head><body><p class=MsoNormal><span class=Name>Sam Cole</span></p><p class=MsoNormal>Sales Lead <span class=Tag>Northbeam</span><o:p></o:p></p></body></html>`,
  apple: () => `<div style="font-family: Helvetica; font-size: 12px; color: rgb(10, 60, 120);">Jamie Park<br><img src="${PNG40}" width="40" height="40" alt="logo"><img src="cid:image001.png@01D9" width="40" height="40"></div>`,
  hostile: `<div onclick="window.__pwned=1">Hi there<script>window.__pwned=2</script><img src="x" onerror="window.__pwned=3"><a href="javascript:window.__pwned=4">click me</a><iframe src="https://evil.test/frame"></iframe><div style="background:url(https://evil.test/x.png);color:rgb(200,0,0)">red words</div><style>body{background:url(https://evil.test/b.png)}@import url(https://evil.test/c.css);</style><form action="https://evil.test"><input value="x"></form><link rel="stylesheet" href="https://evil.test/d.css"></div>`,
  text: "Dana Ellis\nPrincipal Broker\n(415) 555-0192",
};

let bundle = "";
let tmp = "";

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "createlink-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import * as lib from "@/lib/link-anything";
    import CreateLinkBox from "@/components/CreateLinkBox";
    (window as any).lib = lib;
    (window as any).mountBox = () => createRoot(document.getElementById("root")!).render(
      h("div", { className: "max-w-md mx-auto" }, h(CreateLinkBox, { username: "dana", appUrl: "${ORIGIN}" })));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_APP_URL": `"${ORIGIN}"` },
    alias: { "@": resolve("src") }, logLevel: "silent",
  });
  bundle = out.outputFiles[0].text;
  const sharp = (await import("sharp")).default;
  PNG40 = "data:image/png;base64," + (await sharp({ create: { width: 40, height: 40, channels: 3, background: "#2a6" } }).png().toBuffer()).toString("base64");
}, 240_000);

afterAll(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

type World = { ctx: BrowserContext; page: Page; uploads: string[]; evil: string[] };
const engineName = (b: Browser) => b.browserType().name();

async function open(engine: Browser, width = 390, theme: "light" | "dark" = "light"): Promise<World> {
  const css = await appCss();
  const ctx = await engine.newContext({ viewport: { width, height: 900 } });
  if (engine.browserType().name() === "chromium") await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  const uploads: string[] = [];
  const evil: string[] = [];
  let stamp = 1728330000000;
  await ctx.route("**/*", (route) => {
    const req = route.request();
    const u = req.url();
    if (u.startsWith("https://evil.test")) { evil.push(u); return route.fulfill({ status: 404, body: "" }); }
    if (u.startsWith(`${ORIGIN}/api/upload`)) {
      const ext = /image\/png/.test(req.postDataBuffer()?.toString("latin1") ?? "") ? "png" : "jpg";
      const url = `${ORIGIN}/storage/card-uploads/u1/create-${++stamp}.${ext}`;
      uploads.push(url);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url }) });
    }
    if (u.startsWith(`${ORIGIN}/storage/`) || u.startsWith(`${ORIGIN}/logo.png`)) return route.fulfill({ status: 200, contentType: "image/png", body: PNG, headers: { "Access-Control-Allow-Origin": "*" } });
    if (u.startsWith(`${ORIGIN}/api/img-proxy`)) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    if (u.startsWith(ORIGIN)) {
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html data-sc-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>body{margin:0;padding:16px 20px}</style></head><body class="sc-app bg-gray-950"><div id="root"></div><script>${bundle}</script></body></html>` });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log(`[${engineName(engine)} pageerror]`, e.message.slice(0, 300)); });
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log(`[${engineName(engine)} console.${m.type()}]`, m.text().slice(0, 300)); });
  await page.goto(`${ORIGIN}/share`);
  return { ctx, page, uploads, evil };
}

/** Run the pipeline in the page on a fixture: the linked HTML, plus the
 *  computed look of every word before and after. */
function linkAndCompare(page: Page, raw: string, isText = false) {
  return page.evaluate(async ({ raw, isText }) => {
    const L = (window as unknown as { lib: typeof import("@/lib/link-anything") }).lib;
    const HREF = "https://create.test/dana/p/1728330000001p";
    const runs = (doc: Document) => {
      const w = doc.defaultView!;
      const out: string[] = [];
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        const el = n.parentElement!;
        const cs = w.getComputedStyle(el);
        let underline = false;
        for (let a: Element | null = el; a && a !== doc.body; a = a.parentElement) {
          if (/underline/.test(w.getComputedStyle(a).textDecorationLine)) underline = true;
        }
        // The anchor itself is OURS and carries text-decoration:none; what the
        // eye sees is the decoration propagated from the original styling.
        out.push(JSON.stringify([t, cs.color, cs.fontSize, cs.fontWeight, cs.fontStyle, cs.fontFamily.replace(/["']/g, ""), underline]));
      }
      return out;
    };
    const src = isText ? L.textToHtml(raw) : raw;
    const before = await L.renderOffscreen(L.renderableDocument(src));
    const was = runs(before.contentDocument!);
    const linked = L.linkEverything(before, HREF);
    before.remove();
    for (const p of linked.pending) p.img.setAttribute("src", "https://create.test/storage/card-uploads/u1/create-1728330000009.png");
    const html = linked.root.outerHTML;
    // Rendered as a mail app would: plain UA styles, nothing of ours.
    const after = await L.renderOffscreen(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:8px">${html}</body></html>`);
    const is = runs(after.contentDocument!);
    const allLinked = L.everythingLinked(after.contentDocument!.body, HREF);
    after.remove();
    return { html, was, is, allLinked, pending: linked.pending.length, dropped: linked.dropped, pwned: (window as unknown as { __pwned?: number }).__pwned ?? null };
  }, { raw, isText });
}

for (const engineName of ["chromium", "webkit"] as const) {
  describe(`Create + in ${engineName}`, () => {
    let engine: Browser;
    beforeAll(async () => { engine = await (engineName === "chromium" ? chromium : webkit).launch(); }, 120_000);
    afterAll(async () => { await engine?.close(); });

    for (const name of ["gmail", "outlook", "apple", "text"] as const) {
      it(`${name}: every part links, and every word looks exactly as it did`, async () => {
        const w = await open(engine);
        try {
          const raw = typeof FIXTURES[name] === "function" ? (FIXTURES[name] as () => string)() : (FIXTURES[name] as string);
          const r = await linkAndCompare(w.page, raw, name === "text");
          expect(r.allLinked, "a word or picture is not linked to the share link").toBe(true);
          expect(r.html).not.toMatch(/northbeam\.com"|mailto:|href="(?!https:\/\/create\.test\/dana\/p\/)/);
          expect(r.html).not.toMatch(/<(script|style|iframe|form|link)\b|\bon\w+=|class=/i);
          expect(r.is, "the words changed").toEqual(r.was);
          if (name === "apple") {
            expect(r.pending, "the pasted picture must be uploaded").toBe(1);
            expect(r.dropped, "the cid: picture must be reported").toBe(1);
          }
          if (name === "gmail") expect(r.html).toContain(`src="${ORIGIN}/logo.png"`);
        } finally { await w.ctx.close(); }
      });
    }

    it("hostile paste: nothing runs, nothing reaches out, the words stay", async () => {
      const w = await open(engine);
      try {
        const r = await linkAndCompare(w.page, FIXTURES.hostile);
        await w.page.waitForTimeout(500);
        expect(r.pwned).toBeNull();
        expect(await w.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? null)).toBeNull();
        expect(w.evil, "the paste fetched from a host it named").toEqual([]);
        expect(r.html).not.toMatch(/<(script|style|iframe|form|input|link)\b|\bon\w+=|javascript:|url\(/i);
        expect(r.html).toContain("Hi there");
        expect(r.html).toContain("red words");
        expect(r.allLinked).toBe(true);
      } finally { await w.ctx.close(); }
    });

    it("the box: paste a signature → linked preview → one Copy carries the HTML and the share link", async () => {
      const w = await open(engine);
      try {
        await w.page.evaluate(() => (window as unknown as { mountBox: () => void }).mountBox());
        const target = w.page.locator('[role="textbox"][contenteditable]');
        await target.waitFor();
        await w.page.evaluate((html) => {
          const dt = new DataTransfer();
          dt.setData("text/html", html);
          dt.setData("text/plain", "Dana Ellis");
          document.querySelector('[role="textbox"][contenteditable]')!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        }, FIXTURES.gmail);
        const copy = w.page.locator("button", { hasText: /^Copy$/ });
        await copy.waitFor({ timeout: 30_000 });
        // One upload: the preview picture of the signature (its logo is hosted already).
        expect(w.uploads.length).toBe(1);
        const id = /create-(\d{13})\.png$/.exec(w.uploads[0])![1];
        const share = `${ORIGIN}/dana/p/${id}p`;
        const preview = await w.page.evaluate(() => {
          const host = document.querySelector("[data-create-preview]") as HTMLElement;
          const root = host.shadowRoot!;
          return { text: root.textContent ?? "", hrefs: Array.from(root.querySelectorAll("a")).map((a) => a.getAttribute("href")) };
        });
        expect(preview.text).toContain("Dana Ellis");
        expect(new Set(preview.hrefs)).toEqual(new Set([share]));
        if (engineName === "chromium") {
          await copy.click();
          await w.page.locator("button", { hasText: "Copied ✓ Paste it anywhere" }).waitFor({ timeout: 5000 });
          const clip = await w.page.evaluate(async () => {
            const [it] = await navigator.clipboard.read();
            return { html: await (await it.getType("text/html")).text(), text: await (await it.getType("text/plain")).text() };
          });
          expect(clip.text).toBe(share);
          expect(clip.html).toContain(`href="${share}"`);
          expect(clip.html).toContain("Dana Ellis");
        } else {
          await copy.click();
          await w.page.locator("button", { hasText: /Copied ✓|Couldn.t copy/ }).waitFor({ timeout: 5000 });
          expect(await w.page.locator("button", { hasText: "Copied ✓ Paste it anywhere" }).count()).toBe(1);
        }
        // Remembered on this device; Start over clears it.
        await w.page.reload();
        await w.page.evaluate(() => (window as unknown as { mountBox: () => void }).mountBox());
        await w.page.locator("button", { hasText: /^Copy$/ }).waitFor({ timeout: 5000 });
        await w.page.locator("button", { hasText: "Start over" }).click();
        await w.page.locator('[role="textbox"][contenteditable]').waitFor();
        expect(await w.page.evaluate(() => localStorage.getItem("sc_create_dana"))).toBeNull();
      } finally { await w.ctx.close(); }
    });

    it("the box: a picture becomes a linked picture, and its share link is the picture itself", async () => {
      const w = await open(engine);
      try {
        await w.page.evaluate(() => (window as unknown as { mountBox: () => void }).mountBox());
        await w.page.locator('input[type="file"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(PNG40.split(",")[1], "base64") });
        await w.page.locator("button", { hasText: /^Copy$/ }).waitFor({ timeout: 30_000 });
        expect(w.uploads.length, "one upload — the picture, no snapshot").toBe(1);
        const id = /create-(\d{13})\.png$/.exec(w.uploads[0])![1];
        const r = await w.page.evaluate(() => {
          const root = (document.querySelector("[data-create-preview]") as HTMLElement).shadowRoot!;
          const img = root.querySelector("img")!;
          return { src: img.getAttribute("src"), href: img.closest("a")?.getAttribute("href"), w: img.getAttribute("width") };
        });
        expect(r.src).toBe(w.uploads[0]);
        expect(r.href).toBe(`${ORIGIN}/dana/p/${id}p`);
        expect(r.w).toBe("40");
      } finally { await w.ctx.close(); }
    });

    for (const width of [390, 1280]) {
      it(`the box fits at ${width}px, empty and ready`, async () => {
        const w = await open(engine, width, width === 390 ? "light" : "dark");
        try {
          await w.page.evaluate(() => (window as unknown as { mountBox: () => void }).mountBox());
          await w.page.locator('[role="textbox"][contenteditable]').waitFor();
          expect(await w.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
          if (process.env.SHOTS) await w.page.screenshot({ path: `${process.env.SHOTS}/${engineName}-${width}-empty.png` });
          await w.page.evaluate((html) => {
            const dt = new DataTransfer();
            dt.setData("text/html", html);
            document.querySelector('[role="textbox"][contenteditable]')!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
          }, FIXTURES.gmail);
          await w.page.locator("button", { hasText: /^Copy$/ }).waitFor({ timeout: 30_000 });
          expect(await w.page.evaluate(() => document.documentElement.scrollWidth - innerWidth), "the page scrolls sideways").toBeLessThanOrEqual(0);
          if (process.env.SHOTS) await w.page.screenshot({ path: `${process.env.SHOTS}/${engineName}-${width}-ready.png`, fullPage: true });
        } finally { await w.ctx.close(); }
      });
    }
  });
}
