import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINK_STYLE_KEYS, LINK_STRUCTURAL_KEYS, sanitizeCustomizationForPlan } from "@/lib/plan";
import { PREFILL_LINK_STYLE_KEYS } from "@/lib/prefill";
import { isPaidPlan } from "@/lib/plan";
import { OFFICE_DESIGN_KEYS, overlayOfficeDesign } from "@/lib/office-brand";
import {
  pageMediaUrl,
  normalizePageMediaType,
  normalizePageDim,
  DEFAULT_PAGE_DIM,
  MAX_PAGE_DIM,
  PAGE_MEDIA_BASE,
  normalizeHeroStyle,
} from "@/lib/swiftlink-looks";

// ── Swift Links PAGE BACKGROUND — a photo or video behind the whole page ────
//
// Owner request 2026-09-10, referencing linktr.ee/kelsieblevinsrealestate: with
// the compact-circle header, let the whole background be a picture or a video
// of the owner's choosing, or stay a flat colour — and let the link buttons go
// frosted over it.
//
// The LOOK of it is measured in a real browser by
// tests/render/swiftlink-page-background.test.ts. This file guards the things a
// browser cannot show: the plan line, the URL rule, the clamps, and the wiring
// that carries four new keys from the editor to the public page without any of
// them being quietly dropped on the way.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("every header style (owner, 2026-09-17)", () => {
  it("is offered under Background & text whatever the header, in the editor and at render", () => {
    // It used to exist only with the compact circle or no header, so under a
    // cover photo the option was simply missing and people could not find it.
    const design = read("src/components/SwiftLinkDesign.tsx");
    expect(design).toContain("{canUpload && <PageBackgroundMedia value={value} onChange={onChange} />}");
    expect(design).not.toContain("mediaHeader");
    const profile = read("src/components/SwiftLinkProfile.tsx");
    expect(profile).toContain("const bgMedia = pageMediaUrl(pageStyle?.bgMedia);");
  });

  it("a cover or banner photo dissolves into the background instead of meeting it at a hard line", () => {
    const profile = read("src/components/SwiftLinkProfile.tsx");
    expect(profile).toContain("style={wash || bgMedia ? {");
    expect(profile).toContain("{!wash && !bgMedia && (");
  });

  it('"avatar" is what the compact circle is called in stored data', () => {
    expect(normalizeHeroStyle("avatar")).toBe("avatar");
    expect(normalizeHeroStyle("cover")).toBe("cover");
    expect(normalizeHeroStyle(undefined)).toBe("cover");
  });

  it("the header buttons write ONLY linkHeroStyle — switching never deletes an upload", () => {
    const design = read("src/components/SwiftLinkDesign.tsx");
    expect(design).toMatch(/onChange\(\{ linkHeroStyle: o\.id === "cover" \? undefined : o\.id \}\)/);
  });
});

