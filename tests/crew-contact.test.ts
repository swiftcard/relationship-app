import { describe, expect, it } from "vitest";
import { CONTACT, handleFromUrl, LINK_IN_BIO } from "@/lib/crew/agents/contact";
import { headAgent } from "@/lib/crew/agents/head";
import { buildContext } from "@/lib/crew/context";
import { decide } from "@/lib/crew/decide";
import { FakeClaude, FakeCritic } from "@/lib/crew/llm/fake";
import { AGENTS } from "@/lib/crew/registry";
import { propose } from "@/lib/crew/approvals";
import { runEngagement, type Candidate } from "@/lib/crew/replies/engine";
import { fakeAgent, setup } from "./crew-helpers";

// Phase 3, the Contact team and the head agent. The hard rule: nobody we have
// replied to or contacted, by any team on any platform, gets a DM draft.

const scoreAll = (req: { schema?: unknown; prompt: string }) => {
  if (req.schema && JSON.stringify(req.schema).includes("asks_for_tools")) {
    const n = (req.prompt.match(/^#\d+/gm) ?? []).length;
    return JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ i, score: 0.9, why: "Realtor asking for a link page", angle: "card plus link page", asks_for_tools: true, business_pro: i !== 1 })) });
  }
  return "Saw your open house post. If you ever want one link for your card and listings, SwiftCard does both.";
};

const cand = (author: string, o: Partial<Candidate> = {}): Candidate => ({ platform: "reddit", url: `https://www.reddit.com/r/realtors/comments/${author}/x/`, author, title: "good link in bio for realtors?", text: "linktree feels clunky", community: "realtors", promoAllowed: true, ...o });

describe("contact engine", () => {
  it("skips anyone a Replies agent already replied to, and anyone not a business pro", async () => {
    const { store, ctx } = await setup({ def: fakeAgent({ id: "replies-reddit" }), script: scoreAll });
    const reply = await propose(ctx, { kind: "reply", title: "t", summary: "s", body: "helpful", platform: "reddit", targetUrl: "https://r/1", person: { platform: "reddit", handle: "u/alreadyreplied" } });
    if (!reply.ok) throw new Error(reply.reason);
    await decide(store, reply.id, { action: "approve", by: "owner" });

    const dmDef = fakeAgent({ id: "contact-reddit", team: "contact", approvalKind: "dm", maxPending: 10 });
    await store.patchAgentState(dmDef.id, { enabled: true });
    await store.setRateLimit("reddit", "dm", 10, "2026-01-01");
    const dmCtx = await buildContext({ def: dmDef, store, providers: { claude: new FakeClaude(scoreAll), critic: new FakeCritic() }, runId: null });
    await runEngagement(dmCtx, {
      platform: "reddit", kind: "dm", action: "dm", ceiling: 10, mustBePro: true, register: "", length: "",
      label: (c) => `DM ${c.author}`,
      person: (c) => ({ platform: "reddit", handle: `u/${c.author}` }),
      find: async () => [cand("alreadyreplied"), cand("notapro"), cand("freshrealtor")],
    });
    const dms = store.approvals.filter((a) => a.kind === "dm");
    expect(dms.map((a) => a.title)).toEqual(["DM freshrealtor"]);
    expect(dms[0].body).toContain("(I work on SwiftCard, so I'm biased.)");
  });

  it("a DM with no identifiable person is never drafted (no wasted tokens)", async () => {
    const { ctx, claude, store } = await setup({ def: fakeAgent({ id: "contact-x", team: "contact", approvalKind: "dm" }), script: scoreAll });
    await store.setRateLimit("instagram", "dm", 10, "2026-01-01");
    await runEngagement(ctx, { platform: "instagram", kind: "dm", action: "dm", ceiling: 10, keywordFilter: false, register: "", length: "", label: () => "x", person: () => null, find: async () => [cand("x", { platform: "instagram" })] });
    expect(store.approvals).toHaveLength(0);
    expect(claude.calls.filter((c) => !c.schema)).toHaveLength(0); // scored, never drafted
  });
});

describe("helpers", () => {
  it("spots link-in-bio tools and profile handles", () => {
    expect(LINK_IN_BIO.test("Realtor | DM me | linktr.ee/janesells")).toBe(true);
    expect(LINK_IN_BIO.test("hoo.be/mike")).toBe(true);
    expect(LINK_IN_BIO.test("swiftcard.me/jane")).toBe(false);
    expect(handleFromUrl("instagram", "https://www.instagram.com/janesells/")).toBe("janesells");
    expect(handleFromUrl("instagram", "https://www.instagram.com/p/Cxyz/")).toBeNull();
    expect(handleFromUrl("linkedin", "https://www.linkedin.com/in/jane-doe-1/")).toBe("jane-doe-1");
  });
});

describe("head agent", () => {
  it("is built, on Fable 5.1, and needs two manager reports before it spends anything", async () => {
    expect(headAgent.tier).toBe("fable");
    const { ctx, claude } = await setup({ def: headAgent });
    const r = await headAgent.run(ctx);
    expect(r.status).toBe("skipped");
    expect(claude.calls).toHaveLength(0);
  });
});

describe("registry", () => {
  it("one Contact agent per platform from the spec, plus the link-in-bio switcher and a manager", () => {
    const ids = CONTACT.map((a) => a.id);
    expect(ids).toEqual(["contact-reddit", "contact-instagram", "contact-instagram-linkinbio", "contact-linkedin", "contact-alignable"]);
    expect(AGENTS.some((a) => a.id === "contact-manager")).toBe(true);
    for (const a of CONTACT) expect(["dm", "connect_note"]).toContain(a.approvalKind);
  });
});
