import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 9 (2026-10-16): speed and the 1,000-row cap ─────────────────
//
// P-03  /card/<u> paid a serverless render (a cold start, ~2 s blank) just to
//       308, and the card's metadata re-ran the plan-limit query outside the
//       cache. P-06  /contacts read every lead in one select, so past 1,000 the
//       rest vanished from the list. I-01  The two OAuth token exchanges had no
//       timeout. (P-01, the 2.4 MB homepage, was fixed by 129d12e5: 204 KB
//       measured live 2026-10-16. The CRM calls themselves were bounded by
//       ddf2a79a's lib/crm-http.)

const read = (p: string) => readFileSync(p, "utf8");

describe("P-03: a legacy /card/ link redirects at the edge", () => {
  const config = read("next.config.ts");

  it("is a redirects() rule, permanent, one segment (the opengraph image keeps serving)", () => {
    expect(config).toMatch(/\{\s*source: "\/card\/:username",\s*destination: "\/:username",\s*permanent: true,\s*\}/);
    expect(config).not.toMatch(/source: "\/card\/:username\*"/);
    expect(read("src/app/card/[username]/opengraph-image.tsx")).toContain("ImageResponse");
  });

  it("the card's metadata uses the cached plan-limit answer, not a second query", () => {
    const meta = read("src/lib/resolve-card.ts");
    expect(meta).toContain("const { cardRow, cardOwner: owner, profileRow, awaitingPlan, withinLimit } = await getCardPageData(username);");
    expect(meta).toContain("if (cardRow && !withinLimit) return null;");
    expect(meta).not.toMatch(/cardWithinPlanLimit\(/);
  });
});

describe("P-06: every contact is on the Contacts list", () => {
  const page = read("src/app/contacts/page.tsx");

  it("pages through the database's 1,000-row limit with a stable order", () => {
    expect(page).toMatch(/\.order\("name", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\)\s*\.range\(p \* LEADS_PAGE, p \* LEADS_PAGE \+ LEADS_PAGE - 1\)/);
    expect(page).toContain("if ((res.data ?? []).length < LEADS_PAGE) break;");
    expect(page).not.toMatch(/admin\.from\("leads"\)\.select\(cols\)\.in\("card_owner", allUsernames\)\.order\("name", \{ ascending: true \}\);/);
  });
});

describe("I-01: no provider call can hang a function", () => {
  it.each([
    "src/app/api/integrations/google/callback/route.ts",
    "src/app/api/integrations/salesforce/callback/route.ts",
  ])("%s bounds its token exchange and treats no answer as a failed connect", (f) => {
    const src = read(f);
    expect(src).toContain("signal: AbortSignal.timeout(CRM_CALL_TIMEOUT_MS),");
    expect(src).toMatch(/\}\)\.catch\(/);
    expect(src).toMatch(/if \(!tokenRes(?: \|\| !tokenRes\.ok)?\) (?:\{\s*)?return DONE\("error"\)/);
  });
});
