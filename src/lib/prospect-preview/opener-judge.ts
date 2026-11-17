import { checkOpenerText, type OpenerContext, type Openers } from "./opener";

// ── Card Builder: the independent pick (owner, 2026-11-17) ──────────────────
// The call that writes the five openers also scores them, and a writer grading
// its own work is a poor judge of it. So a SEPARATE pass picks the default:
// it sees only the prospect's verified facts and the candidate texts (no
// scores, no hooks), reads each as the recipient would on a lock screen from
// a number they don't know, and ranks them by "would I tap the link". Its
// first choice that passes every rule (checkOpenerText) becomes the default
// and the next the alternate. The writer's scores stay, for display.
//
// The rubric is ONE file, .claude/agents/opener-judge.md, used by both paths:
// the server's writeOpener (lib/card-builder-jobs/jobs.ts, a second turn on
// Sonnet with web off) and /build-card's step 10b (the opener-judge agent).
// This file is the pure part both share: what the judge is shown, how its
// answer is read, and how it sets pick and alt. Tested in
// tests/card-builder-opener-quality.test.ts.

/** The texts are shown in an order that doesn't follow the writer's (a judge leans toward the first one it reads), and is the same every time for the same texts, so /build-card and set-openers agree on it without passing it around. */
export function judgeOrder(texts: string[]): number[] {
  const hash = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  return texts.map((t, i) => ({ i, h: hash(t) })).sort((a, b) => a.h - b.h || a.i - b.i).map((x) => x.i);
}

/** Everything the judge is shown, as one message: the facts, then the texts, numbered. Nothing else (no hooks, no scores). */
export function judgeMessage(facts: string[], texts: string[]): string {
  const order = judgeOrder(texts);
  return [
    "The prospect's verified facts (everything true that a text may mention):",
    ...facts.map((f) => `- ${f}`),
    "",
    `The ${texts.length} texts. Each arrives from a number they don't know, with the link to the card on the line below it:`,
    ...order.map((pos, n) => `${n + 1}. ${texts[pos]}`),
    "",
    `Rank all ${texts.length}, best first, and answer with the JSON only.`,
  ].join("\n");
}

/**
 * How much room the server gives the judge's answer. Adaptive thinking counts
 * toward it, and running out silently falls back to the writer's pick, so it
 * is generous: only what is used is paid for.
 */
export const JUDGE_MAX_TOKENS = 16_000;

export type JudgeVerdict = {
  /** Candidate positions, best first. */
  order: number[];
  /** The one-line reason, by candidate position. */
  reasons: string[];
};

/**
 * The judge's answer, `{ "ranking": [ { "n": 3, "reason": "…" }, … ] }`, with
 * `n` the number it was shown, mapped back to candidate positions. Null unless
 * every text is ranked exactly once, each with a reason.
 */
export function readJudgeVerdict(v: unknown, texts: string[]): JudgeVerdict | null {
  const ranking = v && typeof v === "object" ? (v as { ranking?: unknown }).ranking : null;
  if (!Array.isArray(ranking) || ranking.length !== texts.length) return null;
  const shown = judgeOrder(texts);
  const order: number[] = [];
  const reasons: string[] = Array(texts.length).fill("");
  for (const raw of ranking) {
    const r = (raw ?? {}) as { n?: unknown; reason?: unknown };
    const n = typeof r.n === "string" ? Number(r.n) : r.n;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > texts.length) return null;
    const pos = shown[n - 1];
    if (order.includes(pos)) return null;
    const reason = typeof r.reason === "string" ? r.reason.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    if (!reason) return null;
    order.push(pos);
    reasons[pos] = reason;
  }
  return { order, reasons };
}

/**
 * The judge's ranking sets the default and the alternate: its first choice
 * that passes every rule, then the next. When none passes (never, for a set
 * that passed checkOpeners), the writer's pick stays.
 */
export function applyJudge(o: Openers, verdict: JudgeVerdict, ctx: OpenerContext): Openers {
  const candidates = o.candidates.map((c, i) => ({ ...c, judge: { rank: verdict.order.indexOf(i) + 1, reason: verdict.reasons[i] } }));
  const passing = verdict.order.filter((i) => checkOpenerText(o.candidates[i].text, ctx).length === 0);
  if (!passing.length) return { ...o, candidates, picked_by: "writer" };
  return { ...o, candidates, pick: passing[0], alt: passing[1] ?? null, edited: null, picked_by: "judge" };
}

/**
 * Ask the judge (`ask` sends one message and returns its reply), read the
 * answer, and apply it; one more try when the answer can't be read. When the
 * judge can't be had, the writer's own ranking stands and says so, so a
 * prospect is never held back by the second pass.
 */
export async function judgeOpeners(o: Openers, ctx: OpenerContext, ask: (message: string, retry: boolean) => Promise<string>, parse: (reply: string) => unknown): Promise<{ openers: Openers; note: string }> {
  const texts = o.candidates.map((c) => c.text);
  const message = judgeMessage(ctx.facts, texts);
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply: string;
    try { reply = await ask(message, attempt > 0); } catch (e) { return { openers: { ...o, picked_by: "writer" }, note: `judge unavailable (${e instanceof Error ? e.message : String(e)}); the writer's own best is the default`.slice(0, 200) }; }
    const verdict = readJudgeVerdict(parse(reply), texts);
    if (verdict) {
      const judged = applyJudge(o, verdict, ctx);
      return { openers: judged, note: judged.picked_by === "judge" ? "picked by the judge" : "the judge's choices all broke a rule; the writer's own best is the default" };
    }
  }
  return { openers: { ...o, picked_by: "writer" }, note: "the judge's answer couldn't be read twice; the writer's own best is the default" };
}

/**
 * What /build-card's step 10b put in the openers file as "judge": the agent's
 * ranking, or, only when the opener-judge agent couldn't be had (two failed
 * tries), `{ "unavailable": "<why>" }`, so a Mac batch never loses a prospect
 * over the second pass. Anything else is null: set-openers refuses it.
 */
export type JudgeInFile = { verdict: JudgeVerdict } | { unavailable: string };
export function readJudgeInFile(v: unknown, texts: string[]): JudgeInFile | null {
  const verdict = readJudgeVerdict(v, texts);
  if (verdict) return { verdict };
  const r = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!r || Object.keys(r).length !== 1 || typeof r.unavailable !== "string") return null;
  const why = r.unavailable.replace(/\s+/g, " ").trim().slice(0, 200);
  return why ? { unavailable: why } : null;
}
