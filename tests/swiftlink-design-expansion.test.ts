import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  HERO_STYLES, HERO_CONTENTS, BUTTON_STYLES,
  normalizeHeroStyle, normalizeHeroContent, normalizeButtonStyle,
  DEFAULT_HERO_STYLE, DEFAULT_HERO_CONTENT, DEFAULT_BUTTON_STYLE,
} from "@/lib/swiftlink-looks";
import { LINK_STYLE_KEYS } from "@/lib/plan";

const read = (p: string) => readFileSync(p, "utf8");

// ── Swift Links design expansion (owner order 2026-09-01) ────────────────────
// Linktree-informed additions: a "Page header" layout (cover / short banner /
// compact circle / none — the fix for "the top part is so large"), a "Header
// shows" pick (auto / headshot / logo / initials), and "Link buttons" styles
// (rich tiles / solid rows / outlined rows, with a button color).
// Pins: defaults reproduce the pre-expansion page byte-for-byte, the header
// keys are EVERY plan, the button styling is Pro, and both editors carry it
// all through the shared SwiftLinkStyleControls.
describe("normalizers fail closed to today's rendering", () => {
  it("hero layout: only banner/avatar/none change anything", () => {
    expect(DEFAULT_HERO_STYLE).toBe("cover");
    expect(normalizeHeroStyle(undefined)).toBe("cover");
    expect(normalizeHeroStyle(null)).toBe("cover");
    expect(normalizeHeroStyle("junk")).toBe("cover");
    expect(normalizeHeroStyle("banner")).toBe("banner");
    expect(normalizeHeroStyle("avatar")).toBe("avatar");
    expect(normalizeHeroStyle("none")).toBe("none");
    expect(HERO_STYLES.map((o) => o.id)).toEqual(["cover", "banner", "avatar", "none"]);
  });

  it("hero content: only photo/logo/initials/custom change anything", () => {
    expect(DEFAULT_HERO_CONTENT).toBe("auto");
    expect(normalizeHeroContent(undefined)).toBe("auto");
    expect(normalizeHeroContent("junk")).toBe("auto");
    expect(normalizeHeroContent("photo")).toBe("photo");
    expect(normalizeHeroContent("logo")).toBe("logo");
    expect(normalizeHeroContent("initials")).toBe("initials");
    expect(normalizeHeroContent("custom")).toBe("custom");
    // "Upload photo" sits to the RIGHT of Initials (owner order 2026-09-02).
    expect(HERO_CONTENTS.map((o) => o.id)).toEqual(["auto", "photo", "logo", "initials", "custom"]);
  });

  it("buttons: only 'solid'/'outline' change anything", () => {
    expect(DEFAULT_BUTTON_STYLE).toBe("tile");
    expect(normalizeButtonStyle(undefined)).toBe("tile");
    expect(normalizeButtonStyle("junk")).toBe("tile");
    expect(normalizeButtonStyle("solid")).toBe("solid");
    expect(normalizeButtonStyle("outline")).toBe("outline");
    expect(BUTTON_STYLES.map((o) => o.id)).toEqual(["tile", "solid", "outline"]);
  });
});

