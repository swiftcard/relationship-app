#!/usr/bin/env node
/**
 * Runtime verification for the iOS launch animation (src/lib/splash/markup.html).
 *
 * tests/native-splash.test.ts pins the invariants that are visible in the
 * source. These are the ones that are only visible in a browser — every bug
 * below was live at some point and none of them were catchable by reading the
 * markup:
 *
 *   - the mark rendered at a hard-coded 112px while the iOS launch image draws
 *     it at 556 * max(W,H)/2732, so it visibly SHRANK on handoff on every
 *     device except the SE (-60px on an iPhone 14, -166px on a 12.9" iPad);
 *   - `html.native-app body`'s page-in rise transformed <body>, which made it
 *     the containing block for the fixed overlay: the mark sat 10px low and
 *     snapped when the transform ended, and in landscape the overlay sized to
 *     the body box instead of the screen, throwing the mark 104px off centre;
 *   - the sequence's clock started at parse while iOS kept the static launch
 *     image up until SplashScreen.hide() ran after React hydration, so the
 *     lightning played underneath an opaque splash and the user saw a
 *     different slice of it on every launch.
 *
 * Usage: node scripts/verify-splash.mjs [baseUrl]     (default http://127.0.0.1:3111)
 *        SPLASH_V2=1 node scripts/verify-splash.mjs   (as a build carrying the v2 launch image)
 *        SPLASH_V3=1 node scripts/verify-splash.mjs   (as a build carrying the v3 launch image)
 */
import { localBase } from "./lib/qa-local.mjs";
import { chromium } from "playwright";
import { markInternal } from "./qa-internal.mjs";

const BASE = localBase(process.argv[2], "http://127.0.0.1:3111");
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) SwiftCardApp" +
  (process.env.SPLASH_V3 ? " SwiftCardSplash/3" : process.env.SPLASH_V2 ? " SwiftCardSplash/2" : "");

// Every device the app ships to, plus one landscape case. `expect` is what the
// static launch image renders the mark at, which is what the overlay's first
// frame has to match exactly for the handoff to be invisible.
const DEVICES = [
  ["iPhone SE", 320, 568], ["iPhone 8", 375, 667], ["iPhone 14", 390, 844],
  ["iPhone 15 Pro Max", 430, 932], ["iPad Air", 820, 1180],
  ["iPad Pro 12.9", 1024, 1366], ["landscape", 844, 390],
];
// The mark's measured span in the shipped 2732x2732 launch asset: 560 for v1
// and v2, 768 for v3 (build-splash-v3.mjs draws it larger, to the owner's
// reference image). The overlay must draw it at exactly the size the static
// image does, or the mark jumps the instant the animation takes over.
const MARK_SPAN = process.env.SPLASH_V3 ? 768 : 560;
const markFor = (w, h) => (MARK_SPAN * Math.max(w, h)) / 2732;

// Pointed at production, a burst of contexts trips Vercel's bot challenge and
// serves a "Security Checkpoint" page instead of the app — which looks exactly
// like a missing overlay. Pace remote runs, and fail loudly if we are being
// challenged rather than quietly reporting a splash bug.
const REMOTE = !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE);
const PACE = REMOTE ? 1500 : 0;
const LAUNCHES = REMOTE ? 4 : 10;
const pace = () => (PACE ? new Promise((r) => setTimeout(r, PACE)) : Promise.resolve());

const failures = [];
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch();

/** A context that looks like the Capacitor shell, with the bridge it injects. */
async function shell({ width = 390, height = 844, hideMs = 150, plugin = true, reject = false, ...rest } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, userAgent: UA, ...rest,
  });
  await markInternal(context, BASE);
  await context.addInitScript(
    ([hideMs, plugin, reject]) => {
      window.__hide = 0;
      window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
      const Plugins = plugin
        ? { SplashScreen: { hide() { window.__hide++;
              return new Promise((res, rej) => setTimeout(() => (reject ? rej(new Error("hide failed")) : res()), hideMs)); } } }
        : {};
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios", Plugins };
    },
    [hideMs, plugin, reject],
  );
  return context;
}

