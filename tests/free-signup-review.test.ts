import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Free signup, reviewed live on swiftcard.me (2026-09-22) ─────────────────
//
// Owner: "review everything from when a user … creates their first card …
// choose the free plan … all the way through … the Take a Tour." Each pin is a
// defect seen in a real browser on production, at 390px.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("step 1: the one required field", () => {
  const w = code("src/app/cards/new/NewCardWizard.tsx");

  it("Next with no name takes you TO the field — it sat a phone-screen above the message", () => {
    const fn = w.slice(w.indexOf("function goNextFrom1"), w.indexOf("function goNextFrom1") + 700);
    expect(fn).toMatch(/setNameMissing\(true\)/);
    expect(fn).toMatch(/nameInputRef\.current\?\.scrollIntoView/);
    expect(fn).toMatch(/nameInputRef\.current\?\.focus/);
    expect(w).toMatch(/ref=\{nameInputRef\}/);
    expect(w).toMatch(/aria-invalid=\{nameMissing \|\| undefined\}/);
  });

  it("the error clears as soon as a name is typed — it stayed up after", () => {
    expect(w).toMatch(/if \(nameMissing && e\.target\.value\.trim\(\)\) \{ setNameMissing\(false\); setError\(""\); \}/);
  });

  it("the Socials bio is named like everywhere else", () => {
    // "Bio" on every surface since 2026-09-29 (the wizard said "Swift Links
    // bio", the editor "Swiftlinks bio"). The heading is the textarea's label,
    // and FormSection adds the required asterisk (swift-links-bio-required).
    expect(w).toMatch(/title="Bio"\s+labelFor="wizard-bio"\s+required=\{!bioManaged\}/);
    const e = read("src/app/cards/[id]/edit/CardEditForm.tsx");
    expect(e).toMatch(/title="Bio"\s+labelFor="card-bio"\s+required=\{!bioManaged\}/);
    for (const s of [w, e]) expect(s).not.toMatch(/Swiftlinks bio|Swift Links bio\{/);
  });
});

describe("the logo / headshot cropper", () => {
  it("Cancel and the title are white on its black screen in the light theme", () => {
    // .text-white is remapped near-black under [data-sc-theme=light] with
    // !important, so it cannot be used on this always-black surface.
    const c = code("src/components/CropperLazy.tsx");
    const header = c.slice(c.indexOf("onClick={onCancel}") - 80, c.indexOf("{title}") + 20);
    expect(header).not.toMatch(/text-white/);
    expect(header.match(/color: "#fff"/g)?.length).toBe(2);
  });
});

describe("Social design → Social icons", () => {
  it("the sample chips are LinkedIn, Instagram and YouTube — not \"in\" three times", () => {
    const c = code("src/components/SwiftLinkDesign.tsx");
    const block = c.slice(c.indexOf("Live chips on the Look's own sheet") > -1 ? c.indexOf("Live chips") : c.indexOf('["LinkedIn", "#0A66C2"]'), c.indexOf("ICON_SHAPES.map"));
    expect(block).toMatch(/\["LinkedIn", "#0A66C2"\], \["Instagram", "#E4405F"\], \["YouTube", "#FF0000"\]/);
    expect(block).toMatch(/<PlatformIcon label=\{platform\}/);
    expect(block).not.toMatch(/>\s*in\s*</);
  });
});

describe("/welcome after the plan is chosen", () => {
  const p = code("src/app/welcome/page.tsx");

  it("a Free account that already chose goes to its dashboard — Back offered the chooser again", () => {
    expect(p).toMatch(/\.select\("plan, customization"\)/);
    expect(p).toMatch(/if \(!isPaidPlan\(profile\?\.plan\) && planChosen && !officeTier && sp\.canceled !== "1" && !sp\.plan\) redirect\("\/dashboard"\)/);
  });

  it("the choice itself never reloads the page, so \"Your card is live!\" still shows", () => {
    const w = code("src/components/WelcomePlan.tsx");
    const confirm = w.slice(w.indexOf("async function confirmFree"), w.indexOf("async function startGiftMonth"));
    expect(confirm).toMatch(/setSetupNext\(LANDING\)/);
    expect(confirm).not.toMatch(/router\.refresh|location\.reload/);
  });
});

describe("the two \"Your card is live!\" screens agree", () => {
  const w = code("src/app/cards/new/NewCardWizard.tsx");
  const plan = code("src/components/WelcomePlan.tsx");

  it("one button label everywhere", () => {
    expect(w).toContain("Go to my dashboard →");
    expect(w).not.toContain("Continue to dashboard →");
    expect(plan).toContain("Go to my dashboard →");
  });

  it("the builder says the email went out only when it did — the account's first card", () => {
    expect(w).toMatch(/\{\(isFirstCard \|\| tourOnDone \|\| postCheckout\) && \(\s*<p[^>]*>We also sent you an email with your link\.<\/p>/);
  });

  it("/welcome shows the link the way the builder does (AaronLavi-MalveCapital), only when it is this card's", () => {
    const p = code("src/app/welcome/page.tsx");
    expect(p).toMatch(/\.select\("template, customization, username, name, company"\)/);
    expect(p).toMatch(/slugFor\(cardName, cardCompany\) === rawSlug\s*\?\s*prettyCardSlug\(cardName, cardCompany\)\s*:\s*rawSlug/);
  });
});

describe("Monthly / Annual on the Free tab", () => {
  it("hidden — space kept, so nothing jumps — on a phone with Free open; desktop unchanged", () => {
    // `max-md:invisible`: phone width only, by CSS (right from first paint,
    // before hydration), and visibility:hidden keeps the space. It also drops
    // the switch from the accessibility tree, so no aria-hidden is needed.
    expect(code("src/components/PlanTierCards.tsx")).toMatch(/\$\{hideOnPhone \? "max-md:invisible" : ""\}/);
    for (const f of ["src/components/PlanCards.tsx", "src/app/pricing/page.tsx"]) {
      expect(code(f), f).toMatch(/hideOnPhone=\{mobileTier === "free"\}/);
    }
    // The app's chooser too.
    expect(code("src/components/PlanCards.tsx")).toMatch(/hideOnPhone=\{tier === "free"\}/);
  });

  it("the plan cards that aren't the open tab are hidden at phone width by CSS, not a JS width check", () => {
    // useIsMobile() is false until hydration, so a phone painted all three
    // cards stacked and then snapped to the open one.
    expect(code("src/components/PlanTierCards.tsx")).toMatch(/offTab \? "max-md:hidden" : ""/);
    for (const f of ["src/components/PlanCards.tsx", "src/app/pricing/page.tsx", "src/app/upgrade/UpgradeClient.tsx"]) {
      expect(code(f), f).not.toMatch(/useIsMobile|isMobile/);
    }
  });
});
