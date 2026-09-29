import { aiComplete, hasAiProvider } from "@/lib/ai";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { isRateLimited } from "@/lib/rate-limit";
import { aiConsentAllowsFor } from "@/lib/ai-consent-server";
import { getOfficeSubUserContext } from "@/lib/office-roles";
import { KNOWLEDGE } from "@/lib/knowledge";
import { buildPrompt, instantAnswer, type Scope } from "@/lib/knowledge/retrieval";
import {
  APP_PERSONA,
  OFFICE_ADMIN_PERSONA,
  NATIVE_RULES,
  APP_FALLBACK,
  NATIVE_FALLBACK,
  OFFICE_ADMIN_FALLBACK,
  OFFICE_ADMIN_NATIVE_FALLBACK,
} from "@/lib/knowledge/personas";

// The in-app assistant. It carries NO product knowledge of its own — everything
// it says comes from src/lib/knowledge, which is shared with the marketing
// assistant and kept honest by tests/knowledge-truth.test.ts. This file is a
// transport: authenticate, rate-limit, pick the audience, answer.
//
// Two answer paths, unchanged in spirit from the original: a strong trigger
// match returns a written answer instantly and for free, and anything else goes
// to the LLM with the corpus injected as grounding.

export { NATIVE_RULES, NATIVE_FALLBACK };

type ChatMessage = { role: "user" | "assistant"; content: string };

// Team members (office sub-users). Any plan/billing question gets this answer
// before the knowledge base can hand them upgrade instructions; everything else
// is answered normally, with MEMBER_RULES added to the LLM's instructions.
// Tied to PLAN context: a bare "cancel", "pay", "bill" or "plan" also means
// "cancel a follow-up", a PayPal link, a contact named Bill, "plan a meeting".
const MEMBER_PLAN_QUESTION = /\b(upgrad\w*|downgrad\w*|pro plan|go pro|(my|our|the|a|which|what|free|pro|office|team) plan|plans|pric(e|es|ing)|how much|cost\w*|billing|subscri\w*|payment|pay for|trial|invoice|receipt|refund|cancel (my |the )?(plan|subscription)|charged?|refer\w*|free month|promo|discount|coupon|limits?|locked|unlock\w*)\b/i;
const MEMBER_PLAN_ANSWER =
  "Your SwiftCard plan comes with your team seat — your organization covers it, so there's nothing for you to upgrade, choose or pay. For anything about the team's plan, ask your team admin.";
// Docs a team member is never answered from: everything commerce (plans,
// prices, the "What's included in Pro?" greeting, the Settings map that lists
// Plan and billing and referrals) plus the referral pitch and Free's limits.
const MEMBER_HIDDEN_DOCS = new Set(["referrals", "plan-limits-explained"]);
const MEMBER_CORPUS = KNOWLEDGE.filter((d) => !d.commerce && !MEMBER_HIDDEN_DOCS.has(d.id));
const MEMBER_GREETING = /^\s*(hi|hello|hey|help|help me|good (morning|afternoon|evening)|what can you (do|help with))\W*$/i;
const MEMBER_GREETING_ANSWER =
  "Hi! I can help you find your way around SwiftCard. Try asking \"How do I share my card?\", \"Where do I change my card design?\" or \"Where are my contacts?\"";
const MEMBER_SETTINGS = /\b(settings?|preferences)\b/i;
const MEMBER_SETTINGS_ANSWER =
  "Settings is the gear icon at the top right (or the Settings tab in the bottom bar on a phone). Your sections: Profile (your email and sign out), Cards and sharing (your card's status and your share links — to change your card, tap Edit on it in My Cards on the dashboard), Notifications and preferences (push alerts and CRM integrations), Security (your password) and Help. Your plan comes with your team seat, so there is no billing section — your team admin handles that.";
const MEMBER_FALLBACK =
  "I can help with editing your card, designs, sharing, Swift Links, contacts, analytics and notifications. Try asking \"How do I share my card?\" or \"Where are my contacts?\" — anything about your team's plan or company details goes to your team admin.";
const MEMBER_RULES = `
IMPORTANT — TEAM MEMBER SESSION: This user is a member of a company team (an Office seat). Their plan is provided and paid for by their organization: NEVER suggest upgrading, choosing a plan, starting a trial, or paying, and never quote prices. They have exactly one card, their company card, and cannot create another — for more, they ask their team admin. Their company details (company name, logo, website, office phone, fax, address) and, when the team locks it, the card design are managed by their organization; they edit their own name, title, photo, phone numbers, bio and personal links.`;

