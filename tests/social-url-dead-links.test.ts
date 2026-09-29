import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { socialUrl, socialDestination } from "@/lib/social-url";

// ── A LinkedIn button that opens nothing ─────────────────────────────────────
//
// REPORTED 2026-09-08: "for some of our users LinkedIn isn't working."
//
// Reproduced. Two things a person very plausibly types produced a link that
// looks right in the editor and 404s when a visitor taps it:
//
//   "/in/johndoe"          → https://linkedin.com/in//in/johndoe
//   "linkedin/in/johndoe"  → https://linkedin.com/in/linkedin/in/johndoe
//
// The first is what you get by selecting the PATH out of the address bar —
// linkedin.com/in/johndoe minus the domain — which is a completely ordinary way
// to copy "your LinkedIn". The second is typing the site name without ".com".
// normalizeSocial() lets both through untouched (neither contains "://" or a
// dot), so the bad value is what gets stored, and socialUrl() then pastes it
// after its own "/in/" prefix.
//
// Fixed in socialUrl rather than normalizeSocial on purpose: socialUrl is the
// single choke point every consumer renders through (card page, Swift Links,
// vCard, email signature), so the repair also covers the rows already sitting
// in the database with a broken handle — no migration, no re-save by the user.
//
// The leading-slash case is not LinkedIn-specific; the same paste breaks every
// platform, so the guard is generic.

describe("a stored handle can never build a dead link", () => {
  it("a pasted path fragment still resolves (the reported LinkedIn failure)", () => {
    expect(socialUrl("linkedin", "/in/johndoe")).toBe("https://linkedin.com/in/johndoe");
    expect(socialUrl("linkedin", "//in/johndoe")).toBe("https://linkedin.com/in/johndoe");
  });

  it("the site name typed without .com still resolves", () => {
    expect(socialUrl("linkedin", "linkedin/in/johndoe")).toBe("https://linkedin.com/in/johndoe");
    expect(socialUrl("linkedin", "linkedin/company/acme")).toBe("https://linkedin.com/company/acme");
  });

  it("no built URL ever contains a double slash in its path", () => {
    const inputs = ["/in/johndoe", "//johndoe", "/johndoe", "linkedin/in/johndoe", "/company/acme"];
    for (const platform of ["linkedin", "instagram", "twitter", "facebook", "tiktok", "youtube"]) {
      for (const raw of inputs) {
        const url = socialUrl(platform, raw);
        if (!url) continue;
        const path = url.replace(/^https:\/\/[^/]+/, "");
        expect(path.includes("//"), `${platform} "${raw}" → ${url}`).toBe(false);
      }
    }
  });

  it("a leading slash never survives into the handle on any platform", () => {
    expect(socialUrl("instagram", "/johndoe")).toBe("https://instagram.com/johndoe");
    expect(socialUrl("twitter", "/johndoe")).toBe("https://x.com/johndoe");
    expect(socialUrl("facebook", "/johndoe")).toBe("https://facebook.com/johndoe");
    expect(socialUrl("tiktok", "/johndoe")).toBe("https://tiktok.com/@johndoe");
  });

  // ── everything that already worked must keep working ───────────────────────
  it("leaves the ordinary inputs exactly as they were", () => {
    expect(socialUrl("linkedin", "johndoe")).toBe("https://linkedin.com/in/johndoe");
    expect(socialUrl("linkedin", "@johndoe")).toBe("https://linkedin.com/in/johndoe");
    expect(socialUrl("linkedin", "in/johndoe")).toBe("https://linkedin.com/in/johndoe");
    expect(socialUrl("linkedin", "company/acme-corp")).toBe("https://linkedin.com/company/acme-corp");
    expect(socialUrl("linkedin", "linkedin.com/in/johndoe")).toBe("https://linkedin.com/in/johndoe");
    expect(socialUrl("linkedin", "www.linkedin.com/in/johndoe")).toBe("https://www.linkedin.com/in/johndoe");
    expect(socialUrl("linkedin", "John Doe")).toBe("https://linkedin.com/in/john-doe");
    // A full URL is always passed through untouched.
    expect(socialUrl("linkedin", "https://www.linkedin.com/in/john-doe-1a2b/?utm_source=share"))
      .toBe("https://www.linkedin.com/in/john-doe-1a2b/?utm_source=share");
    expect(socialUrl("linkedin", "https://lnkd.in/abc123")).toBe("https://lnkd.in/abc123");
  });

  it("still returns null for nothing at all", () => {
    expect(socialUrl("linkedin", "@")).toBeNull();
    expect(socialUrl("linkedin", "/")).toBeNull();
    expect(socialUrl("linkedin", "  ")).toBeNull();
    expect(socialUrl("linkedin", null)).toBeNull();
  });
});

// ── The editor must SAY where the link goes ──────────────────────────────────
//
// The second half of the same report. "Open link" sat above the field and told
// you nothing until you clicked it, and nobody clicks it while typing — so a
// wrong handle stayed invisible until a visitor hit the 404. Both the card
// editor and the new-card wizard now print the resolved destination under the
// field, which also exposes the guesses ("John Doe" → linkedin.com/in/john-doe).
describe("the editor shows the destination before it is saved", () => {
  it("socialDestination is the link a person can read", () => {
    expect(socialDestination("linkedin", "johndoe")).toBe("linkedin.com/in/johndoe");
    expect(socialDestination("linkedin", "John Doe")).toBe("linkedin.com/in/john-doe");
    expect(socialDestination("linkedin", "https://www.linkedin.com/in/johndoe")).toBe("www.linkedin.com/in/johndoe");
    expect(socialDestination("instagram", "@johndoe")).toBe("instagram.com/johndoe");
    expect(socialDestination("linkedin", "")).toBeNull();
    expect(socialDestination("linkedin", "@")).toBeNull();
  });

  it("every social editor renders the destination, not just an Open link", () => {
    // One row component for all of them since 2026-09-29 (SocialHandleField):
    // it prints where the value will open, and says so when it cannot link.
    const row = readFileSync(join(process.cwd(), "src/components/SocialHandleField.tsx"), "utf8");
    expect(row).toMatch(/socialDestination\(spec\.key, value\)/);
    expect(row).toMatch(/won&rsquo;t open as a link/);
    for (const f of ["src/app/cards/[id]/edit/CardEditForm.tsx", "src/app/cards/new/NewCardWizard.tsx", "src/components/site/BuilderFields.tsx", "src/components/OfficeLinksBranding.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, `${f} must use the shared social row`).toMatch(/<SocialHandleField\b/);
    }
  });
});
