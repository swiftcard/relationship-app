import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOCIAL_INPUTS, socialInput } from "@/lib/social-input";
import { socialUrl } from "@/lib/social-url";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const DESIGN = "src/components/SwiftLinkDesign.tsx";
const WIZARD = "src/app/cards/new/NewCardWizard.tsx";
const EDITOR = "src/app/cards/[id]/edit/CardEditForm.tsx";

// ── The Social design panel is a ROUTE, top to bottom ────────────────────────
//
// Owner order 2026-09-15: "the page header should be first because that will
// set how they design their whole page based off of what they choose… make sure
// the order is very linear and in order of what makes sense."
//
// The header is the one structural choice on the panel (cover / short banner /
// compact circle / none) and it gates the background's photo-video upload, so
// it has to come before the things that depend on it. The rest of the order was
// already settled and is kept: Look, Page background and Text color stay
// adjacent (owner, 2026-09-10), and the accent still lands between the social
// icons and the link buttons.
describe("Social design reads top to bottom", () => {
  const raw = read(DESIGN);
  // Numbered steps name themselves as `label: "…"`; the two colours inside
  // step 3 are still rendered labels (`}>Page background`). Either form
  // marks where a section sits in the source.
  const at = (label: string) => Math.max(raw.indexOf("}>" + label), raw.indexOf(`label: "${label}"`));
  const src = { indexOf: (needle: string) => at(needle.replace(/^}>/, "")) };

  // The rendered section labels, in source order.
  const ORDER = [
    "Page header",
    "Look",
    "Page background",
    "Text color",
    "Font",
    "Social icons",
    "Connect button",
    "Link buttons",
  ];

  it("puts every section in the agreed order", () => {
    const positions = ORDER.map((label) => ({
      label,
      at: at(label),
    }));
    for (const p of positions) {
      expect(p.at, `section "${p.label}" is missing from the panel`).toBeGreaterThan(-1);
    }
    const sorted = [...positions].sort((a, b) => a.at - b.at).map((p) => p.label);
    expect(sorted).toEqual(ORDER);
  });

  it("leads with the structural choice, not a colour", () => {
    // The specific regression: Page header sank below the background, so the
    // upload it gates appeared before the control that unlocks it.
    expect(src.indexOf("}>Page header")).toBeLessThan(src.indexOf("}>Page background"));
    expect(src.indexOf("}>Page header")).toBeLessThan(src.indexOf("}>Look"));
  });

  it("keeps the Look, background and text together", () => {
    // Owner, 2026-09-10 — moving the header must not have split these up.
    const look = src.indexOf("}>Look");
    const bg = src.indexOf("}>Page background");
    const text = src.indexOf("}>Text color");
    const icons = src.indexOf("}>Social icons");
    expect(look).toBeLessThan(bg);
    expect(bg).toBeLessThan(text);
    expect(text).toBeLessThan(icons);
  });

  it("keeps the accent between the social icons and the link buttons", () => {
    const icons = src.indexOf("}>Social icons");
    const connect = src.indexOf("}>Connect button");
    const links = src.indexOf("}>Link buttons");
    expect(icons).toBeLessThan(connect);
    expect(connect).toBeLessThan(links);
  });
});

