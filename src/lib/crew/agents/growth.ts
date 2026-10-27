import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { propose } from "../approvals";
import { productFacts } from "../facts";
import { everContacted, personFor } from "../ledger";
import { remainingToday } from "../rate-limit";
import { QUIET_REST_MINUTES, pairs, rotate } from "../replies/engine";
import { minutesToTomorrow } from "../schedule";
import { US_METROS } from "../search-plan";
import { searchItems } from "../sources/web-discovery";
import { HUMAN_VOICE } from "../voice";
import { SHEET_MAX_PENDING } from "./replies";

// ── Partnerships and Events ─────────────────────────────────────────────────
// Two finders that work like the others: Start them and they keep adding
// rows (a few a day, rotating through kinds of partner or event and cities)
// until Stop. Partnerships finds organizations that already reach the
// professionals we sell to and writes the first email; Events finds
// upcoming networking and industry events and says what to do there. Neither
// sends anything: the row has the message and the exact link.

export const PARTNER_KINDS = [
  "associations or boards of realtors",
  "insurance agent associations",
  "mortgage broker or loan officer associations",
  "chambers of commerce",
  "coworking spaces that host networking events",
  "real estate license schools",
  "BNI chapters or business networking groups",
  "real estate brokerage franchise offices that onboard new agents",
  "small business development centers",
  "contractor trade associations",
];

export const EVENT_KINDS = [
  "real estate networking events",
  "insurance industry meetups",
  "mortgage and lending industry events",
  "small business networking nights",
  "chamber of commerce mixers",
  "contractor and home services trade shows",
  "BNI or business networking group open visits",
  "sales professionals meetups",
];

/** New York first: the owners are there and can show up in person. */
const AREAS = ["New York City", "Brooklyn", "Long Island", "New Jersey", ...US_METROS.filter((m) => !["New York", "Brooklyn", "Long Island", "New Jersey"].includes(m))];

function httpUrl(u: string): string | null {
  try {
    const x = new URL(u.trim());
    return (x.protocol === "https:" || x.protocol === "http:") && x.pathname !== "" ? x.toString() : null;
  } catch {
    return null;
  }
}

async function seen(ctx: AgentContext, urls: string[]): Promise<Set<string>> {
  const key = `seen:${ctx.def.id}`;
  const prev = (await ctx.store.kvGet<string[]>(key)) ?? [];
  await ctx.store.kvSet(key, [...new Set([...urls, ...prev])].slice(0, 800));
  return new Set(prev);
}

type Partner = { org: string; website: string; contact_page: string; contact_name: string; industry: string; what_they_do: string };
type PartnerDraft = { i: number; opportunity: string; why: string; proposal: string; message: string };

const PARTNER_DRAFTS = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "opportunity", "why", "proposal", "message"],
        properties: { i: { type: "integer" }, opportunity: { type: "string" }, why: { type: "string" }, proposal: { type: "string" }, message: { type: "string" } },
      },
    },
  },
} as const;

