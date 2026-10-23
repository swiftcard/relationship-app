import { describe, expect, it } from "vitest";
import { buildContext } from "@/lib/crew/context";
import { FakeClaude } from "@/lib/crew/llm/fake";
import { CHAT_DAILY_LIMIT, answerOwner, canSend, parseOrders } from "@/lib/crew/manager-chat";
import { MODEL_ID } from "@/lib/crew/models";
import { MemoryStore } from "@/lib/crew/store-memory";
import { fakeAgent } from "./crew-helpers";

// Talking to a team manager. The model's orders are checked in code: only
// pause / resume one of its OWN team's agents, or set a short focus. Nothing
// from chat can switch an agent on, start a shift or create anything outward.

const NOW = () => new Date("2026-10-21T18:00:00Z"); // Wed 2pm New York

async function chatSetup(reply: unknown, settings: Record<string, unknown> = { economy: false }) {
  const store = new MemoryStore();
  await store.updateSettings(settings);
  const claude = new FakeClaude(() => JSON.stringify(reply));
  await store.addChat({ team: "replies", author: "owner", body: "Pause Reddit for today and focus on dentists" });
  const replyId = await store.addChat({ team: "replies", author: "manager", body: "", status: "pending" });
  const run = () => answerOwner({ store, providers: { claude, critic: null }, team: "replies", text: "Pause Reddit for today and focus on dentists", replyId, now: NOW });
  return { store, claude, replyId, run };
}

const order = (o: Record<string, unknown>) => ({ type: "", agent: "", until: "", text: "", days: 0, ...o });