// ── One answer to "what do I type here?" ────────────────────────────────────
//
// Owner report 2026-09-15: "LinkedIn: do they just type their name in, or do
// they have to type out linkedin.com/in/their name?" The placeholders used to
// disagree — a URL on LinkedIn/Facebook/YouTube, an @handle on the rest.
describe("every social box asks for the same thing", () => {
  it("covers exactly the platforms a card can carry", () => {
    expect(SOCIAL_INPUTS.map((s) => s.key)).toEqual([
      "linkedin", "instagram", "tiktok", "facebook", "twitter", "snapchat", "youtube",
    ]);
  });

  it("never asks for a URL in the box", () => {
    // One placeholder for every row since 2026-09-29, after the link prefix
    // the box shows (components/SocialHandleField).
    expect(read("src/components/SocialHandleField.tsx")).toMatch(/placeholder="username"/);
  });

  it("the prefix in each box is the address we actually build", () => {
    for (const s of SOCIAL_INPUTS) {
      // The stem sits in the box in front of the username, so it has to be
      // the address we ACTUALLY build, or the box lies.
      const built = socialUrl(s.key, s.example);
      expect(built, `${s.key} builds no URL from a plain username`).toBeTruthy();
      expect(built!.replace(/^https?:\/\//, "")).toBe(`${s.stem}${s.example}`);
    }
  });

  it("is the single source both editors read", () => {
    for (const [name, src] of [["wizard", read(WIZARD)], ["editor", read(EDITOR)]] as const) {
      expect(src, `${name} does not use the shared spec`).toMatch(/SOCIAL_INPUTS/);
      expect(src, `${name} still hardcodes its own placeholder list`).not.toMatch(/placeholder: "@username"/);
      expect(src, `${name} still tells people to paste a URL`).not.toMatch(/Paste a profile URL or type an @handle/);
    }
  });

  it("has a spec for every key it claims", () => {
    expect(socialInput("snapchat")?.stem).toBe("snapchat.com/add/");
    expect(socialInput("twitter")?.stem).toBe("x.com/");
    expect(socialInput("nope")).toBeUndefined();
  });
});

// ── Custom design: on every card-design screen, open only to a paying account ─
//
// Owner, 2026-09-15: "when someone is creating their card they shouldn't have
// access to open custom design" — and then, 2026-09-18, on finding the row gone
// from Get Started: "I want custom design to be shown with a very small pro tag
// but I want it to be locked. The only time someone can ever access custom
// design is in the actual dashboard if they pay for the Pro or Office plan."
// So: the row is everywhere, and it opens only for Pro and Office.
//
// Owner, 2026-09-30, once AI design existed: "When someone creates a card we
// want to give them the option to do AI design so we should unlock Custom
// Design … 'Copy a recorder template' stays locked but AI design will work."
// So a FIRST card opens the row too — for AI design only; Copy stays paid.
describe("Custom design is shown everywhere; open for Pro and Office, and for AI design on a first card", () => {
  const src = read(WIZARD);
  const picker = read("src/components/card-templates/TemplatePicker.tsx");
  const page = read("src/app/cards/new/page.tsx");

  it("the builder opens it for a paying account, and for a first card's AI design", () => {
    expect(src).toMatch(/const customDesignAvailable = isPro \|\| \(designUnlocked && firstCardAiDesign\);/);
    // Only a REAL first card: no account yet, or an account with no card.
    expect(page).toMatch(/const firstCardAiDesign = !isPro && \(!user \|\| cardCount === 0\);/);
    expect(page).toMatch(/firstCardAiDesign=\{firstCardAiDesign\}/);
    // Copy stays paid; AI design opens with the designer.
    expect(src).toMatch(/canScan=\{isPro\} canAiDesign=\{customDesignAvailable\}/);
    expect(src).toMatch(/customUnlocked=\{customDesignAvailable\}/);
    // The canvas, docked preview and step-2 canvas mode all read the same flag.
    expect(src).toMatch(/customSelected && customDesignAvailable \?/);
    expect(src).toMatch(/designerIsCanvas = step === 2 && customSelected && customDesignAvailable/);
  });

  it("the row can no longer be left out of any gallery", () => {
    expect(picker).not.toMatch(/hideCustom/);
    for (const f of [
      WIZARD, EDITOR, "src/components/OfficeBranding.tsx", "src/components/site/CardMiniBuilder.tsx",
      "src/components/site/SignatureMiniBuilder.tsx", "src/components/site/TeamsDashboard.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/hideCustom/);
      expect(read(f), f).toMatch(/<TemplatePicker/);
    }
  });

  it("locked, it carries the small PRO tag and cannot be opened", () => {
    expect(picker).toMatch(/proTag=\{proTags \|\| !customUnlocked\}/);
    expect(picker).toMatch(/disabled=\{!customUnlocked\}/);
  });

  it("the upgrade link under a locked row only where leaving costs nothing — the card editor", () => {
    expect(picker).toMatch(/\{!customUnlocked && upsell && <CustomDesignUpsell \/>\}/);
    expect(src).toMatch(/customUnlocked=\{customDesignAvailable\}\s*\n\s*upsell=\{false\}/);
    for (const f of ["src/components/site/CardMiniBuilder.tsx", "src/components/site/SignatureMiniBuilder.tsx", "src/components/site/TeamsDashboard.tsx"]) {
      expect(read(f), f).toMatch(/customUnlocked=\{false\} upsell=\{false\}/);
    }
    expect(read(EDITOR)).toMatch(/customUnlocked=\{isPro\}/);
  });

  it("never restores anyone onto a Custom design they cannot open", () => {
    // A resumed draft or a prefill could otherwise strand them on a design
    // they can no longer open or change.
    const guards = src.match(/!\(!customDesignAvailable && p\.template === "custom"\)/g) ?? [];
    expect(guards.length, "both restore paths must be guarded").toBe(2);
  });

  it("still lets a guest and a Free first card try colours and fonts", () => {
    // The plan preview is the point of those flows; only Custom design is held
    // back, so designUnlocked must survive.
    // (A signed-in buyer from a plan CTA is added on the end — they pay for
    // this card next, like a guest from the same button.)
    expect(src).toMatch(/const designUnlocked = isPro \|\| guest \|\| isFirstCard \|\| \(!!presetPlan && !postCheckout\);/);
  });
});

describe("Office Branding: a custom design for the whole team", () => {
  const office = read("src/components/OfficeBranding.tsx");

  it("offers the row open, with the card editor's own designer", () => {
    expect(office).toMatch(/<TemplatePicker template=\{template\} onSelect=\{setTemplate\} data=\{previewData\} customUnlocked upsell=\{false\} \/>/);
    expect(office).toMatch(/<CustomCardDesigner layout=\{customLayout\} data=\{previewData\} onChange=\{setCustomLayout\} canScan teamBrand \/>/);
    // …and saves it with the brand.
    expect(office).toMatch(/\.\.\.\(customSelected \? \{ customLayout \} : \{\}\)/);
  });

  it("never an image with one person's details baked in — in the designer, the page, the API or the brand read", () => {
    const designer = read("src/components/CustomCardDesigner.tsx");
    expect(designer).toMatch(/if \(teamBrand\) await scanLayoutOnly\(prepared\.b64\);/);
    // A team design never shows (or edits past) one person's exact image.
    expect(designer).toMatch(/norm\.faceImage && !teamBrand\s*\?\s*<FaceCard/);
    expect(designer).toContain("isFree && !(norm.faceImage && !teamBrand)");
    expect(office).toMatch(/withoutFaceImage\(normalizeCustomLayout\(office\.brand_custom_layout\)\)/);
    expect(read("src/app/api/office/brand/route.ts")).toMatch(/brand_custom_layout: teamCustomLayout\(body\.customLayout\)/);
    const brand = read("src/lib/office-brand.ts");
    expect(brand).toMatch(/customLayout: withoutFaceImage\(office\.brand_custom_layout \?\? null\)/);
    expect(brand).toMatch(/brand_custom_layout: withoutFaceImage\(cust\.customLayout \?\? null\)/);
  });
});

describe("a team layout is safe to store", () => {
  it("drops the face image and validates everything else", async () => {
    const { teamCustomLayout, withoutFaceImage } = await import("@/lib/custom-layout");
    const withFace = { background: "#000000", textColor: "#ffffff", fontFamily: "Inter", faceImage: "https://example.com/x.png", blocks: [] };
    const team = teamCustomLayout(withFace);
    expect(team).not.toBeNull();
    expect("faceImage" in (team as object)).toBe(false);
    expect(teamCustomLayout(null)).toBeNull();
    expect(teamCustomLayout("not a layout")).toBeNull();
    expect(withoutFaceImage({ a: 1, faceImage: "x" })).toEqual({ a: 1 });
    expect(withoutFaceImage(null)).toBeNull();
  });
});
