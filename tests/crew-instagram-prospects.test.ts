import { describe, expect, it } from "vitest";
import { instagramDms } from "@/lib/crew/agents/contact";
import { PROFILE_SCORE_SYSTEM, unsupportedClaims } from "@/lib/crew/agents/instagram-prospects";
import { FakeClaude } from "@/lib/crew/llm/fake";
import type { LlmRequest } from "@/lib/crew/llm/types";
import { MemoryStore } from "@/lib/crew/store-memory";
import { runAgent } from "@/lib/crew/tick";

// Instagram DMs (contact-instagram) finds PROFILES. These are real bios and
// the DMs it drafted for them before 2026-11-04 (crew_approvals, production),
// kept as fixtures: the honesty check must catch the guessed problems and let
// the grounded ones through.

const RECORDED = [
  {
    handle: "manhattanconcretenyc",
    bio: "Concrete contractor and Construction Management Contractor in New York City #safety #building #contractors #construction #remodeler. 1,730 followers, 97 following",
    dm: "your bio says concrete contractor and construction management in NYC, so I'm guessing quote requests land in your DMs and the number gets lost in the scroll. I built SwiftCard for that. One link in your bio with your past work and a way for people to leave their details, so they're saved for you. It's free to start. Where do most of your inquiries come from right now?",
    bad: true,
  },
  {
    handle: "td_landscaping",
    bio: "Landscape Design & Lawn Maintenance. Serving Westchester County, NY. Tdlandscapingny@gmail.com (914) 633-9754. 359 followers, 110 posts.",
    dm: "Saw your bio has the phone number and a gmail both typed right in there. Anyone who wants a quote has to screenshot it or retype it, and a lot of those people just never do. I built SwiftCard for exactly that, so one tap saves your details and your services sit on one link. It's free to start and takes a couple of minutes. Do most of your jobs come from Instagram or word of mouth?",
    bad: true,
  },
  {
    handle: "p3_reps",
    bio: "Manufacturer's Representative for Foodservice Manufactuers in the New York Metro area. 404 followers, 195 following, 475 posts.",
    dm: "Repping a handful of foodservice lines around the metro area means handing your number to a lot of buyers and chefs who lose the card by lunch. I built SwiftCard for exactly that. One tap or QR code gives them your details plus a link page for your website. Free to start, takes a couple of minutes. Do you still carry paper cards on sales calls?",
    bad: true,
  },
  {
    handle: "esmatherealtor",
    bio: "Luxury • Invest • Sell • Buy Multi-Million Dollar Dynamo. I work to guarantee your dream home or help you sell your current one. 2,878 followers, 202 posts.",
    dm: "your bio says you help people buy their dream home or sell the one they have, and that's two very different people landing on one profile. I built SwiftCard so a link in bio and a card can send each of them to the right place, and the details of anyone who shares them land in one list. It's free to start. Do your buyers or sellers usually reach out first?",
    bad: false,
  },
  {
    handle: "el_realtor_jose",
    bio: "Top 1% Realtor Who Actually Gives A Damn. 250+ Homes Sold since 2020. Husband & Girl Dad.",
    dm: "Jose, 250 homes since 2020 and a girl dad on top of it. 300 open houses means a lot of sign in sheets. I'm one of SwiftCard's founders; it drops those contacts into one list. Want me to make you a sample card?",
    bad: true,
  },
];

describe("Instagram DMs: the honesty check on recorded drafts", () => {
  for (const r of RECORDED) {
    it(`${r.handle}: ${r.bad ? "caught" : "passes"}`, () => {
      const problems = unsupportedClaims(r.dm, { title: `@${r.handle}`, text: r.bio });
      if (r.bad) expect(problems.length, problems.join("; ")).toBeGreaterThan(0);
      else expect(problems).toEqual([]);
    });
  }

  it("names what's wrong: a guess, personal life, a number that isn't in the bio", () => {
    const jose = RECORDED[4];
    const p = unsupportedClaims(jose.dm, { title: "", text: jose.bio });
    expect(p).toEqual(expect.arrayContaining(['brings up their personal life ("girl dad")', "says 300, which isn't in their profile"]));
    expect(unsupportedClaims("I use SwiftCard for my own link page.", { title: "", text: "Realtor" })).toEqual(["pretends to be a SwiftCard customer"]);
    expect(unsupportedClaims('Your line "actually gives a damn" stuck with me.', { title: "", text: jose.bio })).toEqual([]);
    expect(unsupportedClaims('Your line "best agent in Texas" stuck with me.', { title: "", text: jose.bio })).toEqual([expect.stringMatching(/quotes "best agent in Texas"/)]);
  });
});