/**
 * Kept as a named export because tests/help-guardrail.test.ts pins the native
 * guardrail through this exact seam. The `kb` parameter is gone — there is one
 * corpus now — but the (question, native) contract is identical.
 */
export function localAnswer(question: string, native = false, area: Scope["audience"] = "user"): string | null {
  return instantAnswer(KNOWLEDGE, question, { audience: area, native });
}

/** Same: the prompt-construction seam the guardrail test asserts against. */
export function buildHelpPrompt(convo: string, native = false, persona: string = APP_PERSONA): string {
  // The last user line is what ranks the corpus; the whole conversation is
  // still handed to the model for context.
  const lastUser = convo.split("\n").reverse().find((l) => l.startsWith("User: ")) ?? convo;
  return buildPrompt({
    corpus: KNOWLEDGE,
    persona,
    convo,
    question: lastUser.replace(/^User: /, ""),
    scope: { audience: persona === OFFICE_ADMIN_PERSONA ? "office-admin" : "user", native },
    extraRules: native ? NATIVE_RULES : "",
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Per-user throttle: authenticated but previously uncapped (cost/abuse guard).
  if (await isRateLimited(`ai-help:${user.id}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const native = body.native === true;
  // `area` scopes the assistant. "office-admin" gets the console persona and
  // the console's docs; every other value is the default app assistant.
  const isAdmin = body.area === "office-admin";
  const scope: Scope = { audience: isAdmin ? "office-admin" : "user", native };
  const persona = isAdmin ? OFFICE_ADMIN_PERSONA : APP_PERSONA;
  const fallback = isAdmin
    ? (native ? OFFICE_ADMIN_NATIVE_FALLBACK : OFFICE_ADMIN_FALLBACK)
    : (native ? NATIVE_FALLBACK : APP_FALLBACK);

  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMessage[] = raw
    .filter((m: unknown): m is ChatMessage =>
      !!m && typeof m === "object" &&
      ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
      typeof (m as ChatMessage).content === "string")
    .slice(-12)
    .map((m: ChatMessage) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return NextResponse.json({ error: "No question provided." }, { status: 400 });

  // A TEAM MEMBER's plan is their seat: there is nothing for them to upgrade,
  // choose or pay, and the knowledge base's plan answers are written for
  // someone who can. Resolved from the session, never from the request.
  const member = !isAdmin && !!(await getOfficeSubUserContext(user.id).catch(() => null));
  if (member && MEMBER_PLAN_QUESTION.test(lastUser.content)) {
    return NextResponse.json({ reply: MEMBER_PLAN_ANSWER });
  }
  if (member && MEMBER_GREETING.test(lastUser.content)) return NextResponse.json({ reply: MEMBER_GREETING_ANSWER });
  if (member && MEMBER_SETTINGS.test(lastUser.content)) return NextResponse.json({ reply: MEMBER_SETTINGS_ANSWER });
  const corpus = member ? MEMBER_CORPUS : KNOWLEDGE;

  // 1) Answer instantly from the knowledge base (free, always works).
  //    Native sessions get the native-safe answer for any commerce doc.
  const local = instantAnswer(corpus, lastUser.content, scope);
  if (local) return NextResponse.json({ reply: local });

  // 2) Otherwise ask the LLM, grounded in the same corpus, IF a provider is
  //    configured AND the account hasn't refused AI. A declined account keeps a
  //    working assistant — it just answers from the corpus above and the
  //    fallback below, and its message never leaves for the provider.
  if (hasAiProvider() && (await aiConsentAllowsFor(user.id, req))) {
    const convo = messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
    const prompt = buildPrompt({
      corpus,
      persona,
      convo,
      question: lastUser.content,
      // A member's prompt carries no pricing facts either (derivedFacts is
      // commerce-free for a native scope).
      scope: member ? { ...scope, native: true } : scope,
      extraRules: [native ? NATIVE_RULES : "", member ? MEMBER_RULES : ""].filter(Boolean).join("\n"),
    });
    const reply = await aiComplete(prompt, { maxTokens: 700 });
    if (reply) return NextResponse.json({ reply });
  }

  return NextResponse.json({ reply: member ? MEMBER_FALLBACK : fallback });
}
