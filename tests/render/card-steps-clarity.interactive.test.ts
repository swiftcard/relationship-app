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

async function mount(width: number, col: number, props: Record<string, unknown>, theme: "dark" | "light" = "dark", userAgent?: string): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage(userAgent ? { userAgent } : undefined);
  // Nothing here may reach the real LinkedIn ("Find my exact link" opens a tab).
  await page.context().route(/linkedin\.com/,(r) => r.abort());
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
    // "/" — visible in the box and impossible to link. (A lone "@" now counts as
    // empty: after the prefix it shows nothing, so it must say nothing.)
    const page = await mount(390, phoneCol(390), { initial: { tiktok: "@alexmorgan", twitter: "/" } });
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

  it("a lone @ typed after the prefix leaves the box truly empty — no stuck value, no red line", async () => {
    const page = await mount(390, phoneCol(390), {});
    try {
      await page.locator('[data-social-row="snapchat"] input').pressSequentially("@");
      const s = () => page.evaluate(() => (window as unknown as { __state: { socials: Record<string, string> } }).__state.socials.snapchat);
      expect(await s()).toBe("");
      expect(await page.$('[data-social-row="snapchat"] p')).toBeNull();
      // …and "@alex" typed the same way is just the handle.
      await page.locator('[data-social-row="snapchat"] input').pressSequentially("@alex");
      expect(await s()).toBe("alex");
    } finally { await page.close(); }
  });

  it("the office's Instagram is read-only, with its note", async () => {
    const page = await mount(390, phoneCol(390), { managedInstagram: true });
    try {
      expect(await page.$eval('[data-social-row="instagram"] input', (i) => (i as HTMLInputElement).readOnly)).toBe(true);
      // Saved as "@northwindpartners": shown without the @ after instagram.com/
      // (it read "instagram.com/ @northbeamhomes" on the live member editor).
      expect(await page.$eval('[data-social-row="instagram"] input', (i) => (i as HTMLInputElement).value)).toBe("northwindpartners");
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

// ── LinkedIn: "Find my exact link" (owner, 2026-10-02) ──────────────────────
// LinkedIn addresses carry numbers for many people, so the LinkedIn row sends
// them to their own profile and says how to copy the link on THIS device.
describe("LinkedIn: find my exact link", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
  const cases: Array<[string, number, number, string, string]> = [
    ["phone 320", 320, phoneCol(320), IPHONE, "ios"],
    ["phone 390", 390, phoneCol(390), IPHONE, "ios"],
    ["computer", 1280, DESKTOP_COL, WIN, "computer"],
  ];
  for (const [name, width, col, ua, device] of cases) {
    for (const theme of ["dark", "light"] as const) {
      it(`${name}, ${theme}: the steps for this device open inside the row`, async () => {
        const page = await mount(width, col, {}, theme, ua);
        try {
          // Only the LinkedIn row carries it.
          expect(await page.locator("[data-linkedin-find]").count()).toBe(1);
          expect(await page.locator('[data-social-row="linkedin"] [data-linkedin-find]').count()).toBe(1);
          expect(await page.getAttribute("[data-linkedin-find]", "href")).toBe("https://www.linkedin.com/in/me/");
          const popup = page.waitForEvent("popup").catch(() => null);
          await page.click("[data-linkedin-find]");
          await popup;
          const steps = page.locator(`[data-linkedin-steps="${device}"]`);
          await steps.waitFor();
          const m = await page.$eval('[data-social-row="linkedin"]', (row) => {
            const r = row.getBoundingClientRect();
            const p = row.querySelector("[data-linkedin-steps]")!.getBoundingClientRect();
            const btn = row.querySelector("[data-linkedin-steps] button")?.getBoundingClientRect();
            return { inside: p.left >= r.left - 0.5 && p.right <= r.right + 0.5, btnH: btn?.height ?? null };
          });
          expect(m.inside).toBe(true);
          if (device === "computer") {
            expect(await steps.textContent()).toMatch(/web address at the top/);
            expect(m.btnH).toBeNull();
          } else {
            expect(await steps.textContent()).toMatch(/Contact info/);
            expect(m.btnH!).toBeGreaterThanOrEqual(32);
            // The light theme turns .text-white near-black except on the app's
            // own blues — a custom blue read dark-on-blue live (2026-10-05).
            expect(await page.$eval("[data-linkedin-steps] button", (b) => getComputedStyle(b).color)).toBe("rgb(255, 255, 255)");
          }
          if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/linkedin-${name.replace(" ", "")}-${theme}.png`, fullPage: false, clip: { x: 0, y: 0, width, height: 520 } });
        } finally { await page.close(); }
      });
    }
  }

  it("pasting LinkedIn's share text keeps just the address, numbers and all", async () => {
    const page = await mount(390, phoneCol(390), {});
    try {
      await page.locator('[data-social-row="linkedin"] input').focus();
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text", "Check out my profile on LinkedIn https://www.linkedin.com/in/john-doe-4a7b21?utm_source=share&utm_medium=ios_app");
        document.querySelector('[data-social-row="linkedin"] input')!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await page.waitForFunction(() => (window as unknown as { __state: { socials: Record<string, string> } }).__state.socials.linkedin === "linkedin.com/in/john-doe-4a7b21");
      expect(await page.inputValue('[data-social-row="linkedin"] input')).toBe("john-doe-4a7b21");
      expect(await page.textContent('[data-social-row="linkedin"]')).toContain("Opens linkedin.com/in/john-doe-4a7b21");
    } finally { await page.close(); }
  });

  it("LinkedIn's /in/me shortcut is called out instead of saved silently", async () => {
    const page = await mount(390, phoneCol(390), { initial: { linkedin: "https://www.linkedin.com/in/me/" } });
    try {
      expect(await page.textContent('[data-social-row="linkedin"]')).toMatch(/LinkedIn’s shortcut, not your link/);
    } finally { await page.close(); }
  });
});
