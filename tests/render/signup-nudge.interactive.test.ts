import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── THE FREE-CARD POPUP, DRIVEN FOR REAL ─────────────────────────────────────
//
// Every other test of this flow is a source scan, and a source scan cannot tell
// you whether a popup actually became VISIBLE to a human. The reported bug is
// exactly that shape: "save a contact, share back, and the join-for-free popup
// never appears" — with source that reads as though it should.
//
// So this bundles the REAL SaveContactButton and the REAL SignupNudgeHost into
// one tree, hydrates them in headless Chromium with the app's compiled Tailwind,
// clicks through the actual journey, and measures whether the popup is on screen.
//
// Network is stubbed at window.fetch so no server/database is needed; the stub
// records calls so the conversion-funnel events can be asserted too.

let browser: Browser;
let bundle: string;
let tmp: string;

const OWNER = "alex-morgan";

beforeAll(async () => {
  browser = await launchBrowser();
  // INSIDE the project: esbuild resolves bare imports from the importing file's
  // directory upward, so a stub in a system temp dir cannot find react at all.
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "nudge-"));

  writeFileSync(
    join(tmp, "entry.tsx"),
    `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import SaveContactButton from "@/components/SaveContactButton";
    import SignupNudgeHost from "@/components/SignupNudgeHost";
    import { triggerSignupNudge } from "@/lib/nudge";

    const person = {
      name: "Alex Morgan", title: "Broker", company: "Morgan Realty",
      email: "alex@example.com", phone: "+15551230000", website: "https://example.com",
      photoUrl: null,
    };

    (window as any).calls = [];
    (window as any).acctExists = false;
    (window as any).leadFails = false;

    const realFetch = window.fetch.bind(window);
    window.fetch = (async (input: any, init: any) => {
      const url = String(typeof input === "string" ? input : input?.url ?? "");
      (window as any).calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/api/account-exists")) {
        return new Response(JSON.stringify({ exists: (window as any).acctExists }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/leads")) {
        return new Response(JSON.stringify({ ok: !(window as any).leadFails }), {
          status: (window as any).leadFails ? 500 : 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return realFetch(input, init);
    }) as any;

    // The other surfaces on a real card page that fire nudges of their own.
    (window as any).fire = (src: string) => triggerSignupNudge(src);

    let _root: any = null;
    (window as any).mount = (card?: string) => {
      const slug = card || "${OWNER}";
      const el = document.getElementById("root")!;
      if (!_root) _root = createRoot(el);
      _root.render(
        h("div", null,
          h(SaveContactButton, {
            person, username: slug, source: "direct_link",
            cardOwner: slug, ownerFirstName: "Alex",
          }),
          h(SignupNudgeHost, { cardUsername: slug }),
        ),
      );
    };
  `,
  );

  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    // Next inlines NEXT_PUBLIC_* at build time; esbuild does not, so without
    // this the bundle keeps a live `process.env` reference and dies in the
    // browser with "process is not defined".
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_APP_URL": '"https://swiftcard.me"',
    },
    alias: { "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// Served from a REAL https origin, not setContent. With setContent the document
// gets an opaque origin where localStorage/sessionStorage THROW — and the popup
// swallows those throws by design ("private mode — show anyway"), so every
// once-per-session guard silently no-ops and the test proves nothing about them.
// A real origin is what makes the guards actually run.
async function mount(opts: { acctExists?: boolean; width?: number; seed?: Record<string, string>; card?: string } = {}): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage();
  // A module-scope crash in a bundled component shows up here and nowhere
  // else — without it a broken import just reads as "window.mount is missing".
  page.on("pageerror", (e) => { throw new Error(`page error: ${e.message}`); });
  await page.setViewportSize({ width: opts.width ?? 390, height: 844 });
  const client = await page.context().newCDPSession(page);
  await client.send("Page.setDownloadBehavior", { behavior: "deny" }).catch(() => {});

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#FAF7F2}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`;
  await page.route("https://swiftcard.me/**", (route) => {
    // Static images come from public/, exactly as Next serves them — the
    // blurb's logo is the real brand icon and must actually load.
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(".png")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: readFileSync(resolve("public", path.slice(1))) });
    }
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  });
  await page.goto(`https://swiftcard.me/card/${OWNER}`);

  if (opts.seed) {
    await page.evaluate((kv) => {
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, opts.seed);
    await page.reload();
  }
  if (opts.acctExists) await page.evaluate(() => { (window as never as { acctExists: boolean }).acctExists = true; });
  await page.evaluate((card) => (window as never as { mount: (c?: string) => void }).mount(card), opts.card);
  await page.waitForSelector("button");
  return page;
}