describe("plan line", () => {
  it("button style + color are Pro (stripped for Free by LINK_STYLE_KEYS)", () => {
    expect(LINK_STYLE_KEYS).toContain("linkButtonStyle");
    expect(LINK_STYLE_KEYS).toContain("linkButtonColor");
  });

  it("the header keys are EVERY plan — the sanitizer never touches them", () => {
    expect(LINK_STYLE_KEYS).not.toContain("linkHeroStyle");
    expect(LINK_STYLE_KEYS).not.toContain("linkHeroContent");
    expect(LINK_STYLE_KEYS).not.toContain("linkHeroImage");
    // They live on the STRUCTURAL list instead (used by the wizard's draft
    // restore), which the sanitizer never iterates.
    const plan = read("src/lib/plan.ts");
    expect(plan).toContain('LINK_STRUCTURAL_KEYS = ["linkLook", "linkHeroStyle", "linkHeroContent", "linkHeroImage", "linkHeroMediaType"]');
    expect(plan).not.toMatch(/LINK_STRUCTURAL_KEYS[\s\S]{0,800}delete cust/);
  });

  it("the public page gates matching the sanitizer: header outside the paid spread, buttons inside", () => {
    const src = read("src/app/links/[username]/page.tsx");
    expect(src).toMatch(/heroStyle: customization\.linkHeroStyle,\s*\n\s*heroContent: customization\.linkHeroContent,\s*\n\s*\.\.\.\(ownerPaid/);
    // The uploaded header photo is every-plan too — outside the paid spread.
    expect(src).toMatch(/heroImage: customization\.linkHeroImage,[\s\S]{0,200}\.\.\.\(ownerPaid/);
    expect(src).toMatch(/buttonStyle: customization\.linkButtonStyle/);
    // CSS-guarded since the 2026-09-24 security audit (safeCssValue).
    expect(src).toMatch(/buttonColor: safeCssValue\(customization\.linkButtonColor\)/);
  });

  it("the live preview mirrors the same gating", () => {
    const src = read("src/components/SwiftLinkLivePreview.tsx");
    expect(src).toMatch(/heroStyle: style\?\.linkHeroStyle/);
    expect(src).toMatch(/heroContent: style\?\.linkHeroContent/);
    expect(src).toMatch(/heroImage: style\?\.linkHeroImage/);
    expect(src).toMatch(/\.\.\.\(paid \? \{[^}]*buttonStyle: style\?\.linkButtonStyle/);
  });
});

describe("rendering", () => {
  it("the profile renders all four header layouts", () => {
    const src = read("src/components/SwiftLinkProfile.tsx");
    expect(src).toMatch(/normalizeHeroStyle\(pageStyle\?\.heroStyle\)/);
    expect(src).toMatch(/\{\(heroStyle === "cover" \|\| heroBanner\) && \(/); // cover survives; banner shares it
    expect(src).toMatch(/heroBanner \? "h-\[260px\]" : "aspect-square max-h-\[520px\]"/); // a third of the screen
    // The banner crops the BOTTOM of the photo, never the head at the top.
    expect(src).toMatch(/heroBanner \? "object-top"/);
    expect(src).toMatch(/\{heroAvatar && \(/); // compact circle
    expect(src).toMatch(/flatTop = heroStyle === "avatar" \|\| heroStyle === "none"/); // none = flat page
  });

  it("the header content pick falls down the auto chain when the asset is missing", () => {
    // The chain lives in lib/swiftlink-looks resolveHero (2026-10-15) — shared
    // by SwiftLinkProfile and the public page's server-side Photo match read.
    expect(read("src/components/SwiftLinkProfile.tsx")).toMatch(/const hero = resolveHero\(pageStyle, photoUrl, logoUrl\)/);
    const src = read("src/lib/swiftlink-looks.ts");
    // "Upload photo": renders as a cover photo, HTTPS-only (the URL rides in
    // client-writable customization), and with no image falls down the chain.
    expect(src).toMatch(/content === "custom" && style\?\.heroImage && \/\^https:/);
    expect(src).toContain('if (custom) return { kind: style?.heroMediaType === "video" ? "video" : "photo", url: custom }');
    expect(src).toMatch(/if \(content === "initials"\) return \{ kind: "initials"/);
    expect(src).toMatch(/if \(content === "photo" && photoUrl\) return \{ kind: "photo"/);
    expect(src).toMatch(/if \(content === "logo" && logoUrl\) return \{ kind: "logo"/);
    // …and the unqualified auto chain closes it: photo → logo → initials.
    expect(src).toMatch(/if \(photoUrl\) return \{ kind: "photo", url: photoUrl \};\s*\n\s*if \(logoUrl\) return \{ kind: "logo"/);
  });

  it("buttons: solid/outline restyle ONLY compact rows — per-link sizes always win", () => {
    const src = read("src/components/SwiftLinkButtons.tsx");
    // Owner order 2026-09-01: the row style must COMPOSE with the per-link
    // featured/grid/compact sizes, never override them (featured/grid keep
    // their image/video previews). The old force-all-rows behavior (rowsOnly)
    // must stay gone. Since 2026-09-09 the style is resolved PER LINK, with
    // the page-wide `buttonStyle` only as the legacy fallback.
    expect(src).toMatch(/const pickedRow = resolveRowStyle\(link, buttonStyle\)/);
    expect(src).toMatch(/const variant = pickedRow === "solid" \|\| pickedRow === "outline" \? pickedRow : "compact"/);
    expect(src).not.toMatch(/rowsOnly/);
    expect(src).toMatch(/buttonColor \? \(isLightHex\(buttonColor\) \? "#111827" : "#FFFFFF"\) : accentText/);
    // Outline/compact labels stay in the page's AA-tested text color.
    expect(src).toMatch(/variant === "solid" \? btnText : textColor/);
  });

  it("the stock compact row markup is intact (Free rendering unchanged)", () => {
    const src = read("src/components/SwiftLinkButtons.tsx");
    expect(src).toContain('ring-1 bg-white ring-black/[0.08] shadow-[0_2px_10px_rgba(15,23,42,0.06)]');
    expect(src).toContain('ring-1 bg-white/[0.07] ring-white/10');
  });
});

describe("both editors edit it", () => {
  it("the shared controls expose header layout + content + button styles", () => {
    const src = read("src/components/SwiftLinkDesign.tsx");
    expect(src).toContain("Page header");
    expect(src).toContain("Header shows");
    expect(src).toContain("Link buttons");
    // Header choices are never plan-disabled; button styles are (the per-link
    // picker lives in LinkButtonsControls since 2026-09-09).
    expect(src).toMatch(/HERO_STYLES\.map[\s\S]{0,700}onClick/);
    expect(src).toMatch(/HERO_CONTENTS\.filter\(\(o\) => o\.id !== "custom"\)\.map[\s\S]{0,600}onClick/);
    // "custom" is its own obvious button, not a fifth small chip.
    expect(src).toContain("Upload photo or video");
    expect(src).toMatch(/<LinkButtonsControls links=\{links\} onChange=\{onLinksChange\} pageRowStyle=/);
    const perLink = read("src/components/LinkButtonsControls.tsx");
    // Both rows are LIVE on every plan since 2026-09-11 — the Social design
    // panel previews Pro, and Save Changes is the wall — so what is pinned is
    // that they exist and are clickable, not that they disable.
    expect(perLink).toMatch(/TILE_SIZES\.map[\s\S]{0,300}onClick=/);
    expect(perLink).toMatch(/BUTTON_STYLES\.map[\s\S]{0,400}onClick=/);
    expect(perLink).not.toMatch(/disabled=\{locked\}/);
    // "Header shows" hides for the "No header" layout (nothing to show).
    expect(src).toMatch(/normalizeHeroStyle\(value\.linkHeroStyle\) !== "none" && \(/);
    // A Look pick clears the custom button color along with bg/text.
    expect(src).toMatch(/linkLook: v, linkBgColor: undefined, linkTextColor: undefined, linkButtonColor: undefined/);
  });

  it("the editor round-trips all four keys explicitly (null clears on the merge route)", () => {
    const src = read("src/app/cards/[id]/edit/CardEditForm.tsx");
    for (const k of ["linkHeroStyle", "linkHeroContent", "linkButtonStyle", "linkButtonColor"]) {
      expect(src).toMatch(new RegExp(`${k}: card\\.customization\\?\\.${k} \\?\\? undefined`));
      expect(src).toMatch(new RegExp(`${k}: linkStyleState\\.${k} \\?\\? null`));
    }
  });

  it("the wizard persists via the linkStyleState spread", () => {
    expect(read("src/app/cards/new/NewCardWizard.tsx")).toMatch(/\.\.\.linkStyleState,/);
  });
});
