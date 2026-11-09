import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHero, heroPictureUrl } from "@/lib/swiftlink-looks";

// Owner, 2026-11-09: "Upload photo or video" in the Swift Links Page header is
// perfect — the picture fills the compact circle and the cover photo, and the
// page takes its colour from it. Picking "Logo" (or Auto/Headshot on a card
// with no headshot, which fall back to the logo) shrank the same logo onto a
// white plate in the circle and an indigo panel in the cover, and Photo match
// ignored it, so the page stayed plain white. And "Initials" sat on one fixed
// indigo gradient on every Look.
//
// Decisions: a logo works EXACTLY like an upload, for every logo; initials are
// drawn in the page's own Look colours. The render half of this guarantee is
// tests/render/swiftlink-hero-logo-initials.test.ts, which measures it.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("heroPictureUrl — the header picture, logo included", () => {
  it("is the picture for a headshot, an upload and the logo", () => {
    expect(heroPictureUrl(resolveHero(undefined, "https://p", "https://l"))).toBe("https://p");
    expect(heroPictureUrl(resolveHero({ heroContent: "custom", heroImage: "https://c" }, null, "https://l"))).toBe("https://c");
    // The logo — picked, or reached by Auto / Headshot with no headshot.
    expect(heroPictureUrl(resolveHero({ heroContent: "logo" }, "https://p", "https://l"))).toBe("https://l");
    expect(heroPictureUrl(resolveHero(undefined, null, "https://l"))).toBe("https://l");
    expect(heroPictureUrl(resolveHero({ heroContent: "photo" }, null, "https://l"))).toBe("https://l");
  });
  it("is null where there is no still picture: initials and a video", () => {
    expect(heroPictureUrl(resolveHero({ heroContent: "initials" }, "https://p", "https://l"))).toBeNull();
    expect(heroPictureUrl(resolveHero(undefined, null, null))).toBeNull();
    expect(heroPictureUrl(resolveHero({ heroContent: "custom", heroImage: "https://v", heroMediaType: "video" }, null, null))).toBeNull();
  });
});

describe("Photo match reads the logo, on every surface that reads a colour", () => {
  // Three places decide which picture the page colour comes from. If any one
  // goes back to `kind === "photo"`, that surface paints a logo page plain
  // Paper while the others paint it the logo's colour.
  it("the public page, on the server", () => {
    const page = read("src/app/links/[username]/page.tsx");
    expect(page).toMatch(/const heroForTone = heroPictureUrl\(resolveHero\(/);
    expect(page).toMatch(/getPhotoTone\(heroForTone\)/);
    expect(page).not.toMatch(/heroForTone\.kind === "photo"/);
  });
  it("the page itself, in the editor previews", () => {
    const profile = read("src/components/SwiftLinkProfile.tsx");
    expect(profile).toMatch(/usePhotoTone\(matchOn && photoTone === undefined \? heroPicture : null\)/);
    expect(profile).toMatch(/const tone = !matchOn \|\| !heroPicture \? null/);
    expect(profile).not.toMatch(/hero\.kind !== "photo"/);
  });
  it("the design panel's Default swatches", () => {
    const design = read("src/components/SwiftLinkDesign.tsx");
    expect(design).toMatch(/usePhotoTone\(matchOn \? heroPictureUrl\(hero\) : null\)/);
  });
});

describe("the logo draws through the upload's own element", () => {
  const profile = read("src/components/SwiftLinkProfile.tsx");
  it("cover / banner: the same full-bleed object-cover <img> as an upload", () => {
    expect(profile).toMatch(
      /\) : heroPicture \?[\s\S]{0,900}?<img src=\{heroPicture\} alt=\{name\} className=\{`absolute inset-0 w-full h-full object-cover \$\{heroBanner \? "object-top" : ""\}`\} \/>/,
    );
  });
  it("compact circle: the same circle-cropped object-cover <img> as an upload", () => {
    expect(profile).toMatch(/\) : heroPicture \? \([\s\S]{0,120}?<img src=\{heroPicture\} alt=\{name\} className="w-full h-full object-cover" \/>/);
  });
  it("no logo-only treatment is left: no white plate, no contained logo, no indigo panel", () => {
    expect(profile).not.toMatch(/hero\.kind === "logo"/);
    expect(profile).not.toMatch(/bg-white flex items-center justify-center p-3\.5/);
    expect(profile).not.toMatch(/max-w-full max-h-full w-auto h-auto object-contain/);
    expect(profile).not.toContain("#181538");
    expect(profile).not.toContain("#4338ca");
  });
});

describe("initials are drawn in the page's own colours", () => {
  const profile = read("src/components/SwiftLinkProfile.tsx");
  it("the tile is built from the surface the page is using", () => {
    expect(profile).toMatch(/const initialsTile = bgMedia\s*\n\s*\? "transparent"\s*\n\s*: glassOn\s*\n\s*\? sheetMeet\s*\n\s*: `linear-gradient\(180deg, \$\{pageStyle\?\.bg \? sheetBg : look\.tile\} 0%, \$\{sheetBg\} 100%\)`/);
    expect(profile).toMatch(/style=\{\{ background: initialsTile \}\}/);
    expect(profile).toMatch(/style=\{\{ background: initialsCircle \}\}/);
  });
  it("the initials are in the page's text colour — never a hard-coded white", () => {
    const tiles = profile.split("data-sl-initials").slice(1);
    expect(tiles).toHaveLength(2);
    for (const t of tiles) {
      const span = t.slice(0, 700);
      expect(span).toMatch(/color: textColor/);
      expect(span).not.toMatch(/text-white/);
    }
  });
});
