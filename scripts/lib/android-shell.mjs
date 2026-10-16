// ── The Android app, in a desktop browser ────────────────────────────────────
//
// SwiftCard for Android is a REMOTE-URL Capacitor shell: its WebView loads
// https://swiftcard.me/dashboard, so almost everything a person sees is the
// live site. That makes most of the app testable in plain Chromium — IF the
// page is convinced it is inside the Android app, which takes all of this:
//
//  · window.androidBridge. @capacitor/core's getPlatformId() checks it FIRST,
//    and lib/platform.ts and the sc-boot script in app/layout.tsx read it too.
//    A shim that only fakes window.Capacitor fools some of the code and not
//    the rest (scripts/native-flows.mjs learnt that the hard way on iOS).
//  · window.Capacitor with PluginHeaders + nativePromise + nativeCallback —
//    what Capacitor's injected native-bridge.js provides on a real device.
//    @capacitor/core routes every registerPlugin() call through them, so the
//    app's real plugin code (App, Share, SplashScreen, SystemBars, the
//    app-local ExternalPurchase and AppSettings) runs unmodified and every
//    call is RECORDED in window.__scAndroid.calls for the test to read.
//  · the user agent the shell really sends: an Android WebView ("; wv") plus
//    capacitor.config.ts android.appendUserAgent. The server keys the "/" →
//    /dashboard redirect, /pricing suppression and the AI-consent gate on it.
//  · the insets the way MainActivity.applyWindowInsets() hands them over —
//    inline --sc-inset-* on <html> — with env(safe-area-inset-*) left at 0,
//    which is what the WebView reports while MainActivity's listener owns the
//    insets (measured on the emulator, see docs/android-review/SHELL-RUNBOOK.md).
//
// What this CANNOT show: anything the native half does (file chooser, camera,
// downloads, push delivery, the real back key, cookies surviving a kill).
// Those run on the emulator — scripts/qa-android-device.mjs.
//
// Every context made here goes through markInternal (qa-internal-marker.test).
import { markInternal } from "../qa-internal.mjs";

// Device shapes. Insets are CSS px. Pixel 8 numbers are read off the emulator
// (status bar with the camera cutout; 3-button nav is 48dp, gesture pill 24dp).
export const ANDROID_DEVICES = {
  "pixel-8": { width: 412, height: 915, dpr: 2.625, top: 52, bottom: 48, model: "Pixel 8", os: 16 },
  "pixel-8-gesture": { width: 412, height: 915, dpr: 2.625, top: 52, bottom: 24, model: "Pixel 8", os: 16 },
  "galaxy-s24": { width: 360, height: 780, dpr: 3, top: 36, bottom: 48, model: "SM-S921U", os: 15 },
  "small-360": { width: 360, height: 640, dpr: 2, top: 24, bottom: 48, model: "moto g play", os: 13 },
};

/** The UA the Android shell sends. `build` is the SwiftCardAndroid/N token. */
export function androidShellUA({ model = "Pixel 8", os = 16, chrome = "141.0.7390.122", build = 1 } = {}) {
  return `Mozilla/5.0 (Linux; Android ${os}; ${model} Build/BP2A.250605.031; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${chrome} Mobile Safari/537.36 SwiftCardApp SwiftCardAndroid/${build}`;
}

