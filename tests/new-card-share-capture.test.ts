import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Owner, 2026-11-09: "the second i make a card and send it out the preview is
// always messed up." Both "Your card is live!" screens offer Share link the
// moment the card exists, and neither captured the card, so the first link
// always unfurled as the server-drawn stand-in. Each must mount the capture.
const read = (p: string) => readFileSync(p, "utf8");

describe("a just-made card is captured on the screen that offers to share it", () => {
  it("the new-card wizard's done step", () => {
    const s = read("src/app/cards/new/NewCardWizard.tsx");
    const done = s.slice(s.indexOf("{step === 5 && ("), s.indexOf("Go to my dashboard"));
    expect(done).toMatch(/<ShareButton[^>]*ownCard/);
    expect(done).toContain("<NewCardShareCapture username={createdUsername} />");
  });

  it("/welcome's card-is-live step", () => {
    const s = read("src/components/WelcomePlan.tsx");
    expect(s).toMatch(/<ShareButton url=\{liveUrl\}[^>]*ownCard \/>\s*\{\/\*[^*]*\*\/\}\s*<NewCardShareCapture username=\{cardSlug\} \/>/);
  });

  it("captures the card as its public page builds it, for its owner only", () => {
    const r = read("src/app/api/card-share-image/source/route.ts");
    expect(r).toContain("getOwnerUsernames(user.id)");
    expect(r).toMatch(/if \(!owned\.includes\(username\)\) return NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\)/);
    expect(r).toContain("buildCardData(");
    expect(r).toContain("isPro: isPaidPlan(plan)");
    const c = read("src/components/NewCardShareCapture.tsx");
    expect(c).toContain("<ShareCardCapture");
    expect(c).toContain("username={slug}");
  });
});
