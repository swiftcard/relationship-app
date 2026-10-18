import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ── Onboarding a real 15-person office ──────────────────────────────────────
//
// Every guard here comes from walking that flow end to end against a real
// 15-seat office (owner + 14 members) rather than from reading the code. The
// failures were not edge cases: they were what the customer's first day looks
// like.

describe("an admin can actually invite 14 people in one sitting", () => {
  const route = read("src/app/api/office/invite/route.ts");

  it("does not cap invites below a full office", () => {
    // 10 per 10 minutes meant the ELEVENTH invite failed with "Too many invites
    // sent — try again in a few minutes", no countdown, on a sliding window.
    // Onboarding 15 people is 14 invites; the product's core scenario could not
    // be completed.
    const cap = /isRateLimited\(`office-invite:\$\{user\.id\}`,\s*(\d+),/.exec(route);
    expect(cap, "the invite limiter moved — re-check the cap").toBeTruthy();
    expect(Number(cap![1]), "the cap blocks a normal 15-person onboarding").toBeGreaterThanOrEqual(20);
  });

  it("still has a limiter at all", () => {
    expect(route).toContain("isRateLimited(`office-invite:");
  });
});

describe("the invite email names a real person and a real company", () => {
  const route = read("src/app/api/office/invite/route.ts");

  it("never falls back to the word 'Your' as if it were a name", () => {
    // `(profile?.name ?? "Your team").split(" ")[0]` produced "Your invited you
    // to create your … card" for a null name, and "" for an empty one — and
    // EMPTY is the real default: verified against production, every account
    // created through normal signup has profiles.name = "".
    expect(route).not.toMatch(/\?\?\s*"Your team"/);
    // Nor any stand-in word: `|| "A colleague").split(" ")[0]` sent "A invited
    // you…". An unknown name is null and the builder words around it.
    expect(route).not.toContain('"A colleague"');
    expect(route).toMatch(/\.split\(\/\\s\+\/\)\[0\] \|\| null/);
  });

  it("names the person who SENT it, falling back to their CARD", () => {
    // An office admin can invite; the email named the owner while replies
    // went to the admin.
    expect(route).toContain("inviterCardName");
    expect(route).toMatch(/\.eq\("user_id", user\.id\)/);
    // Uses `||`, not `??` — an empty string is the case that has to be caught.
    expect(route).toMatch(/inviterProfile\?\.name as string \| null\) \|\| inviterCardName/);
  });

  it("never sends the placeholder office name to a recipient", () => {
    // offices.name is seeded from profiles.company, which is also empty, so it
    // became the literal string "My Office" — which appeared in the subject
    // line, the From header, the body and the accept page's H1.
    expect(route).toContain("officeCompanyName(");
    expect(read("src/lib/office-display-name.ts")).toMatch(/=== "My Office"/);
    expect(route).toContain('officeName: officeDisplayName');
  });
});

describe("the Team list shows people, not machine handles", () => {
  it("prefers the member's card name over the account handle", () => {
    // profiles.name is empty for real signups, so this fell through to
    // profiles.username — a generated handle like "dana-3f9a2c" — in the Team
    // list, the member drawer and the analytics table.
    const analytics = read("src/lib/office-analytics.ts");
    // (one ladder for every Office screen since audit F-OFFICE-01: card name,
    // then the invited name and address, then the handle)
    expect(analytics).toMatch(/name: \(prof\?\.name as string\)\s*\|\| \(slugs\[0\]\?\.name as string\)/);
  });

  it("falls back to the name the admin typed on the invite", () => {
    // A member who has not built a card yet has no card name. The admin typed
    // one when inviting; it was dropped the moment they accepted.
    const team = read("src/lib/office-team.ts");
    expect(team).toContain("invite_name");
    expect(team).toContain("displayName");
  });
});

describe("the owner cannot burn a seat by inviting themselves", () => {
  it("refuses the owner's own address", () => {
    // There was no guard. The join route blocks owning a DIFFERENT office but
    // lets the owner accept into their own, creating a member row that seat
    // accounting counts ON TOP of the hardcoded +1 for the owner. Remove is
    // gated on !isOwner, so the seat was unrecoverable from the UI.
    const route = read("src/app/api/office/invite/route.ts");
    expect(route).toContain("ownerEmails");
    expect(route).toMatch(/That's your own account/);
  });
});

describe("the branding page does not contradict itself", () => {
  const page = read("src/app/office/admin/branding/page.tsx");

  it("no longer claims the owner's own cards are rebranded", () => {
    // The owner is excluded in code twice (resolveBrandTargetIds and
    // propagateBrandToOfficeCards both skip ownerId), while the page said
    // "yours included" eight lines below "Your own cards stay yours to design".
    //
    // Checked against the RENDERED text: the phrase still appears in the
    // comment that records why it went, and a guard that fires on its own
    // explanation is a guard nobody can keep.
    const rendered = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "");
    expect(rendered).not.toContain("yours included");
  });

  it("says the true thing in both places", () => {
    expect(page).toContain("stay yours to design");
    // Whitespace-tolerant throughout: this asserts the PROMISE, and a reflow of
    // the paragraph (adding the Links-tab pointer moved the line breaks) must
    // not read as the promise being withdrawn.
    expect(page).toMatch(/Your\s+own\s+cards\s+are\s+yours/);
  });
});

describe("the admin console does not query per member", () => {
  const team = read("src/lib/office-team.ts");

  it("resolves last activity for the whole team in one pass", () => {
    // Two `limit 1` queries per member — 30 round-trips at 15 seats — made the
    // console take 2.4-5.8s to render, measured on a real 15-person office.
    // The cost grew with exactly the thing being sold.
    expect(team).toContain("ACTIVITY_SCAN_CAP");
    expect(team).toContain("newestBySlug");
    expect(team, "the per-member fan-out is back").not.toContain("...userIds.map((id) => lastActive(id))");
  });

  it("keeps lastActive a pure lookup, not an async call", () => {
    expect(team).toMatch(/const lastActive = \(uid: string\): string \| null =>/);
  });
});
