import { describe, expect, it } from "vitest";
import { debate, DEBATE_TOKEN_CAP } from "@/lib/crew/debate";
import { setup } from "./crew-helpers";

// The bounded argument: Claude drafts, ChatGPT checks, at most 2 revision
// rounds, then the manager (Opus) settles it.

const long = "x".repeat(400);

describe("debate", () => {
  it("agree on the first look: one critic call, no revision", async () => {
    const { ctx, critic } = await setup({ verdicts: ["agree"] });
    let revised = 0;
    const r = await debate(ctx, { kind: "reply", draft: long, brief: "b", rules: "r", revise: async () => (revised++, "new") });
    expect(r.record.outcome).toBe("agreed");
    expect(r.record.line).toMatch(/agreed/);
    expect(critic.calls).toHaveLength(1);
    expect(revised).toBe(0);
    expect(r.final).toBe(long);
  });

  it("revise then agree", async () => {
    const { ctx } = await setup({ verdicts: ["revise", "agree"] });
    const r = await debate(ctx, { kind: "dm", draft: long, brief: "b", rules: "r", revise: async () => "better draft" });
    expect(r.record.outcome).toBe("revised_agreed");
    expect(r.final).toBe("better draft");
  });

  it("still split after the last round: the manager on Opus settles it", async () => {
    const { ctx, claude, critic } = await setup({
      verdicts: ["revise"],
      script: (req) => (req.schema ? JSON.stringify({ choice: "merged", text: "settled text", why: "kept it short" }) : "rev"),
    });
    const r = await debate(ctx, { kind: "reply", draft: long, brief: "b", rules: "r", revise: async () => "rev" });
    expect(r.record.outcome).toBe("tiebreak");
    expect(r.final).toBe("settled text");
    expect(critic.calls).toHaveLength(3); // rounds 0, 1, 2
    expect(claude.calls.at(-1)!.model).toBe("claude-opus-5-5");
  });

  it("skips trivial and non-outward items", async () => {
    const { ctx, critic } = await setup();
    expect((await debate(ctx, { kind: "ask", draft: long, brief: "b", rules: "r", revise: async () => "" })).record.skipped).toBe(true);
    expect((await debate(ctx, { kind: "comment", draft: "short", brief: "b", rules: "r", score: 0.3, revise: async () => "" })).record.skipped).toBe(true);
    expect(critic.calls).toHaveLength(0);
  });

  it("a token cap ends a long argument early", async () => {
    const { ctx, critic } = await setup({ verdicts: ["revise"], script: (req) => (req.schema ? JSON.stringify({ choice: "last", text: "t", why: "w" }) : "r") });
    await debate(ctx, { kind: "reply", draft: long, brief: "b", rules: "r", revise: async () => "y".repeat(DEBATE_TOKEN_CAP * 4), tokenCap: DEBATE_TOKEN_CAP });
    expect(critic.calls.length).toBeLessThan(3);
  });

  it("with no ChatGPT key, a Claude skeptic pass stands in and says so", async () => {
    const { ctx, store } = await setup({ script: (req) => (req.schema ? JSON.stringify({ verdict: "agree", issues: [], score: 0.8 }) : "x") });
    const { buildContext } = await import("@/lib/crew/context");
    const { FakeClaude } = await import("@/lib/crew/llm/fake");
    const c2 = await buildContext({ def: ctx.def, store, providers: { claude: new FakeClaude((req) => (req.schema ? JSON.stringify({ verdict: "agree", issues: [], score: 0.8 }) : "x")), critic: null }, runId: null });
    const r = await debate(c2, { kind: "reply", draft: long, brief: "b", rules: "r", revise: async () => "" });
    expect(r.record.critic).toMatch(/ChatGPT not connected/);
    expect(r.record.outcome).toBe("agreed");
  });
});
