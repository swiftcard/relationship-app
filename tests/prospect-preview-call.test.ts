import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CALL_OUTCOMES, callBrief, outcomeEffect } from "@/lib/prospect-preview/call";
import { parsePreviewFields } from "@/lib/prospect-preview/input";
import { followUps } from "@/lib/prospect-preview/pipeline";
import { BUYER_ROLES } from "@/lib/prospect-preview/types";

// Card Builder, part 4 (2026-11-11): only for buyers, and the Call screen's brief.

const form = (over: Record<string, unknown> = {}) => {
  const base: Record<string, unknown> = { office_name: "Harbor Realty Group", owner_name: "Dana Whitfield", phone: "(212) 555-0199", buyer_role: "broker_owner", ...over };
  return (k: string) => base[k];
};

describe("a preview is only ever built for someone who can buy for the office", () => {
  it("the four roles, and no value for an individual agent", () => {
    expect([...BUYER_ROLES]).toEqual(["broker_owner", "managing_broker", "team_lead", "branch_manager"]);
  });

  it("is refused without one of them, on create, save and publish alike", () => {
    for (const bad of [undefined, "", "agent", "loan_officer", "realtor", "owner"]) {
      expect(parsePreviewFields(form({ buyer_role: bad }))).toMatchObject({ ok: false, error: expect.stringMatching(/person in charge of the team or office/) });
    }
    for (const role of BUYER_ROLES) expect(parsePreviewFields(form({ buyer_role: role })).ok).toBe(true);
    // One parser stands in front of all three writes.
    const route = readFileSync("src/app/api/admin/card-builder/[id]/route.ts", "utf8");
    expect(route).toMatch(/case "save":\s*case "publish": \{\s*const parsed = parsePreviewFields/);
    expect(readFileSync("src/lib/prospect-preview/input.ts", "utf8")).toMatch(/export function parsePreviewForm[\s\S]*const fields = parsePreviewFields\(get\)/);
    expect(readFileSync("supabase/prospect-previews-call.sql", "utf8")).toContain("buyer_role in ('broker_owner', 'managing_broker', 'team_lead', 'branch_manager')");
  });

  it("reads the reason, team size and detail, and refuses a team size that isn't a number of people", () => {
    const got = parsePreviewFields(form({ buyer_reason: " Owner and Broker of Record per About page ", team_size: "14", detail: "your new listing on Hicks Street" }));
    expect(got.ok && got.value).toMatchObject({ buyer_role: "broker_owner", buyer_reason: "Owner and Broker of Record per About page", team_size: 14, detail: "your new listing on Hicks Street" });
    expect(parsePreviewFields(form({ team_size: "" })).ok).toBe(true);
    for (const bad of ["0", "-3", "2.5", "lots"]) expect(parsePreviewFields(form({ team_size: bad })).ok).toBe(false);
  });
});

describe("the brief", () => {
  const p = {
    owner_name: "Dana Whitfield", office_name: "Harbor Realty Group", buyer_role: "managing_broker" as const,
    buyer_reason: "Named Managing Broker on the brokerage's team page", team_size: 14, detail: "you cover Park Slope and Windsor Terrace",
    views: 2, team_strip_scrolled: true, sent_at: "2026-11-10T15:00:00Z",
  };

  it("says why they decide, how big the team is, and opens with what they did", () => {
    const b = callBrief(p, { sender: "Menash Harooni" });
    expect(b.whyBuyer).toBe("Managing broker: Named Managing Broker on the brokerage's team page.");
    expect(b.teamSize).toBe(14);
    expect(b.opener).toBe("Hi Dana, it's Menash, the founder of SwiftCard. I sent you the card I made for you and the team at Harbor Realty Group. I noticed you cover Park Slope and Windsor Terrace. Did the team's cards look right to you?");
    expect(callBrief({ ...p, team_strip_scrolled: false }, { sender: null }).opener).toMatch(/it's the founder of SwiftCard\..* Did you get a chance to look at it\?$/);
  });

  it("has answers to exactly two objections, uses the team size, and never quotes a price", () => {
    const b = callBrief(p, { sender: "Menash" });
    expect(b.objections.map((o) => o.they)).toEqual(["We already have business cards.", "I'm busy, just send me some information."]);
    expect(b.objections[0].you).toContain("That's how I knew to call: you opened yours.");
    expect(b.objections[1].you).toContain("all 14 of you live");
    expect(JSON.stringify(b)).not.toMatch(/\$\d|per month|\/mo\b|free trial|discount/i);
  });

  it("states nothing that wasn't recorded", () => {
    const b = callBrief({ ...p, buyer_role: null, buyer_reason: null, team_size: null, detail: null, views: 0, team_strip_scrolled: false, sent_at: null }, { sender: "Menash" });
    expect(b.whyBuyer).toBeNull();
    expect(b.teamSize).toBeNull();
    expect(b.opener).toBe("Hi Dana, it's Menash, the founder of SwiftCard. I made a digital business card for you and the team at Harbor Realty Group. Do you have two minutes?");
    expect(b.objections[0].you).not.toContain("you opened yours");
    expect(b.objections[1].you).toContain("your whole team live");
  });
});

describe("logging how the call went", () => {
  it("a ring-out or voicemail is a try, not a conversation; the rest count as reached; three of them end the chase", () => {
    expect(CALL_OUTCOMES).toEqual(["no_answer", "voicemail", "reached", "meeting_booked", "won", "lost"]);
    expect(outcomeEffect("no_answer")).toEqual({ called: null, stage: undefined });
    expect(outcomeEffect("voicemail")).toEqual({ called: null, stage: undefined });
    expect(outcomeEffect("reached")).toEqual({ called: true, stage: null });
    for (const o of ["meeting_booked", "won", "lost"] as const) expect(outcomeEffect(o)).toEqual({ called: true, stage: o });
  });

  it("someone who viewed and got a voicemail stays on the follow-up list, with the last try named", () => {
    const now = Date.parse("2026-11-11T15:00:00Z");
    const [f] = followUps([{
      id: "p1", status: "live", stage: null, called: false, called_at: null, views: 1, last_viewed_at: "2026-11-10T15:00:00Z", sent_at: null, asked_at: null,
      expires_at: "2026-11-20T00:00:00Z", updated_at: "2026-11-10T15:00:00Z", call_outcome: "voicemail", call_outcome_at: "2026-11-10T16:00:00Z",
    }], now);
    expect(f).toMatchObject({ kind: "viewed_not_reached", why: "Viewed yesterday, not reached yet. Left a voicemail today.", next: "Try again." });
  });

  it("the Call screen's page checks the admin itself and the buttons are plain forms", () => {
    expect(readFileSync("src/app/admin/card-builder/call/[id]/page.tsx", "utf8")).toMatch(/const admin = await requireAdmin\(\);\s*if \(!admin\) notFound\(\)/);
    const view = readFileSync("src/app/admin/card-builder/call/[id]/CallView.tsx", "utf8");
    expect(view).toContain('<input type="hidden" name="action" value="outcome" />');
    expect(view).toContain("data-call");
  });
});