// Runs in the page before any of its scripts. Kept self-contained: Playwright
// serialises it, so it can only use what it is passed.
function installAndroidBridge({ top, bottom, build, phoneDark }) {
  const rec = { calls: [], listeners: [], nextId: 1 };
  window.__scAndroid = rec;
  const log = (plugin, method, options) => { rec.calls.push({ plugin, method, options: options ?? null, at: Date.now() }); };

  // Everything installed in the 1.0.1 app (android/app/capacitor.build.gradle,
  // Capacitor 8 core plugins, MainActivity's registerPlugin calls). Build 2+
  // adds the app-local plugins 1.0.2 introduces.
  const plugins = ["App", "Browser", "Preferences", "PushNotifications", "Share", "SplashScreen", "Purchases",
    "SystemBars", "CapacitorCookies", "CapacitorHttp", "WebView", "ExternalPurchase", "AppSettings"];
  if (build >= 2) plugins.push("SaveImage");
  // @capacitor/core looks a method up with methods.find((m) => prop === m.name).
  // The real header lists each method; here every method exists, and only
  // addListener is a callback (its events arrive later, see rec.fire).
  const headers = plugins.map((name) => ({
    name,
    methods: {
      find: (pred) => (pred({ name: "addListener" }) ? { name: "addListener", rtype: "callback" } : { name: "*", rtype: "promise" }),
    },
  }));

  const answer = (plugin, method, options) => {
    if (plugin === "ExternalPurchase" && method === "open") return { opened: true };
    if (plugin === "Share" && method === "canShare") return { value: true };
    if (plugin === "Share" && method === "share") return { activityType: "" };
    if (plugin === "App" && method === "getInfo") return { name: "SwiftCard", id: "me.swiftcard.app", build: String(build + 2), version: build >= 2 ? "1.0.2" : "1.0.1" };
    if (plugin === "App" && method === "getState") return { isActive: true };
    if (plugin === "App" && method === "getLaunchUrl") return {};
    if (plugin === "PushNotifications" && method === "checkPermissions") return { receive: "prompt" };
    if (plugin === "PushNotifications" && method === "requestPermissions") return { receive: "denied" };
    if (plugin === "PushNotifications" && method === "listChannels") return { channels: [] };
    if (plugin === "PushNotifications" && method === "getDeliveredNotifications") return { notifications: [] };
    if (plugin === "Preferences" && method === "get") return { value: null };
    if (plugin === "Preferences" && method === "keys") return { keys: [] };
    if (plugin === "SaveImage" && method === "save") return { saved: true };
    void options;
    return {};
  };

  const cap = (window.Capacitor = window.Capacitor || {});
  cap.PluginHeaders = headers;
  cap.nativePromise = (plugin, method, options) => {
    log(plugin, method, options);
    if (method === "removeListener") {
      rec.listeners = rec.listeners.filter((l) => l.id !== options?.callbackId);
    }
    if (method === "removeAllListeners") rec.listeners = rec.listeners.filter((l) => l.plugin !== plugin);
    return Promise.resolve(answer(plugin, method, options));
  };
  cap.nativeCallback = (plugin, method, options, callback) => {
    log(plugin, method, options);
    const id = String(rec.nextId++);
    if (method === "addListener") rec.listeners.push({ id, plugin, eventName: options?.eventName, callback });
    return id;
  };
  // Plugins the web code reads straight off Capacitor.Plugins (the app-local
  // ones have no npm package to registerPlugin from).
  const direct = (plugin) => new Proxy({}, { get: (_t, method) => (typeof method === "string" ? (opts) => cap.nativePromise(plugin, method, opts) : undefined) });
  cap.Plugins = cap.Plugins || {};
  for (const p of ["ExternalPurchase", "AppSettings", "SystemBars", "SplashScreen"].concat(build >= 2 ? ["SaveImage"] : [])) cap.Plugins[p] = direct(p);

  window.androidBridge = { postMessage: (msg) => { try { const m = JSON.parse(msg); log(m.pluginId, m.methodName, m.options); } catch { /* not JSON */ } } };

  // Fire a native event at the listeners the page registered.
  rec.fire = (plugin, eventName, data) => {
    let n = 0;
    for (const l of rec.listeners) if (l.plugin === plugin && l.eventName === eventName) { n++; try { l.callback(data); } catch (e) { console.error(e); } }
    return n;
  };
  // The hardware/gesture back key. With a JS listener registered, Capacitor's
  // AppPlugin hands the press to it and does nothing else.
  rec.back = () => {
    const n = rec.fire("App", "backButton", { canGoBack: window.history.length > 1 });
    document.dispatchEvent(new Event("backbutton"));
    return n;
  };

  // MainActivity.applyWindowInsets(): inline custom properties on <html>, set
  // after the page commits (it runs on onPageLoaded + every inset change).
  // Capacitor's SystemBars plugin also writes --safe-area-inset-* (CSS px,
  // integers) — on WebView 140+ with viewport-fit=cover it passes the real
  // values through.
  const applyInsets = () => {
    const s = document.documentElement.style;
    s.setProperty("--sc-inset-top", `${top}px`);
    s.setProperty("--sc-inset-bottom", `${bottom}px`);
    s.setProperty("--sc-inset-left", "0px");
    s.setProperty("--sc-inset-right", "0px");
    s.setProperty("--safe-area-inset-top", `${Math.round(top)}px`);
    s.setProperty("--safe-area-inset-bottom", `${Math.round(bottom)}px`);
    s.setProperty("--safe-area-inset-left", "0px");
    s.setProperty("--safe-area-inset-right", "0px");
  };
  rec.applyInsets = applyInsets;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyInsets);
  else applyInsets();
  window.addEventListener("load", applyInsets);

  // Phone-level dark mode (prefers-color-scheme) is emulated by the context;
  // record it so findings can say which state they came from.
  rec.phoneDark = !!phoneDark;

  // Paint the status bar and the nav bar as red hatching in screenshots, so a
  // control drawn underneath one is obvious at a glance.
  const css = `html::before{content:"";position:fixed;top:0;left:0;right:0;height:${top}px;z-index:2147483647;pointer-events:none;background:repeating-linear-gradient(45deg,rgba(255,0,0,.30) 0 8px,rgba(255,0,0,.10) 8px 16px);}
    html::after{content:"";position:fixed;bottom:0;left:0;right:0;height:${bottom}px;z-index:2147483647;pointer-events:none;background:repeating-linear-gradient(45deg,rgba(255,0,0,.30) 0 8px,rgba(255,0,0,.10) 8px 16px);}`;
  const add = () => { const el = document.createElement("style"); el.setAttribute("data-sc-android-bars", ""); el.textContent = css; document.head.appendChild(el); };
  if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
}