describe("Instagram DMs: profiles scored as prospects", () => {
  it("scores with the profile rubric, drops a guessed DM, and never DMs someone with a comment waiting", async () => {
    const store = new MemoryStore();
    await store.patchAgentState("contact-instagram", { enabled: true });
    await store.setRateLimit("instagram", "dm", 10, "2026-01-01");
    // A comment for @busy.realtor's post is waiting in the Sheet.
    await store.insertApproval({ agent_id: "contact-instagram-linkinbio", team: "contact", kind: "comment", title: "t", summary: "s", body: "b", platform: "instagram", target_url: "https://www.instagram.com/p/C1/", meta: { author: "@busy.realtor" } });
    const profiles = [
      { url: "https://www.instagram.com/busy.realtor/", author: "busy.realtor", title: "Busy Realtor", text: "Realtor in Austin. Call 512 555 0101.", community: "" },
      { url: "https://www.instagram.com/esmatherealtor/", author: "esmatherealtor", title: "New York Real Estate Agent (@esmatherealtor)", text: RECORDED[3].bio, community: "" },
      { url: "https://www.instagram.com/manhattanconcretenyc/", author: "manhattanconcretenyc", title: "Manhattan Concrete", text: RECORDED[0].bio, community: "" },
    ];
    const prompts: LlmRequest[] = [];
    const claude = new FakeClaude((req) => {
      prompts.push(req);
      if (req.webSearch) return JSON.stringify({ items: profiles });
      if (req.schema && JSON.stringify(req.schema).includes("asks_for_tools")) {
        const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
        return JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ i, score: 0.8, why: '"Luxury • Invest • Sell • Buy" a working agent', angle: "buyers and sellers", asks_for_tools: false, business_pro: true })) });
      }
      // The concrete contractor's DM keeps guessing, even after the rewrite.
      return /manhattanconcretenyc|Concrete/.test(req.prompt) ? RECORDED[0].dm : RECORDED[3].dm;
    });
    await runAgent({ def: instagramDms, store, providers: { claude, critic: null } });
    const scoreCall = prompts.find((p) => p.schema && JSON.stringify(p.schema).includes("asks_for_tools"))!;
    expect(scoreCall.system).toBe(PROFILE_SCORE_SYSTEM);
    expect(scoreCall.prompt).not.toContain("busy.realtor");
    const dms = store.approvals.filter((a) => a.kind === "dm");
    expect(dms.map((a) => a.target_url)).toEqual(["https://www.instagram.com/esmatherealtor/"]);
    const [run] = await store.recentRuns("contact-instagram", 1);
    expect(run.stats).toMatchObject({ skipped_draft_waiting: 1, skipped_failed_own_check: 1 });
  });

  it("leaves a pasted Instagram post for the comment agent", async () => {
    const store = new MemoryStore();
    await store.patchAgentState("contact-instagram", { enabled: true });
    await store.addInput({ platform: "instagram", kind: "post", url: "https://www.instagram.com/p/DAbc123OpenH/", text: "@kayla.homes.denver open house recap, what do you use for sign in?" });
    await store.addInput({ platform: "instagram", kind: "profile", url: "https://www.instagram.com/denver.lender.mike/", text: "@denver.lender.mike Mortgage loan officer in Denver." });
    const claude = new FakeClaude((req) => (req.webSearch ? JSON.stringify({ items: [] }) : JSON.stringify({ items: [] })));
    await runAgent({ def: instagramDms, store, providers: { claude, critic: null } });
    expect(store.inputs.find((i) => i.url!.includes("/p/"))?.status).toBe("new");
    expect(store.inputs.find((i) => i.url!.includes("denver.lender.mike"))?.status).toBe("used");
  });
});
