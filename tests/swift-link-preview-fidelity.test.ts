import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STRUCTURAL GUARD — "the preview lies" bug class.
//
// A live preview is a promise: what you see while editing is what visitors get.
// That promise has now been broken twice, both times the same way — a field was
// added to the thing that RENDERS, and a call site was left passing nothing:
//
//   1. The card preview hardcoded `website: ""` while the save sent
//      `website.trim()`, so the website silently never appeared while building
//      the card and only showed up after it was created. It read as "the
//      website didn't save".
//   2. The Swift Links hero learned to fall back to the card's logo, but the
//      three SwiftLinkLivePreview call sites never passed `logoUrl` — so
//      /links/[username] showed the logo while the wizard, the editor and the
//      homepage mini-builder all still showed initials for the same card.
//
// Neither was caught by tsc: every one of these props is OPTIONAL, which is
// exactly why they can be silently forgotten. Nothing but a test closes that.
//
// So: adding a hero identity field to SwiftLinkProfile and forgetting a call
// site now fails here rather than shipping a preview that disagrees with the
// page it is previewing.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Every place the Swift Links preview is mounted, and the logo each one is
// expected to hand it — the SAME value that surface persists as logo_url.
const PREVIEW_CALL_SITES: { file: string; logo: string; why: string }[] = [
  {
    file: "src/app/cards/new/NewCardWizard.tsx",
    logo: "logoUrl={logoUrl}",
    why: "the wizard's logoUrl state is what it saves as logo_url",
  },
  {
    file: "src/app/cards/[id]/edit/CardEditForm.tsx",
    logo: "logoUrl={liveLogoUrl}",
    why: "liveLogoUrl is what logo_url holds after the editor's save — the card's own logo, or on a team member's card the office's, which the server writes over it",
  },
  {
    file: "src/components/site/SwiftLinkMiniBuilder.tsx",
    logo: "logoUrl={sketch.logo}",
    why: "the sketch is shared with the card mini-builder, where a guest can upload a logo",
  },
];

// The hero's identity chain, in fallback order. Anything added to it has to be
// added to this list AND to every call site, or the previews drift apart.
const HERO_IDENTITY_FIELDS = ["photoUrl", "logoUrl"];

