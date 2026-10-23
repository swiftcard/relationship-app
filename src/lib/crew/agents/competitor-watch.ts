import type { AgentDef } from "../agent-def";
import { propose } from "../approvals";
import { COMPETITOR_NAME, COMPETITORS, type Competitor } from "../facts";
import { reportHtml } from "../reports";
import { nyDay } from "../schedule";
import { sendOwnerDigest } from "@/lib/owner-digest";

// ── M5 Competitor watch (Wednesdays and Sundays) ────────────────────────────
// Reads each competitor's own site through web search, records dated,
// sourced facts (crew_competitor_facts), and reports what changed. Those
// facts are the ONLY competitor claims any other agent may make, and only
// while they are under 30 days old, so a reply can never quote a stale price.

export const COMPETITOR_DOMAINS: Record<Competitor, string[]> = {
  hihello: ["hihello.com", "hihello.me"],
  blinq: ["blinq.me"],
  popl: ["popl.co"],
  linkme: ["link.me"],
  linktree: ["linktr.ee", "linktree.com"],
  hoobe: ["hoo.be"],
};

type Found = { facts: { fact: string; value: string; source_url: string }[]; new_features: string[] };

const FOUND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts", "new_features"],
  properties: {
    facts: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["fact", "value", "source_url"], properties: { fact: { type: "string" }, value: { type: "string" }, source_url: { type: "string" } } },
    },
    new_features: { type: "array", items: { type: "string" } },
  },
};

const SCHEMA_HINT = `Return:
{"facts": [{"fact": snake_case key such as "free_plan", "paid_plan_monthly_price", "paid_plan_annual_price", "team_plan_price", "trial", "nfc_card_price", "link_in_bio", "contact_capture", "crm_sync"], "value": short plain text exactly as their site states it, "source_url": the page you read it on}],
 "new_features": [short plain sentences about anything announced in the last 30 days]}
Only use what their own pages say. If you can't find a fact, leave it out. Never estimate a price.`;

export function factChanges(prev: { fact: string; value: string }[], next: { fact: string; value: string }[]): { fact: string; from: string | null; to: string }[] {
  const old = new Map(prev.map((p) => [p.fact, p.value]));
  return next.filter((n) => old.get(n.fact) !== n.value).map((n) => ({ fact: n.fact, from: old.get(n.fact) ?? null, to: n.value }));
}

export const competitorWatch: AgentDef = {
  id: "competitor-watch",
  name: "Competitor watch",
  team: "marketing",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "daily", hour: 8, minute: 0, days: [0, 3] },
  dailyUsd: 1.5,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: 3,
  purpose: "Every Wednesday and Sunday, checks HiHello, Blinq, Popl, Link.me, Linktree and Hoobe for price changes and new features.",
  approvalKind: "code_fix",
  async run(ctx) {
    const before = await ctx.store.competitorFacts();
    const lines: string[] = [];
    const priceChanges: string[] = [];
    let checked = 0;
    for (const c of COMPETITORS) {
      const domains = COMPETITOR_DOMAINS[c];
      // A required JSON shape: free-form JSON with web search arrived in
      // pieces around the search steps when tested live (2026-10-20).
      const found = await ctx.llm.askJson<Found>("research", {
        effort: "medium",
        maxTokens: 4000,
        webSearch: { maxUses: 3, allowedDomains: domains },
        system: "You check a competitor's public pricing and feature pages for a small company. Report only what their own site says, with the page URL.",
        prompt: `Competitor: ${COMPETITOR_NAME[c]} (${domains.join(", ")}). Find their current plans and prices, and any feature announced in the last 30 days.\n\n${SCHEMA_HINT}`,
        schema: FOUND_SCHEMA,
      });
      if (!found) {
        lines.push(`- ${COMPETITOR_NAME[c]}: could not read their site this time.`);
        continue;
      }
      checked++;
      const okFacts = found.facts.filter((f) => f.fact && f.value && f.source_url && domains.some((d) => safeHost(f.source_url).endsWith(d)));
      const changes = factChanges(before.filter((b) => b.competitor === c), okFacts);
      for (const f of okFacts) await ctx.store.upsertCompetitorFact({ competitor: c, fact: f.fact.slice(0, 60), value: f.value.slice(0, 200), source_url: f.source_url });
      ctx.stat("facts_checked", okFacts.length);
      const real = changes.filter((x) => x.from !== null);
      if (real.length) {
        ctx.stat("changes_found", real.length);
        for (const ch of real) {
          lines.push(`- ${COMPETITOR_NAME[c]} changed ${ch.fact.replace(/_/g, " ")}: ${ch.from} → ${ch.to}.`);
          if (/price/.test(ch.fact)) priceChanges.push(`${COMPETITOR_NAME[c]} ${ch.fact.replace(/_/g, " ")}: ${ch.from} → ${ch.to}`);
        }
      }
      for (const nf of found.new_features.slice(0, 3)) lines.push(`- ${COMPETITOR_NAME[c]} new: ${nf}`);
      if (!real.length && !found.new_features.length) lines.push(`- ${COMPETITOR_NAME[c]}: no change.`);
    }
    const body = [`Competitor report for ${nyDay(ctx.now())}`, "", "What happened", ...lines, "", "What I need from you", priceChanges.length ? "- A price changed. Look at the card to update our compare pages." : "- Nothing right now."].join("\n");
    await ctx.store.saveReport({ agent_id: ctx.def.id, team: "marketing", day: nyDay(ctx.now()), body, stats: { checked } });
    await sendOwnerDigest("Competitor report", reportHtml(body, "marketing"));
    if (priceChanges.length) {
      await propose(ctx, {
        kind: "code_fix",
        title: "Fix: our compare pages show an old competitor price",
        summary: `A competitor changed a price. Our /compare pages may now be wrong. Tap Approve and an AI engineer opens an update for you to review.`,
        body: `Competitor prices changed (from their own sites, checked ${nyDay(ctx.now())}):\n${priceChanges.map((p) => `- ${p}`).join("\n")}\n\nUpdate src/app/compare/[slug]/page.tsx COMPETITORS (and any compare hub rows) to match. Keep the source and date in a comment.`,
        platform: "site",
      });
    }
    return { summary: `Checked ${checked} of ${COMPETITORS.length} competitors; ${priceChanges.length} price changes.` };
  },
};

function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}
