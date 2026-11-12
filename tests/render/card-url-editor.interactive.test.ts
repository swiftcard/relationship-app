import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";

// Edit card → About you → "Change" (owner, 2026-11-12): "if a username is
// taken and a user puts in that username, it won't let them save it and it'll
// say it's taken already … There can't be any flaws with this."
//
// The real CardUrlEditor, hydrated in Chromium and WebKit (iPhone Safari and
// the app's WKWebView), against a fake server: the URL check answers from a
// table, and the rename can be told to refuse. Typing is real keystrokes.

let bundle: string;
let tmp: string;

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "urled-"));
  writeFileSync(
    join(tmp, "entry.tsx"),
    `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import CardUrlEditor from "@/components/CardUrlEditor";
    const w = window as any;
    w.__checks = [];
    w.__renames = [];
    // slug -> [status, delay ms]
    w.__table = {};
    w.__rename = { status: 200, error: "" };
    w.fetch = async (url: string, init?: any) => {
      const u = new URL(url, location.href);
      if (u.pathname.endsWith("/slug-check")) {
        const slug = u.searchParams.get("slug") || "";
        w.__checks.push(slug);
        const [status, delay] = w.__table[slug] || ["available", 0];
        await new Promise((r) => setTimeout(r, delay));
        if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
        if (status === "http500") return new Response("{}", { status: 500 });
        return new Response(JSON.stringify({ slug, status }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.pathname.endsWith("/rename")) {
        const body = JSON.parse(init.body);
        w.__renames.push(body.slug);
        const r = w.__rename;
        return new Response(JSON.stringify(r.status === 200 ? { ok: true, slug: body.slug } : { error: r.error }), { status: r.status, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    };
    createRoot(document.getElementById("root")!).render(h(CardUrlEditor, { cardId: "card-1", currentSlug: "jane-smith" }));
  `,
  );
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
    banner: { js: 'var process={env:{NODE_ENV:"production"}};' },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function open(browser: Browser, table: Record<string, [string, number]> = {}): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://swiftcard.me/**", (route) => route.fulfill({
    status: 200, contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  }));
  await page.goto("https://swiftcard.me/cards/card-1/edit");
  await page.evaluate((t) => { (window as never as { __table: unknown }).__table = t; }, table);
  await page.getByRole("button", { name: "Change", exact: true }).click();
  return page;
}

const verdict = (p: Page) => p.locator("#card-url-check").getAttribute("data-url-check");
const statusText = (p: Page) => p.locator("#card-url-check").innerText();
const saveBtn = (p: Page) => p.getByRole("button", { name: /Change URL|Changing…/ });

async function typeUrl(p: Page, text: string) {
  const input = p.locator('input[placeholder="your-name"]');
  await input.fill("");
  await input.pressSequentially(text, { delay: 15 });
}

async function settle(p: Page, want: string) {
  await expect.poll(() => verdict(p), { timeout: 5000 }).toBe(want);
}

