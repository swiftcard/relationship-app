import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// INTERACTION test for the mobile card switcher.
//
// Every other check on this is a source scan, and a source scan cannot tell you
// whether tapping the chevron actually reveals anything. This bundles the REAL
// MyCardsList component with esbuild, hydrates it in headless Chromium with the
// app's compiled Tailwind, and clicks it.
//
// next/link and PlanGate are stubbed — neither is what's under test, and both
// drag in framework context this harness has no business booting. The stubs are
// deliberately transparent: Link becomes the <a> it renders anyway, and
// PlanGate renders its children, which is its web behaviour.

let browser: Browser;
let bundle: string;
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  // INSIDE the project, not os.tmpdir(): esbuild resolves bare imports from the
  // importing file's directory upward, so stubs written to a system temp dir
  // could not find react/react-dom at all. node_modules/.cache is already
  // ignored by git and sits above the dependency tree.
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "mycards-"));

  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement } from "react";
    export default function Link(props: any) {
      const { href, children, scroll, ...rest } = props;
      return createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
    }
    // The stub must export EVERYTHING the component imports from next/link.
    // A missing name is an esbuild BUILD error, and a build error here makes
    // all 13 tests SKIP rather than fail — they went quiet for a while when
    // useLinkStatus was added to MyCardsList and nothing said so out loud.
    // The suite now asserts a non-empty bundle so that can't recur silently.
    // Always-idle: these tests drive layout and the dropdown, not pending UI.
    export function useLinkStatus() { return { pending: false }; }
  `);
  writeFileSync(join(tmp, "plangate-stub.tsx"), `
    export function PlanGate({ children }: any) { return children; }
  `);
  // The upsell arrives as plain TEXT and this builds the node. Passing a
  // hand-written element descriptor from page.evaluate does not work — React 19
  // rejects a fabricated $$typeof shape and the whole tree fails to mount.
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement } from "react";
    import MyCardsList from "@/components/dashboard/MyCardsList";
    (window as any).mount = ({ upsellText, ...props }: any) => {
      const el = document.getElementById("root")!;
      const upsell = upsellText
        ? createElement("div", { id: "upsell", className: "min-w-full sm:min-w-[200px]" }, upsellText)
        : null;
      createRoot(el).render(createElement(MyCardsList, { ...props, upsell }));
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
  // A build failure used to surface only as "13 skipped", which reads like a
  // deliberate exclusion in the summary line. Fail loudly instead.
  if (!bundle || bundle.length < 1000) throw new Error("MyCardsList bundle is empty — the esbuild step failed");
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

type Props = {
  cards: { id: string; username: string; label: string | null; name: string | null }[];
  activeUsername: string;
  isPro: boolean;
  freeCardLimit: number;
};

async function mount(width: number, props: Props, withUpsell: boolean): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#030712}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  // The upsell is a ReactNode slot in the real app; a marker div is enough to
  // prove the dropdown never hides it. Passed as TEXT — the bundle builds the
  // node (see the entry stub).
  await page.evaluate(
    ({ p, up }) => {
      (window as unknown as { mount: (x: unknown) => void }).mount({
        ...(p as object),
        upsellText: up ? "Ready for a second card? Go unlimited with Pro." : null,
      });
    },
    { p: props, up: withUpsell },
  );
  await page.waitForSelector("[role=radiogroup]");
  return page;
}

/** Which card rows are actually visible, by their slug. */
async function visibleSlugs(page: Page): Promise<string[]> {
  return page.$$eval("[role=radio]", (els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).display !== "none")
      .filter((e) => {
        const row = e.parentElement!;
        return getComputedStyle(row).display !== "none";
      })
      .map((e) => (e.textContent || "").match(/\/([a-z0-9-]+)/)?.[1] ?? ""),
  );
}

const THREE: Props = {
  cards: [
    { id: "1", username: "work", label: "Work card", name: "Aaron" },
    { id: "2", username: "nadlan", label: "Nadlan Realty", name: "Aaron" },
    { id: "3", username: "side", label: "Side project", name: "Aaron" },
  ],
  activeUsername: "nadlan",
  isPro: true,
  freeCardLimit: 1,
};

const ONE_FREE: Props = {
  cards: [{ id: "1", username: "work", label: "Work card", name: "Aaron" }],
  activeUsername: "work",
  isPro: false,
  freeCardLimit: 1,
};

describe("mobile: the dropdown actually works", () => {
  it("collapses to only the selected card", async () => {
    const page = await mount(375, THREE, false);
    try {
      expect(await visibleSlugs(page)).toEqual(["nadlan"]);
    } finally { await page.close(); }
  });

  it("tapping the chevron reveals the others", async () => {
    const page = await mount(375, THREE, false);
    try {
      await page.click("button[aria-expanded]");
      const slugs = await visibleSlugs(page);
      expect(slugs).toContain("work");
      expect(slugs).toContain("side");
      expect(slugs).toContain("nadlan");
      expect(slugs.length).toBe(3);
    } finally { await page.close(); }
  });

  it("the selected card sits on top when open", async () => {
    const page = await mount(375, THREE, false);
    try {
      await page.click("button[aria-expanded]");
      const tops = await page.$$eval("[role=radio]", (els) =>
        els.map((e) => ({
          slug: (e.textContent || "").match(/\/([a-z0-9-]+)/)?.[1] ?? "",
          top: e.getBoundingClientRect().top,
        })),
      );
      const selected = tops.find((t) => t.slug === "nadlan")!;
      expect(Math.min(...tops.map((t) => t.top))).toBe(selected.top);
    } finally { await page.close(); }
  });

  it("tapping again collapses it", async () => {
    const page = await mount(375, THREE, false);
    try {
      await page.click("button[aria-expanded]");
      await page.click("button[aria-expanded]");
      expect(await visibleSlugs(page)).toEqual(["nadlan"]);
    } finally { await page.close(); }
  });

  it("choosing another card closes the dropdown", async () => {
    const page = await mount(375, THREE, false);
    try {
      await page.click("button[aria-expanded]");
      // Navigation is stubbed out (plain <a href="?...">), so this asserts the
      // collapse handler fired, which is the part that belongs to this component.
      await page.$$eval("[role=radio]", (els) => {
        const other = els.find((e) => (e.textContent || "").includes("/work")) as HTMLElement;
        other.removeAttribute("href");
        other.click();
      });
      expect(await page.getAttribute("button[aria-expanded]", "aria-expanded")).toBe("false");
    } finally { await page.close(); }
  });
});

describe("a single-card account sees no switcher at all", () => {
  it("renders no chevron on Free with one card", async () => {
    const page = await mount(375, ONE_FREE, true);
    try {
      expect(await page.$("button[aria-expanded]")).toBeNull();
      expect(await visibleSlugs(page)).toEqual(["work"]);
    } finally { await page.close(); }
  });

  it("and the Pro upsell is still visible", async () => {
    const page = await mount(375, ONE_FREE, true);
    try {
      const upsell = await page.$("#upsell");
      expect(upsell).not.toBeNull();
      expect(await upsell!.isVisible()).toBe(true);
    } finally { await page.close(); }
  });
});

describe("the upsell is never hidden by the dropdown", () => {
  const TWO_FREE: Props = {
    cards: [
      { id: "1", username: "work", label: "Work card", name: "Aaron" },
      { id: "2", username: "old", label: "Old card", name: "Aaron" },
    ],
    activeUsername: "work",
    isPro: false,
    freeCardLimit: 1,
  };

  it("stays visible while collapsed", async () => {
    const page = await mount(375, TWO_FREE, true);
    try {
      expect(await visibleSlugs(page)).toEqual(["work"]);
      expect(await (await page.$("#upsell"))!.isVisible()).toBe(true);
    } finally { await page.close(); }
  });

  it("stays visible while expanded", async () => {
    const page = await mount(375, TWO_FREE, true);
    try {
      await page.click("button[aria-expanded]");
      expect(await (await page.$("#upsell"))!.isVisible()).toBe(true);
    } finally { await page.close(); }
  });

  it("the downgraded extra card still carries its LINK OFF badge", async () => {
    // freeCardLimit 1 → index 1 ("old") is past the cap.
    const page = await mount(375, TWO_FREE, true);
    try {
      await page.click("button[aria-expanded]");
      const html = await page.innerHTML("[role=radiogroup]");
      expect(html).toContain("LINK OFF");
    } finally { await page.close(); }
  });
});

describe("desktop shows everything, with no switcher", () => {
  it("all three cards visible at 1280", async () => {
    const page = await mount(1280, THREE, false);
    try {
      expect((await visibleSlugs(page)).sort()).toEqual(["nadlan", "side", "work"]);
    } finally { await page.close(); }
  });

  it("the chevron is hidden even though it is in the DOM", async () => {
    const page = await mount(1280, THREE, false);
    try {
      const btn = await page.$("button[aria-expanded]");
      expect(btn).not.toBeNull();
      expect(await btn!.isVisible()).toBe(false);
    } finally { await page.close(); }
  });

  it("DOM order is preserved — the selected card does not jump", async () => {
    const page = await mount(1280, THREE, false);
    try {
      const slugs = await visibleSlugs(page);
      expect(slugs).toEqual(["work", "nadlan", "side"]);
    } finally { await page.close(); }
  });
});
