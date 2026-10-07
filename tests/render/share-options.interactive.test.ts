import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { appCss, launchBrowser } from "./harness";

// INTERACTION test for the reworked share options.
//
// Everything else about this change is a source scan, and a source scan cannot
// tell you what is actually inside the modal once it opens, in what order, or
// whether the card-PNG button appears when it should. This bundles the REAL
// MoreShareOptions with esbuild, hydrates it in headless Chromium with the app's
// compiled Tailwind, and clicks it.
//
// It also pins the property the whole design rests on: the dashboard renders
// its card panel TWICE with one copy display:none, so each copy must resolve to
// ITS OWN card. If a modal ever reached the hidden copy, the PNG would come out
// blank — a bug that leaves no trace in source.

let browser: Browser;
let bundle: string;
let tmp: string;

const URL = "https://swiftcard.me/card/alex-morgan";

beforeAll(async () => {
  browser = await launchBrowser();
  // INSIDE the project: esbuild resolves bare imports from the importing file's
  // directory upward, so stubs in a system temp dir cannot find react at all.
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "shareopts-"));

  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h, useRef, useState } from "react";
    import MoreShareOptions from "@/components/MoreShareOptions";
    import CardFullscreen from "@/components/CardFullscreen";
    import ClassicPro from "@/components/card-templates/ClassicPro";
    import { SAMPLE_DATA } from "@/components/card-templates/types";
    import { CardCaptureProvider, useRegisterCardCapture, useCardCapture } from "@/components/CardCaptureContext";

    // Stands in for CardPreviewDownload: registers a real DOM node, card-sized
    // and busy enough that its PNG clears the blank-capture guard.
    function FakeCard({ id }: { id: string }) {
      const ref = useRef<HTMLDivElement>(null);
      useRegisterCardCapture({ cardRef: ref, filename: id + ".png" });
      return h("div", { ref, "data-card": id, style: { width: 460, height: 263, background: "repeating-linear-gradient(45deg,#0d1b3e 0 7px,#c9a24b 7px 13px,#fff 13px 17px)", color: "#fff", fontSize: 28 } }, id);
    }

    // Renders whatever filename its own provider resolved to — the isolation probe.
    function Probe({ id }: { id: string }) {
      const c = useCardCapture();
      return h("p", { id: "probe-" + id }, c ? c.filename : "NONE");
    }

    (window as any).mount = ({ withCapture, twoPanels, wallet }: any) => {
      const el = document.getElementById("root")!;
      const walletUsername = wallet ? "alex-morgan" : undefined;
      const panel = (id: string) =>
        h(CardCaptureProvider, { key: id }, h(FakeCard, { id }), h(Probe, { id }), h(MoreShareOptions, { url: "${URL}", walletUsername }));
      let tree;
      if (twoPanels) tree = h("div", null, panel("card-a"), panel("card-b"));
      else if (withCapture) tree = panel("card-a");
      else tree = h("div", null, h(Probe, { id: "card-a" }), h(MoreShareOptions, { url: "${URL}" }));
      createRoot(el).render(tree);
    };

    // The dashboard's tap-to-full-screen card, with a REAL template so the QR
    // measured is the one the card actually prints.
    function FullscreenHarness() {
      const [open, setOpen] = useState(false);
      return h("div", null,
        h("button", { id: "open-full", onClick: () => setOpen(true) }, "open"),
        open ? h(CardFullscreen, { width: 460, onClose: () => setOpen(false) },
          h(ClassicPro, { data: { ...SAMPLE_DATA, cardUrl: "swiftcard.me/alexmorgan?source=qr_code" } })) : null,
      );
    }
    (window as any).mountFull = () => {
      createRoot(document.getElementById("root")!).render(h(FullscreenHarness));
    };
  `);

  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    // AddToWalletButton reads NEXT_PUBLIC_APP_URL (the Wallet code a Windows
    // computer shows); Next inlines it, so the bundle has to as well.
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_APP_URL": '"https://swiftcard.me"' },
    alias: { "@": resolve("src") },
  });
  bundle = out.outputFiles[0].text;
}, 240_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

// Apple Wallet depends on the DEVICE, not the width (AddToWalletButton
// useWalletMode): a button on Apple devices, a code to scan on other
// computers, nothing on Android. So each page says which device it is.
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
} as const;

async function mount(width: number, opts: { withCapture?: boolean; twoPanels?: boolean; wallet?: boolean }, before?: string, device: keyof typeof UA = width < 768 ? "iphone" : "mac"): Promise<Page> {
  const css = await appCss();
  const page = await browser.newPage({ userAgent: UA[device] });
  // setViewportSize EXPLICITLY — the constructor option has silently not taken
  // in this harness before, which inverts every breakpoint assertion.
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
     <style>body{margin:0;padding:16px;background:#030712}</style></head>
     <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
  );
  // Runs before React mounts, so it can stand in for the iOS shell.
  if (before) await page.evaluate(before);
  await page.evaluate((o) => (window as unknown as { mount: (x: unknown) => void }).mount(o), opts);
  await page.waitForSelector("button");
  expect(await page.evaluate(() => window.innerWidth)).toBe(width);
  return page;
}

/** Open the Nth "Other ways to share" modal and report what is VISIBLE in it. */
async function openModal(page: Page, index = 0) {
  const triggers = page.locator('button:has-text("Other ways to share")');
  await triggers.nth(index).click();
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const shown = (el: Element | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return getComputedStyle(el).display !== "none" && r.width > 0 && r.height > 0;
    };
    // The dialog is the panel holding the "Share options" heading.
    const heading = Array.from(document.querySelectorAll("p")).find((p) => p.textContent === "Share options");
    const modal = heading?.closest("div")?.parentElement as HTMLElement | undefined;
    if (!modal) throw new Error("share modal did not open");
    // Responsive hiding means BOTH the mobile and desktop copies of a control
    // are in the DOM, one display:none. Every lookup here must therefore find
    // the VISIBLE one — taking the first match silently measured the hidden
    // copy and reported a present control as missing.
    const visibleBtn = (t: string) =>
      Array.from(modal.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(t) && shown(b)) ?? null;
    // The QR PICTURE (not the hidden 1024px source the download draws from):
    // any visible svg in the modal larger than an icon — outside the Wallet
    // section, whose scan-with-your-iPhone code on a Windows computer is a
    // different thing.
    const walletSection = modal.querySelector('[data-share-option="wallet"]');
    const qrImage = Array.from(modal.querySelectorAll("svg")).some((s) => shown(s) && s.getBoundingClientRect().width > 40 && !walletSection?.contains(s));
    const walletQr = !!walletSection && Array.from(walletSection.querySelectorAll("svg")).some((s) => shown(s) && s.getBoundingClientRect().width > 40);
    const top = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().top) : -1);
    const cardLink = modal.querySelector("span.text-blue-400");
    const nfc = modal.querySelector('[data-share-option="nfc"]');
    const wallet = Array.from(modal.querySelectorAll("a")).find((a) => (a.textContent ?? "").includes("Add to Apple Wallet") && shown(a)) ?? null;
    return {
      walletSection: !!walletSection,
      walletButton: !!wallet,
      walletQr,
      walletText: walletSection?.textContent ?? "",
      writeTag: !!visibleBtn("Write to a tag"),
      downloadCard: !!visibleBtn("Download card (PNG)"),
      downloadQr: !!visibleBtn("Download QR (PNG)"),
      shareQrLink: !!visibleBtn("Share QR link"),
      qrImage,
      order: {
        wallet: top(wallet),
        cardLink: top(cardLink),
        downloadCard: top(visibleBtn("Download card (PNG)")),
        downloadQr: top(visibleBtn("Download QR (PNG)")),
        nfc: top(nfc),
      },
    };
  });
}

const MOBILE = 375;
const DESKTOP = 1280;

// One list at every width (owner, 2026-10-06): Apple Wallet first, then the
// two pictures, then the card link, then NFC. No QR picture — Show QR has it.
for (const [name, width] of [["phone", MOBILE], ["computer", DESKTOP]] as const) {
  describe(`share modal on a ${name}`, () => {
    it("offers Wallet, BOTH downloads, and no QR picture", async () => {
      const page = await mount(width, { withCapture: true, wallet: true });
      try {
        const m = await openModal(page);
        expect(m.order.wallet, "Add to Apple Wallet is missing").toBeGreaterThan(-1);
        expect(m.downloadCard, "the card PNG download is missing").toBe(true);
        expect(m.downloadQr, "the QR PNG download is missing").toBe(true);
        expect(m.qrImage, "a QR picture is back in the popup").toBe(false);
      } finally { await page.close(); }
    }, 90_000);

    it("in exactly the order asked for: Wallet, card, QR, link, NFC", async () => {
      const page = await mount(width, { withCapture: true, wallet: true });
      try {
        const { order } = await openModal(page);
        expect(order.wallet).toBeGreaterThan(-1);
        expect(order.downloadCard).toBeGreaterThan(order.wallet);
        expect(order.downloadQr).toBeGreaterThan(order.downloadCard);
        expect(order.cardLink).toBeGreaterThan(order.downloadQr);
        expect(order.nfc).toBeGreaterThan(order.cardLink);
      } finally { await page.close(); }
    }, 90_000);
  });
}

// Owner, 2026-10-07: everything has to make sense on the device it is on.
describe("Apple Wallet and NFC make sense on each device", () => {
  it("iPhone and Mac: the Add to Apple Wallet button", async () => {
    for (const device of ["iphone", "mac"] as const) {
      const page = await mount(device === "iphone" ? MOBILE : DESKTOP, { withCapture: true, wallet: true }, undefined, device);
      try {
        const m = await openModal(page);
        expect(m.walletButton, device).toBe(true);
        expect(m.walletQr, device).toBe(false);
      } finally { await page.close(); }
    }
  }, 90_000);

  it("a Windows computer: a code to scan with the iPhone, not a .pkpass it cannot open", async () => {
    const page = await mount(DESKTOP, { withCapture: true, wallet: true }, undefined, "windows");
    try {
      const m = await openModal(page);
      expect(m.walletSection).toBe(true);
      expect(m.walletButton, "a Wallet download on a computer with no Wallet").toBe(false);
      expect(m.walletQr, "the scan-with-your-iPhone code is missing").toBe(true);
      expect(m.walletText).toContain("Scan this with your iPhone");
      expect(m.qrImage, "the Wallet code counted as the card QR picture").toBe(false);
    } finally { await page.close(); }
  }, 90_000);

  it("Android: no Apple Wallet section at all", async () => {
    const page = await mount(MOBILE, { withCapture: true, wallet: true }, undefined, "android");
    try {
      const m = await openModal(page);
      expect(m.walletSection, "an Apple Wallet heading on Android").toBe(false);
      expect(m.downloadCard).toBe(true);
    } finally { await page.close(); }
  }, 90_000);

  it("Write to a tag only where the browser can write one", async () => {
    // No Web NFC (iPhone, every computer): no button, the NFC-app path instead.
    let page = await mount(DESKTOP, { withCapture: true });
    try {
      const m = await openModal(page);
      expect(m.writeTag, "a Write to a tag button that can only fail").toBe(false);
      expect(await page.locator('[data-share-option="nfc"]').textContent()).toContain("Write it with a free NFC app on your phone");
    } finally { await page.close(); }
    // Android Chrome has NDEFReader: the button is there.
    page = await mount(MOBILE, { withCapture: true }, "window.NDEFReader = function () {}", "android");
    try {
      const m = await openModal(page);
      expect(m.writeTag, "Android Chrome lost Write to a tag").toBe(true);
    } finally { await page.close(); }
  }, 90_000);
});

describe("without a capturable card (the /preview demo)", () => {
  it("offers the QR picture download only — no dead card button", async () => {
    // /preview draws its card in an <iframe>; there is no node to rasterize, so
    // a "Download card" button there would be a guaranteed dead tap.
    const page = await mount(MOBILE, { withCapture: false });
    try {
      const m = await openModal(page);
      expect(m.downloadCard, "a dead download button on a page with no card").toBe(false);
      expect(m.downloadQr).toBe(true);
    } finally { await page.close(); }
  }, 90_000);
});

// In the iOS app both buttons used to open the share sheet with the card LINK
// ("Share QR link"). They must hand it the PICTURE: a PNG File, so iOS offers
// "Save Image". The shell is stood in for by the WKWebView bridge object
// detectNativeApp() looks for, and navigator.share by a recorder.
const AS_APP = `
  window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
  window.__shared = [];
  window.__shareError = null;
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    if (window.__shareError) { const e = new Error("x"); e.name = window.__shareError; throw e; }
    window.__shared.push({ url: d.url ?? null, files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })) });
  };