describe.each([["chromium", chromium], ["webkit", webkit]] as const)("card URL editor (%s)", (_n, engine) => {
  let browser: Browser;
  beforeAll(async () => { browser = await engine.launch(); }, 60_000);
  afterAll(async () => { await browser?.close(); });

  it("opens on your current URL, with nothing to save", async () => {
    const p = await open(browser);
    expect(await verdict(p)).toBe("current");
    expect(await statusText(p)).toContain("That's your current URL.");
    expect(await saveBtn(p).isDisabled()).toBe(true);
    await p.close();
  });

  it("a taken URL says so, and the button stays off — tapping it saves nothing", async () => {
    const p = await open(browser, { "john-acme": ["taken", 0] });
    await typeUrl(p, "John Acme");
    await settle(p, "taken");
    expect(await statusText(p)).toContain("swiftcard.me/john-acme is already taken. Try another.");
    expect(await saveBtn(p).isDisabled()).toBe(true);
    await saveBtn(p).click({ force: true });
    expect(await p.evaluate(() => (window as never as { __renames: string[] }).__renames)).toEqual([]);
    await p.close();
  });

  it("a reserved name says so and can't be saved", async () => {
    const p = await open(browser, { pricing: ["reserved", 0] });
    await typeUrl(p, "pricing");
    await settle(p, "reserved");
    expect(await statusText(p)).toContain("That URL is reserved. Try another.");
    expect(await saveBtn(p).isDisabled()).toBe(true);
    await p.close();
  });

  it("a free URL says available, and saves", async () => {
    const p = await open(browser, { "jane-new": ["available", 0] });
    await typeUrl(p, "jane-new");
    await settle(p, "available");
    expect(await statusText(p)).toContain("swiftcard.me/jane-new is available");
    expect(await saveBtn(p).isEnabled()).toBe(true);
    await saveBtn(p).click();
    await expect.poll(() => p.locator("text=Your URL is now swiftcard.me/jane-new").count()).toBe(1);
    expect(await p.evaluate(() => (window as never as { __renames: string[] }).__renames)).toEqual(["jane-new"]);
    await p.close();
  });

  it("the button is off while it checks, and only the URL in the box is ever judged", async () => {
    // A slow 'available' for something typed earlier must not relabel the
    // taken URL typed after it.
    const p = await open(browser, { "jane-slow": ["available", 1500], "john-acme": ["taken", 0] });
    await typeUrl(p, "jane-slow");
    await expect.poll(() => verdict(p)).toBe("checking");
    expect(await saveBtn(p).isDisabled()).toBe(true);
    await p.waitForTimeout(450); // the slow check is now in flight
    await typeUrl(p, "john-acme");
    await settle(p, "taken");
    await p.waitForTimeout(1600); // the slow answer has landed by now
    expect(await verdict(p)).toBe("taken");
    expect(await saveBtn(p).isDisabled()).toBe(true);
    await p.close();
  });

  it("taken a moment ago by someone else: the save's 409 shows as taken and the button goes off", async () => {
    const p = await open(browser, { "jane-race": ["available", 0] });
    await p.evaluate(() => { (window as never as { __rename: unknown }).__rename = { status: 409, error: "That URL is already taken — try another." }; });
    await typeUrl(p, "jane-race");
    await settle(p, "available");
    await saveBtn(p).click();
    await settle(p, "taken");
    expect(await statusText(p)).toContain("already taken");
    expect(await saveBtn(p).isDisabled()).toBe(true);
    await p.close();
  });

  it("an error from a failed save clears as soon as you edit the URL", async () => {
    const p = await open(browser, { "jane-boom": ["available", 0], "jane-boom2": ["available", 0] });
    await p.evaluate(() => { (window as never as { __rename: unknown }).__rename = { status: 500, error: "Couldn't change the URL right now. Please try again." }; });
    await typeUrl(p, "jane-boom");
    await settle(p, "available");
    await saveBtn(p).click();
    await expect.poll(() => p.locator("text=Couldn't change the URL right now").count()).toBe(1);
    await p.locator('input[placeholder="your-name"]').press("2");
    expect(await p.locator("text=Couldn't change the URL right now").count()).toBe(0);
    await p.close();
  });

  it("if the check itself can't answer, the save decides (button on, no promise shown)", async () => {
    const p = await open(browser, { "jane-down": ["http500", 0] });
    await typeUrl(p, "jane-down");
    await settle(p, "error");
    expect((await statusText(p)).trim()).toBe("");
    expect(await saveBtn(p).isEnabled()).toBe(true);
    await p.close();
  });

  it("symbols only: told what's allowed, nothing to save", async () => {
    const p = await open(browser);
    await typeUrl(p, "!!!");
    expect(await statusText(p)).toContain("Use letters, numbers, and dashes.");
    expect(await saveBtn(p).isDisabled()).toBe(true);
    expect(await p.evaluate(() => (window as never as { __checks: string[] }).__checks)).toEqual([]);
    await p.close();
  });
});