async function open(context, path) {
  const page = await context.newPage();
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  if (res && res.status() === 403 && (await page.title()).includes("Security Checkpoint")) {
    throw new Error(`blocked by Vercel's bot challenge at ${path} — rerun more slowly, this is not a splash failure`);
  }
  return page;
}

const probe = (page) =>
  page.evaluate(() => {
    const el = document.getElementById("sc-splash-vfork");
    if (!el) return { absent: true };
    const cs = getComputedStyle(el);
    const root = el.getBoundingClientRect();
    const icon = document.querySelector(".vfk-icon").getBoundingClientRect();
    const anims = document.getAnimations().filter((a) => a.effect && el.contains(a.effect.target));
    return {
      held: document.documentElement.classList.contains("sc-splash-hold"),
      play: cs.animationPlayState, name: cs.animationName,
      visibility: cs.visibility, opacity: +cs.opacity, pointerEvents: cs.pointerEvents, display: cs.display,
      mark: +icon.width.toFixed(1),
      cx: +(icon.left + icon.width / 2).toFixed(1), cy: +(icon.top + icon.height / 2).toFixed(1),
      rootW: Math.round(root.width), rootH: Math.round(root.height),
      bodyTransform: getComputedStyle(document.body).transform,
      hideCalls: window.__hide, clock: Math.round(Math.max(0, ...anims.map((a) => a.currentTime || 0))),
    };
  });

console.log(`\nSplash verification against ${BASE}\n`);

console.log("Geometry — first frame must match the static launch image on every device");
for (const [name, w, h] of DEVICES) {
  const context = await shell({ width: w, height: h });
  const page = await open(context, "/login");
  const want = markFor(w, h);
  let bad = null, first = null, last = 0;
  for (const t of [30, 150, 340, 700]) {
    await page.waitForTimeout(t - last);
    last = t;
    const s = await probe(page);
    first ??= s;
    // The mark only has to MATCH the launch image while the sequence is held
    // on frame 0; after that it is deliberately animating. Centre, root box
    // and an untransformed body must hold at every instant.
    const wrong =
      Math.abs(s.cx - w / 2) > 0.6 || Math.abs(s.cy - h / 2) > 0.6 ||
      s.rootW !== w || s.rootH !== h || s.bodyTransform !== "none" ||
      (t <= 150 && Math.abs(s.mark - want) > 0.6);
    if (wrong && !bad) bad = { ...s, t };
  }
  check(`${name.padEnd(18)} ${String(w).padStart(4)}x${h}`, !bad,
    bad
      ? `at ${bad.t}ms: mark ${bad.mark}, centre (${bad.cx},${bad.cy}), root ${bad.rootW}x${bad.rootH}, body ${bad.bodyTransform}`
      : `held frame: mark ${first.mark} = launch image ${want.toFixed(1)}, centred (${first.cx},${first.cy}), root ${first.rootW}x${first.rootH}`);
  await context.close();
  await pace();
}