`;
type Shared = { url: string | null; files: { name: string; type: string; size: number }[] };
const sharedSoFar = (page: Page) => page.evaluate(() => (window as unknown as { __shared: Shared[] }).__shared);

describe("in the app, the downloads save a picture, never the link", () => {
  for (const [label, filename] of [["Download QR (PNG)", "swiftcard-qr.png"], ["Download card (PNG)", "card-a.png"]] as const) {
    it(`${label} shares a PNG file`, async () => {
      const page = await mount(MOBILE, { withCapture: true }, AS_APP);
      try {
        const m = await openModal(page);
        expect(m.shareQrLink, "the old 'Share QR link' label is back").toBe(false);
        await page.locator(`button:has-text("${label}")`).click();
        await page.waitForFunction(() => (window as unknown as { __shared: unknown[] }).__shared.length > 0, null, { timeout: 30_000 });
        const shared = await sharedSoFar(page);
        expect(shared).toHaveLength(1);
        expect(shared[0].url, "it shared a link").toBeNull();
        expect(shared[0].files).toHaveLength(1);
        expect(shared[0].files[0].type).toBe("image/png");
        expect(shared[0].files[0].name).toBe(filename);
        expect(shared[0].files[0].size).toBeGreaterThan(5000);
      } finally { await page.close(); }
    }, 90_000);
  }

  it("when iOS refuses a stale tap, the picture opens with its own Save button", async () => {
    const page = await mount(MOBILE, { withCapture: true }, AS_APP);
    try {
      await openModal(page);
      await page.evaluate(() => { (window as unknown as { __shareError: string }).__shareError = "NotAllowedError"; });
      await page.locator('button:has-text("Download QR (PNG)")').click();
      const sheet = page.locator('[aria-labelledby="save-picture-title"]');
      await sheet.waitFor({ timeout: 30_000 });
      const img = sheet.locator("img");
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1024);
      expect(await img.evaluate((el) => el.classList.contains("sc-selectable"))).toBe(true);

      // A fresh tap on Save picture shares the file, and the sheet closes.
      await page.evaluate(() => { (window as unknown as { __shareError: null }).__shareError = null; });
      await sheet.locator('button:has-text("Save picture")').click();
      await sheet.waitFor({ state: "detached" });
      const shared = await sharedSoFar(page);
      expect(shared.at(-1)?.files[0]?.type).toBe("image/png");
    } finally { await page.close(); }
  }, 90_000);
});

describe("on a computer, the downloads are ordinary downloads", () => {
  it("Download QR (PNG) saves swiftcard-qr.png", async () => {
    const page = await mount(DESKTOP, { withCapture: true });
    try {
      await openModal(page);
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30_000 }),
        page.locator('button:has-text("Download QR (PNG)")').click(),
      ]);
      expect(download.suggestedFilename()).toBe("swiftcard-qr.png");
    } finally { await page.close(); }
  }, 90_000);
});

// The dashboard's "Scan to connect (QR)" button was replaced by tapping the
// card itself (owner, 2026-09-29): it opens full screen and SIDEWAYS, to hold
// up while someone scans the QR printed on the card. Measured here at real
// phone sizes, because every property the owner asked for — sideways, as big
// as the screen allows, centred, an × to leave — is layout, which no source
// scan can see.
describe("the full-screen card (tap your card on a phone)", () => {
  async function mountFull(width: number, height: number): Promise<Page> {
    const css = await appCss();
    const page = await browser.newPage();
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
       <style>body{margin:0;padding:16px;background:#030712}</style></head>
       <body class="sc-app"><div id="root"></div><script>${bundle}</script></body></html>`,
    );
    await page.evaluate(() => (window as unknown as { mountFull: () => void }).mountFull());
    await page.locator("#open-full").click();
    await page.waitForSelector('[aria-label="Your card, full screen"]');
    await page.waitForTimeout(300);
    return page;
  }

  /** The card's on-screen box, the close button's, and the QR's. */
  function measureFull(page: Page) {
    return page.evaluate(() => {
      const overlay = document.querySelector('[aria-label="Your card, full screen"]') as HTMLElement;
      const card = overlay.querySelector(".rounded-2xl") as HTMLElement;
      const close = overlay.querySelector('button[aria-label="Close"]') as HTMLElement;
      // The card's QR: the largest svg inside the card.
      const qr = Array.from(card.querySelectorAll("svg"))
        .map((s) => s.getBoundingClientRect())
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const box = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      return {
        vw: window.innerWidth, vh: window.innerHeight,
        parentIsBody: overlay.parentElement === document.body,
        zIndex: Number(getComputedStyle(overlay).zIndex),
        focusedClose: document.activeElement === close,
        card: box(card.getBoundingClientRect()),
        close: box(close.getBoundingClientRect()),
        qr: qr ? box(qr) : null,
      };
    });
  }

  it("on a phone held upright, the card is turned sideways and fills the screen, centred", async () => {
    const page = await mountFull(390, 844);
    try {
      const m = await measureFull(page);
      expect(m.parentIsBody, "not portaled — an ancestor transform would cage it").toBe(true);
      expect(m.zIndex, "must sit above the guided tour (z 10000)").toBeGreaterThanOrEqual(10001);
      // Turned: on screen the card is TALLER than it is wide.
      expect(m.card.height).toBeGreaterThan(m.card.width * 1.5);
      // As big as fits: its short side uses nearly the whole screen width.
      expect(m.card.width).toBeGreaterThan(m.vw * 0.85);
      // Entirely on screen, with room at both ends for the notch and home bar.
      expect(m.card.left).toBeGreaterThanOrEqual(0);
      expect(m.card.right).toBeLessThanOrEqual(m.vw);
      expect(m.card.top).toBeGreaterThanOrEqual(40);
      expect(m.card.bottom).toBeLessThanOrEqual(m.vh - 40);
      // Evenly: centred both ways.
      expect(Math.abs((m.card.left + m.card.right) / 2 - m.vw / 2)).toBeLessThan(2);
      expect(Math.abs((m.card.top + m.card.bottom) / 2 - m.vh / 2)).toBeLessThan(2);
      // The QR is there and scannable-sized.
      expect(m.qr, "no QR on the full-screen card").not.toBeNull();
      expect(m.qr!.width).toBeGreaterThan(60);
      // The × is on screen, a real target, and clear of the card.
      expect(m.close.width).toBeGreaterThanOrEqual(40);
      expect(m.close.left).toBeGreaterThanOrEqual(0);
      expect(m.close.right).toBeLessThanOrEqual(m.vw);
      expect(m.close.bottom).toBeLessThanOrEqual(m.vh);
      const overlaps = !(m.close.right <= m.card.left || m.close.left >= m.card.right || m.close.bottom <= m.card.top || m.close.top >= m.card.bottom);
      expect(overlaps, "the × sits on the card").toBe(false);
      expect(m.focusedClose, "focus should land on the × when it opens").toBe(true);
    } finally { await page.close(); }
  }, 90_000);

  it("on a phone already turned sideways, the card is shown upright and fills the screen", async () => {
    const page = await mountFull(844, 390);
    try {
      const m = await measureFull(page);
      expect(m.card.width).toBeGreaterThan(m.card.height * 1.5);
      expect(m.card.height).toBeGreaterThan(m.vh * 0.85);
      expect(m.card.left).toBeGreaterThanOrEqual(40);
      expect(m.card.right).toBeLessThanOrEqual(m.vw - 40);
      expect(m.card.top).toBeGreaterThanOrEqual(0);
      expect(m.card.bottom).toBeLessThanOrEqual(m.vh);
      expect(Math.abs((m.card.left + m.card.right) / 2 - m.vw / 2)).toBeLessThan(2);
      const overlaps = !(m.close.right <= m.card.left || m.close.left >= m.card.right || m.close.bottom <= m.card.top || m.close.top >= m.card.bottom);
      expect(overlaps, "the × sits on the card").toBe(false);
      // Top-right for the person holding it.
      expect(m.close.top).toBeLessThan(m.vh / 4);
      expect(m.close.left).toBeGreaterThan(m.vw * 0.75);
    } finally { await page.close(); }
  }, 90_000);

  it("the × closes it, and so does Escape", async () => {
    const page = await mountFull(390, 844);
    try {
      await page.locator('button[aria-label="Close"]').click();
      await page.waitForTimeout(150);
      expect(await page.locator('[aria-label="Your card, full screen"]').count(), "× did not close it").toBe(0);
      expect(await page.evaluate(() => document.documentElement.style.overflow), "page scroll left locked").toBe("");

      await page.locator("#open-full").click();
      await page.waitForSelector('[aria-label="Your card, full screen"]');
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      expect(await page.locator('[aria-label="Your card, full screen"]').count(), "Escape did not close it").toBe(0);
    } finally { await page.close(); }
  }, 90_000);
});

describe("two panels on one page resolve to their OWN card", () => {
  it("each provider reports its own registration", async () => {
    // The dashboard renders the panel twice with one copy display:none. If both
    // shared a provider, whichever registered last would win and the visible
    // modal could rasterize the hidden card — a blank PNG, silently.
    const page = await mount(MOBILE, { twoPanels: true });
    try {
      const probes = await page.evaluate(() => ({
        a: document.getElementById("probe-card-a")?.textContent,
        b: document.getElementById("probe-card-b")?.textContent,
      }));
      expect(probes.a).toBe("card-a.png");
      expect(probes.b).toBe("card-b.png");
    } finally { await page.close(); }
  }, 90_000);

  it("and both still open a working modal", async () => {
    const page = await mount(MOBILE, { twoPanels: true });
    try {
      const second = await openModal(page, 1);
      expect(second.downloadCard).toBe(true);
      expect(second.downloadQr).toBe(true);
    } finally { await page.close(); }
  }, 90_000);
});
