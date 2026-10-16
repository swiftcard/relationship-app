import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";

// ── In-app links ask before dropping unsaved edits (audit C02-A39) ──────────
//
// Next's <Link> navigates inside the page, so the editor's beforeunload guard
// never saw it: "Dashboard", "Upgrade to Pro" and the Pro dialog's checkout
// button dropped unsaved edits without a word. The stand-in link below behaves
// exactly like <Link> — its own click handler prevents the default and
// navigates in-page — so if the guard didn't hold the click first, the
// navigation would happen. Driven in Chromium and WebKit.

const ORIGIN = "https://sc.test";
let bundle: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

beforeAll(async () => {
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "leaveguard-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push(to: string) { (window as unknown as { __pushed: string[] }).__pushed.push(to); }, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return "/cards/1/edit"; }
    export function useSearchParams() { return new URLSearchParams(); }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h, useState } from "react";
    import UnsavedLeaveGuard from "@/components/UnsavedLeaveGuard";
    const w = window as unknown as { __pushed: string[]; __linkNav: string[] };
    w.__pushed = []; w.__linkNav = [];
    // Like next/link: prevents the default and navigates in-page.
    const FakeLink = (p: { href: string; children: string; id: string }) =>
      h("a", { id: p.id, href: p.href, onClick: (e: { preventDefault(): void }) => { e.preventDefault(); w.__linkNav.push(p.href); } }, p.children);
    function App() {
      const [dirty, setDirty] = useState(location.hash === "#dirty");
      return h("main", null,
        h(UnsavedLeaveGuard, { when: dirty }),
        h(FakeLink, { id: "dash", href: "/dashboard?card=dana" }, "Dashboard"),
        h(FakeLink, { id: "checkout", href: "/checkout?plan=pro" }, "Start my free trial"),
        h(FakeLink, { id: "hash", href: "#design" }, "Design"),
        h("div", { "data-leave-ok": "" }, h(FakeLink, { id: "discard", href: "/dashboard" }, "Discard")),
        h("button", { id: "save", onClick: () => setDirty(false) }, "Save"),
      );
    }
    createRoot(document.getElementById("root")!).render(h(App));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "next/navigation": join(tmp, "nav-stub.tsx"), "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function open(engine: string, dirty: boolean): Promise<Page> {
  const page = await (await browsers[engine].newContext()).newPage();
  await page.route("**/*", (route) => route.fulfill({
    status: 200, contentType: "text/html",
    body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>`,
  }));
  await page.goto(`${ORIGIN}/cards/1/edit${dirty ? "#dirty" : ""}`);
  await page.locator("#dash").waitFor();
  return page;
}
const state = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __pushed: string[]; __linkNav: string[] };
  return { pushed: w.__pushed, linkNav: w.__linkNav };
});

describe.each(["Chromium", "WebKit"])("%s", (engine) => {
  it("with unsaved edits, a link asks first; Keep editing stays put", async () => {
    const page = await open(engine, true);
    await page.click("#dash");
    await page.getByRole("dialog", { name: "Leave without saving?" }).waitFor();
    expect(await state(page)).toEqual({ pushed: [], linkNav: [] });
    await page.getByRole("button", { name: "Keep editing" }).click();
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await state(page)).toEqual({ pushed: [], linkNav: [] });
    await page.context().close();
  });

  it("Leave without saving goes where the link pointed", async () => {
    const page = await open(engine, true);
    await page.click("#checkout");
    await page.getByRole("button", { name: "Leave without saving" }).click();
    expect((await state(page)).pushed).toEqual(["/checkout?plan=pro"]);
    await page.context().close();
  });

  it("Escape is Keep editing", async () => {
    const page = await open(engine, true);
    await page.click("#dash");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await state(page)).toEqual({ pushed: [], linkNav: [] });
    await page.context().close();
  });

  it("the editor's own Discard, a same-page #link and a saved form go straight through", async () => {
    const page = await open(engine, true);
    await page.click("#discard");
    await page.click("#hash");
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect((await state(page)).linkNav).toEqual(["/dashboard", "#design"]);
    await page.click("#save");
    await page.click("#dash");
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect((await state(page)).linkNav).toContain("/dashboard?card=dana");
    await page.context().close();
  });

  it("nothing unsaved: links work as always", async () => {
    const page = await open(engine, false);
    await page.click("#dash");
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect((await state(page)).linkNav).toEqual(["/dashboard?card=dana"]);
    await page.context().close();
  });
});
