import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── The control at the top of the card wizard ────────────────────────────────
//
// Owner report 2026-09-10: "on Card design there's a Home button, which I don't
// want. It should just be Back."
//
// It said "Home" on EVERY step, so on Card design, Socials and Social design it
// was the only top-of-page control — and for a guest that link deliberately
// calls resetGuestFlow(), which wipes the entire unfinished draft: text, photos,
// logo, links, colours, plan pick. People look UP to go back, not down, so
// reaching for it by reflex destroyed the half-built card. There are "← Back"
// buttons at the BOTTOM of those steps, which is the half of the fix that was
// already there and the half nobody scrolls to.
//
// Pinned by reading the source: the failure is a conditional rendering the wrong
// branch, there is no return value to assert on, and every other test in the
// suite passes happily with "Home" back on step 2.
//
// Every marketing entry point funnels here — "Get Started" / "Start for free" in
// the nav, footer and pricing, and the "Make it live" hand-off from the card,
// signature and Swift Links mini-builders (useProductSketch writes step: 1).
// The mini-builders are modals that already carry their own Back button, so
// this file is the whole surface.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const wizard = read("src/app/cards/new/NewCardWizard.tsx");

// The top-of-page control, from the opening brace of its conditional down to
// the step indicator that follows it. Scoping to this block keeps the assertions
// off the Back/Next buttons at the bottom of each step, which are a different
// control with the same words.
const topControl = (() => {
  const start = wizard.indexOf("{step >= 2 && step <= 4 ? (");
  const end = wizard.indexOf("{/* Steps 1–4: form on the left");
  expect(start, "the top-of-page control's step conditional is gone").toBeGreaterThan(-1);
  expect(end, "the step-indicator comment that bounds the block is gone").toBeGreaterThan(start);
  return wizard.slice(start, end);
})();

describe("the wizard's top control goes BACK once there is a step behind you", () => {
  it("renders Back on steps 2, 3 and 4", () => {
    expect(topControl).toMatch(/\{step >= 2 && step <= 4 \? \(/);
    expect(topControl).toMatch(/onClick=\{\(\) => setStep\(step - 1\)\}/);
    expect(topControl).toMatch(/>\s*Back\s*</);
  });

  it("goes back exactly one step — never to a fixed step, never past the start", () => {
    // setStep(step - 1) is only ever reached when step >= 2, so the lowest it
    // can produce is 1. A hardcoded setStep(1) here would strand someone on
    // step 4 at the beginning of the form.
    expect(topControl).not.toMatch(/setStep\((?!step - 1)/);
  });

  it("is a real button, and cannot submit anything", () => {
    expect(topControl).toMatch(/<button\s+type="button"/);
  });

  it("never wipes the draft — that is what made the old Home link destructive", () => {
    const backBranch = topControl.slice(0, topControl.indexOf(") : guest ? ("));
    expect(backBranch).not.toMatch(/resetGuestFlow/);
    expect(backBranch).not.toMatch(/href=/);
  });

  it("looks identical to the link it replaced, so nothing moves on the page", () => {
    // ONE class string for all four branches — Back, Home, the "card is live"
    // Dashboard (which carries the tour) and Dashboard. They are the same slot
    // in the same place; a second literal here is how they drift apart.
    // Measured on production: same x, same y, same height, same font, same
    // colour, same 2rem gap to the content below.
    expect(topControl.split("className={topControlCls}").length - 1).toBe(4);
    expect(topControl).not.toMatch(/className="text-gray-500/);
  });

  it("the shared class keeps the click target on the text, and the cursor a hand", () => {
    const cls = wizard.slice(wizard.indexOf("const topControlCls ="), wizard.indexOf("const topControlCls =") + 400);
    // w-fit: a bare flex container is a BLOCK, so "Home" stretched the full
    // width of the column and every pixel of that invisible strip navigated
    // away AND wiped the draft. Measured at 896px wide before this.
    expect(cls, "w-fit is gone — the Home link is a full-width click target again").toMatch(/w-fit/);
    // The slot is an <a> on step 1 and a <button> on 2–4; without this the
    // cursor changes between steps on the very same control.
    expect(cls).toMatch(/cursor-pointer/);
  });
});

describe("step 1 and the success screen still offer the way OUT", () => {
  it("keeps Home for a guest and Dashboard for a signed-in user", () => {
    // These are the ONLY steps with nothing behind them. Losing this branch
    // would trap a guest in the funnel with no exit at all.
    expect(topControl).toMatch(/\) : guest \? \(/);
    expect(topControl).toMatch(/>\s*Home\s*</);
    expect(topControl).toMatch(/<DashboardLink/);
  });

  // Owner rule 2026-09-16: nobody loses a card by accident. Home used to wipe
  // the whole draft; now it drops only the marketing sketch, and the builder
  // asks "Continue your card / Start a new card" on the next entry.
  it("goes Home WITHOUT deleting the unfinished card", () => {
    const homeBranch = topControl.slice(topControl.indexOf(") : guest ? ("));
    expect(homeBranch).toMatch(/onClick=\{\(\) => resetMarketingSketch\(\)\}/);
    expect(homeBranch).not.toMatch(/resetGuestFlow|clearDraft/);
    // HomeLink (components/site/HomeLink) is a Link fixed to "/" that only
    // prefetches the homepage on intent — the same destination.
    expect(homeBranch).toMatch(/href="\/"|<HomeLink\b/);
  });
});

describe("the bottom Back buttons are still there", () => {
  // The top control catches people who look up; these catch people who finish a
  // step and look down. Both, deliberately — see the owner exchange.
  it("steps 2, 3 and 4 each keep their own Back beside Next", () => {
    for (const [from, to] of [[2, 1], [3, 2], [4, 3]] as const) {
      const pattern = new RegExp(`onClick=\\{\\(\\) => setStep\\(${to}\\)\\}[^]{0,400}?← Back`);
      expect(wizard, `step ${from}'s bottom Back button is gone`).toMatch(pattern);
    }
  });
});

describe("every marketing entry point lands in this one wizard", () => {
  it("the mini-builders hand off to /cards/new at step 1", () => {
    const sketch = read("src/components/site/useProductSketch.ts");
    expect(sketch).toMatch(/writePrefill\(\{ \.\.\.toPrefill\(sketch, product\), step: 1 \}\)/);
    expect(sketch).toContain("/cards/new");
  });

  it("and each already has its own Back, so none of them needs this fix", () => {
    const modal = read("src/components/site/MiniBuilderModal.tsx");
    expect(modal).toMatch(/step > 0 && \(/);
    expect(modal).toMatch(/onClick=\{\(\) => setStep\(step - 1\)\}[^]{0,200}?>Back</);
  });
});