/** Is the "create your free card" popup actually on screen, in the viewport, opaque? */
async function popupVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('[aria-label="Create your own SwiftCard"]') as HTMLElement | null;
    if (!el) return false;
    const panel = el.firstElementChild as HTMLElement | null;
    if (!panel) return false;
    const r = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    return (
      cs.display !== "none" &&
      cs.visibility !== "hidden" &&
      Number(cs.opacity) > 0.5 &&
      r.width > 0 &&
      r.height > 0 &&
      r.top < window.innerHeight &&
      r.bottom > 0
    );
  });
}

const sheetOpen = (page: Page) =>
  page.evaluate(() => !!Array.from(document.querySelectorAll("p")).find((p) => /have yours too/.test(p.textContent ?? "")));

/** Save Contact → wait for the owner's share-back sheet. */
async function saveContact(page: Page) {
  await page.locator('button:has-text("Save Contact")').click();
  await page.waitForFunction(
    () => !!Array.from(document.querySelectorAll("p")).find((p) => /have yours too/.test(p.textContent ?? "")),
    undefined,
    { timeout: 8000 },
  );
}

describe("save a contact → the free-card popup actually appears", () => {
  it("THE REPORTED BUG: dismissing the share-back sheet shows the popup", async () => {
    const page = await mount();
    await saveContact(page);
    expect(await popupVisible(page)).toBe(false); // not before — the sheet owns the moment

    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(900);

    expect(await sheetOpen(page)).toBe(false);
    expect(await popupVisible(page), "the join-for-free popup must be on screen").toBe(true);
    await page.close();
  });

  it("THE REPORTED BUG: submitting the share-back form shows the popup too", async () => {
    const page = await mount();
    await saveContact(page);

    await page.locator('input[placeholder="Your name *"]').fill("Mina R");
    await page.locator('input[placeholder="Your phone *"]').fill("+15557654321");
    await page.locator('button[type="submit"]').click();
    // The sheet confirms "Info shared!", closes at 1500ms, and the popup follows.
    await page.waitForTimeout(2600);

    expect(await sheetOpen(page)).toBe(false);
    expect(await popupVisible(page), "the join-for-free popup must follow a successful share").toBe(true);
    await page.close();
  });

  it("closing the popup with X leaves the page usable and the persistent CTA in place", async () => {
    const page = await mount();
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(900);
    expect(await popupVisible(page)).toBe(true);

    await page.locator('[aria-label="Create your own SwiftCard"] button[aria-label="Dismiss"]').click();
    await page.waitForTimeout(500);
    expect(await popupVisible(page)).toBe(false);

    // Nothing is left covering the page (a stuck full-screen overlay would eat
    // every tap on the card underneath).
    const blocked = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return el?.closest('[aria-label="Create your own SwiftCard"]') != null;
    });
    expect(blocked).toBe(false);
    await page.close();
  });

  it("(24) an existing SwiftCard customer is NOT nudged", async () => {
    const page = await mount({ acctExists: true });
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(900);
    expect(await popupVisible(page)).toBe(false);
    await page.close();
  });

  it("(25) the popup never precedes the action, and (27) never stacks duplicates", async () => {
    const page = await mount();
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(900);

    // Fire the same moment again (a second save, a stray re-trigger).
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("sc:nudge", { detail: { source: "vcard" } })));
    await page.waitForTimeout(400);

    const count = await page.evaluate(
      () => document.querySelectorAll('[aria-label="Create your own SwiftCard"]').length,
    );
    expect(count).toBe(1);
    // ...and the re-trigger while it is open is not counted as a second view.
    const impressions = await page.evaluate(() =>
      (window as never as { calls: { url: string; body: { event_type?: string } | null }[] }).calls
        .filter((c) => c.url.includes("/api/analytics/event") && c.body?.event_type === "nudge_impression").length,
    );
    expect(impressions, "one popup on screen, one impression").toBe(1);
    await page.close();
  });

  it("a FAILED share-back does not nudge — the visitor's info must not be silently lost", async () => {
    const page = await mount();
    await page.evaluate(() => { (window as never as { leadFails: boolean }).leadFails = true; });
    await saveContact(page);
    await page.locator('input[placeholder="Your name *"]').fill("Mina R");
    await page.locator('input[placeholder="Your phone *"]').fill("+15557654321");
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2600);

    // The sheet stays open with their details so they can retry.
    expect(await sheetOpen(page)).toBe(true);
    expect(await popupVisible(page)).toBe(false);
    await page.close();
  });

  it("REAL JOURNEY: tapping links first must NOT starve the save moment", async () => {
    // A visitor browses a card: taps a Swift Link, taps a social link, THEN
    // saves the contact. Those incidental taps each fire their own nudge, and
    // the save is the moment that actually converts — it must still land.
    const page = await mount();
    await page.evaluate(() => (window as never as { fire: (s: string) => void }).fire("link_button"));
    await page.waitForTimeout(600);
    await page.locator('[aria-label="Create your own SwiftCard"] button[aria-label="Dismiss"]').click({ timeout: 4000 });
    await page.waitForTimeout(400);

    // A SECOND incidental tap gets nothing — one gentle invite per session for
    // link/share taps, so they can never be mistaken for the save moment.
    await page.evaluate(() => (window as never as { fire: (s: string) => void }).fire("share_card"));
    await page.waitForTimeout(600);
    expect(await popupVisible(page), "incidental taps are capped at one per session").toBe(false);

    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(900);

    expect(await popupVisible(page), "the SAVE moment must never be starved by incidental taps").toBe(true);
    await page.close();
  });

  it("REAL JOURNEY: a visitor who already shared gets BOTH popups again, form pre-filled", async () => {
    // Owner, 2026-10-05: "they need to work every single time". Having shared
    // with this owner before no longer skips the sheet — it opens with their
    // details already in it, and the invite follows as on any other save.
    const page = await mount({
      seed: {
        swiftcard_shared: JSON.stringify({ "alex-morgan": true }),
        swiftcard_visitor: JSON.stringify({ name: "Mina R", phone: "+15557654321", email: "" }),
      },
    });

    await saveContact(page);
    expect(await page.locator('input[placeholder="Your name *"]').inputValue()).toBe("Mina R");
    expect(await page.locator('input[placeholder="Your phone *"]').inputValue()).toBe("+15557654321");

    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(900);
    expect(await popupVisible(page), "the invite follows the sheet").toBe(true);
    await page.close();
  });

  it("EVERY TIME: after sharing, the next save opens the FORM again — not a stale 'Info shared!'", async () => {
    const page = await mount();
    await saveContact(page);
    await page.locator('input[placeholder="Your name *"]').fill("Mina R");
    await page.locator('input[placeholder="Your phone *"]').fill("+15557654321");
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2600);
    expect(await popupVisible(page)).toBe(true);
    await page.locator('[aria-label="Create your own SwiftCard"] button[aria-label="Dismiss"]').click();
    await page.waitForTimeout(400);

    // The button now reads "Saved to Contacts!" — pressing it again is a save.
    await page.locator('button:has-text("Saved to Contacts!")').click();
    await page.waitForFunction(
      () => !!Array.from(document.querySelectorAll("p")).find((p) => /have yours too/.test(p.textContent ?? "")),
      undefined,
      { timeout: 8000 },
    );
    expect(await page.locator('button[type="submit"]').isVisible(), "the sheet reopened on its done state").toBe(true);
    expect(await page.locator('input[placeholder="Your name *"]').inputValue()).toBe("Mina R");

    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(900);
    expect(await popupVisible(page), "the second save invites too").toBe(true);
    await page.close();
  });

  it("(28) the funnel is recorded: an impression event attributed to this card", async () => {
    const page = await mount();
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(900);

    const impression = await page.evaluate(() =>
      (window as never as { calls: { url: string; body: { username?: string; event_type?: string } | null }[] }).calls
        .find((c) => c.url.includes("/api/analytics/event") && c.body?.event_type === "nudge_impression"),
    );
    expect(impression?.body?.username).toBe("alex-morgan");
    await page.close();
  });

  it("EVERY TIME: each save invites — the same card again, and a different card", async () => {
    // Owner, 2026-10-05 (supersedes the 2026-09-02 once-ever rule for the
    // save moment): "they need to work every single time".
    const page = await mount();
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(800);
    expect(await popupVisible(page), "first save invites").toBe(true);
    await page.locator('[aria-label="Create your own SwiftCard"] button[aria-label="Dismiss"]').click();
    await page.waitForTimeout(400);

    // Save the same card again — the sheet AND the invite, again.
    await page.locator('button:has-text("Saved to Contacts!")').click();
    await page.waitForFunction(
      () => !!Array.from(document.querySelectorAll("p")).find((p) => /have yours too/.test(p.textContent ?? "")),
      undefined,
      { timeout: 8000 },
    );
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(800);
    expect(await popupVisible(page), "a second save re-invites").toBe(true);
    await page.locator('[aria-label="Create your own SwiftCard"] button[aria-label="Dismiss"]').click();
    await page.waitForTimeout(400);

    // A different card in the same browser — again.
    await page.evaluate(() => (window as never as { mount: (c?: string) => void }).mount("sam-rivera"));
    await page.waitForTimeout(300);
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(800);
    expect(await popupVisible(page), "another card's save invites").toBe(true);
    await page.close();
  });

  it("EVERY TIME: a new visit still invites on save (nothing is spent in storage)", async () => {
    const page = await mount();
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(800);
    expect(await popupVisible(page)).toBe(true);
    await page.locator('[aria-label="Create your own SwiftCard"] button[aria-label="Dismiss"]').click();

    await page.reload();
    await page.evaluate(() => (window as never as { mount: (c?: string) => void }).mount());
    await page.waitForSelector("button");
    await page.locator('button:has-text("Saved to Contacts!")').click();
    await page.waitForFunction(
      () => !!Array.from(document.querySelectorAll("p")).find((p) => /have yours too/.test(p.textContent ?? "")),
      undefined,
      { timeout: 8000 },
    );
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(800);
    expect(await popupVisible(page), "a new visit's save must invite").toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("sc_nudged_ever:save"))).toBeNull();
    await page.close();
  });

  it("ONCE EVER: incidental link taps spend only their own flag, once", async () => {
    const page = await mount();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("sc:nudge", { detail: { source: "link_button" } })));
    await page.waitForTimeout(800);
    expect(await popupVisible(page)).toBe(true);
    await page.locator('[aria-label="Create your own SwiftCard"] button[aria-label="Dismiss"]').click();
    await page.waitForTimeout(400);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("sc:nudge", { detail: { source: "link_button" } })));
    await page.waitForTimeout(600);
    expect(await popupVisible(page), "incidental taps invite once, ever").toBe(false);
    await page.close();
  });
});

