import { describe, it, expect } from "vitest";
import {
  callFirstLine, checkOpeners, checkOpenerText, ogTitle, openAlertText, openerFacts, openerMessage, openerText, passesSwapTest,
  rankOpeners, readOpeners, revealsOpen, scoreTotal, talkingPoints, type OpenerCandidate,
} from "@/lib/prospect-preview/opener";
import type { ProspectPreview, Specific } from "@/lib/prospect-preview/types";

// ── Card Builder: the opening text (owner, 2026-11-16) ──────────────────────
// "The opening text is the most important part of the whole system. If it
// sounds generic, nobody taps." Every rule the owner wrote is pinned here.

const spec = (text: string, extra: Partial<Specific> = {}): Specific => ({ kind: "listing", text, source_url: "https://harborrealty.com/x", dated: "2026-11-10", uncertain: false, ...extra });

const P: Pick<ProspectPreview, "owner_name" | "office_name" | "owner_title" | "address" | "specialty" | "team_members" | "team_size" | "specifics" | "sources" | "phone" | "current_tool" | "hook_why" | "warm_path" | "outreach"> = {
  owner_name: "Dana Whitfield", office_name: "Harbor Realty Group", owner_title: "Owner & Principal Broker",
  address: "12 Middle Neck Rd, Great Neck, NY 11021", specialty: "North Shore homes since 2009",
  team_members: [{ name: "Marcus Lee", title: "Associate Broker" }], team_size: 14,
  specifics: [
    spec("Listed 41 Cedar Ln, Great Neck, a 4-bedroom colonial, at $1.6M"),
    spec("212 reviews on Zillow, 4.9 stars", { kind: "other" }),
    spec("Sold 9 Plandome Rd, Manhasset, in October", { kind: "sale" }),
    spec("Former name: Whitfield Homes", { kind: "other", quiet: true }),
  ],
  sources: { team_size: { url: "https://harborrealty.com/team", uncertain: false, note: "" } },
  phone: "(516) 555-0101", current_tool: null, hook_why: null, warm_path: null, outreach: null,
};
const ctx = { owner_name: P.owner_name, facts: openerFacts(P) };

const GOOD = {
  listing: "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a card that shows it off with your photo and your number. It's yours if you want it:",
  team: "Hi Dana, it's Menash. I put together cards for you and the 14 agents at Harbor Realty Group so everyone matches when they hand one out. Figured you'd want to see it:",
  reviews: "Hey Dana, Menash here. 212 reviews on Zillow is a lot to keep to yourself, so I made you a card that puts them right under your name. Figured you'd want to see it:",
  recent: "Hey Dana, Menash here. Saw the Plandome Rd sale in Manhasset last month, so I made you a card with that and your contact info on it. It's yours if you want it:",
  niche: "Hey Dana, Menash here. North Shore homes since 2009 is a good line, so I made you a card that leads with it, with your photo and number. Figured you'd want to see it:",
};
const cand = (hook: OpenerCandidate["hook"], text: string, uses: number | null, s = [8, 8, 8]): OpenerCandidate => ({ hook, text, uses, scores: { specificity: s[0], human: s[1], curiosity: s[2] } });
const FIVE = [cand("listing", GOOD.listing, 0, [9, 8, 9]), cand("team", GOOD.team, null, [8, 8, 7]), cand("reviews", GOOD.reviews, 1, [8, 7, 8]), cand("recent", GOOD.recent, 2, [8, 8, 7]), cand("niche", GOOD.niche, null, [6, 7, 6])];

