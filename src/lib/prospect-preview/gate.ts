// ── Card Builder: has a person actually looked at this preview? ─────────────
//
// The preview page reports a view only once ONE of these is true:
//
//   • the page has been VISIBLE for three seconds in total, or
//   • the visitor scrolled, tapped / clicked, or pressed a key.
//
// A link-preview fetcher or a mail scanner does none of them: it requests the
// HTML and leaves, or paints into a hidden surface for well under a second.
// Automation (navigator.webdriver) and a speculative prerender never count,
// whatever they do.
//
// WHY NOT lib/human-gate.ts. That gate is the customers' card-view gate: a
// 2.5s dwell and nothing else, pinned by tests/view-visit-window.test.ts. This
// page was specified differently (3 seconds OR an interaction), and a prospect
// who taps the button after one second is exactly the person the alert exists
// for. Two gates for two products, rather than one gate bent to fit both.
//
// The environment is passed in so the whole thing runs under fake timers in
// tests/prospect-preview-gate.test.ts. `browserGateEnv()` is the real one.

export const REAL_VIEW_DWELL_MS = 3000;

export type GateSignal = "visibility" | "scroll" | "tap" | "key" | "prerender-done";

export type GateEnv = {
  isVisible(): boolean;
  /** navigator.webdriver: set by every automation framework. */
  isAutomated(): boolean;
  /** Chrome speculation-rules prerender: effects run before anyone looks. */
  isPrerendering(): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  /** Subscribe; returns the unsubscribe. */
  on(signal: GateSignal, fn: () => void): () => void;
};

/**
 * Calls `onReal` at most once, when a person has really looked. Returns a
 * stop function (for unmount); after it runs, `onReal` is never called.
 */
export function startRealViewGate(env: GateEnv, onReal: (how: "dwell" | "interaction") => void, dwellMs: number = REAL_VIEW_DWELL_MS): () => void {
  let done = false;
  let seen = 0;                 // visible time banked so far
  let since: number | null = null; // when the current visible stretch began
  let timer: unknown = null;
  const offs: (() => void)[] = [];

  const stop = () => {
    done = true;
    if (timer !== null) env.clearTimer(timer);
    timer = null;
    for (const off of offs.splice(0)) off();
  };
  const fire = (how: "dwell" | "interaction") => {
    if (done) return;
    stop();
    onReal(how);
  };

  if (env.isAutomated()) return stop;

  const pause = () => {
    if (since !== null) seen += env.now() - since;
    since = null;
    if (timer !== null) env.clearTimer(timer);
    timer = null;
  };
  const resume = () => {
    if (done || since !== null) return;
    since = env.now();
    timer = env.setTimer(() => fire("dwell"), Math.max(0, dwellMs - seen));
  };
  const begin = () => {
    if (done) return;
    offs.push(env.on("visibility", () => (env.isVisible() ? resume() : pause())));
    // An interaction on a page nobody can see is not a person.
    const interacted = () => { if (env.isVisible()) fire("interaction"); };
    offs.push(env.on("scroll", interacted), env.on("tap", interacted), env.on("key", interacted));
    if (env.isVisible()) resume();
  };

  if (env.isPrerendering()) offs.push(env.on("prerender-done", begin));
  else begin();
  return stop;
}

/** The real browser. Only call it in an effect. */
export function browserGateEnv(): GateEnv {
  const listen = (target: EventTarget, type: string, fn: () => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(type, fn, opts);
    return () => target.removeEventListener(type, fn, opts);
  };
  return {
    isVisible: () => document.visibilityState === "visible",
    isAutomated: () => (navigator as Navigator & { webdriver?: boolean }).webdriver === true,
    isPrerendering: () => (document as Document & { prerendering?: boolean }).prerendering === true,
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id as number),
    on: (signal, fn) => {
      switch (signal) {
        case "visibility": return listen(document, "visibilitychange", fn);
        // capture: the "Your team" strip scrolls sideways inside its own box,
        // and scroll events don't bubble.
        case "scroll": return listen(document, "scroll", fn, { passive: true, capture: true });
        case "tap": return listen(document, "pointerdown", fn, { passive: true });
        case "key": return listen(document, "keydown", fn);
        case "prerender-done": return listen(document, "prerenderingchange", fn, { once: true });
      }
    },
  };
}