/** The `<SwiftLinkLivePreview ... />` element, sliced out of a call site. */
function previewElement(src: string, file: string): string {
  const start = src.indexOf("<SwiftLinkLivePreview");
  expect(start, `${file} no longer mounts SwiftLinkLivePreview`).toBeGreaterThan(-1);
  // No nested JSX elements inside it — the first self-closing `/>` on its own
  // line ends the element.
  const end = src.indexOf("/>", start);
  expect(end, `${file}'s SwiftLinkLivePreview is never closed`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("the Swift Links preview shows what the live page will show", () => {
  const profile = read("src/components/SwiftLinkProfile.tsx");
  const livePreview = read("src/components/SwiftLinkLivePreview.tsx");

  it("the hero really does render every field this test tracks", () => {
    // Without this, deleting the logo fallback from the hero would leave the
    // assertions below testing a chain the product no longer has.
    for (const field of HERO_IDENTITY_FIELDS) {
      expect(profile, `SwiftLinkProfile no longer accepts ${field}`).toMatch(
        new RegExp(`${field}\\??:\\s*string \\| null`),
      );
    }
    // The order IS the behavior: headshot, then logo, then initials. Since
    // the 2026-09-01 header expansion the chain lives in the `hero` resolver
    // (the owner's explicit pick falls down this same auto chain), and the
    // JSX branches on hero.kind.
    // Since 2026-10-15 the resolver is lib/swiftlink-looks resolveHero, shared
    // with the public page's server render (Photo match samples the same
    // picture the header shows).
    expect(profile, "the hero no longer goes through the shared resolver").toMatch(
      /const hero = resolveHero\(pageStyle, photoUrl, logoUrl\)/,
    );
    expect(read("src/lib/swiftlink-looks.ts"), "the hero's headshot → logo → initials chain is gone").toMatch(
      /if \(photoUrl\) return \{ kind: "photo"[\s\S]{0,120}?if \(logoUrl\) return \{ kind: "logo"[\s\S]{0,120}?return \{ kind: "initials"/,
    );
    expect(profile, "the hero JSX no longer branches on the resolved identity").toMatch(
      /hero\.kind === "photo" \?[\s\S]{0,600}?\) : hero\.kind === "logo" \?/,
    );
  });

  it("SwiftLinkLivePreview forwards the whole identity chain to the hero", () => {
    const forwarded = previewElementOfProfile(livePreview);
    for (const field of HERO_IDENTITY_FIELDS) {
      expect(forwarded, `SwiftLinkLivePreview swallows ${field} instead of forwarding it`).toContain(
        `${field}={${field} || null}`,
      );
    }
  });

  it.each(PREVIEW_CALL_SITES)("$file passes the card's logo to the preview", ({ file, logo, why }) => {
    const el = previewElement(read(file), file);
    expect(el, `${file} previews a hero with no logo — ${why}`).toContain(logo);
  });

  it.each(PREVIEW_CALL_SITES)("$file passes every identity field, none hardcoded blank", ({ file }) => {
    const el = previewElement(read(file), file);
    for (const field of HERO_IDENTITY_FIELDS) {
      expect(el, `${file} never passes ${field}`).toContain(`${field}=`);
      // `logoUrl={null}` / `logoUrl=""` would satisfy the line above while
      // still previewing something the visitor will never see.
      expect(el, `${file} hardcodes ${field} blank`).not.toMatch(
        new RegExp(`${field}=(\\{(null|""|undefined)\\}|"")`),
      );
    }
  });

  it("the live page leads with the card's OWN logo, not the account's", () => {
    // Per-card, off the same row the headshot comes from — a shared/account
    // logo here is the cross-card bleed cardHeadshot exists to prevent.
    const page = read("src/app/links/[username]/page.tsx");
    expect(page, "the live page stopped passing a logo").toMatch(/logoUrl=\{/);
    expect(page, "the live page's logo no longer comes off the card row").toMatch(
      /logoUrl=\{\(cardOrLegacy\.logo_url/,
    );
  });
});

/** The `<SwiftLinkProfile ... />` element inside SwiftLinkLivePreview. */
function previewElementOfProfile(src: string): string {
  const start = src.indexOf("<SwiftLinkProfile");
  expect(start, "SwiftLinkLivePreview no longer renders SwiftLinkProfile").toBeGreaterThan(-1);
  const end = src.indexOf("/>", start);
  return src.slice(start, end);
}

// The other half of the same promise: the CARD preview. This is the literal
// bug — `website: ""` sat in previewData while the save sent website.trim().
const CARD_BUILDERS = [
  "src/app/cards/new/NewCardWizard.tsx",
  "src/app/cards/[id]/edit/CardEditForm.tsx",
];

/** The `const previewData: CardData = { ... };` object out of a card builder. */
function previewData(src: string, file: string): string {
  const start = src.indexOf("const previewData");
  expect(start, `${file} no longer builds a previewData`).toBeGreaterThan(-1);
  const end = src.indexOf("\n  };", start);
  expect(end, `${file}'s previewData is never closed`).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("the card preview shows the website as it is typed", () => {
  it.each(CARD_BUILDERS)("%s does not hardcode the preview's website blank", (file) => {
    const src = read(file);
    expect(src, `${file} hardcodes website:"" in the live preview again`).not.toMatch(
      /website:\s*""/,
    );
    expect(src, `${file} stopped feeding the typed website to the preview`).toMatch(
      /^\s*website,\s*$/m,
    );
  });
});

// Same promise, generalized. A card template reads its extras off
// `customization`, and previewData builds that object by hand — so any key a
// template reads and previewData doesn't set is invisible while editing and
// present on the saved card. That is how facebook + youtube went missing from
// the Custom template's preview: they live ONLY in customization, and both
// builders set snapchat but neither set those two.
describe("the card preview supplies every customization key a template reads", () => {
  const TEMPLATE_FILES = [
    "src/components/card-templates/CustomCard.tsx",
    "src/components/card-templates/shared.tsx",
    "src/components/card-templates/ClassicPro.tsx",
    "src/components/card-templates/ModernBold.tsx",
    "src/components/card-templates/PhotoFirst.tsx",
    "src/components/card-templates/LocalBusiness.tsx",
    "src/components/card-templates/LuxuryMinimal.tsx",
    "src/components/card-templates/LogoFirst.tsx",
  ];

  /** Keys read off `data.customization`, in either form the templates use. */
  function keysRead(): Set<string> {
    const keys = new Set<string>();
    for (const f of TEMPLATE_FILES) {
      const src = read(f);
      //  data.customization?.fax
      for (const m of src.matchAll(/data\.customization\?\.([a-zA-Z]+)/g)) keys.add(m[1]);
      //  (data.customization as { youtube?: string } | undefined)?.youtube
      for (const m of src.matchAll(/data\.customization as \{\s*([a-zA-Z]+)\??:/g)) keys.add(m[1]);
    }
    return keys;
  }

  it("the extractor still finds the keys we know are read", () => {
    // If a refactor changes how templates reach into customization, this fails
    // loudly instead of the suite below silently checking an empty set.
    const keys = keysRead();
    for (const known of ["snapchat", "youtube", "facebook", "phones", "fax", "customLayout"]) {
      expect(keys, `no template appears to read customization.${known} any more`).toContain(known);
    }
  });

  it.each(CARD_BUILDERS)("%s passes them all to its live preview", (file) => {
    const block = previewData(read(file), file);
    // Design keys (TemplateStyle: colours, font, finish…) arrive as one spread
    // of the builder's style state, so a key the spread carries is supplied.
    const styleSrc = read("src/lib/template-style.ts");
    const styleType = styleSrc.slice(styleSrc.indexOf("export type TemplateStyle"), styleSrc.indexOf("\n};", styleSrc.indexOf("export type TemplateStyle")));
    const spreadsStyle = /\.\.\.templateStyleState,/.test(block);
    for (const key of keysRead()) {
      if (spreadsStyle && new RegExp(`^\\s*${key}\\?:`, "m").test(styleType)) continue;
      expect(block, `${file}'s preview omits customization.${key} — the saved card will show it, the preview won't`)
        .toMatch(new RegExp(`\\b${key}[,:]`));
    }
  });
});
