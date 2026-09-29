import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildTourSteps, TOUR_STEPS, type TourContext } from "@/lib/tour-steps";
import { ADMIN_TOUR_STEPS } from "@/lib/admin-tour-steps";

// ── Every tour step must point at something that exists ──────────────────────
//
// The tour spotlights elements by `data-tour="<anchor>"`. When the anchor is not
// in the DOM the engine does not fail loudly — GuidedTour polls for it
// FIND_TRIES(24) x 120ms and then silently skips. So a step aimed at a deleted,
// renamed, or plan-gated element costs the user ~2.9 SECONDS of a frozen-looking
// tour, per step, and nothing anywhere reports it. Four bad steps is twelve
// seconds of the tour appearing broken.
//
// tour-steps.test.ts checks the list's internal integrity (unique ids, non-empty
// anchors). It cannot catch an anchor that is merely spelled differently from
// the markup, or one whose element was removed — both of which look perfectly
// valid in the step list itself. This closes that gap by checking the anchors
// against the actual source.
//
// Scoped per ACCOUNT SHAPE on purpose: buildTourSteps() filters the list by
// plan, so "does this anchor exist" has to be asked once per plan the product
// sells. A step that is fine for Pro and broken for an office sub-user is
// exactly the defect this is for.

const root = process.cwd();

