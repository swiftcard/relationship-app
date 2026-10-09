import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── Custom design: Copy, AI design, and fine-tuning on the card ─────────────
// Owner, 2026-09-23: Custom design keeps "Copy a card or template you like"
// exactly as it was, loses the eight Looks / Style / What's on your card, and
// gains "AI design" — choose colours, a theme, headshot and logo; AI designs the
// card; then move things, make them bigger, change the font and colours.
//
// The REAL designer, hydrated in Chromium with the app's Tailwind, driven like
// a person would. /api/design-generate is stubbed with the real engine's output
// (lib/ai-card-design), so what lands on the canvas is exactly what the route
// would return.

let browser: Browser; let bundle: string; let tmp: string;
const SHOT_DIR = process.env.SHOT_DIR;

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "designer-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h, useState } from "react";
    import CustomCardDesigner from "@/components/CustomCardDesigner";
    import { normalizeCustomLayout } from "@/lib/custom-layout";
    import { buildDesign, fallbackSpec } from "@/lib/ai-card-design";
    import { faceLayoutFromScan, freeLayoutFromFace, transferChecklist } from "@/lib/design-transfer";

    const data = {
      name: "Dana Whitfield", title: "Insurance Advisor", company: "Beacon Mutual",
      phone: "(303) 555-0149", email: "dana@beaconmutual.com", website: "beaconmutual.com",
      initials: "DW", photoUrl: null, logoUrl: null, cardUrl: "swiftcard.me/dana",
    };
    (window as any).calls = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = (async (input: any, init: any) => {
      const url = String(typeof input === "string" ? input : input?.url ?? "");
      const body = init?.body ? JSON.parse(init.body) : null;
      (window as any).calls.push({ url, body });
      if (url.includes("/api/design-generate")) {
        const ctx = { ...body.identity, hasPhoto: body.hasPhoto, hasLogo: body.hasLogo };
        const spec = fallbackSpec(body.brief, body.avoid ? [body.avoid] : []);
        return new Response(JSON.stringify({ layout: buildDesign(spec, ctx, body.brief) }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/design-transfer")) {
        // The route's real answer since 2026-10-08 (lib/design-transfer): the
        // measured card built into an editable free design with the owner's
        // own details over the redrawn artwork.
        const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        const face = faceLayoutFromScan({
          background: "#f5f0e6", font: "serif",
          panels: [{ x: 0, y: 0, w: 32, h: 100, color: "#1b2a4a" }],
          elements: [
            { kind: "name", x: 40, y: 18, w: 50, h: 9, align: "left", color: "#1b2a4a", weight: "bold", size: "xl" },
            { kind: "phone", x: 40, y: 62, w: 40, h: 4, align: "left", color: "#333333", weight: "normal", size: "sm" },
          ],
        })!;
        const identity = { name: data.name, title: data.title, company: data.company, phone: data.phone, email: data.email, website: data.website, hasHeadshot: false, hasLogo: false };
        const reply = { layout: freeLayoutFromFace(face, identity, { bgImage: px }), artwork: true, checklist: transferChecklist(identity) };
        return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return realFetch(input, init);
    }) as any;

    function Harness({ canScan }: { canScan: boolean }) {
      const [layout, setLayout] = useState(normalizeCustomLayout(null));
      (window as any).layout = layout;
      return h(CustomCardDesigner, { layout, data, onChange: setLayout, canScan });
    }
    (window as any).mount = (canScan: boolean) =>
      createRoot(document.getElementById("root")!).render(h(Harness, { canScan }));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_APP_URL": '"https://swiftcard.me"' },
    alias: { "@": resolve("src") },
    // lib/design-transfer reaches lib/card-flatten, whose server-only image
    // work loads sharp with a dynamic import the stub never calls.
    external: ["sharp"],
  });
  bundle = out.outputFiles[0].text;
}, 240_000);
afterAll(async () => { await browser?.close(); rmSync(tmp, { recursive: true, force: true }); });

async function mount(width: number, canScan = true): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setContent(`<style>${await appCss()}</style><body class="bg-gray-950" style="margin:0;padding:12px"><div id="root"></div></body>`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate((c) => (window as never as { mount: (c: boolean) => void }).mount(c), canScan);
  await page.waitForSelector("text=Copy a card or template you like");
  return page;
}
const shot = async (page: Page, name: string) => { if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true }); };
const layout = (page: Page) => page.evaluate(() => (window as never as { layout: { elements: { id: string; x: number; y: number; fontSize?: number; font?: string }[]; background: string; ai?: { variant: number } } }).layout);