describe("the plan line", () => {
  it("all four keys are Pro, so a Free page stores none of them", () => {
    for (const key of ["linkBgMedia", "linkBgMediaType", "linkBgDim", "linkGlass"]) {
      expect(LINK_STYLE_KEYS, key).toContain(key);
    }
  });

  it("the compact-circle header itself stays every-plan", () => {
    // The background is the premium part. The header is structure, and Free
    // keeps every header — same rule as the named Look.
    expect(LINK_STRUCTURAL_KEYS).toContain("linkHeroStyle");
    expect(LINK_STYLE_KEYS).not.toContain("linkHeroStyle");
  });

  it("the sanitizer actually strips them for a Free account", () => {
    const cust = {
      linkHeroStyle: "avatar",
      linkBgMedia: "https://example.com/a.jpg",
      linkBgMediaType: "image",
      linkBgDim: 40,
      linkGlass: true,
    };
    const free = sanitizeCustomizationForPlan(cust, false, "modern") as Record<string, unknown>;
    expect(free.linkBgMedia).toBeUndefined();
    expect(free.linkBgMediaType).toBeUndefined();
    expect(free.linkBgDim).toBeUndefined();
    expect(free.linkGlass).toBeUndefined();
    // …and keeps the header, which is not a paid feature.
    expect(free.linkHeroStyle).toBe("avatar");

    const paid = sanitizeCustomizationForPlan(cust, true, "modern") as Record<string, unknown>;
    expect(paid.linkBgMedia).toBe("https://example.com/a.jpg");
  });

  it("a downgraded Pro keeps the upload in storage, hidden not deleted", () => {
    // Same philosophy as the links cap: re-subscribing must bring the page
    // back, so nothing is destroyed on write.
    const cust = { linkBgMedia: "https://example.com/a.jpg", linkGlass: true };
    const kept = sanitizeCustomizationForPlan(cust, false, "modern", { preserveDowngraded: true }) as Record<string, unknown>;
    expect(kept.linkBgMedia).toBe("https://example.com/a.jpg");
  });

  it("the public page gates the four keys behind ownerPaid", () => {
    const page = read("src/app/links/[username]/page.tsx");
    const paidBlock = page.slice(page.indexOf("...(ownerPaid"), page.indexOf("const bio ="));
    for (const key of ["bgMedia:", "bgMediaType:", "bgDim:", "glass:"]) {
      expect(paidBlock, key).toContain(key);
    }
  });

  it("the live preview previews them on exactly the same terms", () => {
    // A Free pick that previewed live but was stripped on save is the audit
    // bug the custom pickers already had once.
    const preview = read("src/components/SwiftLinkLivePreview.tsx");
    expect(preview).toMatch(/paid \?[\s\S]{0,600}bgMedia: style\?\.linkBgMedia/);
    expect(preview).toMatch(/bgMediaType: style\?\.linkBgMediaType/);
    expect(preview).toMatch(/bgDim: style\?\.linkBgDim/);
    expect(preview).toMatch(/glass: style\?\.linkGlass/);
  });
});

describe("every Swift Links design key survives a round trip through the editor", () => {
  // THE BUG THIS EXISTS FOR (found 2026-09-10, during verification):
  // CardEditForm does not spread the link style — it names every key twice,
  // once to hydrate from the stored card and once in the save payload, because
  // the save has to send an explicit null to CLEAR a key. Add a key to the
  // feature and forget one of those two lists and there is no error anywhere:
  // the control works, the live preview updates, and the value is dropped the
  // moment Save is pressed. All four background keys shipped that way for an
  // hour. This makes the next one impossible to miss.
  const form = read("src/app/cards/[id]/edit/CardEditForm.tsx");
  const ALL = [...LINK_STYLE_KEYS, ...LINK_STRUCTURAL_KEYS];

  it.each(ALL)("%s is hydrated from the stored card", (key) => {
    expect(form).toContain(`${key}: card.customization?.${key} ??`);
  });

  it.each(ALL)("%s is sent on save", (key) => {
    expect(form).toContain(`${key}: linkStyleState.${key} ??`);
  });

  it.each(ALL)("%s is declared on the customization type", (key) => {
    expect(form).toMatch(new RegExp(`${key}\\?:`));
  });

  it("the wizard carries them too", () => {
    // It spreads rather than naming keys, which is why it never had the bug —
    // but the spread has to actually be there.
    const wizard = read("src/app/cards/new/NewCardWizard.tsx");
    expect(wizard).toMatch(/\.\.\.linkStyleState,/);
  });

  it("a page-only key never invalidates the Swift Signature's card image", () => {
    // The signature re-renders when the CARD changes. A background photo is
    // not on the card, so it must be stripped before the change hash.
    const sig = read("src/lib/signature-content.ts");
    for (const key of ["linkBgMedia", "linkBgMediaType", "linkBgDim", "linkGlass"]) {
      expect(sig, key).toContain(`"${key}"`);
    }
  });
});

