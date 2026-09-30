import { useEffect, useState } from "react";

/**
 * Native-platform detection for the SwiftCard Capacitor shells (iOS and Android).
 *
 * ABSOLUTE RULE for this file: on the web (and during any server render) every
 * export here must resolve to `false`. It only becomes `true` when our bundle is
 * actually running inside the native Capacitor iOS webview.
 *
 * SSR-safety: `detectNativeApp()` guards on `typeof window` first, so it is safe
 * to call during Next.js server-side rendering (no `window`/`document`).
 *
 * ── WHY THIS NO LONGER IMPORTS @capacitor/core (perf audit 2026-09-14) ───────
 *
 * It used to be `Capacitor.isNativePlatform()`. Fifty-five files import this
 * module — hooks, buttons, gates, layout components — so that one import pulled
 * 55 kB of the Capacitor runtime into the JavaScript of every page on the
 * WEBSITE, where the answer is always false, for a single boolean.
 *
 * The raw signals below are exactly what @capacitor/core reads internally
 * (getPlatformId), and they are the same ones the root layout's `sc-boot` script
 * already tests before first paint — which also documents why the RAW check is
 * the more reliable of the two: `window.Capacitor` is created by Capacitor's
 * own injected bundle, so testing only that is a race against our own script,
 * whereas `window.webkit.messageHandlers.bridge` is installed by WKWebView
 * before any page script runs. Reading both, in that order, is strictly more
 * dependable than the old call and costs nothing.
 *
 * Pinned by tests/native-detection.test.ts.
 */
type CapacitorGlobal = {
  webkit?: { messageHandlers?: Record<string, unknown> };
  androidBridge?: unknown;
  Capacitor?: {
    isNativePlatform?: () => boolean;
    isNative?: boolean;
    getPlatform?: () => string;
  };
};

export function detectNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const w = window as unknown as CapacitorGlobal;
    // The native message handler WKWebView installs before any page script.
    if (w.webkit?.messageHandlers?.bridge) return true;
    // The Android mirror of it. @capacitor/core reads exactly these two, in
    // this order (getPlatformId), and both are installed by the native side
    // before the first page script runs — unlike window.Capacitor, which our
    // own bundle races. Without this line an Android build answers this
    // question from window.Capacitor alone, which is the race the comment
    // above describes; on iOS losing it flashed the marketing hero and leaked
    // a login sheet.
    if (w.androidBridge) return true;
    const c = w.Capacitor;
    if (!c) return false;
    return typeof c.isNativePlatform === "function" ? c.isNativePlatform() : !!c.isNative;
  } catch {
    return false;
  }
}

/**
 * Synchronous convenience boolean for NON-render contexts only: event handlers,
 * `useEffect` bodies, and outbound request payloads (e.g. the /upgrade redirect,
 * the AI help request flag).
 *
 * Evaluated once at module load. On the server this is `false` (no window). On
 * the web client it is `false`. Inside the native shell it is `true`.
 *
 * ⚠️ DO NOT read this directly inside a component's render output. On the server
 * it is `false`, but the first client render inside the native shell would be
 * `true`, producing a React hydration mismatch. For render-time decisions use
 * {@link useIsNativeApp}, which stays `false` until after mount so server HTML
 * and the first client paint always agree.
 */
export const isNativeApp: boolean = detectNativeApp();

/**
 * Hydration-safe React hook for render-time platform decisions.
 *
 * Returns `false` on the server AND on the very first client render (so the
 * markup matches and there is no hydration mismatch), then flips to the real
 * value in a mount effect. This is the standard React pattern for
 * client-only-derived values.
 */
export function useIsNativeApp(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => {
    // The value can only be read from `window`, so computing it during render
    // would make the server and first client render disagree and blow up
    // hydration. Deferring it to a mount effect is the documented React pattern
    // (see the JSDoc above); the one extra render is the entire point.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe by design
    setNative(detectNativeApp());
  }, []);
  return native;
}

/**
 * Is this the iPhone app running on an Apple Silicon Mac?
 *
 * The native shell sets `data-sc-mac` on <html> from
 * `ProcessInfo.processInfo.isiOSAppOnMac` (MainViewController.applyPlatformFlags).
 * Nothing in the webview can work this out for itself: on a Mac the user agent
 * still says iPhone and Capacitor still reports platform "ios", so every
 * "am I native?" check answers yes and the feature fails later, at the point of
 * use, with no explanation.
 *
 * What is genuinely missing on a Mac, and what this gates:
 *   • Core NFC          — no NFC radio (NFCWriter already self-detects via NDEFReader)
 *   • Apple Wallet      — PassKit will not add a pass from an iOS app on Mac
 *   • The rear camera   — no scanning a code by pointing the device at it
 * Everything else — sharing, QR display, contact saving, forms, uploads,
 * purchases — works, so nothing else is hidden.
 *
 * Returns false on the web and during SSR, like everything else in this file.
 */
export function detectIosAppOnMac(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.scMac === "1";
}

/** Hydration-safe hook — false until after mount, so SSR and first paint agree. */
export function useIsIosAppOnMac(): boolean {
  const [onMac, setOnMac] = useState(false);
  useEffect(() => {
    // Same reason as useIsNativeApp: the flag only exists on the document once
    // the native shell has written it, so reading it during render would
    // mismatch SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe by design
    setOnMac(detectIosAppOnMac());
  }, []);
  return onMac;
}

/**
 * WHICH shell — for the handful of branches that are genuinely per-platform:
 * the store a purchase goes through, the push endpoint prefix, the "open
 * device settings" deep link, and the Apple-only sign-in button.
 *
 * Returns null on the web, during SSR, and for any shell whose platform
 * cannot be read. Every caller must treat null as "not this platform", never
 * as a default, so a detection failure can only ever hide a platform-specific
 * feature — never show the wrong one.
 *
 * Deliberately separate from {@link detectNativeApp} rather than replacing it:
 * that function must keep answering "yes" for a shell that exposes only
 * window.Capacitor with no getPlatform, which is exactly what
 * tests/native-detection.test.ts plants.
 */
export function detectNativePlatform(): "ios" | "android" | null {
  if (typeof window === "undefined") return null;
  try {
    const w = window as unknown as CapacitorGlobal;
    if (w.webkit?.messageHandlers?.bridge) return "ios";
    if (w.androidBridge) return "android";
    const p = w.Capacitor?.getPlatform?.();
    return p === "android" ? "android" : p === "ios" ? "ios" : null;
  } catch {
    return null;
  }
}

/** Hydration-safe hook — null until after mount, like {@link useIsNativeApp}. */
export function useNativePlatform(): "ios" | "android" | null {
  const [platform, setPlatform] = useState<"ios" | "android" | null>(null);
  useEffect(() => {
    // Same hydration reasoning as useIsNativeApp: the answer only exists on
    // window, so reading it during render would disagree with the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe by design
    setPlatform(detectNativePlatform());
  }, []);
  return platform;
}

/** True only in the Android shell. False on web, on SSR and on iOS. */
export function useIsAndroidApp(): boolean {
  return useNativePlatform() === "android";
}

/** True only in the iOS shell. False on web, on SSR and on Android. */
export function useIsIosApp(): boolean {
  return useNativePlatform() === "ios";
}