describe("one opener: the owner's rules", () => {
  it.each(Object.entries(GOOD).filter(([k]) => k !== "niche"))("a good one passes (%s)", (_, text) => {
    expect(checkOpenerText(text, ctx)).toEqual([]);
  });

  it("starts 'Hey <First>, Menash here.' because they don't have his number", () => {
    expect(checkOpenerText(GOOD.listing.replace("Hey Dana, Menash here.", "Hi there, this is Menash."), ctx).join(" ")).toMatch(/Start with "Hey Dana, Menash here\."/);
    expect(checkOpenerText(GOOD.listing.replace("Dana", "Mike"), ctx).join(" ")).toMatch(/Start with/);
  });

  it.each([
    ["reaching out", "Hey Dana, Menash here. I'm reaching out because I saw your listing on Cedar Ln in Great Neck and made you a card that shows it off. It's yours if you want it:"],
    ["hope this finds you well", "Hey Dana, Menash here. Hope this finds you well. Saw your listing on Cedar Ln in Great Neck, so I made you a card that shows it off. It's yours if you want it:"],
    ["quick question", "Hey Dana, Menash here. Quick question: saw your listing on Cedar Ln in Great Neck, so I made you a card that shows it off. Want it? It's yours:"],
    ["platform", "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a card on our platform that shows it off. It's yours if you want it:"],
    ["solution", "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a card, a simple solution that shows it off. It's yours if you want it:"],
    ["boost", "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a card to boost it with your photo and number. It's yours if you want it:"],
    ["elevate", "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a card to elevate it with your photo and number. It's yours if you want it:"],
    ["#1", "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a card from the #1 card maker with your photo and number. It's yours if you want it:"],
    ["a price", "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a free card that shows it off with your photo and number. It's yours if you want it:"],
    ["tracking", "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a card that shows it off and tells you who views it. It's yours if you want it:"],
    ["tracking", "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a card with tracking built in and your photo on it. It's yours if you want it:"],
    ["the company name", "Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck, so I made you a SwiftCard that shows it off with your photo and number. It's yours if you want it:"],
  ])("never says %s", (what, text) => {
    expect(checkOpenerText(text, ctx).join(" ")).toContain(`It says ${what}`);
  });

  it("no emojis, no exclamation marks, no generic compliment", () => {
    expect(checkOpenerText(GOOD.listing.replace("It's yours", "🏡 It's yours"), ctx)).toContain("No emojis.");
    expect(checkOpenerText(GOOD.listing.replace("want it:", "want it!"), ctx).join(" ")).toMatch(/exclamation/);
    expect(checkOpenerText("Hey Dana, Menash here. Your listings look impressive and so does Cedar Ln in Great Neck, so I made you a card with your photo. It's yours if you want it:", ctx).join(" ")).toMatch(/compliment/);
  });

  it("the link is never in the words: it goes alone on the last line", () => {
    expect(checkOpenerText(GOOD.listing.replace("want it:", "want it: swiftcard.me/p/harbor"), ctx).join(" ")).toMatch(/Leave the link out/);
    const msg = openerMessage(GOOD.listing, "https://swiftcard.me/p/harbor-realty-k3x9");
    expect(msg.split("\n")).toEqual([GOOD.listing, "https://swiftcard.me/p/harbor-realty-k3x9"]);
  });

  it("2–3 short sentences, about 150–220 characters", () => {
    expect(checkOpenerText("Hey Dana, Menash here. Made you a card for Cedar Ln in Great Neck.", ctx).join(" ")).toMatch(/characters.*|sentence/);
    const long = `${GOOD.listing} ${"It has your photo, your number and your email on it. ".repeat(2)}`;
    expect(checkOpenerText(long, ctx).join(" ")).toMatch(/characters/);
  });

  it("says he made them a card", () => {
    expect(checkOpenerText("Hey Dana, Menash here. Saw your listing on Cedar Ln in Great Neck and thought of you and your photo and your number today. Figured you'd want to know about it:", ctx).join(" ")).toMatch(/made them a card/);
  });

  it("never invents a fact: a number or a name that isn't in their facts is refused", () => {
    expect(checkOpenerText(GOOD.listing.replace("Cedar Ln", "Maple Ave"), ctx).join(" ")).toMatch(/names Maple.*in their verified facts/);
    expect(checkOpenerText(GOOD.team.replace("14", "20"), ctx).join(" ")).toMatch(/says 20, which isn't in their verified facts/);
    expect(checkOpenerText(GOOD.reviews.replace("212", "300"), ctx).join(" ")).toMatch(/says 300/);
  });

  it("never quotes a quiet fact, and never a number flagged as possibly stale", () => {
    expect(openerFacts(P).join(" ")).not.toContain("Whitfield Homes");
    expect(checkOpenerText(GOOD.team, { ...ctx, stale: ["14"] }).join(" ")).toMatch(/flagged as possibly out of date/);
  });
});

describe("the swap test", () => {
  const about = { specifics: P.specifics, team_size: 14, office_name: P.office_name, warm_name: null };
  it("passes when it names the street, the number or the place from its own fact", () => {
    expect(passesSwapTest(FIVE[0], about)).toBe(true);
    expect(passesSwapTest(FIVE[1], about)).toBe(true);
    expect(passesSwapTest(FIVE[2], about)).toBe(true);
  });
  it("fails when it would still make sense sent to someone else", () => {
    expect(passesSwapTest(cand("listing", "Hey Dana, Menash here. Saw one of your listings, so I made you a card that shows it off with your photo and number. It's yours if you want it:", 0), about)).toBe(false);
  });
});

describe("five openers, scored", () => {
  it("the best total is the default and the runner-up the alternate", () => {
    const o = rankOpeners(FIVE, new Date("2026-11-16T12:00:00Z"));
    expect(o.pick).toBe(0);
    expect(scoreTotal(o.candidates[o.pick])).toBe(26);
    expect(o.alt).toBe(1);
    expect(openerText(o)).toBe(GOOD.listing);
    expect(openerText({ ...o, edited: "my words" })).toBe("my words");
  });

  it("a clean set of five passes", () => {
    const o = rankOpeners(FIVE.slice(0, 4));
    expect(checkOpeners(o, P)).toEqual([]);
  });

  it("each takes a different hook, at least three, at most five", () => {
    expect(checkOpeners(rankOpeners([FIVE[0], FIVE[0], FIVE[2]]), P).join(" ")).toMatch(/same hook/);
    expect(checkOpeners(rankOpeners(FIVE.slice(0, 2)), P).join(" ")).toMatch(/Write 5/);
  });

  it("each is built on a verified, quotable specific", () => {
    const bad = rankOpeners([{ ...FIVE[0], uses: 3 }, FIVE[1], FIVE[2]]);
    expect(checkOpeners(bad, P).join(" ")).toMatch(/don't quote/);
    const unverified = { ...P, specifics: P.specifics.map((s, i) => (i === 0 ? { ...s, uncertain: true } : s)) };
    expect(checkOpeners(rankOpeners(FIVE.slice(0, 3)), unverified).join(" ")).toMatch(/isn't verified/);
  });

  it("refuses the set when even the best isn't good enough to send", () => {
    const weak = FIVE.slice(0, 3).map((c) => ({ ...c, scores: { specificity: 6, human: 6, curiosity: 6 } }));
    expect(checkOpeners(rankOpeners(weak), P).join(" ")).toMatch(/none is good enough/);
  });

  it("reads back what was stored, and drops anything malformed", () => {
    const o = readOpeners({ candidates: [...FIVE, { hook: "nonsense", text: "x", scores: {} }], pick: 2, alt: 2 });
    expect(o?.candidates).toHaveLength(5);
    expect(o?.pick).toBe(2);
    expect(o?.alt).not.toBe(2);
    expect(readOpeners(null)).toBeNull();
  });
});

describe("the call, and the alert text", () => {
  it("the first line never gives away that we saw them open it", () => {
    for (const t of ["Hi Dana, I saw you opened the card.", "Hey, you just opened it", "I noticed you were looking at the card", "Saw you checking it out right now"]) expect(revealsOpen(t)).toBe(true);
    expect(revealsOpen("Hi Dana, it's Menash. I texted you about your open house on Hicks St.")).toBe(false);
    const line = callFirstLine({ owner_name: "Dana Whitfield", outreach: { call_opener: "Hi Dana, saw you just opened the card!" } as ProspectPreview["outreach"] }, "your Cedar Ln listing");
    expect(revealsOpen(line)).toBe(false);
    expect(line).toContain("Cedar Ln");
  });

  it("three talking points, the opener's own fact first, never a quiet one", () => {
    const pts = talkingPoints(P, 2);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toContain("Plandome Rd");
    expect(pts.join(" ")).not.toContain("Whitfield Homes");
  });

  it("the text to the owner: who, the number to tap, what they got, what to say", () => {
    const o = rankOpeners(FIVE.slice(0, 4));
    const text = openAlertText({ ...P, openers: o }, { sentText: openerMessage(GOOD.listing, "https://swiftcard.me/p/x") });
    expect(text).toMatch(/^Dana Whitfield \(Harbor Realty Group\) is looking at the card now\./);
    expect(text).toContain("Call: 5165550101");
    expect(text).toContain(`They got: "${GOOD.listing}"`);
    expect(text).toMatch(/Talk about:\n1\. Listed 41 Cedar Ln/);
    expect(text).toMatch(/Open with: "Hi Dana, it's Menash\./);
    expect(revealsOpen(text.split("Open with:")[1])).toBe(false);
  });
});

it("the link preview's title says the card is theirs", () => {
  expect(ogTitle("Dana Whitfield")).toBe("Dana's card, made for you");
});