describe("manager chat", () => {
  it("answers, applies its own team's orders and confirms each one", async () => {
    const { store, claude, replyId, run } = await chatSetup({
      reply: "Done. Maya is off Reddit until tonight, and the team will look for dentists.",
      orders: [
        order({ type: "pause_agent", agent: "replies-reddit", until: "end_of_day" }),
        order({ type: "set_focus", text: "Dentists and dental offices", days: 7 }),
        order({ type: "pause_agent", agent: "contact-reddit", until: "end_of_day" }), // another team's agent
        order({ type: "enable_agent", agent: "replies-threads" }), // not an order a manager has
      ],
    });
    await run();
    const msg = store.chat.find((m) => m.id === replyId)!;
    expect(msg).toMatchObject({ status: "done", body: "Done. Maya is off Reddit until tonight, and the team will look for dentists." });
    expect((await store.getAgentState("replies-reddit")).paused_until).toBe("2026-10-22T03:59:00.000Z");
    expect((await store.getAgentState("contact-reddit")).paused_until ?? null).toBeNull();
    expect((await store.getAgentState("replies-threads")).enabled).toBe(false);
    const team = (await store.listTeams()).find((t) => t.team === "replies")!;
    expect(team).toMatchObject({ focus: "Dentists and dental offices", focus_by: "Rachel" });
    expect(store.chat.filter((m) => m.author === "system").map((m) => m.body)).toEqual([
      "Done: Maya (Reddit replies) is paused until 11:59pm.",
      expect.stringMatching(/^Done: the team's focus is "Dentists and dental offices" until /),
    ]);
    // Opus outside economy mode, metered as the manager's "chat".
    expect(claude.calls[0].model).toBe(MODEL_ID.opus);
    expect(store.usage).toEqual([expect.objectContaining({ agent_id: "replies-manager", team: "replies", purpose: "chat" })]);
    // The brief has who is on the team, but never a draft's text.
    expect(claude.calls[0].prompt).toContain("Maya, Reddit replies (id replies-reddit)");
  });

  it("uses Sonnet in economy mode", async () => {
    const { claude, run } = await chatSetup({ reply: "All quiet.", orders: [] }, { economy: true });
    await run();
    expect(claude.calls[0].model).toBe(MODEL_ID.sonnet);
  });

  it("resume ends a pause but never puts an agent on the team", async () => {
    const { store, run } = await chatSetup({ reply: "Maya is back.", orders: [order({ type: "resume_agent", agent: "replies-reddit" })] });
    await store.patchAgentState("replies-reddit", { enabled: false, paused_until: "2099-12-31T00:00:00.000Z" });
    await run();
    expect(await store.getAgentState("replies-reddit")).toMatchObject({ enabled: false, paused_until: null });
  });

  it("with the whole office locked it answers without calling the model", async () => {
    const { store, claude, replyId, run } = await chatSetup({ reply: "x", orders: [] }, { kill_all: true });
    await run();
    expect(claude.calls).toHaveLength(0);
    expect(store.chat.find((m) => m.id === replyId)!.body).toMatch(/whole office is locked/);
  });

  it("a money limit becomes a failed message that says where to raise it", async () => {
    const { store, claude, replyId, run } = await chatSetup({ reply: "x", orders: [] }, { economy: false, daily_usd_cap: 0 });
    await run();
    expect(claude.calls).toHaveLength(0);
    expect(store.chat.find((m) => m.id === replyId)).toMatchObject({ status: "failed", body: expect.stringContaining("Settings → Money") });
  });

  it("checks every order: team, length, days, how many", () => {
    const long = "x".repeat(400);
    expect(parseOrders([order({ type: "set_focus", text: long, days: 99 })], "replies")).toEqual([{ type: "set_focus", text: "x".repeat(280), days: 14 }]);
    expect(parseOrders([order({ type: "pause_agent", agent: "leads-linkedin" })], "leads")).toEqual([]); // locked: not on any team
    expect(parseOrders([order({ type: "pause_agent", agent: "replies-manager" })], "replies")).toEqual([]); // managers aren't orderable
    expect(parseOrders(Array.from({ length: 9 }, () => order({ type: "clear_focus" })), "replies")).toHaveLength(5);
    expect(parseOrders("nonsense", "replies")).toEqual([]);
  });

  it("refuses an empty message, a double tap, and more than the daily limit", async () => {
    const store = new MemoryStore();
    store.clock = NOW;
    expect(await canSend(store, "replies", "  ", NOW())).toBe("Type a message first.");
    await store.addChat({ team: "replies", author: "owner", body: "How did today go?" });
    expect(await canSend(store, "replies", "How did today go?", new Date(NOW().getTime() + 5000))).toBe("Already sent.");
    expect(await canSend(store, "replies", "How did today go?", new Date(NOW().getTime() + 60_000))).toBeNull();
    for (let i = 1; i < CHAT_DAILY_LIMIT; i++) await store.addChat({ team: "replies", author: "owner", body: `m${i}` });
    expect(await canSend(store, "replies", "one more", NOW())).toMatch(/40 messages/);
    expect(await canSend(store, "contact", "one more", NOW())).toBeNull();
  });
});

describe("the team's focus reaches its agents", () => {
  it("is added to the prompt for search and drafting only, and the system text never changes", async () => {
    const store = new MemoryStore();
    const def = fakeAgent({ team: "replies" });
    await store.patchAgentState(def.id, { enabled: true });
    await store.patchTeam("replies", { focus: "Dentists only", focus_until: "2099-01-01T00:00:00Z" });
    const claude = new FakeClaude(() => "ok");
    const ctx = await buildContext({ def, store, providers: { claude, critic: null }, runId: null });
    expect(ctx.teamFocus).toBe("Dentists only");
    await ctx.llm.ask("draft", { system: "SYS", prompt: "P" });
    await ctx.llm.ask("report", { system: "SYS", prompt: "P" });
    expect(claude.calls[0].prompt).toContain("- Dentists only");
    expect(claude.calls[1].prompt).toBe("P");
    expect(claude.calls.map((c) => c.system)).toEqual(["SYS", "SYS"]);
  });

  it("an expired focus is dropped", async () => {
    const store = new MemoryStore();
    const def = fakeAgent({ team: "replies" });
    await store.patchTeam("replies", { focus: "Old", focus_until: "2020-01-01T00:00:00Z" });
    const ctx = await buildContext({ def, store, providers: { claude: null, critic: null }, runId: null });
    expect(ctx.teamFocus).toBeNull();
  });
});
