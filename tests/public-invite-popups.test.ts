import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NUDGE_COPY, CARD_CTA } from "@/lib/referral";

// ── The two invites on a public page (owner, 2026-09-23) ────────────────────
// "If I'm in a user's SwiftLinks and I press on something, the thing that pops
// up … should be the exact same pop-up as what's in the icon on the top left."
// "On the pop-up that comes up for the SwiftCard link, the button should say
// 'See how yours looks - free' … make the design example card … much nicer
// and more realistic."

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("a Swift Links page has ONE invite", () => {
  const sheet = code("src/components/SwiftLinksPromoSheet.tsx");
  const badge = code("src/components/SwiftLinksPromoBadge.tsx");
  const host = code("src/components/SignupNudgeHost.tsx");

  it("the corner badge and every moment on the page render the same sheet", () => {
    expect(badge).toContain("<SwiftLinksPromoSheet");
    expect(host).toContain('if (variant === "links") {');
    expect(host).toContain("<SwiftLinksPromoSheet");
    expect(code("src/app/links/[username]/page.tsx")).toMatch(/<SignupNudgeHost cardUsername=\{[^}]+\} variant="links" \/>/);
    // The card page keeps the card invite.
    expect(code("src/app/[username]/page.tsx")).not.toMatch(/<SignupNudgeHost[^>]*variant="links"/);
  });

  it("the sheet's words and markup live in one file only, so they cannot drift", () => {
    expect(sheet).toContain("Create your own Swift Links");
    expect(sheet).toContain("See how yours looks — free");
    expect(sheet).toContain("Explore more about SwiftCard");
    for (const other of [badge, host]) {
      expect(other).not.toContain("Create your own Swift Links</h2>");
      expect(other).not.toContain("Comes with a SwiftCard and Swift Signature");
    }
  });

  it("closes on ✕, a tap outside and Escape; the mockup's motion is actually defined", () => {
    expect(sheet).toContain('aria-label="Dismiss"');
    expect(sheet).toContain("if (e.target === e.currentTarget) dismiss();");
    expect(sheet).toContain('if (e.key === "Escape") dismiss();');
    expect(sheet).toContain("@keyframes sc-lbp-float");
    expect(sheet).toContain("@keyframes sc-lbp-twinkle");
  });

  it("the moment-based invite keeps its own rules and attribution", () => {
    expect(host).toContain("const ctaHref = `/cards/new?src=${encodeURIComponent(source)}`;");
    expect(host).toContain('onCta={() => trackNudge(cardUsername, "nudge_cta_click", source)}');
    expect(badge).toContain('ctaHref="/cards/new?src=links_promo_badge"');
  });
});

describe("the SwiftCard invite", () => {
  it("every card invite's button says 'See how yours looks — free'", () => {
    expect(CARD_CTA).toBe("See how yours looks — free");
    for (const [key, copy] of Object.entries(NUDGE_COPY)) expect(copy.cta, key).toBe(CARD_CTA);
  });

  it("shows a REAL card — the Portrait Pro template with a real headshot — not a drawn stand-in", () => {
    const ex = code("src/components/SignupCardExample.tsx");
    expect(ex).toContain("<PhotoFirst data={EXAMPLE} />");
    expect(ex).toContain('photoUrl: "/showcase/simone.jpg"');
    expect(existsSync(join(process.cwd(), "public/showcase/simone.jpg"))).toBe(true);
    // Owner, 2026-10-19: the headshot is circular (the template's own option).
    expect(ex).toContain('photoShape: "circle"');
    const host = code("src/components/SignupNudgeHost.tsx");
    expect(host).toContain('lazy(() => import("@/components/SignupCardExample"))');
    expect(host).not.toContain(">Your Name<");
    expect(host).not.toContain(">YOU<");
  });

  it("the example is warmed while idle, and never loaded on a Swift Links page", () => {
    const host = code("src/components/SignupNudgeHost.tsx");
    expect(host).toContain('if (variant !== "card" || native) return;');
    expect(host).toContain('void import("@/components/SignupCardExample");');
  });
});