/**
 * A browser context that the site believes is the Android app.
 *   device: a key of ANDROID_DEVICES
 *   build:  the SwiftCardAndroid/N token (1 = the 1.0.1 build on Play today)
 *   phoneDark: the phone's own dark mode (prefers-color-scheme)
 *   savedTheme: "dark" | "light" | null — the app's saved theme (localStorage sc_theme)
 */
export async function newAndroidContext(browser, { base, device = "pixel-8", build = 1, phoneDark = false, savedTheme = null, contextOptions = {} } = {}) {
  const d = ANDROID_DEVICES[device];
  if (!d) throw new Error(`unknown Android device ${device}`);
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: androidShellUA({ model: d.model, os: d.os, build }),
    colorScheme: phoneDark ? "dark" : "light",
    // The Android WebView DOES run service workers (WKWebView does not).
    serviceWorkers: "allow",
    ...contextOptions,
  });
  await markInternal(ctx, base);
  await ctx.addInitScript(installAndroidBridge, { top: d.top, bottom: d.bottom, build, phoneDark });
  if (savedTheme) await ctx.addInitScript((t) => { try { localStorage.setItem("sc_theme", t); } catch { /* blocked */ } }, savedTheme);
  return { ctx, device: d };
}

/** Everything the page asked the native side to do, in order. */
export async function nativeCalls(page, plugin) {
  const calls = await page.evaluate(() => window.__scAndroid?.calls ?? []);
  return plugin ? calls.filter((c) => c.plugin === plugin) : calls;
}

/** Press the Android back key. Returns how many listeners received it. */
export async function pressBack(page) {
  return page.evaluate(() => window.__scAndroid?.back() ?? 0);
}

// Words that must never be visible inside the Android app. Each one names
// something that does not exist there (Apple's account, the App Store, the
// iPhone's Settings app, Apple Wallet) or a gesture Android does not have.
export const NOT_ON_ANDROID = [
  /\biPhone\b/, /\biPad\b/, /\bApple account\b/i, /\bApple ID\b/, /App Store/, /Apple Wallet/,
  /Save to Photos/, /Restore Purchases/, /\bpull down to refresh\b/i, /\bSafari\b/,
];
// Anything that offers to sell. The Android app sells nothing (owner, 2026-10-08).
export const SELLING = [
  /\$\s?\d/, /\/\s?mo\b/, /per month/i, /\bGet Pro\b/, /\bUpgrade\b/, /\bKeep Pro\b/, /\bSubscribe\b/,
  /\bfree trial\b/i, /Try Pro free/i, /\bBuy\b/,
];

