import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { launchBrowser } from "./harness";
import { buildContactQr, contactPersonFromCardRow } from "@/lib/contact-qr";
import { qrBits } from "@/lib/qr-bits";

// BEHAVIOUR test for offline cards: the REAL public/sw.js and
// public/offline.html, and the REAL saver, outbox and lead form (bundled with
// esbuild), in headless Chromium against a tiny local server that can be
// switched off. "Off" destroys every connection, which is what no signal looks
// like to a phone: navigator.onLine still says true, every request just fails.
//
// What a source scan can't see, and this does: the card actually reopens with
// no signal; Save Contact's file still arrives; a page that was never opened
// shows the no-signal screen with the owner's codes, and those codes scan; a
// lead typed with no signal arrives once the signal is back; and a card the
// server says is gone stops opening offline.

const VCARD = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alex Morgan\r\nTEL;TYPE=CELL:(415) 555-0188\r\nEND:VCARD\r\n";
const CARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Alex Morgan</title>
<link rel="stylesheet" href="/_next/static/css/app.css"></head>
<body><h1 id="name">Alex Morgan</h1><div id="root"></div>
<script src="/_next/static/chunks/app.js"></script></body></html>`;

let browser: Browser;
let server: Server;
let origin = "";
let bundle = "";
let tmp = "";
let down = false;
let cardStatus = 200;
let cardDelayMs = 0;
const sockets = new Set<Socket>();
const leads: unknown[] = [];
const events: unknown[] = [];

function handle(req: IncomingMessage, res: ServerResponse) {
  if (down) { req.socket.destroy(); return; }
  const url = new URL(req.url ?? "/", origin);
  const send = (status: number, type: string, body: string) => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(body);
  };
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (url.pathname === "/api/leads") leads.push(JSON.parse(body));
      if (url.pathname === "/api/card-events") events.push(JSON.parse(body));
      send(200, "application/json", '{"success":true}');
    });
    return;
  }
  switch (url.pathname) {
    case "/sw.js": return send(200, "application/javascript", readFileSync(resolve("public/sw.js"), "utf8"));
    case "/offline.html": return send(200, "text/html; charset=utf-8", readFileSync(resolve("public/offline.html"), "utf8"));
    case "/_next/static/chunks/app.js": return send(200, "application/javascript", bundle);
    case "/_next/static/css/app.css": return send(200, "text/css", "h1{font:700 24px system-ui}");
    case "/api/card/alex/vcard": return send(200, "text/vcard; charset=utf-8", VCARD);
    case "/alex":
      if (cardStatus !== 200) return send(cardStatus, "text/html", "<h1>Not found</h1>");
      if (cardDelayMs) { setTimeout(() => send(200, "text/html; charset=utf-8", CARD_HTML), cardDelayMs); return; }
      return send(200, "text/html; charset=utf-8", CARD_HTML);
    case "/dashboard": return send(200, "text/html", "<h1>Dashboard</h1>");
    default: return send(404, "text/html", "<h1>Not found</h1>");
  }
}

beforeAll(async () => {
  browser = await launchBrowser();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "offline-sw-"));
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h } from "react";
    import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
    import OfflineOutbox from "@/components/OfflineOutbox";
    import OfflineCardSaver from "@/components/OfflineCardSaver";
    import LeadCaptureForm from "@/components/LeadCaptureForm";
    createRoot(document.getElementById("root")!).render(h("div", null,
      h(ServiceWorkerRegistrar), h(OfflineOutbox),
      h(OfflineCardSaver, { name: "Alex Morgan", vcardHref: "/api/card/alex/vcard" }),
      h(LeadCaptureForm, { cardOwner: "alex", source: "qr_code" }),
    ));
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;

  server = createServer(handle);
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  for (const s of sockets) s.destroy();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** No signal: every open connection dies and new ones are refused. */
function signal(on: boolean) {
  down = !on;
  if (!on) for (const s of sockets) s.destroy();
}

async function freshContext(): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  // The saver waits for the same human gate as the view count, which refuses
  // automation. Look like a person.
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true });
  });
  return ctx;
}

/** Open the card with signal and wait until the worker has saved it. */
async function openAndSave(ctx: BrowserContext): Promise<Page> {
  signal(true);
  cardStatus = 200;
  cardDelayMs = 0;
  const page = await ctx.newPage();
  await page.goto(`${origin}/alex?source=qr_code`);
  // (An async predicate can't go to waitForFunction: its Promise is truthy.)
  await expect.poll(() => page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) return false;
    const c = await caches.open("sc-cards-v1");
    const s = await caches.open("sc-static-v1");
    return !!(await c.match("/alex")) && !!(await c.match("/api/card/alex/vcard"))
      // The scripts the saved page runs on are saved with it.
      && !!(await s.match(location.origin + "/_next/static/chunks/app.js"));
  }), { timeout: 20_000, interval: 250 }).toBe(true);
  return page;
}

const JSQR = readFileSync(resolve("node_modules/jsqr/dist/jsQR.js"), "utf8");

/**
 * Read a QR the way a camera does: from a screenshot of what is on screen,
 * with a white margin around it, decoded by jsQR in the page.
 */
async function decodeShot(page: Page, selector: string): Promise<string | null> {
  const shot = (await page.locator(selector).screenshot()).toString("base64");
  await page.addScriptTag({ content: JSQR });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const pad = 40;
    const c = document.createElement("canvas");
    c.width = img.width + pad * 2;
    c.height = img.height + pad * 2;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, pad, pad);
    const d = g.getImageData(0, 0, c.width, c.height);
    type Fn = (data: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
    const w = window as unknown as { jsQR: Fn | { default: Fn } };
    const fn = typeof w.jsQR === "function" ? w.jsQR : w.jsQR.default;
    return fn(d.data, c.width, c.height)?.data ?? null;
  }, shot);
}

describe("a card that opened once opens again with no signal", () => {
  it("reopens from the phone, at its plain address and at a tagged scan address", async () => {
    const ctx = await freshContext();
    const page = await openAndSave(ctx);
    signal(false);
    const res = await page.reload();
    expect(res?.fromServiceWorker()).toBe(true);
    await expect(page.textContent("#name")).resolves.toBe("Alex Morgan");
    await page.goto(`${origin}/alex?source=nfc_card`);
    await expect(page.textContent("#name")).resolves.toBe("Alex Morgan");
    // The page still RUNS offline: its scripts came from the saved copy, so the
    // lead form hydrated and is there to use.
    await page.waitForSelector("#sc-lead-name", { timeout: 10_000 });
    await ctx.close();
  }, 60_000);

  it("Save Contact's file still arrives, as a contact file", async () => {
    const ctx = await freshContext();
    const page = await openAndSave(ctx);
    signal(false);
    const got = await page.evaluate(async () => {
      const r = await fetch("/api/card/alex/vcard");
      return { type: r.headers.get("Content-Type"), text: await r.text() };
    });
    expect(got.type).toContain("text/vcard");
    expect(got.text).toBe(VCARD);
    await ctx.close();
  }, 60_000);

  it("on a signal too weak to answer, the saved copy opens instead of waiting", async () => {
    const ctx = await freshContext();
    const page = await openAndSave(ctx);
    cardDelayMs = 15_000;
    const t0 = Date.now();
    await page.reload();
    expect(Date.now() - t0).toBeLessThan(8_000);
    await expect(page.textContent("#name")).resolves.toBe("Alex Morgan");
    cardDelayMs = 0;
    await ctx.close();
  }, 60_000);

  it("a card the server says is gone stops opening offline (the office switch-off wins)", async () => {
    const ctx = await freshContext();
    const page = await openAndSave(ctx);
    cardStatus = 404;
    const res = await page.reload();
    expect(res?.status()).toBe(404);
    await expect.poll(() => page.evaluate(async () => !(await (await caches.open("sc-cards-v1")).match("/alex"))), { timeout: 10_000, interval: 250 }).toBe(true);
    signal(false);
    await page.reload();
    await expect(page.textContent("body")).resolves.toContain("You're offline");
    cardStatus = 200;
    await ctx.close();
  }, 60_000);

  it("never intercepts a POST: with no signal it fails like any request", async () => {
    const ctx = await freshContext();
    const page = await openAndSave(ctx);
    signal(false);
    const failed = await page.evaluate(() =>
      fetch("/api/leads", { method: "POST", body: "{}" }).then(() => false, () => true),
    );
    expect(failed).toBe(true);
    await ctx.close();
  }, 60_000);
});

describe("the no-signal screen", () => {
  const contact = buildContactQr(contactPersonFromCardRow({
    username: "alexmorgan", name: "Alex Morgan", title: "Realtor", company: "Coastline Realty",
    email: "alex@coastline.com", website: "coastline.com",
    customization: { phones: [{ number: "(415) 555-0188", label: "mobile" }], address: { street: "1 Ocean Ave", city: "SF", state: "CA", zip: "94122" } },
  }, "https://swiftcard.me")!);
  const linkUrl = "https://swiftcard.me/alexmorgan?source=qr_code";

  it("shows the owner's codes, Contact first, and both scan", async () => {
    const ctx = await freshContext();
    const page = await openAndSave(ctx);
    await page.evaluate(([c, l]) => {
      localStorage.setItem("sc_offline_card", JSON.stringify({
        v: 1, name: "Alex Morgan", company: "Coastline Realty", url: l.url,
        link: { ...l.bits, bg: "#ffffff", fg: "#0d1b3e" },
        contact: { ...c, bg: "#ffffff", fg: "#0d1b3e" },
      }));
    }, [qrBits(contact), { url: linkUrl, bits: qrBits(linkUrl) }] as const);
    signal(false);
    await page.goto(`${origin}/dashboard`);
    await expect(page.textContent("body")).resolves.toContain("You're offline");
    await expect(page.getAttribute('button[data-mode="contact"]', "aria-pressed")).resolves.toBe("true");
    expect(await decodeShot(page, "#plate")).toBe(contact);
    await page.click('button[data-mode="link"]');
    expect(await decodeShot(page, "#plate")).toBe(linkUrl);
    // …and lists the card this phone saved, which opens offline from there.
    await page.click('#list a:has-text("Alex Morgan")');
    await expect(page.textContent("#name")).resolves.toBe("Alex Morgan");
    await ctx.close();
  }, 60_000);

  it("a page never opened on this phone explains itself, with no owner card when signed out", async () => {
    const ctx = await freshContext();
    const page = await openAndSave(ctx);
    signal(false);
    await page.goto(`${origin}/someone-else`);
    const body = await page.textContent("body");
    expect(body).toContain("You're offline");
    expect(body).toContain("needs signal");
    expect(await page.isVisible("#plate")).toBe(false);
    await ctx.close();
  }, 60_000);

  it("fits a phone: no sideways scroll at 390px", async () => {
    const ctx = await freshContext();
    const page = await openAndSave(ctx);
    await page.setViewportSize({ width: 390, height: 844 });
    signal(false);
    await page.goto(`${origin}/dashboard`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await ctx.close();
  }, 60_000);
});

describe("a lead typed with no signal arrives once the signal is back", () => {
  it("says it's saved on the phone, then delivers it exactly once", async () => {
    const ctx = await freshContext();
    const page = await openAndSave(ctx);
    leads.length = 0;
    signal(false);
    await page.fill("#sc-lead-name", "Jordan Lee");
    await page.fill("#sc-lead-phone", "4155550123");
    await page.click('button:has-text("Share My Info")');
    await page.waitForSelector("text=Saved on your phone", { timeout: 25_000 });
    expect(leads).toHaveLength(0);
    signal(true);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => leads.length, { timeout: 10_000 }).toBe(1);
    expect(leads[0]).toMatchObject({ name: "Jordan Lee", phone: "4155550123", card_owner: "alex", source: "qr_code" });
    expect(await page.evaluate(() => localStorage.getItem("sc_outbox_v1"))).toBeNull();
    // A second "online" sends nothing twice.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(500);
    expect(leads).toHaveLength(1);
    await ctx.close();
  }, 60_000);
});
