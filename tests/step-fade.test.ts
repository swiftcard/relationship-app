import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Builder steps and editor tabs fade in ────────────────────────────────────
//
// Owner, 2026-09-23: "it slowly transitions between pages cleanly and
// smoothly." Each step of the card builder, each tab of the card editor, each
// homepage mini-builder step and the "Your card is live" screen settle in with
// a short fade instead of snapping into place.
//
// OPACITY ONLY. A transform would move things: render tests measure positions,
// fixed-position dialogs live inside steps, and a hit-test during a slide lands
// somewhere else. The class sits on each step's ROOT, which mounts fresh per
// step, so the fade plays once per step and never while typing.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r/g, "");

describe("sc-step-in", () => {
  const css = read("src/app/globals.css");

  it("is an opacity-only fade, off under reduced motion", () => {
    const kf = css.match(/@keyframes sc-step-in\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(kf).toMatch(/from\s*\{\s*opacity:\s*0;\s*\}/);
    expect(kf).toMatch(/to\s*\{\s*opacity:\s*1;\s*\}/);
    expect(kf).not.toMatch(/transform|translate|scale/);
    expect(css).toMatch(/\.sc-step-in\s*\{\s*animation:\s*sc-step-in \.3s ease-out both;\s*\}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.sc-step-in\s*\{\s*animation:\s*none;\s*\}\s*\}/);
  });

  it("is on every card-builder step and the keyed desktop preview", () => {
    const w = read("src/app/cards/new/NewCardWizard.tsx");
    for (const n of [1, 2, 3, 4, 5]) {
      expect(w, `step ${n}`).toMatch(new RegExp(`\\{step === ${n} && \\(\\s*<div className="[^"]*\\bsc-step-in\\b`));
    }
    expect(w).toMatch(/<div key=\{step === 3 \|\| step === 4 \? "links" : "card"\} className="sc-step-in">/);
  });

  it("is on every card-editor tab and the keyed desktop preview", () => {
    const e = read("src/app/cards/[id]/edit/CardEditForm.tsx");
    for (const t of ["content", "design", "sharing", "linkdesign"]) {
      expect(e, t).toMatch(new RegExp(`\\{tab === "${t}" && \\(\\s*<div className="[^"]*\\bsc-step-in\\b`));
    }
    expect(e).toMatch(/<div key=\{tab === "linkdesign" \|\| tab === "sharing" \? "links" : "card"\} className="sc-step-in">/);
  });

  it("is on each homepage mini-builder step and the \"card is live\" screen", () => {
    expect(read("src/components/site/MiniBuilderModal.tsx")).toMatch(/<div key=\{step\} className="[^"]*\bsc-step-in\b[^"]*">\{current\.content\}<\/div>/);
    expect(read("src/components/WelcomePlan.tsx")).toMatch(/the card is live now[^\n]*\n\s*<div className="[^"]*\bsc-step-in\b/);
  });
});
