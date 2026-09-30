import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { linkedInPhotoCandidates, SMALL_PHOTO_PX } from "../src/lib/linkedin-photo";

// 2026-09-30, owner: "is there an easier way to pull up LinkedIn profiles
// instead of logging in and putting all our information?" and "the picture it
// pulls back from LinkedIn is extremely blurry". The photo answer is pinned here.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the LinkedIn photo: largest rendition first, enhanced when only the thumbnail comes back", () => {
  it("asks the CDN for 800, 400 and 200 before settling for the 100px thumbnail", () => {
    const thumb = "https://media.licdn.com/dms/image/v2/ABC/profile-displayphoto-shrink_100_100/0/1?e=1&v=beta&t=sig";
    expect(linkedInPhotoCandidates(thumb)).toEqual([
      thumb.replace("shrink_100_100", "shrink_800_800"),
      thumb.replace("shrink_100_100", "shrink_400_400"),
      thumb.replace("shrink_100_100", "shrink_200_200"),
      thumb,
    ]);
  });

  it("only tries sizes LARGER than the one given, and leaves an unknown URL alone", () => {
    const four = "https://media.licdn.com/x/profile-displayphoto-shrink_400_400/y";
    expect(linkedInPhotoCandidates(four)).toEqual([four.replace("400_400", "800_800"), four]);
    expect(linkedInPhotoCandidates("https://example.com/photo.jpg")).toEqual(["https://example.com/photo.jpg"]);
  });

  it("a thumbnail is upscaled with Lanczos and sharpened; a real photo is capped at 1000px as before", () => {
    const src = read("src/lib/linkedin-photo.ts");
    expect(SMALL_PHOTO_PX).toBe(300);
    expect(src).toMatch(/kernel: "lanczos3"/);
    expect(src).toMatch(/\.sharpen\(/);
    expect(src).toMatch(/resize\(1000, 1000, \{ fit: "inside", withoutEnlargement: true \}\)/);
  });

  it("both import paths use the one helper, so they can never disagree", () => {
    for (const f of ["src/app/api/integrations/linkedin/route.ts", "src/app/api/integrations/linkedin/callback/route.ts"]) {
      const src = read(f);
      expect(src, f).toMatch(/fetchLinkedInPhoto\(profile\.picture\)/);
      expect(src, f).not.toMatch(/resize\(1000, 1000/);
    }
    // The signed-in import says when LinkedIn only had the thumbnail…
    expect(read("src/app/api/integrations/linkedin/route.ts")).toMatch(/small: photo\.wasSmall/);
    // …and the suggester tells the owner, pointing at Adjust.
    const sug = read("src/components/ProfilePhotoSuggest.tsx");
    expect(sug).toMatch(/setSmallNote\(data\.small === true\)/);
    expect(sug).toMatch(/LinkedIn only shares a small version of your photo/);
  });

  it("any applied photo can be reframed with Adjust (imports never passed through the crop tool)", () => {
    const src = read("src/components/ImageUpload.tsx");
    expect(src).toMatch(/async function adjustCurrent\(\)/);
    expect(src).toMatch(/fetch\(preview, \{ mode: "cors" \}\)/);
    expect(src).toMatch(/>\s*Adjust\s*<\/button>/);
  });
});

// Owner, 2026-09-30 (later): "Use LinkedIn bio" had to connect to LinkedIn and
// fill the bio by itself, and the builder's "Skip the typing" screenshot step
// wasn't wanted. LinkedIn's sign-in (openid profile email) returns name, photo
// and email only — no app can read the About — so the paste-your-About panel
// was the most it could be, and the owner chose to remove both.
describe("no LinkedIn bio paste and no profile-screenshot import", () => {
  const gone = [
    "src/components/LinkedInBioImport.tsx",
    "src/lib/linkedin-bio.ts",
    "src/app/api/ai/tidy-bio/route.ts",
    "src/components/ProfileImportButton.tsx",
    "src/app/api/profile-import/route.ts",
  ];
  it.each(gone)("%s stays deleted", (p) => {
    expect(existsSync(join(process.cwd(), p))).toBe(false);
  });

  it("the Bio boxes and the builder's first step carry neither", () => {
    for (const p of [
      "src/app/cards/new/NewCardWizard.tsx",
      "src/app/cards/[id]/edit/CardEditForm.tsx",
      "src/components/site/SwiftLinkMiniBuilder.tsx",
    ]) {
      const src = read(p);
      expect(src, p).not.toMatch(/LinkedInBioImport|ProfileImportButton|Use LinkedIn bio|Skip the typing/);
    }
  });

  it("the assistant doesn't offer them", () => {
    const kb = read("src/lib/knowledge/docs/cards.ts");
    expect(kb).not.toMatch(/Use LinkedIn bio|Skip the typing|Import screenshot/);
  });
});
