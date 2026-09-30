import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { linkedInPhotoCandidates, SMALL_PHOTO_PX } from "../src/lib/linkedin-photo";

// 2026-09-30, owner: "is there an easier way to pull up LinkedIn profiles
// instead of logging in and putting all our information?" and "the picture it
// pulls back from LinkedIn is extremely blurry". Two answers, pinned here.

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

describe("the no-typing path: a screenshot of your profile fills the builder", () => {
  const route = read("src/app/api/profile-import/route.ts");
  const button = read("src/components/ProfileImportButton.tsx");
  const wizard = read("src/app/cards/new/NewCardWizard.tsx");

  it("is open to guests and Free accounts, rate-limited by account or IP", () => {
    expect(route).not.toMatch(/isPaidPlan/);
    expect(route).not.toMatch(/status: 401/);
    expect(route).toMatch(/`profile-import:\$\{user\.id\}` : `profile-import:ip:\$\{clientIp\(request\)\}`/);
  });

  it("signed-in users still pass the AI consent gate (App Review)", () => {
    expect(route).toMatch(/if \(user\) \{\s*const consentBlocked = await aiConsentBlock\(user\.id, request\)/);
  });

  it("asks for the profile's OWN details and returns only sanitised strings", () => {
    expect(route).toMatch(/never the viewer's account/);
    expect(route).toMatch(/\.replace\(\/\\s\+\/g, " "\)\.trim\(\)\.slice\(0, 120\)/);
  });

  it("the button reuses the scanner's image compressor and never shows a machine code", () => {
    expect(button).toMatch(/import \{ compressToBase64 \} from "@\/lib\/scan-card"/);
    expect(read("src/lib/scan-card.ts")).toMatch(/export async function compressToBase64/);
    expect(button).toMatch(/data\.message \|\| "Couldn't read that screenshot/);
    // Hidden for a signed-out guest inside the iOS shell.
    expect(button).toMatch(/if \(native && guest\) return null/);
  });

  it("sits at the top of the builder's first step and fills the right boxes", () => {
    const step1 = wizard.indexOf("only your name is required");
    const btn = wizard.indexOf("<ProfileImportButton");
    const about = wizard.indexOf('<FormSection id="about"');
    expect(btn).toBeGreaterThan(step1);
    expect(btn).toBeLessThan(about);
    // A team member's company half belongs to the organization.
    expect(wizard).toMatch(/if \(!org\) \{\s*if \(f\.company\) setCompany\(f\.company\)/);
    // A found name clears the "name is required" error.
    expect(wizard).toMatch(/if \(f\.name\) \{ setName\(f\.name\); setNameMissing\(false\); setError\(""\); \}/);
  });

  it("the knowledge base can explain it", () => {
    expect(read("src/lib/knowledge/docs/cards.ts")).toMatch(/Skip the typing/);
  });
});