console.log("\nHandoff — the sequence starts when the screen is actually ours");
{
  const context = await shell({ hideMs: 150 });
  const page = await open(context, "/login");
  await page.waitForTimeout(60);
  const held = await probe(page);
  check("frozen on frame 0 while the native splash is still up",
    held.held && held.play === "paused" && held.clock === 0, `playState=${held.play} clock=${held.clock}ms`);
  // The held root must paint solid navy itself: the plane needs its mask
  // images decoded before it shows anything, and until then this background
  // is the only thing standing between the user and a black frame.
  const heldBg = await page.evaluate(
    () => getComputedStyle(document.getElementById("sc-splash-vfork")).backgroundColor);
  const heldImg = await page.evaluate(
    () => getComputedStyle(document.getElementById("sc-splash-vfork")).backgroundImage);
  // v1: flat navy. v2: the logo's gradient over its mid-tone. v3: the
  // reference's field — the sheen's radial over the linear, on its mid-tone.
  // Every one of them is CSS only: a gradient needs no decode, so the held
  // frame is on screen immediately whatever the mask images are doing.
  check("held frame paints the launch image's ground even before any image decodes",
    process.env.SPLASH_V3
      ? heldBg === "rgb(31, 50, 116)" && heldImg.startsWith("radial-gradient(") && heldImg.includes("linear-gradient(146.5deg")
      : process.env.SPLASH_V2
        ? heldBg === "rgb(54, 66, 120)" && heldImg.startsWith("linear-gradient(135deg")
        : heldBg === "rgb(26, 35, 66)",
    `background=${heldBg} ${heldImg.slice(0, 40)}`);
  await page.waitForTimeout(180);
  const go = await probe(page);
  check("hands off from the overlay itself, not from hydration", go.hideCalls === 1, `hide() calls=${go.hideCalls}`);
  check("released, and starts at its first frame", !go.held && go.clock < 150, `clock=${go.clock}ms`);
  await page.waitForTimeout(1500);
  const end = await probe(page);
  // Once the sequence ends the overlay disarms to display:none, which also
  // drops the animation's fill — so visibility/opacity read their base values
  // there, and display is what says it is gone.
  check("ends inert — hidden, transparent, untappable",
    end.display === "none" || (end.visibility === "hidden" && end.opacity === 0 && end.pointerEvents === "none"),
    `display=${end.display} visibility=${end.visibility} opacity=${end.opacity} pointer-events=${end.pointerEvents}`);
  check("a tap at centre screen reaches the app",
    await page.evaluate(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return !el || !el.closest("#sc-splash-vfork");
    }));
  await context.close();
  await pace();
}

console.log("\nHandoff failure paths — the hold must always release");
for (const [name, opts, waitMs] of [
  ["hide() rejects", { hideMs: 120, reject: true }, 500],
  ["plugin missing (older shell)", { plugin: false }, 4400],
]) {
  const context = await shell(opts);
  const page = await open(context, "/login");
  await page.waitForTimeout(waitMs);
  check(name, !(await probe(page)).held);
  await context.close();
}

console.log("\nPlays on every launch, never mid-session");
{
  const seen = new Set();
  for (let i = 0; i < LAUNCHES; i++) {
    const context = await shell();
    const page = await open(context, "/login");
    await page.waitForTimeout(100);
    const s = await probe(page);
    seen.add([s.play, s.mark, s.cx, s.cy].join("|"));
    await context.close();
    await pace();
  }
  check(`${LAUNCHES} consecutive launches are byte-identical at t=100ms`, seen.size === 1, [...seen].join("   vs   "));

  const context = await shell({ hideMs: 120 });
  const page = await open(context, "/login");
  await page.waitForTimeout(1700);
  await page.evaluate(() => { window.location.href = "/cards/new"; });
  // A hard navigation destroys the execution context, and load-state waits can
  // resolve against the OLD document before the hop even starts — so don't
  // race events at all: just retry the probe until the new document answers.
  const settled = async (fn, tries = 25) => {
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch { await page.waitForTimeout(300); }
    }
    throw new Error("page never settled after the in-app navigation");
  };
  await page.waitForTimeout(800);
  check("an in-app navigation ships no overlay at all", (await settled(() => probe(page))).absent === true);
  check("and keeps its own page-in animation",
    (await settled(() => page.evaluate(() => getComputedStyle(document.body).animationName))) !== "none");
  await context.close();
}

console.log("\nConditions");
{
  const context = await shell();
  const page = await open(context, "/login");
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(150);
  const s = await probe(page);
  check("re-centres and re-scales when rotated mid-animation",
    s.cx === 422 && s.cy === 195 && s.rootW === 844 && s.rootH === 390,
    `centre=(${s.cx},${s.cy}) root=${s.rootW}x${s.rootH}`);
  await context.close();
}
{
  const context = await shell({ reducedMotion: "reduce" });
  const page = await open(context, "/login");
  await page.waitForTimeout(160);
  const a = await probe(page);
  await page.waitForTimeout(900);
  const b = await probe(page);
  check("reduced motion swaps to a plain fade and still ends inert",
    a.name === "vfk-reduced" && (b.display === "none" || b.visibility === "hidden"), `${a.name} -> ${b.display}/${b.visibility}`);
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILING: ${failures.join("; ")}\n` : "\nAll splash checks passed.\n");
process.exit(failures.length ? 1 : 0);
