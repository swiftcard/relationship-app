import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { REAL_VIEW_DWELL_MS, startRealViewGate, type GateEnv, type GateSignal } from "@/lib/prospect-preview/gate";

// ── Card Builder: has a person actually looked? ─────────────────────────────
//
// The preview page reports a view once the page has been VISIBLE for three
// seconds, or the visitor scrolls, taps or presses a key. Never on page load,
// never for automation, never for a page the browser loaded speculatively.
// This drives the real gate with a fake page and fake time.

function fakePage(start: { visible?: boolean; automated?: boolean; prerendering?: boolean } = {}) {
  const listeners = new Map<GateSignal, Set<() => void>>();
  const page = { visible: start.visible ?? true, automated: start.automated ?? false, prerendering: start.prerendering ?? false };
  const env: GateEnv = {
    isVisible: () => page.visible,
    isAutomated: () => page.automated,
    isPrerendering: () => page.prerendering,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    on: (signal, fn) => {
      if (!listeners.has(signal)) listeners.set(signal, new Set());
      listeners.get(signal)!.add(fn);
      return () => listeners.get(signal)!.delete(fn);
    },
  };
  const emit = (signal: GateSignal) => { for (const fn of [...(listeners.get(signal) ?? [])]) fn(); };
  return {
    env,
    emit,
    show: () => { page.visible = true; emit("visibility"); },
    hide: () => { page.visible = false; emit("visibility"); },
    finishPrerender: () => { page.prerendering = false; emit("prerender-done"); },
    listening: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("three seconds of the page actually visible", () => {
  it("is three seconds", () => {
    expect(REAL_VIEW_DWELL_MS).toBe(3000);
  });

  it("does not fire on load, or at 2.9 seconds; fires at 3", () => {
    const page = fakePage();
    const onReal = vi.fn();
    startRealViewGate(page.env, onReal);
    expect(onReal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2999);
    expect(onReal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReal).toHaveBeenCalledExactlyOnceWith("dwell");
  });

  it("a page that is never visible never fires (a link preview paints into a hidden surface)", () => {
    const page = fakePage({ visible: false });
    const onReal = vi.fn();
    startRealViewGate(page.env, onReal);
    vi.advanceTimersByTime(60_000);
    expect(onReal).not.toHaveBeenCalled();
  });

  it("time spent hidden doesn't count; the visible stretches add up", () => {
    const page = fakePage();
    const onReal = vi.fn();
    startRealViewGate(page.env, onReal);
    vi.advanceTimersByTime(2000); // 2s visible
    page.hide();
    vi.advanceTimersByTime(30_000); // a long time in another tab
    expect(onReal).not.toHaveBeenCalled();
    page.show();
    vi.advanceTimersByTime(999); // 2.999s visible in total
    expect(onReal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReal).toHaveBeenCalledExactlyOnceWith("dwell");
  });

  it("a page opened in the background starts counting when it is brought forward", () => {
    const page = fakePage({ visible: false });
    const onReal = vi.fn();
    startRealViewGate(page.env, onReal);
    vi.advanceTimersByTime(10_000);
    page.show();
    vi.advanceTimersByTime(2999);
    expect(onReal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReal).toHaveBeenCalledTimes(1);
  });
});

describe("or the visitor does something", () => {
  it.each(["scroll", "tap", "key"] as const)("a %s counts straight away", (signal) => {
    const page = fakePage();
    const onReal = vi.fn();
    startRealViewGate(page.env, onReal);
    vi.advanceTimersByTime(400);
    page.emit(signal);
    expect(onReal).toHaveBeenCalledExactlyOnceWith("interaction");
  });

  it("an interaction on a page nobody can see is not a person", () => {
    const page = fakePage({ visible: false });
    const onReal = vi.fn();
    startRealViewGate(page.env, onReal);
    page.emit("scroll");
    page.emit("tap");
    expect(onReal).not.toHaveBeenCalled();
  });
});

describe("one view, once", () => {
  it("fires once however much the visitor does afterwards", () => {
    const page = fakePage();
    const onReal = vi.fn();
    startRealViewGate(page.env, onReal);
    page.emit("tap");
    page.emit("scroll");
    page.emit("key");
    page.hide();
    page.show();
    vi.advanceTimersByTime(60_000);
    expect(onReal).toHaveBeenCalledTimes(1);
  });

  it("stops listening once it has fired", () => {
    const page = fakePage();
    startRealViewGate(page.env, vi.fn());
    expect(page.listening()).toBeGreaterThan(0);
    vi.advanceTimersByTime(3000);
    expect(page.listening()).toBe(0);
  });

  it("a page that is left before then never fires (the component unmounted)", () => {
    const page = fakePage();
    const onReal = vi.fn();
    const stop = startRealViewGate(page.env, onReal);
    vi.advanceTimersByTime(1500);
    stop();
    vi.advanceTimersByTime(60_000);
    page.emit("tap");
    expect(onReal).not.toHaveBeenCalled();
    expect(page.listening()).toBe(0);
  });
});

describe("never for a machine", () => {
  it("automation (navigator.webdriver) never counts, whatever it does", () => {
    const page = fakePage({ automated: true });
    const onReal = vi.fn();
    startRealViewGate(page.env, onReal);
    page.emit("scroll");
    page.emit("tap");
    vi.advanceTimersByTime(60_000);
    expect(onReal).not.toHaveBeenCalled();
    expect(page.listening()).toBe(0);
  });

  it("a speculative prerender counts nothing until a person actually opens the page", () => {
    const page = fakePage({ prerendering: true });
    const onReal = vi.fn();
    startRealViewGate(page.env, onReal);
    page.emit("scroll");
    vi.advanceTimersByTime(60_000);
    expect(onReal).not.toHaveBeenCalled(); // an abandoned prerender never records
    page.finishPrerender();
    vi.advanceTimersByTime(2999);
    expect(onReal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReal).toHaveBeenCalledExactlyOnceWith("dwell");
  });
});
