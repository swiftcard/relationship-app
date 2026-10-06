import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// "Made with SwiftCard" reaches EVERY shared card and SwiftLink — every plan
// (owner decision 2026-08-11). It was Free-only before, and the two surfaces
// had even drifted apart, which read as a glitch from the outside. If a paid
// "remove branding" tier ever returns, re-gate BOTH and delete this file.
//
// MOVED 2026-08-13 (owner request): on the card page the blurb no longer sits
// at the bottom of the page. It renders inside the Save Contact section, under
// "Saved to Contacts!", replacing the blue "Create your free card" button that
// used to be there — the conversion moment rather than below the fold. The
// SwiftLinks footer attribution is a separate surface and did not move.
describe("the SwiftCard badge is universal", () => {
  const badge = code("src/components/MadeWithSwiftCard.tsx");
  const save = code("src/components/SaveContactButton.tsx");
  const page = code("src/app/[username]/page.tsx");

  it("the blurb is one shared component, not re-inlined per placement", () => {
    expect(badge).toMatch(/Made with/);
    expect(badge).toMatch(/Get yours free/);
    // Placements differ only in the ground they stand on.
    expect(badge).toMatch(/tone === "onWhite"/);
  });

  it("carries the REAL SwiftCard logo, not a hand-drawn bolt (owner, 2026-10-05)", () => {
    expect(badge).toMatch(/import \{ SwiftCardIcon \} from "@\/components\/SwiftCardLogo"/);
    expect(badge).toMatch(/<SwiftCardIcon size=\{20\} \/>/);
    expect(badge, "the stand-in bolt is back").not.toMatch(/<polygon/);
  });

  it("card page: the blurb renders under Saved to Contacts, ungated by plan", () => {
    expect(save).toMatch(/<MadeWithSwiftCard/);
    // Inside the `saved &&` block — it is the post-save invite.
    const savedBlock = save.slice(save.indexOf("{saved && ("), save.indexOf("Conversion bottom sheet"));
    expect(savedBlock, "the blurb is not in the saved-state block").toMatch(/<MadeWithSwiftCard/);
    // No plan gate anywhere near it: the badge is universal.
    expect(savedBlock).not.toMatch(/isPaidPlan|ownerPaid/);
  });

  it("it is styled for the WHITE section card it now sits in, not the cream page", () => {
    // A white pill on a white card is invisible — the move required this.
    const savedBlock = save.slice(save.indexOf("{saved && ("), save.indexOf("Conversion bottom sheet"));
    expect(savedBlock).toMatch(/tone="onWhite"/);
  });

  it("at the conversion moment it routes into the BUILDER, not the marketing page", () => {
    // It replaced a button that went straight to /cards/new; sending this slot
    // to the home page instead would quietly lengthen its own funnel.
    const savedBlock = save.slice(save.indexOf("{saved && ("), save.indexOf("Conversion bottom sheet"));
    expect(savedBlock).toMatch(/href="\/cards\/new\?src=save_contact_cta"/);
    // Same as the header's "Get started free": no wipe on click — the builder
    // asks "Continue your card / Start a new card" itself (owner rule 2026-09-16).
    expect(savedBlock).not.toMatch(/resetGuestFlow\(\)/);
  });

  it("the old bottom-of-page copy is gone — one blurb per card, not two", () => {
    expect(page).not.toMatch(/Get yours free/);
    expect(page).not.toMatch(/src=badge/);
  });

  // Owner order 2026-09-02: on SWIFT LINKS pages the footer became Free-only —
  // paid plans drop it, because the top-left bolt badge (SwiftLinksPromoBadge)
  // now carries the invite on EVERY plan. The card-page blurb stays universal.
  it("SwiftLinks: the footer attribution renders only when brandingFooter allows it", () => {
    const c = code("src/components/SwiftLinkProfile.tsx");
    const at = c.indexOf("src=badge");
    expect(at).toBeGreaterThan(-1);
    const before = c.slice(Math.max(0, at - 400), at);
    expect(before).toMatch(/brandingFooter\s*&&/);
  });

  it("SwiftLinks page: the footer gate is the owner's PLAN, and the bolt badge is not gated", () => {
    const page = code("src/app/links/[username]/page.tsx");
    expect(page).toMatch(/brandingFooter=\{!ownerPaid\}/);
    // The corner badge invite shows on every plan — only embed/owner-view
    // context gates exist in the profile, never a plan check.
    const profile = code("src/components/SwiftLinkProfile.tsx");
    const badgeAt = profile.indexOf("<SwiftLinksPromoBadge");
    expect(badgeAt).toBeGreaterThan(-1);
    expect(profile.slice(Math.max(0, badgeAt - 200), badgeAt)).not.toMatch(/ownerPaid|paidTiles|verified/);
  });

  it("SwiftLinks preview mirrors the live rule (paid preview shows no footer)", () => {
    const preview = code("src/components/SwiftLinkLivePreview.tsx");
    expect(preview).toMatch(/brandingFooter=\{!paid\}/);
  });
});
