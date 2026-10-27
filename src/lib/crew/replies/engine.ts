import { inboxFull, propose } from "../approvals";
import type { AgentContext } from "../context";
import { debate } from "../debate";
import { isPromotional } from "../disclosure";
import { competitorFacts, productFacts } from "../facts";
import { everContacted, personFor } from "../ledger";
import { crewLink } from "../links";
import { remainingToday } from "../rate-limit";
import { nyDayStart } from "../schedule";
import type { ApprovalKind, Platform } from "../types";
import { HUMAN_VOICE } from "../voice";
import { writingProblems } from "../writing-check";

// ── The shared engine behind every Replies and Contact agent ────────────────
// find posts → drop ones already seen → cheap keyword filter (no model) →
// ONE scoring call for the batch → draft only the best few, within today's
// warmed-up cap → second opinion → the inbox. Nothing is posted or sent: a
// person copies the approved draft and posts it from their own account.

export type Candidate = {
  platform: Platform;
  url: string;
  author: string | null;
  title: string;
  text: string;
  community: string | null;
  /** False where the community's rules ban self-promotion. */
  promoAllowed: boolean;
  fromPaste?: boolean;
};

export type EngageOptions = {
  platform: Platform;
  kind: Extract<ApprovalKind, "reply" | "comment" | "dm" | "connect_note">;
  /** Rate-limit key and default daily ceiling (the meeting's numbers are ceilings). */
  action: string;
  ceiling: number;
  find: () => Promise<Candidate[]>;
  /** How people write on this platform. */
  register: string;
  /** e.g. "40 to 120 words". */
  length: string;
  /** Who the post or person must be. Contact agents require a business professional. */
  mustBePro?: boolean;
  /** Share of drafts allowed to mention SwiftCard at all (comments: about 1 in 3). */
  pitchShare?: number;
  /** What the draft is for, in one line, for the card. */
  label: (c: Candidate) => string;
  person?: (c: Candidate) => { platform: Platform; handle: string; name?: string | null } | null;
  /** Skip the keyword filter (e.g. pasted input, which a person already chose). */
  keywordFilter?: boolean;
};

export const RELEVANT =
  /linktree|linktr\.ee|link[- ]?in[- ]?bio|link\.me|hoo\.?be|hihello|blinq|popl|digital business card|business cards?|e-?card|vcard|qr code|nfc|networking|contact card|personal brand|lead capture|swift ?card/i;

const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "score", "why", "angle", "asks_for_tools", "business_pro"],
        properties: {
          i: { type: "integer" },
          score: { type: "number" },
          why: { type: "string" },
          angle: { type: "string" },
          asks_for_tools: { type: "boolean" },
          business_pro: { type: "boolean" },
        },
      },
    },
  },
} as const;

type Scored = { i: number; score: number; why: string; angle: string; asks_for_tools: boolean; business_pro: boolean };

const SCORE_SYSTEM = `You help a person who works on SwiftCard (digital business cards plus a link-in-bio page, made for business professionals with a personal brand: realtors, recruiters, sales coaches, wholesalers, loan officers, plumbers, window washers, landscapers and other local businesses; never lawyers) decide which public posts deserve a genuinely helpful reply.
Score each post 0 to 1: high when the person has a problem a digital card or link-in-bio page really solves, asks which tool to use, or complains about a competitor's price or limits. Low for spam, jokes, old or locked threads, students, people selling their own competing tool, or anything about law firms.
angle: one short phrase for what a helpful reply would address. business_pro: true only if the author is clearly a working professional or business owner. asks_for_tools: true only if they ask for a recommendation.`;

function seenKey(ctx: AgentContext) {
  return `seen:${ctx.def.id}`;
}

async function markSeen(ctx: AgentContext, urls: string[]) {
  const prev = (await ctx.store.kvGet<string[]>(seenKey(ctx))) ?? [];
  await ctx.store.kvSet(seenKey(ctx), [...new Set([...urls, ...prev])].slice(0, 600));
}