/**
 * The measured audit for ONE screen state, run in the page. Returns
 * [kind, detail] pairs. TOP/BOTTOM are the Android bars in CSS px.
 */
export const ANDROID_AUDIT = async ({ TOP, BOTTOM, notOnAndroid, selling }) => {
  const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await settle();
  const W = innerWidth, H = innerHeight;
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""} “${(el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 40).replace(/\s+/g, " ")}”`;
  const isFixedish = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") return n; } return null; };
  const offscreenClone = (r) => r.right <= 0 || r.left >= W;
  const txt = document.body.innerText || "";
  if (/Application error|Something went wrong|Internal Server Error|This page could not be found/i.test(txt)) out.push(["error-page", txt.slice(0, 120)]);
  if (document.documentElement.scrollWidth > W + 1) out.push(["horizontal-overflow", `scrollWidth ${document.documentElement.scrollWidth} > ${W}`]);

  // Visible text only — a hidden capture clone or an aria-hidden decoration is
  // not something a person reads.
  const words = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent.trim()) continue;
    if (el.closest("script,style,noscript,[aria-hidden='true'],[inert]")) continue;
    const r = el.getBoundingClientRect();
    if (!vis(el) || offscreenClone(r)) continue;
    words.push({ text: n.textContent.trim(), el });
  }
  const seen = new Set();
  for (const src of notOnAndroid) {
    const re = new RegExp(src.source, src.flags);
    for (const w of words) if (re.test(w.text) && !seen.has(w.text)) { seen.add(w.text); out.push(["apple-wording", `${re} in “${w.text.slice(0, 90)}” (${desc(w.el)})`]); }
  }
  for (const src of selling) {
    const re = new RegExp(src.source, src.flags);
    for (const w of words) if (re.test(w.text) && !seen.has(w.text)) { seen.add(w.text); out.push(["selling", `${re} in “${w.text.slice(0, 90)}” (${desc(w.el)})`]); }
  }

  const all = [...document.querySelectorAll("body *")].filter(vis);
  const atTop = scrollY < 2;
  const inter = all.filter((el) => el.matches("button, a[href], [role='button'], input, select, textarea, [role='switch'], [role='tab']"));
  for (const el of inter) {
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= H || offscreenClone(r)) continue;
    if (el.closest("details:not([open])") && !el.closest("summary")) continue;
    const fx = isFixedish(el);
    if (r.top < TOP - 1 && r.height > 8 && (atTop || fx)) out.push(["under-status-bar", `${desc(el)} top=${Math.round(r.top)} (bar ${TOP})`]);
    if (fx) {
      const fr = fx.getBoundingClientRect();
      if (fr.bottom >= H - 1 && r.bottom > H - BOTTOM + 2) out.push(["under-nav-bar", `${desc(el)} bottom=${Math.round(r.bottom)} (bar starts ${H - BOTTOM})`]);
    }
  }
  // Open dialogs/sheets: their controls must clear both bars.
  for (const dlg of document.querySelectorAll("[role='dialog'], [aria-modal='true']")) {
    if (!vis(dlg)) continue;
    for (const c of dlg.querySelectorAll("button, a[href], input, select, textarea")) {
      if (!vis(c)) continue;
      const r = c.getBoundingClientRect();
      if (r.top < TOP - 1 && r.bottom > 0) out.push(["dialog-under-status-bar", `${desc(c)} top=${Math.round(r.top)}`]);
      if (r.bottom > H - BOTTOM + 2 && r.top < H) out.push(["dialog-under-nav-bar", `${desc(c)} bottom=${Math.round(r.bottom)}`]);
    }
  }
  return [...new Map(out.map((o) => [o.join("|"), o])).values()];
};
