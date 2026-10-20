import { BudgetStop } from "./budget";
import { parseJson, type AgentContext } from "./context";
import { MODEL_ID } from "./models";
import type { ApprovalKind, DebateRecord, DebateTurn } from "./types";

// ── Claude drafts, ChatGPT pushes back, they settle it, then we decide ──────
// Bounded on purpose:
//   round 0  the worker (Sonnet, the cheapest model that gets approved) drafts
//   critique ChatGPT returns {verdict, issues, score}
//   rounds   on "revise" the worker rewrites and ChatGPT checks again (max 2)
//   tie-break still split after the last round → the team manager (Opus)
//            picks or merges, and that is final
// Skipped for anything that is not outward-facing or is trivial, and entirely
// when Settings → "Second opinion" is off. A token cap stops a long argument;
// a budget stop falls back to a single opinion. In economy mode the tie-break
// runs on Sonnet instead of Opus (see routeTier).

export const OUTWARD_KINDS: ApprovalKind[] = ["reply", "comment", "dm", "connect_note", "post", "blog_post", "code_fix"];

export const CRITIQUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "issues", "score"],
  properties: {
    verdict: { type: "string", enum: ["agree", "revise"] },
    issues: { type: "array", items: { type: "string" } },
    score: { type: "number" },
  },
} as const;

const TIEBREAK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["choice", "text", "why"],
  properties: {
    choice: { type: "string", enum: ["first", "last", "merged"] },
    text: { type: "string" },
    why: { type: "string" },
  },
} as const;

export const DEBATE_TOKEN_CAP = 12_000;

type Critique = { verdict: "agree" | "revise"; issues: string[]; score: number };

export function isTrivial(kind: ApprovalKind, draft: string, score?: number): boolean {
  if (!OUTWARD_KINDS.includes(kind)) return true;
  return draft.length < 280 && score !== undefined && score < 0.6;
}

export async function debate(
  ctx: AgentContext,
  o: {
    kind: ApprovalKind;
    draft: string;
    /** What the draft is for: the post it answers, the person, the goal. */
    brief: string;
    /** The rules it must meet (voice, facts, platform). */
    rules: string;
    revise: (draft: string, issues: string[]) => Promise<string>;
    score?: number;
    maxRounds?: number;
    tokenCap?: number;
  },
): Promise<{ final: string; record: DebateRecord }> {
  const workerModel = MODEL_ID[ctx.tier];
  const turns: DebateTurn[] = [{ who: "worker", model: workerModel, text: o.draft }];
  if (isTrivial(o.kind, o.draft, o.score)) {
    return { final: o.draft, record: { skipped: true, reason: "trivial", rounds: 0, outcome: "single", line: "Quick item, so no second opinion.", turns, critic: "" } };
  }
  // Settings → "Second opinion". Off by default to keep costs down: you are the
  // second opinion, since every draft waits for your Approve anyway.
  if (!ctx.settings.second_opinion) {
    return { final: o.draft, record: { skipped: true, reason: "off", rounds: 0, outcome: "single", line: "Second opinion is off (Settings), so you're the reviewer.", turns, critic: "" } };
  }

  const maxRounds = o.maxRounds ?? 2;
  const cap = o.tokenCap ?? DEBATE_TOKEN_CAP;
  let used = 0;
  let current = o.draft;
  let criticLabel = "";
  let lastIssues: string[] = [];
  const system = `You are a sharp, skeptical second reviewer for drafts a small company's staff will post by hand. Judge ONLY against the rules and facts given. Say "agree" if it is ready to post as is. Say "revise" with short, concrete issues if anything breaks a rule, overclaims, sounds like an ad or a bot, or misses the person's actual point.\n\n${o.rules}`;

  for (let round = 0; round <= maxRounds; round++) {
    let c: Critique | null;
    try {
      const r = await ctx.llm.critique(system, `BRIEF:\n${o.brief}\n\nDRAFT:\n${current}`, CRITIQUE_SCHEMA as unknown as Record<string, unknown>);
      criticLabel = r.label;
      used += r.usage.input + r.usage.output + r.usage.cacheRead;
      c = parseJson<Critique>(r.text);
    } catch (e) {
      if (e instanceof BudgetStop) {
        return { final: current, record: { skipped: true, reason: "budget", rounds: round, outcome: "single", line: "Budget was low, so only one opinion.", turns, critic: criticLabel } };
      }
      throw e;
    }
    if (!c) break;
    turns.push({ who: "critic", model: criticLabel, text: c.issues.join("; "), verdict: c.verdict, issues: c.issues });
    if (c.verdict === "agree") {
      const outcome = round === 0 ? "agreed" : "revised_agreed";
      const line = round === 0 ? (criticLabel.startsWith("ChatGPT") ? "Claude and ChatGPT agreed." : "Passed a second Claude check (ChatGPT not connected).") : `${short(criticLabel)} asked for changes (${firstIssue(lastIssues)}); the new version passed.`;
      return { final: current, record: { skipped: false, rounds: round, outcome, line, turns, critic: criticLabel } };
    }
    lastIssues = c.issues;
    if (round === maxRounds || used >= cap) break;
    const revised = await o.revise(current, c.issues);
    used += Math.ceil((current.length + revised.length) / 3);
    current = revised;
    turns.push({ who: "worker", model: workerModel, text: current });
  }

  // Still split: the manager settles it.
  try {
    const first = turns[0].text;
    const res = await ctx.llm.askJson<{ choice: "first" | "last" | "merged"; text: string; why: string }>("tiebreak", {
      tier: "opus",
      effort: "medium",
      maxTokens: 3000,
      schema: TIEBREAK_SCHEMA as unknown as Record<string, unknown>,
      system: `You manage a small team. Two reviewers disagree about a draft. Pick the version that best follows the rules, or merge them. The answer is final.\n\n${o.rules}`,
      prompt: `BRIEF:\n${o.brief}\n\nFIRST VERSION:\n${first}\n\nLAST VERSION:\n${current}\n\nOPEN ISSUES:\n${lastIssues.join("\n")}`,
    });
    if (res?.text) {
      turns.push({ who: "manager", model: MODEL_ID.opus, text: res.why });
      return {
        final: res.text,
        record: { skipped: false, rounds: maxRounds, outcome: "tiebreak", line: `${short(criticLabel)} wanted changes (${firstIssue(lastIssues)}); the manager settled it: ${res.why}`, turns, critic: criticLabel },
      };
    }
  } catch (e) {
    if (!(e instanceof BudgetStop)) throw e;
  }
  return { final: current, record: { skipped: false, rounds: maxRounds, outcome: "single", line: `${short(criticLabel)} still had concerns: ${firstIssue(lastIssues)}. Check it before posting.`, turns, critic: criticLabel } };
}

function short(label: string): string {
  return label.startsWith("ChatGPT") ? "ChatGPT" : "the second check";
}

function firstIssue(issues: string[]): string {
  return (issues[0] ?? "small things").replace(/\.$/, "");
}
