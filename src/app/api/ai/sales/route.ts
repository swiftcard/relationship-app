import { aiComplete, hasAiProvider } from "@/lib/ai";
import { isRateLimited } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { isShellRequest } from "@/lib/shell-request";
import { KNOWLEDGE } from "@/lib/knowledge";
import { buildPrompt, instantAnswer } from "@/lib/knowledge/retrieval";
import { SALES_PERSONA, SALES_FALLBACK } from "@/lib/knowledge/personas";

// The public (unauthenticated) assistant on the marketing site. Like the in-app
// one it holds no product knowledge of its own — it answers from the shared
// corpus in src/lib/knowledge, filtered to the "visitor" audience.
//
// COMPLIANCE: prices and limits are never written here or in the docs; they are
// generated from lib/plan at request time (knowledge/derived.ts), so the bot
// cannot quote a stale number. The persona forbids invented statistics,
// reviews, ratings and discounts (FTC deceptive-practices risk), and
// tests/knowledge-truth.test.ts fails the build if a doc hardcodes a price.

const SCOPE = { audience: "visitor" } as const;

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  // Public endpoint → strict per-IP limit (20 messages / 10 minutes).
  const ip = clientIp(req);
  // Plus one daily ceiling across every visitor: per-IP limits alone let a
  // bot rotating IPs run the model bill without bound.
  if (
    (await isRateLimited(`sales-chat:${ip}`, 20, 10 * 60 * 1000)) ||
    (await isRateLimited("ai-global:sales-chat", 3000, 24 * 60 * 60 * 1000))
  ) {
    return NextResponse.json(
      { reply: "You've sent quite a few messages — give it a few minutes and try again, or reach the team at swiftcard.me/contact." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMessage[] = raw
    .filter((m: unknown): m is ChatMessage =>
      !!m && typeof m === "object" &&
      ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
      typeof (m as ChatMessage).content === "string")
    .slice(-10)
    .map((m: ChatMessage) => ({ role: m.role, content: m.content.slice(0, 1000) }));

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return NextResponse.json({ error: "No question provided." }, { status: 400 });

  // 1) Knowledge base — instant and free.
  const local = instantAnswer(KNOWLEDGE, lastUser.content, SCOPE);
  if (local) return NextResponse.json({ reply: local });

  // 2) LLM fallback when a provider is configured, grounded in the same corpus.
  //    Never for the iOS shell: this endpoint is unauthenticated, so there is
  //    no account to hold an AI-consent decision, and the app may not send a
  //    typed message to the provider without permission (5.1.2(i)). The widget
  //    is <NativeHidden> anyway — this is the server-side backstop for the day
  //    that hiding fails — and the corpus answer above still works.
  if (hasAiProvider() && !isShellRequest(req)) {
    const convo = messages.map((m) => `${m.role === "user" ? "Visitor" : "Assistant"}: ${m.content}`).join("\n");
    const prompt = buildPrompt({
      corpus: KNOWLEDGE,
      persona: SALES_PERSONA,
      convo,
      question: lastUser.content,
      scope: SCOPE,
    });
    const reply = await aiComplete(prompt, { maxTokens: 500 });
    if (reply) return NextResponse.json({ reply });
  }

  return NextResponse.json({ reply: SALES_FALLBACK });
}
