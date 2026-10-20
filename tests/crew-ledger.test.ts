import { describe, expect, it } from "vitest";
import { propose } from "@/lib/crew/approvals";
import { decide } from "@/lib/crew/decide";
import { emailsIn, normalizeHandle, personFor } from "@/lib/crew/ledger";
import { fakeAgent, setup } from "./crew-helpers";

// The hard rule from the meeting: never DM, or draft a DM to, anyone we have
// already replied to or contacted, on any platform, by any team.

describe("handles normalize to one person", () => {
  it("reddit, instagram, linkedin and email variants collapse", () => {
    expect(normalizeHandle("reddit", "https://www.reddit.com/user/Jane_Doe/")).toBe("u/jane_doe");
    expect(normalizeHandle("reddit", "u/Jane_Doe")).toBe("u/jane_doe");
    expect(normalizeHandle("reddit", "/u/jane_doe")).toBe("u/jane_doe");
    expect(normalizeHandle("instagram", "https://instagram.com/Some.Realtor?igsh=x")).toBe("@some.realtor");
    expect(normalizeHandle("instagram", "@some.realtor")).toBe("@some.realtor");
    expect(normalizeHandle("linkedin", "https://www.linkedin.com/in/Jane-Doe-123/")).toBe("in/jane-doe-123");
    expect(normalizeHandle("email", "Jane+promo@Example.com")).toBe("jane@example.com");
  });
  it("finds public emails and drops junk", () => {
    expect(emailsIn("Call or email jane@acme-realty.com. Logo: logo@2x.png noreply@acme.com")).toEqual(["jane@acme-realty.com"]);
  });
});

describe("the DM rule", () => {
  const dmAgent = fakeAgent({ id: "dm-agent", team: "contact", approvalKind: "dm" });

  it("refuses a DM to someone a reply was approved for (cross-team)", async () => {
    const { store, ctx } = await setup();
    const r = await propose(ctx, { kind: "reply", title: "t", summary: "s", body: "a helpful reply", platform: "reddit", targetUrl: "https://reddit.com/r/x/1", person: { platform: "reddit", handle: "u/jane" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await decide(store, r.id, { action: "approve", by: "owner" });

    await store.patchAgentState("dm-agent", { enabled: true });
    const { buildContext } = await import("@/lib/crew/context");
    const dmCtx = await buildContext({ def: dmAgent, store, providers: { claude: null, critic: null }, runId: null });
    const dm = await propose(dmCtx, { kind: "dm", title: "t", summary: "s", body: "hey", person: { platform: "reddit", handle: "https://reddit.com/user/Jane" } });
    expect(dm).toEqual({ ok: false, reason: "already contacted" });
  });

  it("one person gets at most one DM draft, even from two agents at once", async () => {
    const { store, ctx } = await setup({ def: dmAgent });
    const [a, b] = await Promise.all([
      propose(ctx, { kind: "dm", title: "t", summary: "s", body: "hey one", person: { platform: "instagram", handle: "@pro" } }),
      propose(ctx, { kind: "dm", title: "t", summary: "s", body: "hey two", person: { platform: "instagram", handle: "instagram.com/pro" } }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(store.approvals.filter((x) => x.status === "pending")).toHaveLength(1);
  });

  it("a rejected DM draft frees the person again; a posted one never does", async () => {
    const { store, ctx } = await setup({ def: dmAgent });
    const first = await propose(ctx, { kind: "dm", title: "t", summary: "s", body: "hey", person: { platform: "linkedin", handle: "in/sam" } });
    if (!first.ok) throw new Error("expected a draft");
    await decide(store, first.id, { action: "reject", reason: "too salesy", by: "owner" });
    const second = await propose(ctx, { kind: "dm", title: "t", summary: "s", body: "hey again", person: { platform: "linkedin", handle: "in/sam" } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await decide(store, second.id, { action: "approve", by: "owner" });
    await decide(store, second.id, { action: "posted", by: "owner" });
    const third = await propose(ctx, { kind: "dm", title: "t", summary: "s", body: "third", person: { platform: "linkedin", handle: "in/sam" } });
    expect(third).toEqual({ ok: false, reason: "already contacted" });
    const pid = await personFor(store, "linkedin", "in/sam");
    expect((await store.touchesFor(pid!)).map((t) => t.kind)).toEqual(["dm_sent"]);
  });

  it("being on a lead list is not contact", async () => {
    const { store, ctx } = await setup({ def: dmAgent });
    const pid = await personFor(store, "email", "lead@biz.com");
    await store.addTouch(pid!, "email", "lead_listed", null);
    const r = await propose(ctx, { kind: "dm", title: "t", summary: "s", body: "hi", person: { platform: "email", handle: "lead@biz.com" } });
    expect(r.ok).toBe(true);
  });
});

describe("one reply per thread, backpressure", () => {
  it("a thread is answered once", async () => {
    const { ctx } = await setup();
    const p = { kind: "reply" as const, title: "t", summary: "s", body: "b", platform: "reddit" as const, targetUrl: "https://reddit.com/r/a/1" };
    expect((await propose(ctx, p)).ok).toBe(true);
    expect(await propose(ctx, p)).toEqual({ ok: false, reason: "already answered that thread" });
  });
  it("an agent with a full inbox stops drafting", async () => {
    const { ctx } = await setup({ def: fakeAgent({ maxPending: 2 }) });
    for (let i = 0; i < 2; i++) expect((await propose(ctx, { kind: "reply", title: "t", summary: "s", body: "b", platform: "reddit", targetUrl: `https://r/${i}` })).ok).toBe(true);
    expect(await propose(ctx, { kind: "reply", title: "t", summary: "s", body: "b", platform: "reddit", targetUrl: "https://r/9" })).toEqual({ ok: false, reason: "inbox full" });
  });
});
