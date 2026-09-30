import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page, Request } from "playwright";
import { appCss, launchBrowser } from "./harness";

// ── "Get notifications like this on your phone", clicked for real ────────────
//
// Owner, 2026-09-18: remind people who skipped the notifications switch, right
// under an important notification — but not on every notification, never so
// often it is spam, and once they really don't want it, never again. And it
// must not disturb anything else the notifications do.
//
// A source scan cannot see what a person sees when the bell opens: which row
// the reminder hangs under, whether two asks end up on one screen, whether the
// switch inside it actually asks the browser, whether it fits a 320px phone.
// So this bundles the REAL NotificationBell and PushNudge (the dashboard's own
// notifications list was a third surface until it went with Quick Contacts,
// 2026-09-29)
// with esbuild, serves them from a fake https origin (so storage and a secure
// context behave like the site), answers the API from here, and clicks.
//
// Stubbed: next/navigation (router calls are recorded), PlanGate's GateCopy
// (renders its text, its web behaviour), and the browser push APIs — headless
// Chromium has no real notification permission to grant, and the point is
// what OUR code does with each answer.

const ORIGIN = "https://sc.test";
let browser: Browser;
let bundle: string;
let css: string;
let tmp: string;

beforeAll(async () => {
  browser = await launchBrowser();
  css = await appCss();
  const cache = resolve("node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  tmp = mkdtempSync(join(cache, "pushask-"));

  writeFileSync(join(tmp, "nav-stub.tsx"), `
    export function useRouter() {
      return {
        push: (u: string) => { (window as any).__nav.push(u); },
        replace: (u: string) => { (window as any).__nav.push(u); },
        refresh: () => {},
        back: () => {},
        prefetch: () => {},
      };
    }
    export function usePathname() { return "/dashboard"; }
    export function useSearchParams() { return new URLSearchParams(); }
  `);
  writeFileSync(join(tmp, "plangate-stub.tsx"), `
    export function GateCopy({ copy }: any) { return copy; }
  `);
  // The iPhone app's push plugin, answered from window.__capPerm ("prompt" |
  // "granted" | "denied") so a test can play the OS: deny once, then "flip
  // Allow in Settings" by changing it and firing visibilitychange.
  writeFileSync(join(tmp, "cap-push-stub.ts"), `
    const w = window as any;
    export const PushNotifications = {
      checkPermissions: async () => ({ receive: w.__capPerm ?? "prompt" }),
      requestPermissions: async () => { w.__capAsks = (w.__capAsks ?? 0) + 1; return { receive: w.__capPerm ?? "prompt" }; },
      addListener: async (name: string, cb: (e: any) => void) => {
        (w.__capListeners = w.__capListeners ?? {})[name] = cb;
        return { remove() { delete w.__capListeners[name]; } };
      },
      register: async () => { w.__capListeners?.registration?.({ value: "abcdef0123456789abcdef0123456789" }); },
    };
  `);
  writeFileSync(join(tmp, "entry.tsx"), `
    import { createRoot } from "react-dom/client";
    import { createElement as h, Fragment } from "react";
    import NotificationBell from "@/components/NotificationBell";
    import PushNudge from "@/components/PushNudge";
    (window as any).__nav = [];
    (window as any).mount = (o: any) => {
      createRoot(document.getElementById("root")!).render(
        h(Fragment, null,
          o.nudge ? h(PushNudge, { viewCount: o.viewCount ?? 0 }) : null,
          h("nav", { className: "sc-app flex justify-end p-2" },
            h(NotificationBell, { initialNotifications: o.notifs, cardLabels: {} })),
        ),
      );
    };
  `);

  writeFileSync(join(tmp, "link-stub.tsx"), `
    import { createElement } from "react";
    export default function Link(props: any) {
      const { href, children, prefetch, scroll, ...rest } = props;
      return createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
    }
  `);
  const out = await build({
    entryPoints: [join(tmp, "entry.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY": '"BPtestkeyplaceholderAAAA"',
      "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://example.supabase.co"',
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"anon"',
      "process.env.NEXT_PUBLIC_APP_STORE_URL": '"https://apps.apple.com/app/id6798875872"',
      "process.env.NEXT_PUBLIC_APP_STORE_ID": "undefined",
      // Read by lib/app-store's PLAY_STORE_URL (the Google Play badge). Next
      // inlines it in a real build; a bare esbuild bundle has no `process`.
      "process.env.NEXT_PUBLIC_PLAY_STORE_URL": "undefined",
    },
    alias: {
      "next/navigation": join(tmp, "nav-stub.tsx"),
      // SeeWhoLink (the Free "See who and where →" line) uses next/link.
      "next/link": join(tmp, "link-stub.tsx"),
      "@capacitor/push-notifications": join(tmp, "cap-push-stub.ts"),
      "@/components/PlanGate": join(tmp, "plangate-stub.tsx"),
      "@": resolve("src"),
    },
  });
  bundle = out.outputFiles[0].text;
  if (!bundle || bundle.length < 1000) throw new Error("push-ask bundle is empty — the esbuild step failed");
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

type Notif = { id: string; type: string; title: string; body: string; read: boolean; created_at: string; card_owner?: string | null };
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const LEAD: Notif = { id: uuid(1), type: "new_lead", title: "New contact: Shantal Paul", body: "Shantal Paul shared their info with you.", read: false, created_at: ago(5 * 60_000) };
const VIEW: Notif = { id: uuid(2), type: "card_viewed", title: "Card viewed", body: "Someone viewed your card.", read: false, created_at: ago(60_000) };
const OLD_REPLY: Notif = { id: uuid(3), type: "lead_reply", title: "Dana replied", body: "Sounds good!", read: true, created_at: ago(30 * 60_000) };
const MILESTONE: Notif = { id: uuid(4), type: "milestone_10", title: "10 views!", body: "Your card hit 10 views.", read: false, created_at: ago(2 * 60_000) };

type Opts = {
  notifs: Notif[];
  nudge?: boolean;
  width?: number;
  userAgent?: string;
  /** What the server answers a claim with. */
  claimShow?: boolean;
  /** What GET /api/push/ask answers (the dashboard box reads it). */
  account?: { pushOn: boolean; stopped: boolean; quietUntil: string | null };
  /** Notification.permission before anything is asked. */
  permission?: "default" | "granted" | "denied";
  /** What the browser's own prompt answers. */
  answer?: "granted" | "denied" | "default";
  /** This browser already holds a push subscription (push is ON here). */
  alreadySubscribed?: boolean;
  /** The site's light theme (data-sc-theme="light"). */
  light?: boolean;
  /** An iPhone Safari TAB: no web push at all until "Add to Home Screen". */
  iphoneBrowser?: boolean;
  /** The iPhone APP (Capacitor shell), with the OS permission in this state. */
  native?: "prompt" | "granted" | "denied";
};

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

type Rig = { page: Page; asks: Array<Record<string, unknown>>; subscribes: number; permissionAsks: () => Promise<number> };

async function rig(o: Opts): Promise<Rig> {
  const ctx = await browser.newContext({
    viewport: { width: o.width ?? 390, height: 844 },
    ...(o.iphoneBrowser ? { userAgent: IPHONE_SAFARI } : o.userAgent ? { userAgent: o.userAgent } : {}),
  });
  // The App Store opens in a new tab when the badge is tapped; answer it here
  // rather than reaching the real internet from a test.
  await ctx.route("https://apps.apple.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>App Store</p>" }));
  const page = await ctx.newPage();
  const asks: Array<Record<string, unknown>> = [];
  const state = { subscribes: 0 };

  await page.route(`${ORIGIN}/**`, async (route) => {
    const req: Request = route.request();
    const url = new URL(req.url());
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname === "/") {
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
          <style>body{margin:0;background:#030712}</style></head>
          <body><div id="root"></div><script>${bundle}</script></body></html>`,
      });
    }
    if (url.pathname === "/api/notifications") return json(o.notifs);
    if (url.pathname === "/api/push/ask" && req.method() === "GET") {
      return json(o.account ?? { pushOn: false, stopped: false, quietUntil: null });
    }
    if (url.pathname === "/api/push/ask") {
      const body = JSON.parse(req.postData() || "{}");
      asks.push(body);
      return json(body.action ? { ok: true } : { show: o.claimShow ?? true });
    }
    if (url.pathname === "/api/push/subscribe") { state.subscribes++; return json({ ok: true }); }
    return json({ ok: true }); // client-error and anything else
  });

  // The browser's push machinery, answered the way a real browser would.
  await page.addInitScript(({ permission, answer, alreadySubscribed, iphoneBrowser, native }) => {
    if (iphoneBrowser) {
      // What an iPhone Safari tab really has: no PushManager at all.
      delete (window as unknown as Record<string, unknown>).PushManager;
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    if (native) {
      // The shell: lib/platform detectNativeApp() reads Capacitor.isNativePlatform,
      // EnablePushButton reads isPluginAvailable; the plugin itself is the stub.
      w.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true };
      w.__capPerm = native;
      return;
    }
    w.__permissionAsks = 0;
    let perm = permission;
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/test-device", keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: async () => true,
    };
    let subscribed = alreadySubscribed;
    const reg = {
      pushManager: {
        getSubscription: async () => (subscribed ? sub : null),
        subscribe: async () => { subscribed = true; return sub; },
      },
    };
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        get permission() { return perm; },
        requestPermission: async () => {
          (w.__permissionAsks as number)++;
          perm = answer;
          return answer;
        },
      },
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve(reg), register: async () => reg },
    });
  }, { permission: o.permission ?? "default", answer: o.answer ?? "granted", alreadySubscribed: !!o.alreadySubscribed, iphoneBrowser: !!o.iphoneBrowser, native: o.native ?? null });

  await page.goto(`${ORIGIN}/`);
  // After load: an init script runs before <html> exists.
  if (o.light) await page.evaluate(() => document.documentElement.setAttribute("data-sc-theme", "light"));
  await page.evaluate((opts) => {
    (window as unknown as { mount: (x: unknown) => void }).mount(opts);
  }, { notifs: o.notifs, nudge: !!o.nudge, viewCount: 0 });

  return {
    page,
    asks,
    get subscribes() { return state.subscribes; },
    permissionAsks: () => page.evaluate(() => (window as unknown as { __permissionAsks: number }).__permissionAsks),
  };
}

const openBell = (p: Page) => p.click('nav button[aria-label="Notifications"]');
const closeBell = (p: Page) => p.click('[role="dialog"][aria-label="Notifications"] button[aria-label="Close"]');
const reminders = (p: Page) => p.locator("[data-push-ask]").count();
const claims = (r: Rig) => r.asks.filter((a) => typeof a.id === "string" && !a.action);
const settle = (p: Page) => p.waitForTimeout(400);

describe("the reminder appears where it should — and only there", () => {
  it("hangs under the newest unread NEW CONTACT, never under a view or a milestone", async () => {
    const r = await rig({ notifs: [VIEW, MILESTONE, LEAD, OLD_REPLY] });
    await openBell(r.page);
    await r.page.waitForSelector("[data-push-ask]");
    expect(await reminders(r.page)).toBe(1);
    // The row directly above it is the lead.
    const above = await r.page.$eval("[data-push-ask]", (el) => el.previousElementSibling?.textContent ?? "");
    expect(above).toContain("New contact: Shantal Paul");
    expect(claims(r)).toEqual([{ id: LEAD.id }]);
    await r.page.context().close();
  });

  it("opening the bell again is the same reminder — nothing is counted twice", async () => {
    const r = await rig({ notifs: [LEAD] });
    await openBell(r.page);
    await r.page.waitForSelector("[data-push-ask]");
    await closeBell(r.page);
    await openBell(r.page);
    await r.page.waitForSelector("[data-push-ask]");
    await settle(r.page);
    expect(claims(r)).toHaveLength(1);
    await r.page.context().close();
  });

  it("nothing important → no reminder, and the server is not even asked", async () => {
    const r = await rig({ notifs: [VIEW, MILESTONE, OLD_REPLY] });
    await openBell(r.page);
    await settle(r.page);
    expect(await reminders(r.page)).toBe(0);
    expect(r.asks).toHaveLength(0);
    await r.page.context().close();
  });

  it("a CLOSED bell asks nothing — a reminder is counted only when it is seen", async () => {
    const r = await rig({ notifs: [LEAD] });
    await settle(r.page);
    expect(r.asks).toHaveLength(0);
    await r.page.context().close();
  });

  it("the server's no is final: no reminder", async () => {
    const r = await rig({ notifs: [LEAD], claimShow: false });
    await openBell(r.page);
    await settle(r.page);
    expect(claims(r)).toHaveLength(1);
    expect(await reminders(r.page)).toBe(0);
    await r.page.context().close();
  });

  it("a device that is blocked, or already on, never sees it", async () => {
    for (const setup of [{ permission: "denied" as const }, { permission: "granted" as const, alreadySubscribed: true }]) {
      const r = await rig({ notifs: [LEAD], ...setup });
      await openBell(r.page);
      await settle(r.page);
      expect(await reminders(r.page)).toBe(0);
      expect(r.asks).toHaveLength(0);
      await r.page.context().close();
    }
  });
});

describe("every answer is respected", () => {
  it("Not now: gone, recorded, and it does not come back this session", async () => {
    const r = await rig({ notifs: [LEAD] });
    await openBell(r.page);
    await r.page.waitForSelector("[data-push-ask]");
    await r.page.click("[data-push-ask] >> text=Not now");
    await settle(r.page);
    expect(await reminders(r.page)).toBe(0);
    expect(r.asks).toContainEqual({ action: "later", id: LEAD.id });
    await closeBell(r.page);
    await openBell(r.page);
    await settle(r.page);
    expect(await reminders(r.page)).toBe(0);
    expect(claims(r)).toHaveLength(1);
    await r.page.context().close();
  });

  it("Don't ask again: gone and recorded as never", async () => {
    const r = await rig({ notifs: [LEAD] });
    await openBell(r.page);
    await r.page.waitForSelector("[data-push-ask]");
    await r.page.click("[data-push-ask] >> text=Don't ask again");
    await settle(r.page);
    expect(await reminders(r.page)).toBe(0);
    expect(r.asks).toContainEqual({ action: "stop" });
    await r.page.context().close();
  });

  it("the switch asks the browser for permission, subscribes, and says so", async () => {
    const r = await rig({ notifs: [LEAD] });
    await openBell(r.page);
    await r.page.waitForSelector("[data-push-ask]");
    await r.page.click('[data-push-ask] [role="switch"]');
    await r.page.waitForSelector("[data-push-ask] [role=status]");
    expect(await r.permissionAsks()).toBe(1);
    expect(r.subscribes).toBe(1);
    expect(await r.page.textContent("[data-push-ask]")).toContain("You're set");
    // …and then it goes away by itself.
    await r.page.waitForSelector("[data-push-ask]", { state: "detached", timeout: 8000 });
    await r.page.context().close();
  });

  // Owner, 2026-09-23: a "Don't Allow"/"Block" at the device's own prompt is
  // no longer "never again". On the web there is no button that can undo it,
  // so the reminder simply goes away here; nothing is stopped.
  it("'Block' at the browser's own prompt hides the reminder here — and ends nothing", async () => {
    const r = await rig({ notifs: [LEAD], answer: "denied" });
    await openBell(r.page);
    await r.page.waitForSelector("[data-push-ask]");
    await r.page.click('[data-push-ask] [role="switch"]');
    await r.page.waitForSelector("[data-push-ask]", { state: "detached" });
    expect(r.asks).not.toContainEqual({ action: "stop" });
    expect(r.subscribes).toBe(0);
    await r.page.context().close();
  });

  it("in the app after 'Don't Allow': the reminder offers iPhone Settings, and coming back allowed turns push on", async () => {
    const r = await rig({ notifs: [LEAD], native: "denied" });
    await openBell(r.page);
    await r.page.waitForSelector('[data-push-ask="settings"]');
    expect(await reminders(r.page)).toBe(1);
    expect(await r.page.locator('[data-push-ask] [role="switch"]').count()).toBe(0);
    expect(await r.page.textContent("[data-push-ask]")).toContain("Notifications are off for SwiftCard");
    const open = r.page.locator("[data-push-ask] >> text=Open iPhone Settings");
    expect(await open.count()).toBe(1);
    // A reminder like any other: claimed once, within the same budget.
    expect(claims(r)).toEqual([{ id: LEAD.id }]);
    // Tap it (app-settings: goes nowhere in Chromium), flip Allow "in
    // Settings", come back to the app.
    await open.click();
    await r.page.evaluate(() => {
      (window as unknown as { __capPerm: string }).__capPerm = "granted";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await r.page.waitForSelector("[data-push-ask] >> text=You're set", { timeout: 8000 });
    expect(r.subscribes).toBe(1);
    expect(r.asks).not.toContainEqual({ action: "stop" });
    await r.page.context().close();
  });

  it("in the app, coming back allowed WITHOUT having gone to Settings from the reminder shows the switch, not a surprise", async () => {
    const r = await rig({ notifs: [LEAD], native: "denied" });
    await openBell(r.page);
    await r.page.waitForSelector('[data-push-ask="settings"]');
    await r.page.evaluate(() => {
      (window as unknown as { __capPerm: string }).__capPerm = "granted";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await r.page.waitForSelector('[data-push-ask="switch"] [role="switch"]');
    expect(r.subscribes).toBe(0);
    await r.page.context().close();
  });

  it("a prompt put away without an answer is NOT a no — nothing is stopped", async () => {
    const r = await rig({ notifs: [LEAD], answer: "default" });
    await openBell(r.page);
    await r.page.waitForSelector("[data-push-ask]");
    await r.page.click('[data-push-ask] [role="switch"]');
    await settle(r.page);
    expect(r.asks).not.toContainEqual({ action: "stop" });
    expect(await reminders(r.page)).toBe(1);
    await r.page.context().close();
  });
});

describe("one ask on screen, never two", () => {
  it("while the dashboard box is asking, the bell does not", async () => {
    const r = await rig({ notifs: [LEAD], nudge: true });
    await r.page.waitForSelector("text=Know the moment someone connects");
    await openBell(r.page);
    await settle(r.page);
    expect(await reminders(r.page)).toBe(0);
    expect(claims(r)).toHaveLength(0);
    await r.page.context().close();
  });

  it("'Not now' on the box rests the bell too — no second ask seconds later", async () => {
    const r = await rig({ notifs: [LEAD], nudge: true });
    await r.page.waitForSelector("text=Know the moment someone connects");
    await r.page.click("text=Not now");
    await settle(r.page);
    expect(r.asks).toContainEqual({ action: "snooze" });
    await openBell(r.page);
    await settle(r.page);
    expect(await reminders(r.page)).toBe(0);
    await r.page.context().close();
  });

  it("the box stays away when the account already has push, said stop, or was asked recently", async () => {
    for (const account of [
      { pushOn: true, stopped: false, quietUntil: null },
      { pushOn: false, stopped: true, quietUntil: null },
      { pushOn: false, stopped: false, quietUntil: new Date(Date.now() + 86_400_000).toISOString() },
    ]) {
      const r = await rig({ notifs: [], nudge: true, account });
      await settle(r.page);
      expect(await r.page.locator("text=Know the moment someone connects").count()).toBe(0);
      await r.page.context().close();
    }
  });

  it("in the bell, tapping the switch never also opens the contact", async () => {
    const r = await rig({ notifs: [LEAD] });
    await openBell(r.page);
    await r.page.waitForSelector('[role="dialog"] [data-push-ask] [role="switch"]');
    await r.page.click('[role="dialog"] [data-push-ask] [role="switch"]');
    await r.page.waitForSelector('[role="dialog"] [data-push-ask] [role=status]');
    expect(r.subscribes).toBe(1);
    // The row's own text still opens the contact — the reminder did not break it.
    expect(await r.page.evaluate(() => (window as unknown as { __nav: string[] }).__nav)).toEqual([]);
    await r.page.click('[role="dialog"] >> text=New contact: Shantal Paul');
    expect(await r.page.evaluate(() => (window as unknown as { __nav: string[] }).__nav)).toEqual(["/contacts"]);
    await r.page.context().close();
  });

  it("readable in the bell on the light theme and the dark one", async () => {
    for (const light of [false, true]) {
      const r = await rig({ notifs: [LEAD], light });
      await openBell(r.page);
      await r.page.waitForSelector('[role="dialog"] [data-push-ask] [role=switch]');
      const ratio = await r.page.evaluate(() => {
        const box = document.querySelector('[role="dialog"] [data-push-ask]') as HTMLElement;
        const title = box.querySelector("p") as HTMLElement;
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        // The colour actually behind the text: the first ancestor with an opaque-ish background.
        let bgEl: HTMLElement | null = box;
        let bg = "rgb(0,0,0)";
        while (bgEl) {
          const c = getComputedStyle(bgEl).backgroundColor;
          const a = c.match(/[\d.]+/g);
          if (a && (a.length < 4 || Number(a[3]) > 0.5)) { bg = c; break; }
          bgEl = bgEl.parentElement;
        }
        if (!bgEl) bg = getComputedStyle(document.body).backgroundColor;
        const L1 = lum(rgb(getComputedStyle(title).color));
        const L2 = lum(rgb(bg));
        return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      });
      expect(ratio, light ? "light theme" : "dark theme").toBeGreaterThan(4.5);
      await r.page.context().close();
    }
  });
});

describe("an iPhone browser tab is sent to the app", () => {
  it("offers the App Store — not a switch that cannot work there — and says why", async () => {
    const r = await rig({ notifs: [LEAD], iphoneBrowser: true });
    await openBell(r.page);
    await r.page.waitForSelector('[data-push-ask="app"]');
    expect(await r.page.locator('[data-push-ask] [role="switch"]').count()).toBe(0);
    expect(await r.page.getAttribute('[data-push-ask] a[aria-label="Download on the App Store"]', "href"))
      .toBe("https://apps.apple.com/app/id6798875872");
    const text = await r.page.textContent("[data-push-ask]");
    expect(text).toContain("on your phone");
    expect(text).toContain("SwiftCard app");
    expect(claims(r)).toEqual([{ id: LEAD.id }]);
    await r.page.context().close();
  });

  it("tapping the App Store button is the answer: that reminder is done", async () => {
    const r = await rig({ notifs: [LEAD], iphoneBrowser: true });
    await openBell(r.page);
    await r.page.waitForSelector('[data-push-ask="app"]');
    await r.page.click('[data-push-ask] a[aria-label="Download on the App Store"]');
    await r.page.waitForSelector("[data-push-ask]", { state: "detached" });
    expect(r.asks).toContainEqual({ action: "later", id: LEAD.id });
    await r.page.context().close();
  });

  it("fits a 320px iPhone", async () => {
    const r = await rig({ notifs: [LEAD, VIEW], iphoneBrowser: true, width: 320 });
    await openBell(r.page);
    await r.page.waitForSelector('[data-push-ask="app"]');
    const fits = await r.page.evaluate(() => {
      const box = (document.querySelector("[data-push-ask]") as HTMLElement).getBoundingClientRect();
      const panel = (document.querySelector('[role="dialog"][aria-label="Notifications"]') as HTMLElement).getBoundingClientRect();
      const badge = (document.querySelector('[data-push-ask] a[aria-label="Download on the App Store"]') as HTMLElement).getBoundingClientRect();
      return box.left >= panel.left - 0.5 && box.right <= panel.right + 0.5 && badge.right <= panel.right + 0.5
        && document.documentElement.scrollWidth <= window.innerWidth;
    });
    expect(fits).toBe(true);
    await r.page.context().close();
  });
});

describe("it fits, and says the right device", () => {
  for (const width of [320, 390, 1280]) {
    it(`sits inside the bell at ${width}px — nothing cut off, nothing covered, no divider through it`, async () => {
      const r = await rig({ notifs: [LEAD, VIEW], width });
      await openBell(r.page);
      await r.page.waitForSelector("[data-push-ask] [role=switch]");
      const m = await r.page.evaluate(() => {
        const box = document.querySelector("[data-push-ask]") as HTMLElement;
        const panel = document.querySelector('[role="dialog"][aria-label="Notifications"]') as HTMLElement;
        const b = box.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        const covered: string[] = [];
        for (const el of Array.from(box.querySelectorAll<HTMLElement>("button, [role=switch]"))) {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!hit || !(el === hit || el.contains(hit))) covered.push(el.textContent || el.getAttribute("aria-label") || "?");
          if (r.right > p.right + 0.5 || r.left < p.left - 0.5) covered.push(`${el.textContent} outside the panel`);
        }
        const overflowing = Array.from(box.querySelectorAll<HTMLElement>("*")).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "visible").length;
        const row = box.previousElementSibling as HTMLElement;
        return {
          inside: b.left >= p.left - 0.5 && b.right <= p.right + 0.5,
          pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
          covered,
          overflowing,
          rowBorder: getComputedStyle(row).borderBottomWidth,
        };
      });
      expect(m.inside).toBe(true);
      expect(m.pageScrolls).toBe(false);
      expect(m.covered).toEqual([]);
      expect(m.overflowing).toBe(0);
      expect(m.rowBorder).toBe("0px");
      await r.page.context().close();
    });
  }

  it("on a computer it says computer; on a phone it says phone", async () => {
    const desk = await rig({ notifs: [LEAD] });
    await openBell(desk.page);
    await desk.page.waitForSelector("[data-push-ask]");
    expect(await desk.page.textContent("[data-push-ask]")).toContain("on this computer");
    await desk.page.context().close();

    const phone = await rig({
      notifs: [LEAD],
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    });
    await openBell(phone.page);
    await phone.page.waitForSelector("[data-push-ask]");
    expect(await phone.page.textContent("[data-push-ask]")).toContain("on your phone");
    await phone.page.context().close();
  });
});
