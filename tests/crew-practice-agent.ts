import type { AgentDef } from "@/lib/crew/agent-def";
import { propose } from "@/lib/crew/approvals";
import { debate } from "@/lib/crew/debate";
import { productFacts } from "@/lib/crew/facts";
import { HUMAN_VOICE } from "@/lib/crew/voice";

// ── The practice agent (a test fixture since 2026-10-27, not registered) ──
// Proves the whole loop end to end with no platform account: it drafts one
// reply to a made-up forum post, runs it past the second opinion, checks the
// ledger and puts it in the inbox. Nothing it makes is ever posted anywhere;
// the fake person and URL are reserved for it.

export const TEST_POST = {
  url: "https://example.com/crew-test/thread-1",
  author: "crew-test-person",
  text: "Is there a cheap way to have a digital business card AND a link in bio page without paying for two apps? Linktree plus a card app is getting expensive.",
};

export const testAgent: AgentDef = {
  id: "system-test",
  name: "Test agent",
  team: "system",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "every", minutes: 60 * 24 },
  dailyUsd: 0.25,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: 1,
  purpose: "Makes one practice draft so you can see the inbox, the second opinion and the buttons work. It never posts anything.",
  approvalKind: "reply",
  async run(ctx) {
    const system = `${HUMAN_VOICE}\n\n${productFacts()}`;
    const url = `${TEST_POST.url}?run=${ctx.now().toISOString().slice(0, 10)}`;
    const first = await ctx.llm.ask("draft", {
      system,
      effort: "medium",
      maxTokens: 1200,
      prompt: `Write a forum reply (40 to 120 words) to this post. Mention SwiftCard only if it honestly fits.\n\nPOST:\n${TEST_POST.text}`,
    });
    if (first.refused || !first.text) return { summary: "The model declined to write the practice draft.", status: "skipped" };
    const { final, record } = await debate(ctx, {
      kind: "reply",
      draft: first.text,
      brief: `Practice reply to: ${TEST_POST.text}`,
      rules: `${HUMAN_VOICE}\n\n${productFacts()}`,
      revise: async (draft, issues) =>
        (
          await ctx.llm.ask("revise", {
            system,
            effort: "medium",
            maxTokens: 1200,
            prompt: `Rewrite this reply to fix these issues: ${issues.join("; ")}\n\nPOST:\n${TEST_POST.text}\n\nREPLY:\n${draft}`,
          })
        ).text,
    });
    const r = await propose(ctx, {
      kind: "reply",
      title: "Practice: a reply to a made-up post",
      summary: "This is a test. Nobody will see it. Tap Approve or Reject to see how the buttons work.",
      body: final,
      platform: "web",
      targetUrl: url,
      person: { platform: "web", handle: TEST_POST.author, name: "Test person" },
      debate: record,
      meta: { test: true, source_text: TEST_POST.text },
    });
    ctx.stat("practice_drafts", r.ok ? 1 : 0);
    return { summary: r.ok ? "Put one practice draft in the inbox." : `No draft: ${r.reason}.` };
  },
};
