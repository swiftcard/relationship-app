import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── The Socials step, as a first-time user meets it ─────────────────────────
//
// Owner, 2026-09-29: the Socials step asked for "yourname" (read as "type your
// name in lowercase"), "Additional links" gave no idea what a link was for, and
// the page was one long column. It is now three boxed sections (FormSection),
// social rows that show the start of the link inside the box
// (SocialHandleField), and a link form with tappable ideas (AddLinkForm).
//
// A prefix inside a box is exactly the thing that clips on a 320px phone, so
// this MEASURES it, at the widths the real pages give these fields, in both
// themes — and drives the parts that respond to typing and tapping.

let browser: Browser;
let bundle: string;
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "steps-clarity-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h, useState } from "react";
    import FormSection from "@/components/ui/FormSection";
    import SocialHandleField from "@/components/SocialHandleField";
    import AddLinkForm from "@/components/AddLinkForm";
    import { SOCIAL_INPUTS } from "@/lib/social-input";
    import { normalizeSocial } from "@/lib/social-url";

    function Step({ initial, variant, managedInstagram }: any) {
      const [socials, setSocials] = useState<Record<string, string>>(initial);
      const [draft, setDraft] = useState({ label: "", url: "" });
      const [added, setAdded] = useState<any[]>([]);
      (window as any).__state = { socials, draft, added };
      return h("div", { className: "space-y-5" },
        h(FormSection, { id: "socials", title: "Social profiles", note: "Type your username — or paste your profile link." },
          h("div", { className: "space-y-3.5" },
            ...SOCIAL_INPUTS.map((spec) => {
              const managed = managedInstagram && spec.key === "instagram";
              return h(SocialHandleField, {
                key: spec.key, spec, variant,
                value: managed ? "@northwindpartners" : (socials[spec.key] ?? ""),
                onChange: (v: string) => setSocials((s) => ({ ...s, [spec.key]: v })),
                onBlur: () => setSocials((s) => ({ ...s, [spec.key]: normalizeSocial(s[spec.key] ?? "", spec.key) })),
                managed, managedTag: h("span", null, "Managed"), managedNote: "Your page shows the company Instagram.",
              });
            }),
          ),
        ),
        h(FormSection, { id: "links", title: "Additional links", note: "Buttons on your page that open any website." },
          h(AddLinkForm, { value: draft, onChange: setDraft, variant, onAdd: () => { setAdded((a) => [...a, draft]); setDraft({ label: "", url: "" }); } }),
        ),
      );
    }
    (window as any).mount = (props: any) => createRoot(document.getElementById("root")!).render(h(Step, props));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
  if (!bundle || bundle.length < 1000) throw new Error("bundle is empty — the esbuild step failed");
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/**
 * The column these fields actually get: on a phone the page's px-5 each side;
 * on a computer the editor's form column (max-w-4xl minus the 340px preview
 * and the gap) — about 532px.
 */
const phoneCol = (w: number) => w - 40;
const DESKTOP_COL = 532;