// ── The relocated "Made with SwiftCard — Get yours free" blurb ───────────────
describe("the blurb under Saved to Contacts", () => {
  const blurb = '[href^="/cards/new?src=save_contact_cta"]';

  it("is hidden before a save and appears once the contact is saved", async () => {
    const page = await mount();
    expect(await page.locator(blurb).count()).toBe(0);

    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(700);

    await expect.poll(() => page.locator(blurb).count()).toBe(1);
    expect(await page.locator(blurb).isVisible()).toBe(true);
    await page.close();
  });

  it("reads correctly and is legible on the white section card", async () => {
    const page = await mount();
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(700);

    const info = await page.evaluate((sel) => {
      const a = document.querySelector(sel) as HTMLElement;
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      return {
        text: (a.textContent || "").replace(/\s+/g, " ").trim(),
        bg: cs.backgroundColor,
        borderColor: cs.borderTopColor,
        width: Math.round(r.width),
        height: Math.round(r.height),
        // Does it fit its own box, or is a word clipped?
        clippedX: a.scrollWidth - a.clientWidth,
        lines: Math.round(r.height / parseFloat(cs.fontSize || "16")),
      };
    }, blurb);

    // Sibling spans with no whitespace text node between them — the visible
    // gap comes from flex `gap-2`, so compare on the concatenation.
    expect(info.text.replace(/\s+/g, "")).toBe("MadewithSwiftCardGetyoursfree");
    // NOT white-on-white: it carries the page's cream card language instead.
    expect(info.bg).toBe("rgb(250, 247, 242)");
    expect(info.borderColor).toBe("rgb(228, 221, 212)");
    expect(info.clippedX, "the blurb must not clip its own text").toBeLessThanOrEqual(1);
    expect(info.height).toBeGreaterThan(30);
    await page.close();
  });

  it("shows the REAL SwiftCard logo, loaded, beside the words (owner, 2026-10-05)", async () => {
    const page = await mount();
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(700);

    const logo = await page.evaluate((sel) => {
      const a = document.querySelector(sel) as HTMLElement;
      const img = a.querySelector("img") as HTMLImageElement | null;
      const words = Array.from(a.querySelectorAll("span")).find((s) => /^Made with/.test(s.textContent ?? ""));
      if (!img || !words) return null;
      const r = img.getBoundingClientRect();
      const w = words.getBoundingClientRect();
      return {
        src: new URL(img.src).pathname,
        loaded: img.complete && img.naturalWidth > 0,
        width: Math.round(r.width),
        height: Math.round(r.height),
        // Vertically centred on the text line, to the left of it.
        centreGap: Math.abs((r.top + r.bottom) / 2 - (w.top + w.bottom) / 2),
        leftOfWords: r.right <= w.left,
        drawnBolt: !!a.querySelector("polygon"),
      };
    }, blurb);

    expect(logo, "the blurb has no logo image").not.toBeNull();
    expect(logo!.src).toBe("/brand-icon-192.png");
    expect(logo!.loaded, "the logo did not load").toBe(true);
    expect(logo!.width).toBe(20);
    expect(logo!.height).toBe(20);
    expect(logo!.centreGap).toBeLessThanOrEqual(1.5);
    expect(logo!.leftOfWords).toBe(true);
    expect(logo!.drawnBolt, "the hand-drawn stand-in is back").toBe(false);
    await page.close();
  });

  it("fits without overflow from a 320px phone up to desktop", async () => {
    for (const width of [320, 360, 390, 430, 1280]) {
      const page = await mount({ width });
      await saveContact(page);
      await page.locator('button:has-text("No thanks")').click();
      await page.waitForTimeout(700);

      const m = await page.evaluate((sel) => {
        const a = document.querySelector(sel) as HTMLElement;
        const r = a.getBoundingClientRect();
        return {
          clippedX: a.scrollWidth - a.clientWidth,
          overflowsViewport: r.right > window.innerWidth + 1 || r.left < -1,
          docScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      }, blurb);

      expect(m.clippedX, `clipped at ${width}px`).toBeLessThanOrEqual(1);
      expect(m.overflowsViewport, `escapes the viewport at ${width}px`).toBe(false);
      expect(m.docScrollX, `causes horizontal page scroll at ${width}px`).toBeLessThanOrEqual(1);
      await page.close();
    }
  });

  // Owner rule 2026-09-16: every "Get started free"-style button behaves like the
  // site header's, and nobody loses a card by accident. The click no longer
  // wipes an unfinished card; the builder asks "Continue your card / Start a new
  // card" itself (see NewCardWizard resumeChoice).
  it("goes straight into the builder and KEEPS an unfinished card for the builder to ask about", async () => {
    const page = await mount({ seed: { swiftcard_guest_draft: '{"name":"stale"}' } });
    await saveContact(page);
    await page.locator('button:has-text("No thanks")').click();
    await page.waitForTimeout(700);

    const href = await page.locator(blurb).getAttribute("href");
    expect(href).toBe("/cards/new?src=save_contact_cta");

    // Clicking does not touch the draft.
    await page.evaluate((sel) => {
      const a = document.querySelector(sel) as HTMLElement;
      a.addEventListener("click", (e) => e.preventDefault(), { capture: true });
      a.click();
    }, blurb);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => localStorage.getItem("swiftcard_guest_draft"))).toBe('{"name":"stale"}');
    await page.close();
  });
});
