import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards for the create-card / upgrade button flows (2026-07 audit).
//
// Two bugs are pinned here, both in src/app/cards/new/page.tsx:
//
//   1. PROMO DROPPED ON THE FAST-PATH. /pricing carries ?promo= into the
//      builder; the wizard forwards it to /checkout and even documents why. But
//      a logged-in Pro buyer who ALREADY has a card skips the wizard via a
//      server redirect that rebuilt the query string from scratch — dropping
//      the code, so the likeliest converter paid full price.
//
//   2. AT-LIMIT BUILDER ENTRY. The dashboard hides "+ Add card" at the Free
//      cap, but /cards/new?add=1 itself didn't check — a stale tab could build
//      a whole card only for Save to reject it and discard the work.
//
// These are server-component behaviours, so following this repo's pattern they
// are pinned structurally — against the actual redirect blocks, not a
// windowed regex over the whole file.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** The statements between a marker and the redirect() that follows it. */
function blockAfter(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const end = src.indexOf("redirect(", at);
  expect(end, `no redirect() after: ${marker}`).toBeGreaterThan(-1);
  // include the redirect call itself
  return src.slice(at, src.indexOf(")", end) + 1);
}

describe("promo codes survive every path from /pricing to /checkout", () => {
  it("pricing attaches the applied promo to the builder URL", () => {
    const src = read("src/app/pricing/page.tsx");
    expect(src).toMatch(/qs\.set\("promo", promo\.appliedCode\)/);
  });

  it("the wizard forwards it when the buyer builds a card", () => {
    const src = read("src/app/cards/new/NewCardWizard.tsx");
    expect(src).toMatch(/if \(presetPromo\) qs\.set\("promo", presetPromo\)/);
  });

  it("the has-a-card fast-path redirect forwards it too — the path that dropped it", () => {
    const src = read("src/app/cards/new/page.tsx");
    // The specific block: logged-in + plan=pro + existing card → straight to checkout.
    const block = blockAfter(src, 'sp.plan === "pro" && sp.claim !== "1"');
    expect(block, "fast-path rebuilds the query without the promo again").toMatch(/qs\.set\("promo", sp\.promo\)/);
    // And the param must be declared, or TypeScript-visible callers can't see it exists.
    expect(src).toMatch(/promo\?: string/);
  });
});

describe("a Free account at the card cap never enters the add-a-card builder", () => {
  const src = read("src/app/cards/new/page.tsx");

  it("redirects to /upgrade before the builder renders, and says why", () => {
    const block = blockAfter(src, "cardCount >= PLAN_LIMITS.FREE_CARD_LIMIT");
    // ?from=card-limit is load-bearing, not decoration: /upgrade renders its
    // explanation banner only for a known `from`, so without it this bounce was
    // wordless — the person pressed a button and met a price grid with nothing
    // saying what had happened (audit 2026-09-29).
    expect(block).toContain('redirect("/upgrade?from=card-limit")');
  });

  it("exempts plan CTAs — they are on their way to pay, not to build for free", () => {
    const at = src.indexOf("cardCount >= PLAN_LIMITS.FREE_CARD_LIMIT");
    const condition = src.slice(src.lastIndexOf("if (", at), at);
    expect(condition).toContain("!authedPlan");
  });

  it("exempts postcheckout — a just-paid buyer may arrive before the webhook flips their plan", () => {
    // Without this, someone who JUST PAID could be bounced to /upgrade because
    // their profile still reads Free for a few seconds. Worst possible greeting.
    const at = src.indexOf("cardCount >= PLAN_LIMITS.FREE_CARD_LIMIT");
    const condition = src.slice(src.lastIndexOf("if (", at), at);
    expect(condition).toContain("!sp.postcheckout");
  });

  it("still lets an empty Free account build its first card", () => {
    // The guard is >= LIMIT with count 0 vs limit 1 — but pin the shape so a
    // future edit to `> 0` or similar can't lock out brand-new accounts.
    expect(src).toContain("cardCount >= PLAN_LIMITS.FREE_CARD_LIMIT");
    expect(src).not.toContain("cardCount > 0 && !isPro && sp.add");
  });
});