export async function runEngagement(ctx: AgentContext, o: EngageOptions): Promise<{ summary: string }> {
  const quota = await remainingToday(ctx.store, { agentId: ctx.def.id, platform: o.platform, action: o.action, defaultCeiling: o.ceiling, now: ctx.now() });
  if (quota.left === 0) return { summary: `Reached today's limit of ${quota.cap} drafts (it rises as the account warms up).` };
  if (await inboxFull(ctx)) return { summary: "Waiting: the inbox already has enough of my drafts." };

  const seen = new Set((await ctx.store.kvGet<string[]>(seenKey(ctx))) ?? []);
  const found = await o.find();
  ctx.stat("posts_read", found.length);
  const unique = [...new Map(found.map((c) => [c.url, c])).values()].filter((c) => !seen.has(c.url));
  const relevant = unique.filter((c) => c.fromPaste || o.keywordFilter === false || RELEVANT.test(`${c.title} ${c.text}`));
  ctx.stat("posts_relevant", relevant.length);
  await markSeen(ctx, unique.map((c) => c.url));
  if (!relevant.length) {
    ctx.stat("no_llm_needed");
    return { summary: `Read ${found.length} posts; none worth a reply.` };
  }

  const batch = relevant.slice(0, 15);
  const scored = await ctx.llm.askJson<{ items: Scored[] }>("score", {
    effort: "low",
    maxTokens: 2500,
    schema: SCORE_SCHEMA as unknown as Record<string, unknown>,
    system: SCORE_SYSTEM,
    prompt: batch.map((c, i) => `#${i} [${c.platform}${c.community ? ` / ${c.community}` : ""}] ${c.title}\n${c.text.slice(0, 700)}`).join("\n\n"),
  });
  const picks = (scored?.items ?? [])
    .filter((s) => s.i >= 0 && s.i < batch.length && s.score >= 0.55 && (!o.mustBePro || s.business_pro))
    .sort((a, b) => b.score - a.score)
    .slice(0, quota.left);
  ctx.stat("posts_scored", batch.length);

  const facts = await competitorFacts(ctx.store, ctx.now());
  const system = `${HUMAN_VOICE}\n\n${productFacts()}`;
  const examples = await ctx.ownerExamples(o.kind);
  const replyCap = Number((await ctx.store.getControls().catch(() => ({}) as Record<string, unknown>)).social_reply_limit ?? 0);
  let promoBudget = await pitchBudget(ctx, o, picks.length);
  let made = 0;
  if (replyCap > 0) {
    // Controls → "Social replies per platform per day": a ceiling on top of the warm-up cap.
    const todayOnPlatform = await ctx.store.countTouchesSince(o.platform, ["replied", "commented", "dm_drafted", "dm_sent", "connect_sent"], nyDayStart(ctx.now()).toISOString());
    if (todayOnPlatform >= replyCap) return { summary: `Reached the Controls limit of ${replyCap} ${o.platform} drafts today.` };
  }

  for (const s of picks) {
    if (await inboxFull(ctx)) break;
    const c = batch[s.i];
    const person = o.person?.(c) ?? null;
    if ((o.kind === "dm" || o.kind === "connect_note") && !person) {
      ctx.stat("skipped_no_person");
      continue;
    }
    if ((o.kind === "dm" || o.kind === "connect_note") && person) {
      const pid = await personFor(ctx.store, person.platform, person.handle, person.name);
      if (!pid || (await everContacted(ctx.store, pid))) {
        ctx.stat("skipped_already_contacted");
        continue;
      }
    }
    const mayPitch = c.promoAllowed && promoBudget > 0;
    const link = crewLink(o.platform, o.kind, c.url);
    const brief = `${o.platform}${c.community ? ` (${c.community})` : ""} post by ${c.author ?? "someone"}:\n${c.title}\n${c.text.slice(0, 1500)}\n\nWhy it's worth it: ${s.why}. Angle: ${s.angle}.`;
    const instructions = [
      `Write a ${o.kind === "reply" ? "reply" : o.kind === "comment" ? "comment" : o.kind === "dm" ? "private message" : "connection note"} on ${o.platform}. Length: ${o.length}. ${o.register}`,
      mayPitch
        ? `You MAY mention SwiftCard in one low-key sentence if it honestly fits${s.asks_for_tools ? " (they asked for tools)" : ""}. If you include a link, use exactly ${link}.`
        : "Do NOT mention SwiftCard or any product, and include no link. Just be genuinely helpful or insightful about their post.",
      facts,
      ...(examples ? [examples] : []),
      `POST:\n${brief}`,
    ].join("\n\n");
    const first = await ctx.llm.ask("draft", { system, effort: "medium", maxTokens: 1200, prompt: instructions });
    if (first.refused || !first.text) continue;
    let { final, record } = await debate(ctx, {
      kind: o.kind,
      draft: first.text,
      brief,
      score: s.score,
      rules: `${HUMAN_VOICE}\n\n${productFacts()}\n\n${facts}\n\n${mayPitch ? "A product mention is allowed if it fits." : "No product mention or link is allowed here."}`,
      revise: async (draft, issues) => (await ctx.llm.ask("revise", { system, effort: "medium", maxTokens: 1200, prompt: `${instructions}\n\nYOUR DRAFT:\n${draft}\n\nFix these problems and return only the new text:\n- ${issues.join("\n- ")}` })).text || draft,
    });
    if (!mayPitch && isPromotional(final)) {
      ctx.stat("skipped_pitch_not_allowed");
      continue;
    }
    // The writing check: one rewrite when a draft trips it; a second failure
    // reaches the Sheet as Needs Review (propose() marks it) rather than vanishing.
    let problems = writingProblems(final, { kind: o.kind, platform: o.platform });
    if (problems.length) {
      ctx.stat("rewritten_for_style");
      const again = await ctx.llm.ask("revise", { system, effort: "medium", maxTokens: 1200, prompt: `${instructions}\n\nYOUR DRAFT:\n${final}\n\nRewrite it without these problems and return only the new text:\n- ${problems.join("\n- ")}` });
      if (again.text && !writingProblems(again.text, { kind: o.kind, platform: o.platform }).length) {
        final = again.text;
        record = { ...record, line: `${record.line} Rewritten once for style.` };
      }
      problems = writingProblems(final, { kind: o.kind, platform: o.platform });
    }
    const r = await propose(ctx, {
      kind: o.kind,
      title: o.label(c),
      summary: `${s.why.replace(/\.$/, "")}. Approve it, then post it yourself from your own account.${problems.length ? ` Heads up: ${problems.join(", ")}.` : ""}`,
      body: final,
      platform: o.platform,
      targetUrl: c.url,
      person,
      debate: record,
      // The Sheet's row is built from this: who, where, what they asked, why
      // it matters. Reddit's terms want post bodies gone quickly, so Reddit
      // rows carry the title and the link only.
      meta: {
        score: s.score,
        angle: s.angle,
        why: s.why,
        asks_for_tools: s.asks_for_tools,
        author: c.author,
        post_title: c.title.slice(0, 200),
        community: c.community,
        pitched: isPromotional(final),
        ...(o.platform === "reddit" ? {} : { excerpt: c.text.slice(0, 500) }),
      },
    });
    if (r.ok) {
      made++;
      if (isPromotional(final)) promoBudget--;
    }
  }
  ctx.stat("drafts_made", made);
  return { summary: `Read ${found.length} posts, ${relevant.length} on topic, drafted ${made}.` };
}

async function pitchBudget(ctx: AgentContext, o: EngageOptions, n: number): Promise<number> {
  const share = o.pitchShare ?? 1;
  if (share >= 1) return n;
  const today = await ctx.store.listApprovals({ agentId: ctx.def.id, sinceIso: nyDayStart(ctx.now()).toISOString(), limit: 100 });
  const pitched = today.filter((a) => a.meta?.pitched === true).length;
  const allowed = Math.floor((today.length + n) * share);
  return Math.max(0, allowed - pitched);
}
