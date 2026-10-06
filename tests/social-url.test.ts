import { describe, it, expect } from "vitest";
import { socialUrl, normalizeSocial, handleLabel } from "@/lib/social-url";

describe("socialUrl", () => {
  it("passes a full URL through unchanged", () => {
    expect(socialUrl("instagram", "https://instagram.com/aaron")).toBe("https://instagram.com/aaron");
  });

  it("builds a profile URL from a bare handle per platform", () => {
    expect(socialUrl("instagram", "aaron")).toBe("https://instagram.com/aaron");
    expect(socialUrl("instagram", "@aaron")).toBe("https://instagram.com/aaron");
    expect(socialUrl("twitter", "aaron")).toBe("https://x.com/aaron");
    expect(socialUrl("tiktok", "aaron")).toBe("https://tiktok.com/@aaron");
    expect(socialUrl("snapchat", "aaron")).toBe("https://snapchat.com/add/aaron");
    expect(socialUrl("youtube", "aaron")).toBe("https://youtube.com/@aaron");
  });

  it("defaults a bare LinkedIn handle to /in/ but respects explicit prefixes", () => {
    expect(socialUrl("linkedin", "aaron")).toBe("https://linkedin.com/in/aaron");
    expect(socialUrl("linkedin", "company/malve")).toBe("https://linkedin.com/company/malve");
  });

  it("keeps an older YouTube channel path a path, not an @handle", () => {
    // The box shows "youtube.com/@", which invites typing the rest of an
    // older address; youtube.com/@channel/UC… is a 404.
    expect(socialUrl("youtube", "c/AlexMorganHomes")).toBe("https://youtube.com/c/AlexMorganHomes");
    expect(socialUrl("youtube", "channel/UC1234")).toBe("https://youtube.com/channel/UC1234");
    expect(socialUrl("youtube", "user/alexmorgan")).toBe("https://youtube.com/user/alexmorgan");
    expect(socialUrl("youtube", "@alexmorgan")).toBe("https://youtube.com/@alexmorgan");
    // A handle that merely starts with those letters is still a handle.
    expect(socialUrl("youtube", "cooking")).toBe("https://youtube.com/@cooking");
  });

  it("only treats a website value with a dot as a URL", () => {
    expect(socialUrl("website", "malvecapital.com")).toBe("https://malvecapital.com");
    expect(socialUrl("website", "not-a-domain")).toBeNull();
  });

  it("returns null for empty/nullish input", () => {
    expect(socialUrl("instagram", "")).toBeNull();
    expect(socialUrl("instagram", null)).toBeNull();
    expect(socialUrl("instagram", "   ")).toBeNull();
  });
});

describe("normalizeSocial", () => {
  it("reduces a handle-style network to @handle", () => {
    expect(normalizeSocial("https://instagram.com/aaron", "instagram")).toBe("@aaron");
    expect(normalizeSocial("aaron", "instagram")).toBe("@aaron");
    expect(normalizeSocial("@aaron", "instagram")).toBe("@aaron");
  });

  it("keeps the path for URL-style networks", () => {
    expect(normalizeSocial("https://linkedin.com/in/aaron", "linkedin")).toBe("linkedin.com/in/aaron");
    expect(normalizeSocial("https://youtube.com/@chan", "youtube")).toBe("youtube.com/@chan");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeSocial("   ", "instagram")).toBe("");
  });

  // 2026-09-22 signup review: "Sam Builder" typed into Instagram was stored
  // as "@Sam Builder" and built instagram.com/Sam%20Builder — a dead link.
  it("closes spaces in one-word handle networks, at save and at render", () => {
    for (const p of ["instagram", "tiktok", "twitter", "snapchat"]) {
      expect(normalizeSocial("Sam Builder", p), p).toBe("@SamBuilder");
    }
    expect(socialUrl("instagram", "@Sam Builder")).toBe("https://instagram.com/SamBuilder");
    expect(socialUrl("tiktok", "Sam Builder")).toBe("https://tiktok.com/@SamBuilder");
    expect(socialUrl("youtube", "My Channel")).toBe("https://youtube.com/@MyChannel");
    // LinkedIn / Facebook keep their hyphenated-name rule.
    expect(socialUrl("linkedin", "John Doe")).toBe("https://linkedin.com/in/john-doe");
    // An unspaced handle is untouched.
    expect(normalizeSocial("@aaron", "instagram")).toBe("@aaron");
  });
});

// The user-reported LinkedIn breakage: a pasted URL must stay linkable, and a
// spaced name must never produce an invalid URL on the published card.
describe("LinkedIn linkability — every stored shape builds a working URL", () => {
  it("accepts a full pasted profile URL (with or without www / trailing slash)", () => {
    expect(socialUrl("linkedin", "https://www.linkedin.com/in/aaron-lavi")).toBe("https://www.linkedin.com/in/aaron-lavi");
    expect(normalizeSocial("https://www.linkedin.com/in/aaron-lavi/", "linkedin")).toBe("linkedin.com/in/aaron-lavi");
    // 2026-10-05: a short link left the box as linkedin.com/<code>, which opens
    // nothing; a sub-page keeps only the profile; old /pub/ paths stay whole.
    expect(normalizeSocial("https://lnkd.in/gAbC123", "linkedin")).toBe("https://lnkd.in/gAbC123");
    expect(normalizeSocial("lnkd.in/gAbC123", "linkedin")).toBe("https://lnkd.in/gAbC123");
    expect(normalizeSocial("https://www.linkedin.com/in/aaron-lavi/overlay/contact-info/", "linkedin")).toBe("linkedin.com/in/aaron-lavi");
    expect(normalizeSocial("https://www.linkedin.com/company/acme/about/", "linkedin")).toBe("linkedin.com/company/acme");
    expect(normalizeSocial("https://www.linkedin.com/pub/aaron-lavi/1a/2b3/4c5", "linkedin")).toBe("linkedin.com/pub/aaron-lavi/1a/2b3/4c5");
    expect(socialUrl("linkedin", "linkedin.com/in/aaron-lavi")).toBe("https://linkedin.com/in/aaron-lavi");
  });

  it("converts a spaced name to the hyphenated handle instead of an invalid URL", () => {
    expect(normalizeSocial("John Doe", "linkedin")).toBe("linkedin.com/in/john-doe");
    expect(socialUrl("linkedin", "John Doe")).toBe("https://linkedin.com/in/john-doe");
  });

  it("never emits a raw space, and never double-encodes an already-encoded value", () => {
    const spaced = socialUrl("linkedin", "linkedin.com/in/John Doe");
    expect(spaced).not.toMatch(/\s/);
    expect(socialUrl("linkedin", "https://linkedin.com/in/John%20Doe")).toBe("https://linkedin.com/in/John%20Doe");
  });

  it("URL-normalizes a pasted URL whose path carries a space", () => {
    expect(normalizeSocial("https://www.linkedin.com/in/John Doe", "linkedin")).toBe("linkedin.com/in/John%20Doe");
  });
});

describe("handleLabel", () => {
  it("strips the scheme for display", () => {
    expect(handleLabel("https://instagram.com/aaron")).toBe("instagram.com/aaron");
    expect(handleLabel(null)).toBe("");
  });
});