async function generate(page: Page) {
  await page.getByRole("button", { name: /AI design/ }).first().click();
  const sheet = page.getByRole("dialog", { name: "AI design" });
  await sheet.waitFor();
  await sheet.getByRole("button", { name: "#1e3a8a" }).click();
  await sheet.getByRole("button", { name: /Modern/ }).click();
  await sheet.getByRole("button", { name: "Generate my design" }).click();
  await sheet.waitFor({ state: "detached" });
  await page.waitForSelector(".sc-free-canvas [data-el]");
}

describe("the designer is Copy and AI design — nothing else", () => {
  it("Copy is first, exactly as it was; AI design sits under it; the Looks, Style and card list are gone", async () => {
    const page = await mount(1280);
    const text = await page.locator("#root").innerText();
    expect(text).toContain("Copy a card or template you like");
    expect(text).toContain("AI design");
    expect(text.indexOf("Copy a card or template you like")).toBeLessThan(text.indexOf("AI design"));
    for (const gone of ["Looks", "hover to preview", "What's on your card", "Add something", "Panel"]) expect(text).not.toContain(gone);
    expect(await page.locator(".sc-magic-frame").count()).toBe(2);
    await shot(page, "designer-start-1280");
    await page.close();
  });

  // Owner, 2026-09-30: building a FIRST card opens Custom design for AI design;
  // "Copy a card or template you like" stays locked there (canScan false).
  it("a first card: Copy is locked with its PRO tag, AI design opens and designs", async () => {
    const page = await mount(1280, false);
    expect(await page.getByText("PRO", { exact: true }).count()).toBe(1);
    expect(await page.locator(".sc-magic-frame").count()).toBe(1);
    const copy = page.getByRole("button", { name: /Copy a card or template you like/ });
    expect(await copy.isDisabled()).toBe(true);
    expect(await page.locator("#root").innerText()).not.toContain("or copy a card you like");
    await shot(page, "designer-first-card-1280");
    await generate(page);
    expect((await layout(page)).elements.length).toBeGreaterThan(4);
    expect(await page.getByRole("button", { name: "↻ Try another" }).count()).toBe(1);
    await page.close();
  });

  it("a first card on a phone: fits 390px with Copy locked", async () => {
    const page = await mount(390, false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await shot(page, "designer-first-card-390");
    await page.close();
  });
});

// ── Copy: take a photo of your card, or upload (owner, 2026-10-06) ──────────
// Most people copy their OWN paper card. Copy now offers the camera — a
// card-shaped outline that turns green when the card fits — beside the upload,
// and only the photographed card is sent to be redrawn.
describe("Copy: camera or upload", () => {
  /** A fake back camera: a white card on a dark desk, filling the outline. */
  async function fakeCamera(page: Page) {
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1280; c.height = 720;
      const g = c.getContext("2d")!;
      const draw = () => {
        g.fillStyle = "#2a2118"; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = "#f4f1ea"; g.fillRect(240, 200, 800, 457);
        g.fillStyle = "#1b2a4a"; g.fillRect(240, 200, 260, 457);
      };
      draw();
      setInterval(draw, 50);
      (window as never as { tracksStopped: number }).tracksStopped = 0;
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            const stream = c.captureStream(20);
            for (const t of stream.getTracks()) {
              const stop = t.stop.bind(t);
              t.stop = () => { (window as never as { tracksStopped: number }).tracksStopped++; stop(); };
            }
            return stream;
          },
        },
      });
    });
  }

  it("Copy offers both ways in, and they fit a 390px phone", async () => {
    const page = await mount(390);
    await page.getByRole("button", { name: /Copy a card or template you like/ }).click();
    const take = page.getByRole("button", { name: "Take a photo of your card" });
    const upload = page.getByRole("button", { name: "Upload an image" });
    await take.waitFor();
    expect(await upload.isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    // Each choice sits inside the viewport, uncovered.
    for (const b of [take, upload]) {
      const box = (await b.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await shot(page, "designer-copy-choice-390");
    await page.close();
  });

  it("the camera opens, the shutter takes ONLY the card, and it goes to be redrawn", async () => {
    const page = await mount(390);
    await fakeCamera(page);
    await page.getByRole("button", { name: /Copy a card or template you like/ }).click();
    await page.getByRole("button", { name: "Take a photo of your card" }).click();
    const cam = page.locator("[data-card-scan-camera]");
    await cam.waitFor();
    // The contact scanner's camera, titled for what this one is for.
    expect(await page.getByRole("dialog", { name: "Photograph your card" }).count()).toBe(1);
    expect(await cam.innerText()).toContain("Photograph your card");
    const shutter = page.locator("[data-card-shutter]");
    await page.waitForFunction(() => !(document.querySelector("[data-card-shutter]") as HTMLButtonElement)?.disabled);
    await shot(page, "designer-copy-camera-390");
    // The photo is taken (the shutter, or the steady-green auto-capture) …
    await shutter.click().catch(() => { /* auto-capture beat the tap */ });
    await cam.waitFor({ state: "detached" });
    // … the camera is off …
    expect(await page.evaluate(() => (window as never as { tracksStopped: number }).tracksStopped)).toBeGreaterThan(0);
    // … and the card goes to the redraw, as a JPEG no larger than 1400px.
    const approve = page.getByRole("dialog", { name: "Approve your copied card design" });
    await approve.waitFor();
    // The preview is the real card renderer drawing the owner's own details.
    expect(await approve.locator("[data-transfer-preview]").innerText()).toContain("Dana Whitfield");
    const sent = await page.evaluate(() => (window as never as { calls: { url: string; body: { imageBase64: string; mediaType: string } }[] }).calls.find((c) => c.url.includes("/api/design-transfer"))!.body);
    expect(sent.mediaType).toBe("image/jpeg");
    const dims = await page.evaluate(async (b64) => {
      const i = new Image(); i.src = `data:image/jpeg;base64,${b64}`; await i.decode();
      return { w: i.naturalWidth, h: i.naturalHeight };
    }, sent.imageBase64);
    expect(Math.max(dims.w, dims.h)).toBeLessThanOrEqual(1400);
    // Card-shaped, not the whole camera frame.
    expect(dims.w / dims.h).toBeGreaterThan(1.5);
    expect(dims.w / dims.h).toBeLessThan(2);
    await page.close();
  });

  it("Close shuts the camera and nothing is sent", async () => {
    const page = await mount(1280);
    await fakeCamera(page);
    await page.getByRole("button", { name: /Copy a card or template you like/ }).click();
    await page.getByRole("button", { name: "Take a photo of your card" }).click();
    await page.locator("[data-card-scan-camera]").waitFor();
    await page.getByRole("button", { name: "Close camera" }).click();
    await page.locator("[data-card-scan-camera]").waitFor({ state: "detached" });
    expect(await page.evaluate(() => (window as never as { calls: { url: string }[] }).calls.some((c) => c.url.includes("/api/design-transfer")))).toBe(false);
    await page.close();
  });
});

describe("AI design", () => {
  it("asks for colours, a theme, headshot and logo — and needs a theme before it will generate", async () => {
    const page = await mount(1280);
    await page.getByRole("button", { name: /AI design/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "AI design" });
    await sheet.waitFor();
    const t = await sheet.innerText();
    // Section heads are set in capitals by CSS, so compare without case.
    for (const s of ["Your colours", "Theme", "On your card", "Headshot", "Logo"]) expect(t.toLowerCase()).toContain(s.toLowerCase());
    // No photo and no logo on this card: those switches are off and explain why.
    expect(t).toContain("Add a photo in your details first");
    expect(await sheet.getByRole("switch", { name: "Headshot on the card" }).isDisabled()).toBe(true);
    expect(await sheet.getByRole("button", { name: "Pick a theme to continue" }).isDisabled()).toBe(true);
    await shot(page, "ai-sheet-1280");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
    await page.close();
  });

  it("generates a free design from the choices, and Try another makes a different one", async () => {
    const page = await mount(1280);
    await generate(page);
    const calls = await page.evaluate(() => (window as never as { calls: { url: string; body: { brief: { theme: string; colors: string[]; variant: number } } }[] }).calls.filter((c) => c.url.includes("design-generate")));
    expect(calls[0].body.brief).toMatchObject({ theme: "modern", colors: ["#1e3a8a"], variant: 0 });
    const first = await layout(page);
    expect(first.elements.length).toBeGreaterThan(4);
    expect(await page.locator("#root").innerText()).toContain("Here's your AI design");
    await shot(page, "ai-generated-1280");

    await page.getByRole("button", { name: "↻ Try another" }).click();
    await page.waitForFunction(() => (window as never as { layout: { ai?: { variant: number } } }).layout.ai?.variant === 1);
    const second = await layout(page);
    const sent = await page.evaluate(() => (window as never as { calls: { url: string; body: { avoid?: string } }[] }).calls.filter((c) => c.url.includes("design-generate")).pop()!.body);
    expect(sent.avoid).toBeTruthy();
    expect(JSON.stringify(second.elements.map((e) => e.id))).not.toBe(JSON.stringify(first.elements.map((e) => e.id)));
    await page.close();
  });
});

describe("fine-tune on the card", () => {
  it("tap selects, drag moves, the corner handle and + make it bigger, font and background change, Undo reverses", async () => {
    const page = await mount(1280);
    await generate(page);
    const before = (await layout(page)).elements.find((e) => e.id === "name")!;

    // Drag the name 60px right, 20px down.
    const name = page.locator('.sc-free-canvas [data-el="name"]');
    const b = (await name.boundingBox())!;
    await page.mouse.move(b.x + 8, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 38, b.y + b.height / 2 + 10, { steps: 5 });
    await page.mouse.move(b.x + 68, b.y + b.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    const moved = (await layout(page)).elements.find((e) => e.id === "name")!;
    expect(moved.x).toBeGreaterThan(before.x + 5);
    expect(moved.y).toBeGreaterThan(before.y + 3);
    expect(await page.locator("#root").innerText()).toContain("Name — drag to move");

    // Bigger with +, then with the corner handle.
    await page.getByRole("button", { name: "Bigger" }).click();
    const bigger = (await layout(page)).elements.find((e) => e.id === "name")!;
    expect(bigger.fontSize!).toBeGreaterThan(moved.fontSize!);
    const handle = (await page.locator("[data-resize]").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + 10, { steps: 6 });
    await page.mouse.up();
    const resized = (await layout(page)).elements.find((e) => e.id === "name")!;
    expect(resized.fontSize!).toBeGreaterThan(bigger.fontSize!);

    // A font for just this line.
    await page.getByRole("button", { name: "Elegant" }).click();
    expect((await layout(page)).elements.find((e) => e.id === "name")!.font).toContain("Palatino");
    await shot(page, "fine-tune-selected-1280");

    // Undo walks it back one step at a time.
    await page.getByRole("button", { name: "↶ Undo" }).click();
    expect((await layout(page)).elements.find((e) => e.id === "name")!.font).toBe(resized.font);

    // Nothing selected: the whole card's background.
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "#faf7f2" }).click();
    expect((await layout(page)).background).toBe("#faf7f2");
    await page.close();
  });

  it("add and remove things", async () => {
    const page = await mount(1280);
    await generate(page);
    await page.getByRole("button", { name: "+ Text" }).click();
    expect((await layout(page)).elements.some((e) => e.id === "text")).toBe(true);
    await page.getByRole("button", { name: "Remove from card" }).click();
    expect((await layout(page)).elements.some((e) => e.id === "text")).toBe(false);
    await page.close();
  });
});

describe("on a phone", () => {
  it("the designer, the sheet and the editor all fit 390px with no sideways scroll", async () => {
    const page = await mount(390);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(await overflow()).toBe(false);
    await page.getByRole("button", { name: /AI design/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "AI design" });
    await sheet.waitFor();
    expect(await overflow()).toBe(false);
    await shot(page, "ai-sheet-390");
    await sheet.getByRole("button", { name: /Bold/ }).click();
    await sheet.getByRole("button", { name: "Generate my design" }).click();
    await sheet.waitFor({ state: "detached" });
    await page.waitForSelector(".sc-free-canvas [data-el]");
    await page.locator('.sc-free-canvas [data-el="name"]').click();
    expect(await overflow()).toBe(false);
    await shot(page, "fine-tune-390");
    await page.close();
  });
});
