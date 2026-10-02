import { aiComplete, hasAiProvider } from "@/lib/ai";
import { KNOWLEDGE } from "@/lib/knowledge";
import { buildPrompt, instantAnswer } from "@/lib/knowledge/retrieval";
import { SALES_PERSONA } from "@/lib/knowledge/personas";

// The website sales assistant, callable from the server with a plain question.
// Same corpus, same persona, same order (knowledge base first, model second)
// as src/app/api/ai/sales/route.ts — so an answer given on Instagram can never
// say something the website's assistant would not.
//
// Returns null when there is no real answer. Callers must NOT fall back to a
// canned line: on a social channel "I can help with questions about SwiftCard"
// under someone's comment reads as a bot, and a person should answer instead.

const SCOPE = { audience: "visitor" } as const;

// Plain-text channels render no markdown and no relative links.
const CHANNEL_RULES = `
CHANNEL: you are replying on Instagram as SwiftCard.
- Plain text only: no markdown, no bullet points, no headings.
- At most 3 short sentences.
- Write links in full, e.g. swiftcard.me/pricing — never a bare path like /pricing.
- If you cannot answer from the facts above, reply with exactly: NO_ANSWER`;

function plain(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?([^)]+)\)/g, "$1 ($2)")
    .replace(/(^|\s)\/(cards\/new|pricing|contact|templates|preview)\b/g, "$1swiftcard.me/$2")
    .replace(/\s+\n/g, "\n")
    .trim();
}

export async function answerSalesQuestion(question: string, opts?: { convo?: string }): Promise<string | null> {
  const q = question.trim().slice(0, 1000);
  if (!q) return null;

  const local = instantAnswer(KNOWLEDGE, q, SCOPE);
  if (local) return plain(local);

  if (!hasAiProvider()) return null;
  const prompt = buildPrompt({
    corpus: KNOWLEDGE,
    persona: SALES_PERSONA + CHANNEL_RULES,
    convo: opts?.convo ?? `Visitor: ${q}`,
    question: q,
    scope: SCOPE,
  });
  const reply = await aiComplete(prompt, { maxTokens: 300 });
  if (!reply || /NO_ANSWER/.test(reply)) return null;
  return plain(reply).slice(0, 900);
}
