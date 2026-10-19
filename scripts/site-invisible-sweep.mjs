// READ-ONLY site-wide sweep for the "rendered but invisible" bug class:
// collapsed CardScalers, invisible preview frames, unresolved Suspense stubs,
// broken images, and interactive demos that don't paint. Real painting browser.
// Plain package import: this script lives in the repo and runs on the Linux CI
// runner as well as a dev box. It was first written as a scratch file and
// imported playwright by ABSOLUTE WINDOWS PATH, which threw instantly on
// ubuntu-latest — so every CI run failed before loading a single page, and the
// paint check reported "invisible content" when the site was perfectly fine. A
// check that cries wolf is worse than no check.
import { chromium } from "playwright";
import { markInternal } from "./qa-internal.mjs";

const BASE = process.env.SWEEP_BASE || "https://swiftcard.me";
const PAGES = ["/", "/pricing", "/templates", "/compare", "/testimonials", "/preview", "/cards/new", "/login", "/checkout?plan=pro", "/upgrade", "/privacy", "/contact"];

// Exit non-zero when anything is invisible, so CI can gate a deploy on it.
// Without this the script printed findings and still exited 0 — a check that
// cannot fail is not a check.
let failures = 0;

const browser = await chromium.launch();

async function sweep(page) {
  return page.evaluate(() => {
    const bad = [];

    // Only elements the browser is actually laying out can be "rendered but
    // invisible". A `display:none` element has no box by definition, and this
    // site is full of responsive pairs — /cards/new renders the card preview
    // twice, `lg:hidden` for phone and the desktop one beside it, so one of
    // the two is ALWAYS display:none. Measuring those reported a 0x0 preview
    // on every single run and failed CI for days on a non-bug, which is the
    // exact cry-wolf failure this file's header warns about — and worse, it
    // masked any genuine regression behind a permanent red.
    const isLaidOut = (el) =>
      typeof el.checkVisibility === "function"
        ? el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })
        : el.offsetParent !== null;

    [...document.querySelectorAll("div")].forEach((el) => {
      if (((getComputedStyle(el).contain) || "").includes("size") && isLaidOut(el)) {
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) bad.push("scaler-collapsed:" + (el.className || "").slice(0, 30));
      }
    });
    [...document.querySelectorAll("[data-preview-locked]")].forEach((el) => {
      if (!isLaidOut(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5) bad.push("preview-frame-collapsed");
    });
    bad.push(...[...document.querySelectorAll("div[hidden][id^='S:']")].map(() => "unresolved-suspense"));
    [...document.querySelectorAll("img")].forEach((img) => {
      if (img.complete && img.naturalWidth === 0 && img.getBoundingClientRect().width > 0)
        bad.push("broken-img:" + (img.src || "").split("/").pop().slice(0, 40));
    });
    return bad;
  });
}

for (const path of PAGES) {
  for (const [label, vp] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
    const ctx = await markInternal(await browser.newContext({ viewport: vp }));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 80)));
    try {
      await page.goto(BASE + path, { waitUntil: "load", timeout: 45000 });
      // Settle: hydration + the ResizeObserver pass that sizes every CardScaler.
      // Bounded, because a scaler that never sizes is exactly what we are here
      // to catch — waiting for it to succeed would hide the bug.
      await page.waitForTimeout(1500);
      const bad = await sweep(page);
      // homepage: also open all three mini-builders and type, then sweep again
      if (path === "/") {
        for (const btnText of ["See how your card would look", "See how your Swift Signature would look", "See how your Swift Links page would look"]) {
          const btn = page.locator(`button:has-text("${btnText}")`).first();
          if (await btn.count()) {
            const inModal = [];
            await btn.scrollIntoViewIfNeeded();
            await btn.click();
            const nameInput = page.locator('input[placeholder="Alex Morgan"]').first();
            // WAIT FOR CONDITIONS, never fixed sleeps. The previous version gave
            // the modal 400ms to open and the preview 400ms to react; on a
            // slower CI runner that is a coin flip, and a flaky check gets
            // ignored — the same way the invisible preview survived 12 days.
            try {
              await nameInput.waitFor({ state: "visible", timeout: 15000 });
              await nameInput.fill("Sweep Test");
              // Poll until the typed name is actually PAINTED somewhere with
              // real size. This is the assertion that catches an invisible
              // preview; the timeout is the failure, not the wait.
              await page.waitForFunction(
                () => [...document.querySelectorAll("*")].some(
                  (el) => el.children.length === 0 && /Sweep Test/.test(el.textContent || "") && el.getBoundingClientRect().width > 0
                ),
                undefined,
                { timeout: 15000 },
              );
            } catch {
              inModal.push("builder-preview-not-updating");
            }
            // Sweep AFTER the preview has reacted, so a collapsed frame is
            // measured in its settled state rather than mid-open.
            inModal.push(...(await sweep(page)));
            if (inModal.length) bad.push(`[${btnText.slice(16, 30)}] ` + inModal.join(","));
            const close = page.locator('button[aria-label="Close"]').first();
            if (await close.count()) {
              await close.click();
              await nameInput.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
            }
          }
        }
      }
      if (bad.length) failures += bad.length;
      console.log(`${label.padEnd(7)} ${path.padEnd(18)} ${bad.length ? "FINDINGS: " + bad.join(" | ") : "clean"}${errors.length ? "  JSERR: " + errors.join(";") : ""}`);
    } catch (e) {
      failures++;
      console.log(`${label.padEnd(7)} ${path.padEnd(18)} LOAD-FAILED ${String(e.message).slice(0, 60)}`);
    }
    await ctx.close();
  }
}
await browser.close();

if (failures) {
  console.log(`\n${failures} invisible-content finding(s). Something is rendering but not showing.`);
  process.exit(1);
}
console.log("\nAll pages paint correctly (scalers sized, previews visible, builders reflect input).");
