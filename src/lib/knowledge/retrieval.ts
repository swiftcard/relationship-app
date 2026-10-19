// ── Selecting knowledge and building the prompt ─────────────────────────────
//
// Two paths, same corpus:
//   1. instantAnswer() — a strong trigger match returns a doc's `answer`
//      verbatim. Free, instant, works with no AI provider configured.
//   2. buildPrompt()   — everything the audience is allowed to know is injected
//      as grounded context so the model answers from the product, not from its
//      training data. The corpus is small enough to send whole; the ranking and
//      budget below only matter once it grows.

import type { Audience, KnowledgeDoc } from "./types";
import { derivedFacts, fillPlaceholders } from "./derived";

/**
 * Roughly 15k tokens of grounding. Well inside every provider's window and
 * cheap at the models these routes use; the ranking below only kicks in if the
 * corpus ever outgrows it, and dropping the tail of a RANKED list degrades
 * gracefully in a way truncating mid-document would not.
 */
const CONTEXT_BUDGET_CHARS = 60_000;

export function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()} `;
}

/**
 * Trigger-match score. Multi-word phrases weigh more than single words, so
 * "share my card" beats a doc that merely contains "card" — the same scoring
 * the two hand-rolled KBs used before this module replaced them.
 */
export function scoreDoc(question: string, doc: KnowledgeDoc): number {
  const q = normalize(question);
  let score = 0;
  for (const trigger of doc.triggers) {
    // Normalize the TRIGGER too, not just the question. Writing triggers the
    // way people type them ("can't log in", "follow-up") is the whole point,
    // and an un-normalized apostrophe or hyphen could never match a question
    // that has already had its punctuation stripped.
    const t = normalize(trigger).trim();
    if (!t) continue;
    const words = t.split(" ").length;
    if (q.includes(` ${t} `) || (words > 1 && q.includes(t))) score += words;
  }
  return score;
}

export type Scope = {
  audience: Audience;
  /** Native app session (iPhone or Android) — no commerce content may reach it. */
  native?: boolean;
  /** Which app, when native. Android gets `androidAnswer` (audit F-HELP-01). */
  platform?: "ios" | "android";
};

/**
 * A fractional tie-break, never enough to outrank a real trigger match.
 *
 * A doc written for one audience beats a general one when both match equally
 * well: an admin asking about "leads" wants the console's Leads tab, not the
 * personal Contacts page. Without this, ties fell to corpus order, which is an
 * accident of import order rather than a judgement about relevance.
 */
function specificity(doc: KnowledgeDoc, scope: Scope): number {
  return doc.audience.includes(scope.audience) ? 0.5 / doc.audience.length : 0;
}

/**
 * Which audiences a surface can read.
 *
 * An office admin is also an ordinary account holder — they have their own
 * card, their own contacts, their own settings — and they ask about all of it
 * from the console's assistant. So the admin surface reads both sets, and
 * `specificity` above keeps the console's own docs on top when both match.
 */
const REACH: Record<Audience, Audience[]> = {
  visitor: ["visitor"],
  user: ["user"],
  "office-admin": ["office-admin", "user"],
};

/**
 * Docs this surface may see, in a stable order.
 *
 * Native sessions drop `commerce` docs from CONTEXT entirely rather than
 * rewriting them: a model handed pricing text plus an instruction not to
 * mention it will eventually mention it. The instant path keeps the doc but
 * swaps in `nativeAnswer` (see instantAnswer), which the type system already
 * guarantees exists.
 */
export function visibleDocs(corpus: readonly KnowledgeDoc[], scope: Scope): KnowledgeDoc[] {
  const reach = REACH[scope.audience];
  return corpus.filter(
    (d) => d.audience.some((a) => reach.includes(a)) && !(scope.native && d.commerce),
  );
}

/**
 * A doc's answer, or null when nothing matches confidently. Native sessions get
 * `nativeAnswer` for commerce docs — the fast path must not be a way around the
 * guardrail the context filter enforces.
 */
export function instantAnswer(
  corpus: readonly KnowledgeDoc[],
  question: string,
  scope: Scope,
): string | null {
  // Commerce docs stay in play here (unlike context) because their
  // `nativeAnswer` is a purpose-written safe reply — silently matching nothing
  // would send "how do I get unlimited leads?" to the generic fallback.
  // Commerce docs stay in this pool (unlike context) — see below.
  const pool = corpus.filter((d) => d.audience.some((a) => REACH[scope.audience].includes(a)));
  let best: { score: number; doc: KnowledgeDoc | null } = { score: 0, doc: null };
  for (const doc of pool) {
    const score = scoreDoc(question, doc) + specificity(doc, scope);
    if (score > best.score) best = { score, doc };
  }
  if (!best.doc || best.score < 1) return null;
  const answer = !scope.native
    ? best.doc.answer
    : (scope.platform === "android" ? best.doc.androidAnswer : undefined) ?? best.doc.nativeAnswer ?? best.doc.answer;
  return fillPlaceholders(answer, { native: scope.native });
}

/** Visible docs, most relevant first, trimmed to the context budget. */
export function selectDocs(
  corpus: readonly KnowledgeDoc[],
  question: string,
  scope: Scope,
): KnowledgeDoc[] {
  const ranked = visibleDocs(corpus, scope)
    .map((doc, i) => ({ doc, score: scoreDoc(question, doc) + specificity(doc, scope), i }))
    // Ties keep corpus order, so the context reads in a deliberate sequence
    // instead of shuffling between requests.
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.doc);

  const kept: KnowledgeDoc[] = [];
  let size = 0;
  for (const doc of ranked) {
    const cost = renderDoc(doc, scope.native).length;
    if (size + cost > CONTEXT_BUDGET_CHARS) break;
    kept.push(doc);
    size += cost;
  }
  return kept;
}

function renderDoc(doc: KnowledgeDoc, native?: boolean): string {
  const body = `### ${doc.title}\n${doc.answer}${doc.detail ? `\n${doc.detail}` : ""}\n`;
  return fillPlaceholders(body, { native });
}

/**
 * The full prompt: persona, code-derived facts, grounded product knowledge,
 * then the conversation. `extraRules` carries the native guardrail.
 */
export function buildPrompt(opts: {
  corpus: readonly KnowledgeDoc[];
  persona: string;
  convo: string;
  question: string;
  scope: Scope;
  extraRules?: string;
}): string {
  const { corpus, persona, convo, question, scope, extraRules } = opts;
  const docs = selectDocs(corpus, question, scope);
  return `${persona}${extraRules ?? ""}

━━━ VERIFIED PRODUCT FACTS (generated from the live codebase — trust these over anything you remember about SwiftCard) ━━━
${derivedFacts({ commerce: !scope.native, audience: scope.audience })}

━━━ PRODUCT KNOWLEDGE ━━━
${docs.map((d) => renderDoc(d, scope.native)).join("\n")}
━━━ END KNOWLEDGE ━━━

Answer ONLY from the facts above. If the answer is not there, say you're not sure and point to the Contact page — never guess a feature, a menu location, a price, or a limit into existence.

Conversation so far:
${convo}

Reply as the assistant to the last message.`;
}