describe("the accent — one colour for every call to action", () => {
  it("is Pro, like every other colour on this panel", () => {
    expect(LINK_STYLE_KEYS).toContain("linkAccentColor");
  });

  it("the sanitizer strips it for Free", () => {
    const free = sanitizeCustomizationForPlan(
      { linkAccentColor: "#0F766E" }, false, "modern",
    ) as Record<string, unknown>;
    expect(free.linkAccentColor).toBeUndefined();
  });

  it("reaches the Connect button, the social chips and the link rows", () => {
    // One accent, three consumers. If a future edit passes the Look's raw
    // accent to any of them again, the owner's choice silently stops applying
    // to that one thing — which reads as a bug in the control, not in a prop.
    const profile = read("src/components/SwiftLinkProfile.tsx");
    expect(profile).toMatch(/const accent = customAccent \?\? look\.accent/);
    expect(profile).not.toMatch(/accent=\{look\.accent\}/);
    expect(profile).not.toMatch(/accentText=\{look\.accentText\}/);
  });

  it("derives its label colour rather than trusting a pair nobody tested", () => {
    const profile = read("src/components/SwiftLinkProfile.tsx");
    expect(profile).toMatch(/isLightHex\(customAccent\) \? "#111827" : "#FFFFFF"/);
  });

  it("picking a Look clears it, like every other fine-tune override", () => {
    // A stale accent would win at render time and make every Look "not work"
    // until the owner found and reset it.
    const design = read("src/components/SwiftLinkDesign.tsx");
    expect(design).toMatch(/linkLook: v,[^}]*linkAccentColor: undefined/);
  });

  it("survives the marketing sketch's hand-off to the wizard", () => {
    // The mini-builder renders this control (it is gated by neither `links`
    // nor `canUpload`), so a visitor can pick a colour there. That colour then
    // has to cross three hops to reach the real builder: the sketch's read-back
    // map, the CardPrefill type, and the key list the wizard restores from.
    // It was dropped at the last two — the same whitelist trap that ate the
    // page background in the card editor, in a different file.
    expect(PREFILL_LINK_STYLE_KEYS).toContain("linkAccentColor");
    expect(read("src/lib/prefill.ts")).toMatch(/linkAccentColor\?: string/);
    expect(read("src/components/site/useProductSketch.ts")).toMatch(/linkAccentColor: p\.linkAccentColor/);
  });

  it("every prefill style key is declared and mapped, not just this one", () => {
    // The general form of the bug above: a key on the carry list that the type
    // does not declare, or that the sketch never reads back, is a colour the
    // visitor picks and silently loses.
    const type = read("src/lib/prefill.ts");
    const sketch = read("src/components/site/useProductSketch.ts");
    for (const key of PREFILL_LINK_STYLE_KEYS) {
      expect(type, `${key} missing from the CardPrefill type`).toMatch(new RegExp(`${key}\\?: `));
      expect(sketch, `${key} missing from the sketch's fromPrefill map`).toContain(`${key}: p.${key}`);
    }
  });

  it("the Solid/Outline rows preview the accent actually in use", () => {
    // Their "Default" swatch falls back to the accent, so showing the Look's
    // raw one would preview a colour those rows never render.
    const design = read("src/components/SwiftLinkDesign.tsx");
    // pageLook = the Look as rendered, so Photo match shows the photo's accent.
    expect(design).toMatch(/fallbackHex=\{value\.linkAccentColor \|\| pageLook\.accent\}/);
    expect(design).toMatch(/const pageLook = resolveLook\(value\.linkLook, tone\)/);
  });
});