async function mount(width: number, col: number, props: Record<string, unknown>, theme: "dark" | "light" = "dark"): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1400 });
  await page.setContent(
    `<!doctype html><html data-sc-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:20px 0;background:${theme === "dark" ? "#030712" : "#FAF7F2"}}#root{width:${col}px;margin:0 auto}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  await page.evaluate((p) => (window as unknown as { mount: (x: unknown) => void }).mount(p), { variant: "app", initial: {}, managedInstagram: false, ...props });
  await page.waitForSelector("[data-social-row]");
  return page;
}

/** Every social row: the box, what sits in it, and whether anything escapes. */
async function measureRows(page: Page) {
  return page.$$eval("[data-social-row]", (rows) => rows.map((row) => {
    const box = row.querySelector("div.rounded-xl") as HTMLElement;
    const input = box.querySelector("input") as HTMLInputElement;
    const prefix = box.querySelector("span[aria-hidden]") as HTMLElement | null;
    const b = box.getBoundingClientRect();
    const i = input.getBoundingClientRect();
    const p = prefix?.getBoundingClientRect();
    const section = row.closest("section")!.getBoundingClientRect();
    return {
      key: row.getAttribute("data-social-row"),
      boxInsideSection: b.left >= section.left - 0.5 && b.right <= section.right + 0.5,
      inputInsideBox: i.left >= b.left - 0.5 && i.right <= b.right + 0.5,
      prefixInsideBox: !p || (p.left >= b.left - 0.5 && p.right <= b.right + 0.5),
      prefixWhole: !prefix || prefix.scrollWidth <= prefix.clientWidth + 0.5,
      overlap: !!p && p.right > i.left + 0.5,
      inputWidth: Math.round(i.width),
      prefix: prefix?.textContent ?? null,
    };
  }));
}

const WIDTHS: Array<[string, number, number]> = [
  ["phone 320", 320, phoneCol(320)],
  ["phone 390", 390, phoneCol(390)],
  ["computer", 1280, DESKTOP_COL],
];

describe("social rows fit at every width", () => {
  for (const [name, width, col] of WIDTHS) {
    for (const theme of ["dark", "light"] as const) {
      it(`${name}, ${theme}: prefix and box stay inside, nothing overlaps, the username has room`, async () => {
        const page = await mount(width, col, { initial: { linkedin: "linkedin.com/in/john-doe", instagram: "@alexmorgan", youtube: "youtube.com/c/AlexMorganHomes" } }, theme);
        try {
          const rows = await measureRows(page);
          expect(rows.length).toBe(7);
          for (const r of rows) {
            expect(r.boxInsideSection, `${r.key}: box escapes its section`).toBe(true);
            expect(r.inputInsideBox, `${r.key}: input escapes its box`).toBe(true);
            expect(r.prefixInsideBox, `${r.key}: prefix escapes its box`).toBe(true);
            expect(r.prefixWhole, `${r.key}: prefix is clipped`).toBe(true);
            expect(r.overlap, `${r.key}: prefix runs under the typing`).toBe(false);
            // Room for a real username (about 12 characters) even beside the
            // longest prefix, snapchat.com/add/, on the smallest phone.
            expect(r.inputWidth, `${r.key}: only ${r.inputWidth}px left to type in`).toBeGreaterThanOrEqual(90);
          }
          const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(docOverflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
          if (process.env.SHOT_DIR) await page.locator("#root").screenshot({ path: `${process.env.SHOT_DIR}/socials-${name.replace(/\s/g, "")}-${theme}.png` });
        } finally { await page.close(); }
      });
    }
  }
});

describe("what the rows show and say", () => {
  it("a saved @handle shows without its @, a pasted link shows only the part after the prefix, another address shows whole", async () => {
    const page = await mount(390, phoneCol(390), { initial: { instagram: "@alexmorgan", linkedin: "https://www.linkedin.com/in/john-doe", youtube: "youtube.com/c/AlexMorganHomes" } });
    try {
      const v = (k: string) => page.$eval(`[data-social-row="${k}"] input`, (i) => (i as HTMLInputElement).value);
      const pre = (k: string) => page.$eval(`[data-social-row="${k}"]`, (r) => r.querySelector("div.rounded-xl span[aria-hidden]")?.textContent ?? null);
      expect(await v("instagram")).toBe("alexmorgan");
      expect(await pre("instagram")).toBe("instagram.com/");
      expect(await v("linkedin")).toBe("john-doe");
      expect(await pre("linkedin")).toBe("linkedin.com/in/");
      expect(await v("youtube")).toBe("youtube.com/c/AlexMorganHomes");
      expect(await pre("youtube")).toBeNull();
    } finally { await page.close(); }
  });

  it("an empty box says nothing under it; a filled one says where it opens; a hopeless one says so in red", async () => {
    const page = await mount(390, phoneCol(390), { initial: { tiktok: "@alexmorgan", twitter: "@" } });
    try {
      const note = (k: string) => page.$eval(`[data-social-row="${k}"]`, (r) => (r.querySelector("p") as HTMLElement | null)?.innerText ?? null);
      expect(await note("facebook")).toBeNull();
      expect(await note("tiktok")).toBe("Opens tiktok.com/@alexmorgan");
      expect(await note("twitter")).toMatch(/won.t open as a link/);
      const red = await page.$eval('[data-social-row="twitter"] p', (p) => getComputedStyle(p).color);
      expect(red).not.toBe(await page.$eval('[data-social-row="tiktok"] p', (p) => getComputedStyle(p).color));
    } finally { await page.close(); }
  });

  it("typing a username saves exactly what was typed; leaving the box tidies it as before", async () => {
    const page = await mount(390, phoneCol(390), {});
    try {
      await page.fill('[data-social-row="instagram"] input', "alexmorgan");
      expect(await page.evaluate(() => (window as unknown as { __state: { socials: Record<string, string> } }).__state.socials.instagram)).toBe("alexmorgan");
      await page.locator('[data-social-row="tiktok"] input').focus();
      expect(await page.evaluate(() => (window as unknown as { __state: { socials: Record<string, string> } }).__state.socials.instagram)).toBe("@alexmorgan");
      // …and the box still shows it without the @ after instagram.com/.
      expect(await page.$eval('[data-social-row="instagram"] input', (i) => (i as HTMLInputElement).value)).toBe("alexmorgan");
      expect(await page.$eval('[data-social-row="instagram"] p', (p) => (p as HTMLElement).innerText)).toBe("Opens instagram.com/alexmorgan");
    } finally { await page.close(); }
  });

  it("the office's Instagram is read-only, with its note", async () => {
    const page = await mount(390, phoneCol(390), { managedInstagram: true });
    try {
      expect(await page.$eval('[data-social-row="instagram"] input', (i) => (i as HTMLInputElement).readOnly)).toBe(true);
      expect(await page.$eval('[data-social-row="instagram"] p', (p) => (p as HTMLElement).innerText)).toBe("Your page shows the company Instagram.");
      expect(await page.$('[data-social-row="instagram"] a')).toBeNull();
    } finally { await page.close(); }
  });

  it("the focus ring is on the whole box, not a rectangle through the middle", async () => {
    const page = await mount(390, phoneCol(390), {});
    try {
      await page.keyboard.press("Tab");
      await page.locator('[data-social-row="linkedin"] input').focus();
      const s = await page.$eval('[data-social-row="linkedin"] input', (i) => getComputedStyle(i).outlineStyle);
      expect(s).toBe("none");
      const ring = await page.$eval('[data-social-row="linkedin"] div.rounded-xl', (b) => getComputedStyle(b).boxShadow);
      expect(ring).not.toBe("none");
    } finally { await page.close(); }
  });
});

describe("Additional links explain themselves", () => {
  it("tapping an idea fills Button text and moves to Web address; nothing is added until both are filled", async () => {
    const page = await mount(390, phoneCol(390), {});
    try {
      const add = page.locator('[data-add-link] button:has-text("+ Add link")');
      expect(await add.isDisabled()).toBe(true);
      await page.click('[data-add-link] button:has-text("Leave a review")');
      expect(await page.inputValue("#add-link-label")).toBe("Leave a review");
      await page.waitForFunction(() => document.activeElement?.id === "add-link-url");
      expect(await add.isDisabled()).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { __state: { added: unknown[] } }).__state.added.length)).toBe(0);
      await page.fill("#add-link-url", "g.page/r/alex/review");
      expect(await add.isDisabled()).toBe(false);
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => (window as unknown as { __state: { added: { label: string }[] } }).__state.added.map((a) => a.label))).toEqual(["Leave a review"]);
    } finally { await page.close(); }
  });

  it("the ideas wrap inside the box at 320px, and both boxes carry real labels", async () => {
    const page = await mount(320, phoneCol(320), {});
    try {
      const m = await page.$eval("[data-add-link]", (form) => {
        const f = form.getBoundingClientRect();
        const chips = Array.from(form.querySelectorAll("button[aria-pressed]")).map((c) => c.getBoundingClientRect());
        return { inside: chips.every((c) => c.left >= f.left - 0.5 && c.right <= f.right + 0.5), labels: Array.from(form.querySelectorAll("label")).map((l) => l.textContent) };
      });
      expect(m.inside).toBe(true);
      expect(m.labels).toEqual(["Button text", "Web address"]);
    } finally { await page.close(); }
  });
});
