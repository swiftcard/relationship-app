import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { appCss } from "./harness";
import { summarizeWebsite, type PageviewRow } from "@/lib/admin-data/website";

// ── Website › "Include my team's visits", driven (owner, 2026-10-28) ────────
//
// "make sure 'include my team's visits' really works". Hydrated in a real
// browser with the API answered by the real counting (lib/admin-data/website)
// over a fixed set of rows: flipping the switch asks for ?internal=1, the
// totals grow by exactly the team's rows, and the line under the header says
// so in words — then flipping it back puts every number back.

const ORIGIN = "https://sc.test";
let css: string;
let bundle: string;
let tmp: string;
const browsers: Record<string, Browser> = {};

const NOW = new Date();
const at = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * 60_000).toISOString();
const ROWS: PageviewRow[] = [
  // A customer: one visit, two pages.
  { visitor_id: "c", session_id: "c1", path: "/", referrer: "www.google.com", country: "US", duration_ms: 5000, created_at: at(50), is_internal: false },
  { visitor_id: "c", session_id: "c1", path: "/pricing", referrer: null, country: "US", duration_ms: 9000, created_at: at(49), is_internal: false },
  // The team: two visits, five pages.
  ...[0, 1, 2].map((i) => ({ visitor_id: "us", session_id: "t1", path: "/", referrer: null, country: "US", duration_ms: null, created_at: at(40 - i), is_internal: true })),
  ...[0, 1].map((i) => ({ visitor_id: "us", session_id: "t2", path: "/faq", referrer: null, country: "US", duration_ms: null, created_at: at(20 - i), is_internal: true })),
];

beforeAll(async () => {
  css = (await appCss()) + readFileSync("src/app/admin/admin.css", "utf8");
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "adminwebsite-"));
  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() { return { push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return location.pathname; }
    export function useSearchParams() { return new URLSearchParams(location.search); }
  `);
  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement as h } from "react";
    export default function Link({ href, children, scroll, prefetch, ...rest }) { return h("a", { href, ...rest }, children); }
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import WebsiteAnalyticsClient from "@/app/admin/website/WebsiteAnalyticsClient";
    createRoot(document.getElementById("root")).render(
      h("div", { className: "sc-app sc-admin min-h-screen" }, h("main", { className: "px-4 sm:px-6 pt-5 pb-16" }, h(WebsiteAnalyticsClient, { initialInternalDevice: false, tab: "traffic" })))
    );
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://x"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"k"' },
    alias: { "next/navigation": join(tmp, "nav-stub.tsx"), "next/link": join(tmp, "link-stub.tsx"), "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
  browsers.Chromium = await chromium.launch();
  browsers.WebKit = await webkit.launch();
}, 240_000);

afterAll(async () => {
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function open(engine: string, width: number): Promise<{ page: Page; asked: string[] }> {
  const ctx = await browsers[engine].newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const asked: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/admin/")) {
      return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>body{margin:0}</style></head><body><div id="root"></div><script>window.process={env:{}};</script><script>${bundle}</script></body></html>` });
    }
    if (url.pathname === "/api/admin/website") {
      const includeInternal = url.searchParams.get("internal") === "1";
      asked.push(url.searchParams.get("internal") ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ includeInternal, capHit: false, ...summarizeWebsite(ROWS, { includeInternal }) }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`${ORIGIN}/admin/website`);
  return { page, asked };
}

const kpi = (page: Page, label: string) =>
  page.locator(".adm-card", { has: page.getByText(label, { exact: true }) }).first().innerText().then((t) => t.replace(/\s+/g, " "));

describe.each(["Chromium", "WebKit"])("%s", (engine) => {
  for (const width of [390, 1280]) {
    it(`the team switch adds exactly the team's visits, says so, and takes them out again (${width}px)`, async () => {
      const { page, asked } = await open(engine, width);
      try {
        const line = page.getByTestId("team-line");
        await line.waitFor();
        expect(await line.innerText()).toBe("Your team: 2 visits (5 pages) left out of these numbers.");
        expect(await kpi(page, "Visitors · 30 days")).toContain("1 visit · 2 pages");

        await page.getByRole("switch").click();
        await page.getByText("included below.").waitFor();
        expect(asked).toEqual(["0", "1"]);
        expect(await line.innerText()).toBe("Your team: 2 visits (5 pages) included below.");
        // 1 + 2 visits, 2 + 5 pages, 1 + 1 people.
        expect(await kpi(page, "Visitors · 30 days")).toContain("3 visits · 7 pages");
        expect(await page.getByRole("switch").getAttribute("aria-checked")).toBe("true");

        await page.getByRole("switch").click();
        await page.getByText("left out of these numbers.").waitFor();
        expect(await kpi(page, "Visitors · 30 days")).toContain("1 visit · 2 pages");
        expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `sideways at ${width}px`).toBe(false);
      } finally { await page.context().close(); }
    });
  }
});