describe("every plan and every Office role gets the same Social design", () => {
  // Owner question, 2026-09-10: does this reach the Office admin AND the
  // sub-user? It does, but only because every surface gates on isPaidPlan
  // rather than on plan === "pro" — a narrower check anywhere would lock the
  // whole panel for a whole company, and it would do it silently.

  it("an Office plan counts as paid", () => {
    expect(isPaidPlan("enterprise")).toBe(true);
    expect(isPaidPlan("pro")).toBe(true);
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan(null)).toBe(false);
  });

  it("a sub-user's OWN profile is set to enterprise when they join", () => {
    // The gate reads profiles.plan for the person editing, not the office's
    // plan. If joining left a member on "free" they would see the entire
    // Social design panel Pro-locked while their admin saw it open.
    expect(read("src/app/api/join/route.ts")).toMatch(/plan: "enterprise"/);
  });

  it("every surface that unlocks the panel uses isPaidPlan", () => {
    for (const f of [
      "src/app/cards/[id]/edit/page.tsx",   // the card editor
      "src/app/cards/new/page.tsx",         // the wizard
      "src/app/links/[username]/page.tsx",  // the public page
    ]) {
      expect(read(f), f).toMatch(/isPaidPlan\(/);
    }
  });

  it("keeps the accent for an Office account and strips it for Free", () => {
    const cust = { linkAccentColor: "#0F766E" };
    expect(
      (sanitizeCustomizationForPlan(cust, isPaidPlan("enterprise"), "modern") as Record<string, unknown>).linkAccentColor,
    ).toBe("#0F766E");
    expect(
      (sanitizeCustomizationForPlan(cust, isPaidPlan("free"), "modern") as Record<string, unknown>).linkAccentColor,
    ).toBeUndefined();
  });

  it("a company brand lock governs the CARD, and leaves Swift Links alone", () => {
    // overlayOfficeDesign forces OFFICE_DESIGN_KEYS onto every member's card.
    // That list is the card's colours and font — no link* key is in it — so an
    // employee's Swift Links page, and the accent on it, stays their own. This
    // pins the separation: adding a link key to that list would silently
    // overwrite every member's page the next time branding was applied.
    for (const key of LINK_STYLE_KEYS) {
      expect(OFFICE_DESIGN_KEYS as readonly string[], `${key} must not be office-locked`).not.toContain(key);
    }
    const locked = overlayOfficeDesign(
      { linkAccentColor: "#0F766E", accentColor: "#FF0000" },
      { design: { accentColor: "#123456" }, lockTemplate: true },
    );
    expect(locked.linkAccentColor).toBe("#0F766E"); // the member's own, untouched
    expect(locked.accentColor).toBe("#123456");     // the company's, forced
  });
});

