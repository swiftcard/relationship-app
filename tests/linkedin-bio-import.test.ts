import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tidyBioLocally, parseTidyBio, LINKEDIN_BIO_SHORT } from "@/lib/linkedin-bio";

// "Use LinkedIn bio" (2026-09-30) — the small blue link under every personal Bio
// box. LinkedIn gives apps no access to a member's About, so it is a paste that
// gets shortened, never an import. Pinned here: where it appears, that it can't
// submit the card form, that it never dead-ends, and that it stays a paste.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const COMPONENT = read("src/components/LinkedInBioImport.tsx");
const code = COMPONENT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("it sits under every personal Bio box", () => {
  it.each([
    "src/app/cards/[id]/edit/CardEditForm.tsx",
    "src/app/cards/new/NewCardWizard.tsx",
  ])("%s — and not when the company sets the bio", (f) => {
    expect(read(f)).toMatch(/\{!bioManaged && \(\s*<LinkedInBioImport/);
  });

  it("the homepage SwiftLink builder, outside the Bio label", () => {
    expect(read("src/components/site/SwiftLinkMiniBuilder.tsx")).toMatch(/below=\{<LinkedInBioImport tone="site"/);
    expect(read("src/components/site/BuilderFields.tsx")).toMatch(/below \? <div>\{field\}\{below\}<\/div> : field/);
  });

  it("not on the team bio — that's the company's words, not a person's About", () => {
    expect(read("src/components/OfficeLinksBranding.tsx")).not.toContain("LinkedInBioImport");
  });
});

describe("the component", () => {
  it("is labelled exactly as the owner asked", () => {
    expect(COMPONENT).toContain("Use LinkedIn bio");
  });

  it("can never submit the card form it renders inside", () => {
    expect(code).not.toMatch(/<form/);
    const buttons = code.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toContain('type="button"');
  });

  it("falls back to the local cleanup when the AI answer doesn't come", () => {
    expect(code).toMatch(/fetch\("\/api\/ai\/tidy-bio"/);
    expect(code).toMatch(/return local;/);
  });

  it("stays a paste — it never asks LinkedIn for the About", () => {
    expect(code).not.toMatch(/api\.linkedin\.com|\/api\/integrations\/linkedin/);
  });
});

describe("the route", () => {
  const route = read("src/app/api/ai/tidy-bio/route.ts");
  it("honours the AI notice, caps spend, and never calls the model for a visitor in the app", () => {
    expect(route).toContain("aiConsentBlock(user.id, req)");
    expect(route).toMatch(/isRateLimited\(`tidy-bio:\$\{user\.id\}`/);
    expect(route).toMatch(/isRateLimited\(`tidy-bio:ip:\$\{clientIp\(req\)\}`/);
    expect(route).toMatch(/if \(isShellRequest\(req\)\) return/);
    expect(route).toMatch(/text\.length > 3000/);
    // A scrap of text made the model invent a whole bio (seen on production).
    expect(route).toMatch(/text\.length < 120/);
  });
});

describe("tidyBioLocally", () => {
  it("leaves a short About as it was, minus the heading, bullets and hashtags", () => {
    expect(tidyBioLocally("About\n\n• Realtor in Austin helping first-time buyers. #realestate #austin\n"))
      .toBe("Realtor in Austin helping first-time buyers.");
  });

  it("joins lines into one paragraph", () => {
    expect(tidyBioLocally("Founder at Morgan & Co\nHelping brands grow")).toBe("Founder at Morgan & Co. Helping brands grow");
  });

  it("cuts a long About at a sentence end, never mid-word", () => {
    const long = "I help first-time buyers in Austin find a home they love. ".repeat(12);
    const out = tidyBioLocally(long);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith(".")).toBe(true);
  });

  it("ends a long run-on with an ellipsis at a word boundary", () => {
    const out = tidyBioLocally("word ".repeat(120));
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out).toMatch(/word…$/);
  });

  it("a short paste skips the AI entirely", () => {
    expect(tidyBioLocally("Austin realtor.").length).toBeLessThanOrEqual(LINKEDIN_BIO_SHORT);
  });
});

describe("parseTidyBio", () => {
  it("takes a plausible bio", () => {
    expect(parseTidyBio('{"bio": "Austin realtor helping first-time buyers find a home."}'))
      .toBe("Austin realtor helping first-time buyers find a home.");
  });
  it("rejects junk, empties and essays", () => {
    expect(parseTidyBio(null)).toBeNull();
    expect(parseTidyBio("not json")).toBeNull();
    expect(parseTidyBio('{"bio": ""}')).toBeNull();
    expect(parseTidyBio(JSON.stringify({ bio: "x".repeat(500) }))).toBeNull();
  });
});