/** Every .tsx under src/ — the only place a data-tour attribute can be. */
function srcFiles(dir = join(root, "src"), out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * anchor -> files that render it.
 *
 * Two forms, because the app uses both and a scan that knows only the first
 * reports the entire bottom tab bar as missing:
 *
 *   data-tour="my-cards"        — written straight into the markup
 *   data-tour={tour}            — MobileNav maps over a config array whose
 *                                 entries carry `tour: "nav-contacts"`
 *
 * Deliberate limitation: src/app/dashboard/page.tsx:616 builds its desktop nav
 * anchors as `data-tour={`nav-${label.toLowerCase()}`}`, which no static scan
 * can resolve. Those three (nav-dashboard/-contacts/-links) are still covered
 * here because MobileNav declares the same anchors as literals — every one of
 * them renders in BOTH navs. If a future anchor exists ONLY as a computed
 * string, this test cannot see it and will report a false failure; the fix then
 * is to give it a literal, not to weaken this.
 */
const anchorIndex: Map<string, string[]> = (() => {
  const index = new Map<string, string[]>();
  const add = (anchor: string, file: string) => {
    const rel = file.replace(root + "/", "");
    const list = index.get(anchor) ?? [];
    if (!list.includes(rel)) list.push(rel);
    index.set(anchor, list);
  };
  for (const file of srcFiles()) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/data-tour=["']([a-z0-9-]+)["']/gi)) add(m[1], file);
    // Nav config objects: `tour: "nav-contacts"` feeding data-tour={tour}.
    for (const m of src.matchAll(/\btour:\s*["']([a-z0-9-]+)["']/gi)) add(m[1], file);
  }
  return index;
})();

/**
 * The four account shapes the product actually sells, on the WEB with a card.
 *
 * hasCards/isNative are varied separately below rather than multiplied into
 * this list: they gate on entirely different things (whether the anchor's
 * surrounding tree exists at all, and whether the surface ships in the app), so
 * mixing them here would hide which dimension broke.
 */
const ACCOUNTS: { name: string; ctx: TourContext }[] = [
  { name: "free", ctx: { tier: "free", isOfficeMember: false, hasCards: true, isNative: false } },
  { name: "pro", ctx: { tier: "pro", isOfficeMember: false, hasCards: true, isNative: false } },
  { name: "office owner (admin)", ctx: { tier: "office", isOfficeMember: false, hasCards: true, isNative: false } },
  { name: "office member (sub-user)", ctx: { tier: "office", isOfficeMember: true, hasCards: true, isNative: false } },
];

describe("every tour anchor exists in the app", () => {
  for (const { name, ctx } of ACCOUNTS) {
    it(`${name}: every spotlighted step has a rendered data-tour target`, () => {
      const missing = buildTourSteps(ctx)
        .filter((s) => s.anchor)
        .filter((s) => !anchorIndex.has(s.anchor!))
        .map((s) => `${s.id} -> data-tour="${s.anchor}" (${s.path})`);

      expect(
        missing,
        `these steps point at a data-tour that exists nowhere in src/. The tour ` +
          `will freeze ~2.9s on each before skipping:\n  ${missing.join("\n  ")}`,
      ).toEqual([]);
    });
  }

  it("the base fallback list is fully anchored too", () => {
    // readTourContext() falls back to the free shape, but TOUR_STEPS is what
    // GuidedTour seeds state with before boot() rebuilds. Anything dangling
    // here shows up in that first frame.
    const missing = TOUR_STEPS.filter((s) => s.anchor)
      .filter((s) => !anchorIndex.has(s.anchor!))
      .map((s) => `${s.id} -> ${s.anchor}`);
    expect(missing).toEqual([]);
  });

  it("the office admin console tour is fully anchored", () => {
    const missing = ADMIN_TOUR_STEPS.filter((s) => s.anchor)
      .filter((s) => !anchorIndex.has(s.anchor!))
      .map((s) => `${s.id} -> ${s.anchor}`);
    expect(missing).toEqual([]);
  });

  it("no NEW data-tour attribute is left uncovered", () => {
    // The reverse direction. An anchor in the markup that no step points at is
    // harmless at runtime, but it is the trail left by a step someone deleted,
    // a half-finished rename, or coverage that was planned and never written —
    // the admin console's Analytics tab was exactly that: a tab with an anchor,
    // no step, and a closing line that told admins the console had three
    // sections when it has four.
    //
    // The two below are surfaces the tours deliberately do not stop on (the
    // Contacts page header and the Settings account block are both reached by
    // steps that spotlight something INSIDE them). They are listed rather than
    // deleted so this test still fails the moment a NEW anchor appears with no
    // step behind it.
    const KNOWN_UNCOVERED = new Set(["contacts-page", "settings-account"]);

    const referenced = new Set(
      [...ACCOUNTS.flatMap(({ ctx }) => buildTourSteps(ctx)), ...TOUR_STEPS, ...ADMIN_TOUR_STEPS]
        .map((s) => s.anchor)
        .filter(Boolean) as string[],
    );
    const orphans = [...anchorIndex.keys()].filter(
      (a) => !referenced.has(a) && !KNOWN_UNCOVERED.has(a),
    );
    expect(
      orphans,
      `data-tour attributes no tour step points at: ${orphans.join(", ")}. ` +
        `Either add a step, or add it to KNOWN_UNCOVERED with a reason.`,
    ).toEqual([]);
  });
});

describe("the tour describes each plan honestly", () => {
  it("never shows an office sub-user billing, seats, or referrals", () => {
    // A company-managed sub-user has no billing surface at all: those sections
    // are not rendered for them, so these steps would both mislead and stall.
    const ids = buildTourSteps({ tier: "office", isOfficeMember: true, hasCards: true, isNative: false }).map((s) => s.id);
    expect(ids).not.toContain("settings-billing");
    expect(ids).not.toContain("settings-refer");
    expect(ids).not.toContain("nav-grow");
  });

  it("never shows the team console to anyone but an office owner", () => {
    for (const { name, ctx } of ACCOUNTS) {
      const ids = buildTourSteps(ctx).map((s) => s.id);
      const isOwner = ctx.tier === "office" && !ctx.isOfficeMember;
      expect(ids.includes("nav-admin"), `${name} nav-admin`).toBe(isOwner);
    }
  });

  it("only offers referrals to personal accounts", () => {
    // Referrals are a personal-plan growth loop; the whole Office plan is out.
    for (const { name, ctx } of ACCOUNTS) {
      const ids = buildTourSteps(ctx).map((s) => s.id);
      expect(ids.includes("settings-refer"), `${name} settings-refer`).toBe(ctx.tier !== "office");
    }
  });

  it("gives every account a first and last step", () => {
    // Filtering is per-plan, so a filter mistake could empty the ends of the
    // list and leave a plan with a tour that opens or closes on nothing.
    for (const { name, ctx } of ACCOUNTS) {
      const steps = buildTourSteps(ctx);
      expect(steps.length, `${name} has no steps`).toBeGreaterThan(5);
      expect(steps[0].id, `${name} first step`).toBe("welcome");
      expect(steps[steps.length - 1].id, `${name} last step`).toBe("finish");
    }
  });

  it("drops every spotlighted step for an account with no cards", () => {
    // The zero-card dashboard is a different tree: no nav, no tab bar, no
    // panels. Any anchored step there polls ~2.9s and skips — ~30 seconds of a
    // frozen-looking tour, on the first run of a brand-new account, which is
    // exactly who auto-starts it. Then /share redirects back to /dashboard and
    // the tour used to bounce between them under an opaque scrim with no way
    // out but Escape.
    for (const { name, ctx } of ACCOUNTS) {
      const steps = buildTourSteps({ ...ctx, hasCards: false });
      const anchored = steps.filter((s) => s.anchor).map((s) => s.id);
      expect(anchored, `${name} with no cards still spotlights: ${anchored.join(", ")}`).toEqual([]);
      // It must still be a coherent tour, not an empty one.
      expect(steps.length, `${name} with no cards has no steps at all`).toBeGreaterThan(0);
      expect(steps[0].id).toBe("welcome");
    }
  });

  it("hides surfaces the iOS app does not render — and shows the ones it now does", () => {
    // Billing's step stays hidden (its anchor is the web billing manager).
    // Referrals RETURNED to the app 2026-08-26 (owner order, IAP era): the
    // box renders in the shell again, so its tour step must fire there too —
    // an excluded step would silently skip a surface the app really has.
    for (const { name, ctx } of ACCOUNTS) {
      const ids = buildTourSteps({ ...ctx, isNative: true }).map((s) => s.id);
      expect(ids, `${name} on native shows billing`).not.toContain("settings-billing");
      const webIds = buildTourSteps({ ...ctx, isNative: false }).map((s) => s.id);
      if (webIds.includes("settings-refer")) {
        expect(ids, `${name} on native hides referrals (it renders there now)`).toContain("settings-refer");
      }
    }
  });

  it("still shows those surfaces on the web", () => {
    // The native rule must not leak into the website, where both exist.
    const freeWeb = buildTourSteps({ tier: "free", isOfficeMember: false, hasCards: true, isNative: false })
      .map((s) => s.id);
    expect(freeWeb).toContain("settings-billing");
    expect(freeWeb).toContain("settings-refer");
  });

  it("keeps every step's copy truthful for the account it is shown to", () => {
    // bodyFor() rewords per plan. A step that keeps its base copy while being
    // shown to a plan the copy does not describe is the subtler half of this
    // bug — it does not stall, it just lies.
    const free = buildTourSteps({ tier: "free", isOfficeMember: false, hasCards: true, isNative: false });
    const member = buildTourSteps({ tier: "office", isOfficeMember: true, hasCards: true, isNative: false });

    // Free has exactly one card, and EMAIL follow-ups only (owner, 2026-09-11):
    // texts and AI-written messages are Pro. It used to say the whole
    // automation feature was Pro, which was false.
    expect(free.find((s) => s.id === "my-cards")!.body).toMatch(/free includes one/i);
    const auto = free.find((s) => s.id === "contact-automations")!.body;
    expect(auto).toMatch(/flip on email/i);
    expect(auto).toMatch(/text follow-ups and ai-written messages are on pro/i);
    expect(auto, "Free told email follow-ups are Pro").not.toMatch(/automated follow-up is a pro feature/i);
    expect(free.find((s) => s.id === "traffic")!.body).toMatch(/unlock on pro/i);
    // CRM sync is Pro: Free is told so, not promised it.
    expect(free.find((s) => s.id === "settings-integrations")!.body).toMatch(/^On Pro, connect/);

    // A sub-user's branding is company-owned; the copy must not tell them to
    // change what is locked.
    expect(member.find((s) => s.id === "your-card")!.body).toMatch(/company sets the card's branding/i);
    expect(member.find((s) => s.id === "settings-cards")!.body).toMatch(/branding stays locked/i);
  });
});