describe("the URL is never trusted", () => {
  it("accepts https and nothing else", () => {
    expect(pageMediaUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    // Everything below arrives through client-writable customization and would
    // be printed into a src on a PUBLIC page.
    expect(pageMediaUrl("http://cdn.example.com/a.jpg")).toBeNull();
    expect(pageMediaUrl("javascript:alert(1)")).toBeNull();
    expect(pageMediaUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(pageMediaUrl("//cdn.example.com/a.jpg")).toBeNull();
    expect(pageMediaUrl("")).toBeNull();
    expect(pageMediaUrl(undefined)).toBeNull();
    expect(pageMediaUrl(null)).toBeNull();
  });

  it("treats anything but the exact string \"video\" as an image", () => {
    // Fails toward <img>: an <img> pointed at an mp4 shows a broken image,
    // while a <video> pointed at a jpg is a silent black rectangle that
    // autoplays nothing.
    expect(normalizePageMediaType("video")).toBe("video");
    expect(normalizePageMediaType("image")).toBe("image");
    expect(normalizePageMediaType("VIDEO")).toBe("image");
    expect(normalizePageMediaType(undefined)).toBe("image");
  });
});

describe("the scrim is the readability control, so it is clamped", () => {
  it("keeps a sane value out of any input", () => {
    expect(normalizePageDim(undefined)).toBe(DEFAULT_PAGE_DIM);
    expect(normalizePageDim(null)).toBe(DEFAULT_PAGE_DIM);
    expect(normalizePageDim(Number.NaN)).toBe(DEFAULT_PAGE_DIM);
    expect(normalizePageDim("not a number")).toBe(DEFAULT_PAGE_DIM);
    expect(normalizePageDim(-40)).toBe(0);
    expect(normalizePageDim(9999)).toBe(MAX_PAGE_DIM);
    expect(normalizePageDim("55")).toBe(55);
    expect(normalizePageDim(42.6)).toBe(43);
  });

  it("never darkens all the way to black", () => {
    // 100% would hide the photo the owner just uploaded and leave them with a
    // black page and no idea why.
    expect(MAX_PAGE_DIM).toBeLessThan(100);
    expect(DEFAULT_PAGE_DIM).toBeGreaterThan(0);
  });
});

describe("text can never end up invisible over a photo", () => {
  const profile = read("src/components/SwiftLinkProfile.tsx");

  it("forces white text and dark-mode chrome over media", () => {
    // A light Look's body text is #111827 — unreadable on a dimmed photo.
    expect(profile).toMatch(/const textColor = pageStyle\?\.text \|\| \(bgMedia \? "#ffffff" : look\.text\)/);
    expect(profile).toMatch(/const light = bgMedia \? false :/);
  });

  it("pins the surface behind the media dark, to match that white text", () => {
    // It is what shows while the photo decodes, or forever if it 404s.
    expect(profile).toMatch(/const sheetBg = bgMedia \? PAGE_MEDIA_BASE :/);
    expect(PAGE_MEDIA_BASE).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("carries a text shadow over media and nowhere else", () => {
    expect(profile).toMatch(/\.\.\.\(bgMedia \? \{ textShadow:/);
  });

  it("turns Aura off — the two are the same surface", () => {
    expect(profile).toMatch(/const auraOn = !pageStyle\?\.bg && !bgMedia &&/);
  });

  it("stops the sheet painting over the photo", () => {
    // The single mistake that would make the whole feature look broken.
    expect(profile).toMatch(/background: bgMedia\s*\n?\s*\? "transparent"/);
  });
});

describe("frosted link rows", () => {
  const buttons = read("src/components/SwiftLinkButtons.tsx");
  const profile = read("src/components/SwiftLinkProfile.tsx");

  it("only ever arrive together with media", () => {
    expect(profile).toMatch(/glass=\{!!bgMedia && !!pageStyle\?\.glass\}/);
  });

  it("is chosen per link; an untouched row falls back to the page-wide setting (stock rows only)", () => {
    expect(buttons).toContain('const glassRow = paid && (link.glass ?? (glass && variant === "compact"));');
    // Frosting a SOLID row keeps the owner's colour, translucent.
    expect(buttons).toContain("{ background: `color-mix(in srgb, ${btnColor} 55%, transparent)`, ...frost }");
    // Featured/Grid tiles get a frosted band under the title.
    expect(buttons).toContain("{paid && link.glass && (");
  });

  it("the Blur switch lives on each link, for every size (owner, 2026-09-17)", () => {
    const controls = read("src/components/LinkButtonsControls.tsx");
    expect(controls).toContain("onClick={() => patch(i, { glass: !on })}");
    expect(controls).toContain('role="switch"');
    // …and the Office branding copy keeps it when saved.
    expect(read("src/lib/office-brand.ts")).toContain('if (typeof r.glass === "boolean") out.glass = r.glass;');
    // …and the live preview passes it through.
    expect(read("src/components/SwiftLinkLivePreview.tsx")).toContain("glass: l.glass");
  });

  it("section headers get their contrast from the media, not from the frosting", () => {
    // They sit directly on the photo whether or not the ROWS are frosted.
    expect(profile).toMatch(/overMedia=\{!!bgMedia\}/);
    expect(buttons).toMatch(/opacity: overMedia \? 0\.85 : 0\.55/);
  });
});

describe("uploads", () => {
  it("one shared uploader, so the two pickers cannot drift", () => {
    const lib = read("src/lib/upload-media.ts");
    expect(lib).toMatch(/export async function uploadMedia/);
    // A video cannot ride /api/upload — the function body cap is ~4.5 MB.
    expect(lib).toMatch(/\/api\/upload\/link-video/);
    expect(lib).toMatch(/createSignedUploadUrl|signedUrl/);
    for (const f of ["src/components/LinkButtonsControls.tsx", "src/components/SwiftLinkDesign.tsx"]) {
      expect(read(f), f).toMatch(/from "@\/lib\/upload-media"/);
    }
  });

  it("the page background uses its own allow-listed field", () => {
    const route = read("src/app/api/upload/route.ts");
    // The field becomes part of the storage object key, so it is allow-listed
    // rather than trusted.
    expect(route).toMatch(/field !== "pagebg"/);
    // …and it has NO database column, so it must return before the write
    // branches or a caller that forgets defer=true clobbers logo_url.
    expect(route).toMatch(/field === "hero" \|\| field === "link" \|\| field === "pagebg"/);
    expect(read("src/components/SwiftLinkDesign.tsx")).toMatch(/uploadMedia\(file, "pagebg"\)/);
  });

  it("writes the url and its type in ONE patch", () => {
    // Two patches can interleave and leave a video url flagged as an image,
    // which renders an <img> pointed at an mp4.
    const design = read("src/components/SwiftLinkDesign.tsx");
    expect(design).toMatch(/linkBgMedia: media\.url,\s*\n\s*linkBgMediaType: media\.type,/);
    expect(design).toMatch(/onChange\(\{ linkBgMedia: undefined, linkBgMediaType: undefined \}\)/);
  });

  it("frosting still defaults on for the rows when a first background is added", () => {
    const design = read("src/components/SwiftLinkDesign.tsx");
    expect(design).toMatch(/linkGlass: value\.linkGlass \?\? true/);
    // The per-link switch shows that default truthfully for untouched rows.
    expect(design).toContain("pageGlass={!!value.linkGlass && !!value.linkBgMedia}");
  });

  it("is offered in the sketch too: guests can upload (owner, 2026-09-17)", () => {
    // The marketing mini-builder's sketch belongs to a visitor; every upload
    // route answers 401 there.
    expect(read("src/components/site/SwiftLinkMiniBuilder.tsx")).not.toContain("canUpload={false}");
    expect(read("src/app/api/upload/route.ts")).toContain("guest/${randomUUID()}");
  });

  it("both upload controls share the one uploader and the canUpload gate", () => {
    const design = read("src/components/SwiftLinkDesign.tsx");
    expect(design).toContain("{canUpload && <HeroMediaUpload value={value} onChange={onChange} />}");
    expect(design).toContain("{canUpload && <PageBackgroundMedia value={value} onChange={onChange} />}");
    // Header and page background, both through lib/upload-media — no raw fetch.
    const calls = design.match(/uploadMedia\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect(design).not.toMatch(/fetch\("\/api\/upload"/);
  });

  it("a header picked in the sketch survives the hand-off too", () => {
    // Same three hops the accent had to cross. The header controls are
    // structural, so they are neither Pro-gated nor upload-gated — which means
    // the mini-builder shows them to every visitor, and a "Compact circle"
    // chosen there has to still be chosen in the real builder.
    for (const key of ["linkHeroStyle", "linkHeroContent"]) {
      expect(PREFILL_LINK_STYLE_KEYS, key).toContain(key);
    }
    // linkHeroImage stays OUT: it is an uploaded URL, and the control that
    // sets it is gated off in the sketch by the test above.
    expect(PREFILL_LINK_STYLE_KEYS).not.toContain("linkHeroImage");
  });
});
