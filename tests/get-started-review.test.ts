import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Get Started review, 2026-11-04 ───────────────────────────────────────────
// The owner asked for the Get Started flow (card → account → plan → dashboard)
// to be checked for flaws. Each block below pins one defect that review found,
// so it cannot come back unnoticed.
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("a new person who taps Google/Apple on the Sign in tab", () => {
  const onboarding = read("src/app/onboarding/page.tsx");

  // 8 of the 15 real sign-ups (2026-10-02 → 11-04) tapped Google on the app's
  // first screen, were signed out with "You don't have an account yet", and
  // none of them ever finished a card. Owner's decision: build the card.
  it("is provisioned and sent to the card builder, never bounced", () => {
    expect(onboarding).not.toContain("error=no_account");
    expect(onboarding).not.toMatch(/intent\s*===\s*"signin"/);
    expect(onboarding).toContain('redirect(newAccountNext ?? (await inviteLanding(user.email, user.id)) ?? "/cards/new?add=1")');
  });

  // The bounce signed out from a Server Component, which cannot write cookies:
  // the phone kept a dead session cookie for up to an hour.
  it("signs nobody out from a Server Component", () => {
    expect(onboarding).not.toContain("auth.signOut(");
  });
});

describe("the card builder's draft", () => {
  const w = read("src/app/cards/new/NewCardWizard.tsx");

  it("is never written back once the card has been created", () => {
    const effect = w.slice(w.indexOf("if (step >= 5) return;"), w.indexOf("drafts.save({", w.indexOf("if (step >= 5) return;")));
    expect(effect).toContain("if (createdUsername) return;");
    const deps = w.slice(w.indexOf("}, [guest, keepsDraft, drafts, step,"), w.indexOf("]);", w.indexOf("}, [guest, keepsDraft, drafts, step,")));
    expect(deps).toContain("createdUsername");
  });

  it("lets ?name= and ?template= win only on a fresh entry, not on reload or a return", () => {
    expect(w).toContain("function restoreDraft(draft: GuestDraft, entryWins = false)");
    expect(w).toContain("setName(entryWins ? (heroName || s(p.name)) : (s(p.name) || heroName));");
    expect(w).toContain("!(entryWins && validPresetTemplate)");
    // "Continue your card" is the one fresh-entry restore …
    expect(w).toContain("restoreDraft(resumeChoice, true);");
    // … every silent one (reload, Back, login return, LinkedIn return) is not.
    const silent = w.match(/restoreDraft\(draft(, true)?\)/g) ?? [];
    expect(silent.length).toBeGreaterThan(0);
    expect(silent.every((c) => c === "restoreDraft(draft)")).toBe(true);
  });

  it("keeps a nickname that is the same as the name", () => {
    expect(w).toContain("username, label: cardLabel, nickname, name, company, title,");
    expect(w).toContain('setNickname(typeof p.nickname === "string" ? p.nickname : s(p.label) === s(p.name) ? "" : s(p.label));');
  });
});

describe("the claim screen's \"Back to my card\"", () => {
  it("keeps the plan picked on /pricing and drops only claim=1", () => {
    const c = read("src/components/GuestDraftClaim.tsx");
    expect(c).not.toContain('router.replace("/cards/new")');
    expect(c).toContain('const onBuilder = window.location.pathname === "/cards/new";');
    expect(c).toContain('keep.delete("claim");');
  });
});

describe("/welcome, the plan step", () => {
  it("knows it is inside the app from the first frame (no website prices in the shell)", () => {
    const f = "src/app/welcome/layout.tsx";
    expect(existsSync(f)).toBe(true);
    expect(read(f)).toContain("<NativeRequestBoundary>{children}</NativeRequestBoundary>");
  });

  it("reads the plan the way /dashboard does, so the two can't redirect into each other", () => {
    const p = read("src/app/welcome/page.tsx");
    expect(p).toContain("const paid = isPaidProfile(profile);");
    expect(p).toContain(".select(PLAN_COLUMNS)");
    expect(p).not.toMatch(/isPaidPlan\(profile/);
    expect(read("src/app/dashboard/page.tsx")).toContain("isPaidProfile(profile)");
  });

  const wp = read("src/components/WelcomePlan.tsx");

  it("still offers a friend's free month after backing out of Stripe", () => {
    const paidBranch = wp.slice(wp.indexOf(") : paidIntent && !pendingFreeConfirm ? ("), wp.indexOf(") : pendingFreeConfirm ? ("));
    expect(paidBranch).toContain("{giftPanel}");
  });

  it("gives the gift its own busy state, so no checkout claims to be running", () => {
    expect(wp).toContain('setLoading("gift");');
    expect(wp).toContain('starting={loading === "gift"}');
    expect(wp).toContain('{loading === "pro" || loading === "office" ? "Redirecting to checkout…" : `Continue to secure checkout →`}');
    expect(read("src/components/PlanCards.tsx")).toContain('busy?: "free" | PaidPlan | "gift" | null;');
  });

  it("shows a refused promo code on \"Before you go Free\", where Keep can be refused", () => {
    const freeBranch = wp.slice(wp.indexOf(") : pendingFreeConfirm ? ("), wp.indexOf("// THE plan step."));
    expect(freeBranch).toContain('{!native && promo.state.status !== "none" && (');
    expect(freeBranch).toContain("<PromoCodeBox");
  });
});