export const partnerships: AgentDef = {
  id: "partnerships",
  name: "Partnerships",
  team: "office",
  role: "worker",
  tier: "sonnet",
  continuous: true,
  schedule: { kind: "daily", hour: 10, minute: 0 },
  dailyUsd: 0.6,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: SHEET_MAX_PENDING,
  approvalKind: "dm",
  purpose: "Finds organizations that already reach realtors, insurance agents, loan officers and local businesses (associations, chambers, coworking spaces, license schools, networking groups) and writes a first email proposing something concrete together, with a link to their contact page.",
  async run(ctx) {
    const quota = await remainingToday(ctx.store, { agentId: ctx.def.id, platform: "web", action: "partner", defaultCeiling: 5, now: ctx.now() });
    if (quota.left === 0) return { summary: `Done for today: ${quota.cap} partners is today's limit. Back tomorrow.`, restMinutes: minutesToTomorrow(ctx.now()) };
    const [[kind, area]] = await rotate(ctx, "where_i", pairs(PARTNER_KINDS, AREAS), 1);
    const found = await searchItems<Partner>(ctx, {
      system: "You find real organizations and their official websites from web search results.",
      prompt: `Find ${kind} in ${area}. For each: org (its name), website (its own site as shown), contact_page (the URL of its contact, membership or partnerships page if the results show one, else the website), contact_name (a named director, membership or events lead if shown, else empty), industry (who its members are), what_they_do (one line, from the results).`,
      fields: ["org", "website", "contact_page", "contact_name", "industry", "what_they_do"],
      maxUses: 5,
      want: 8,
    });
    const fresh = found.filter((p) => httpUrl(p.contact_page || p.website));
    const already = await seen(ctx, fresh.map((p) => httpUrl(p.contact_page || p.website)!));
    const batch = fresh.filter((p) => !already.has(httpUrl(p.contact_page || p.website)!)).slice(0, quota.left);
    if (!batch.length) return { summary: `${kind} in ${area}: nothing new.`, restMinutes: QUIET_REST_MINUTES };
    const drafts = await ctx.llm.askJson<{ items: PartnerDraft[] }>("draft", {
      effort: "medium",
      maxTokens: 5000,
      schema: PARTNER_DRAFTS as unknown as Record<string, unknown>,
      system: `${HUMAN_VOICE}\n\n${productFacts()}`,
      prompt: `For each organization, write:\n- opportunity: what we could do together, concretely (a member perk, a workshop at their next event, a card for every new member).\n- why: why they fit, in one sentence, from what they do.\n- proposal: the first small step, in one sentence.\n- message: a short first email from Menash (under 110 words), first line "Subject: ...", specific to them, one easy ask (a 10 minute call or a reply), no link, no hype.\n\n${batch.map((p, i) => `#${i} ${p.org} (${p.website}) — members: ${p.industry}. ${p.what_they_do}${p.contact_name ? ` Contact: ${p.contact_name}.` : ""}`).join("\n")}`,
    });
    let made = 0;
    for (const d of drafts?.items ?? []) {
      const p = batch[d.i];
      if (!p || !d.message) continue;
      const url = httpUrl(p.contact_page || p.website)!;
      const host = new URL(url).hostname.replace(/^www\./, "");
      const pid = await personFor(ctx.store, "web", host, p.org);
      if (pid && (await everContacted(ctx.store, pid))) continue;
      const r = await propose(ctx, {
        kind: "dm",
        title: `Partner: ${p.org}`,
        summary: d.why,
        body: d.message,
        platform: "web",
        targetUrl: url,
        person: { platform: "web", handle: host, name: p.org },
        meta: { org: p.org.slice(0, 120), industry: p.industry.slice(0, 120), contact_name: p.contact_name.slice(0, 80), opportunity: d.opportunity.slice(0, 400), why: d.why.slice(0, 300), proposal: d.proposal.slice(0, 300), score: 0.7 },
      });
      if (r.ok) made++;
    }
    ctx.stat("partners_added", made);
    return { summary: `${kind} in ${area}: added ${made} partners to the Sheet.`, ...(made ? {} : { restMinutes: QUIET_REST_MINUTES }) };
  },
};

type EventHit = { name: string; url: string; date: string; location: string; audience: string; cost: string; organizer: string; why: string; action: string };

export const events: AgentDef = {
  id: "events",
  name: "Events",
  team: "marketing",
  role: "worker",
  tier: "sonnet",
  continuous: true,
  schedule: { kind: "daily", hour: 9, minute: 0 },
  dailyUsd: 0.5,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: SHEET_MAX_PENDING,
  approvalKind: "ask",
  purpose: "Finds upcoming networking and industry events where realtors, insurance agents, loan officers and business owners will be, with the event link and what to do there (go and hand out cards, sponsor, run a demo).",
  async run(ctx) {
    const quota = await remainingToday(ctx.store, { agentId: ctx.def.id, platform: "web", action: "event", defaultCeiling: 5, now: ctx.now() });
    if (quota.left === 0) return { summary: `Done for today: ${quota.cap} events is today's limit. Back tomorrow.`, restMinutes: minutesToTomorrow(ctx.now()) };
    const [[kind, area]] = await rotate(ctx, "where_i", pairs(EVENT_KINDS, AREAS), 1);
    const found = await searchItems<EventHit>(ctx, {
      system: "You find upcoming in-person events from web search results.",
      prompt: `Find ${kind} in ${area} happening in the next 60 days. For each: name, url (the event's own page as shown), date, location, audience (who goes), cost (ticket price if shown), organizer, why (why a digital business card startup should be there, one sentence), action (the one thing to do: attend and collect contacts, sponsor, ask to demo, partner with the organizer).`,
      fields: ["name", "url", "date", "location", "audience", "cost", "organizer", "why", "action"],
      maxUses: 5,
      want: 8,
    });
    const fresh = found.filter((e) => httpUrl(e.url) && e.name);
    const already = await seen(ctx, fresh.map((e) => httpUrl(e.url)!));
    let made = 0;
    for (const e of fresh.filter((x) => !already.has(httpUrl(x.url)!)).slice(0, quota.left)) {
      const r = await propose(ctx, {
        kind: "ask",
        title: `Event: ${e.name.slice(0, 100)}`,
        summary: e.why,
        body: e.action,
        platform: "web",
        targetUrl: httpUrl(e.url),
        meta: { event_name: e.name.slice(0, 160), date: e.date.slice(0, 60), location: e.location.slice(0, 120), audience: e.audience.slice(0, 160), cost: e.cost.slice(0, 60), organizer: e.organizer.slice(0, 120), why: e.why.slice(0, 300), score: 0.7 },
      });
      if (r.ok) made++;
    }
    ctx.stat("events_added", made);
    return { summary: `${kind} in ${area}: added ${made} events to the Sheet.`, ...(made ? {} : { restMinutes: QUIET_REST_MINUTES }) };
  },
};

export const GROWTH: AgentDef[] = [partnerships, events];
