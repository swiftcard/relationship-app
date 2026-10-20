import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { propose } from "../approvals";
import { debate } from "../debate";
import { productFacts } from "../facts";
import { everContacted, personFor } from "../ledger";
import { pageTitle, phonesIn, readSite, textOf } from "../leads/fetch-page";
import { cleanEmails, recordLeads } from "../leads/record";
import { nyDayStart } from "../schedule";
import { syncLeadsToSheet } from "../sources/sheets";
import { searchItems } from "../sources/web-discovery";
import type { Lead } from "../types";
import { HUMAN_VOICE } from "../voice";

// ── E: Office outreach (for Aaron and Manaj to call) ────────────────────────
// Finds New York City real estate teams and other businesses with a team:
// owners, brokers, managers and sales heads, with the name, phone and email
// their own website publishes. They go on the Office sheet as call-ready rows
// (~30 a day) with a one-line talking point. It also drafts a few personal
// emails for approval and, weekly, suggests partnerships. Nothing is sent.

export const NYC_AREAS = ["Manhattan", "Brooklyn", "Queens", "the Bronx", "Staten Island", "Long Island City", "Williamsburg", "Upper East Side", "Midtown Manhattan", "Park Slope"];
export const OFFICE_TYPES = ["real estate teams", "real estate brokerages", "mortgage brokerages", "insurance agencies", "staffing agencies", "property management companies", "commercial real estate firms"];
export const ROLE = /\b(owner|founder|co-?founder|principal|broker|managing|manager|director|team lead(er)?|head of sales|sales (manager|director)|vp|vice president|president|ceo|partner)\b/i;

const PEOPLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sites"],
  properties: {
    sites: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "people", "talking_point"],
        properties: {
          i: { type: "integer" },
          talking_point: { type: "string" },
          people: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "title", "email", "phone"],
              properties: { name: { type: "string" }, title: { type: "string" }, email: { type: "string" }, phone: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

type Site = { name: string; website: string; area: string; type: string; pages: { url: string; html: string }[] };
type People = { i: number; talking_point: string; people: { name: string; title: string; email: string; phone: string }[] };

export function officeQuery(n: number): { area: string; type: string } {
  return { area: NYC_AREAS[n % NYC_AREAS.length], type: OFFICE_TYPES[Math.floor(n / NYC_AREAS.length) % OFFICE_TYPES.length] };
}

/** Only decision-makers, and only contact details the site itself shows. */
export function officeLeads(site: Site, found: People | undefined): Lead[] {
  if (!site.pages.length) return [];
  const text = site.pages.map((p) => textOf(p.html)).join(" ").toLowerCase();
  const html = site.pages.map((p) => p.html.toLowerCase()).join(" ");
  const host = new URL(site.pages[0].url).hostname;
  const sitePhone = phonesIn(text)[0] ?? null;
  const company = site.name || pageTitle(site.pages[0].html) || host;
  const rows: Lead[] = [];
  for (const p of found?.people ?? []) {
    if (!p.name || !ROLE.test(p.title)) continue;
    const email = p.email && (text.includes(p.email.toLowerCase()) || html.includes(p.email.toLowerCase())) ? p.email.toLowerCase() : null;
    const digits = p.phone.replace(/\D/g, "");
    const phone = digits.length >= 10 && text.replace(/\D/g, "").includes(digits.slice(-10)) ? digits : sitePhone;
    rows.push({ list: "office", name: p.name.slice(0, 80), title: p.title.slice(0, 80), email, phone, company: company.slice(0, 120), business_type: site.type, city: "New York", region: "NY", country: "US", source_platform: "web", source_url: site.pages[0].url, notes: found?.talking_point?.slice(0, 240) ?? null });
  }
  if (!rows.length) {
    // No named decision-maker on the site: still a callable office line.
    const email = cleanEmails([text], host)[0] ?? null;
    if (email || sitePhone) rows.push({ list: "office", name: null, title: "Main office", email, phone: sitePhone, company: company.slice(0, 120), business_type: site.type, city: "New York", region: "NY", country: "US", source_platform: "web", source_url: site.pages[0].url, notes: found?.talking_point?.slice(0, 240) ?? null });
  }
  return rows.slice(0, 4);
}

async function findOffices(ctx: AgentContext, type: string, area: string): Promise<{ name: string; website: string }[]> {
  const items = await searchItems<{ name: string; website: string }>(ctx, {
    system: "You find businesses' official websites from web search results.",
    prompt: `Find ${type} in ${area}, New York City, that have a team of agents or staff (not law firms). For each: name, and website = the URL from the results where this team is presented: its own website if shown, otherwise its team or agent page on its brokerage's site (for example compass.com/agents/..., elliman.com/team/...). Never a directory, listing site or social media. Skip any team with no URL in the results.`,
    fields: ["name", "website"],
    maxUses: 6,
    want: 12,
  });
  return items.filter((b) => /^https?:\/\//.test(b.website) && !/(yelp|facebook|instagram|linkedin|zillow|streeteasy|realtor\.com|google)\./i.test(b.website));
}

export const officeOutreach: AgentDef = {
  id: "office-outreach",
  name: "Office outreach",
  team: "office",
  role: "worker",
  tier: "sonnet",
  schedule: { kind: "every", minutes: 360 },
  dailyUsd: 1.5,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: 6,
  approvalKind: "dm",
  purpose: "Finds NYC real estate teams and other businesses with staff: owners, brokers and sales heads with phone and email, about 30 a day, for you to call about the Office Plan. Drafts a few personal emails and suggests partnerships.",
  async run(ctx) {
    const today = await ctx.store.countLeadsSince(nyDayStart(ctx.now()).toISOString(), "office");
    const target = ctx.config<number>("daily_rows", 30);
    const have = Object.values(today).reduce((a, b) => a + b, 0);
    if (have >= target) return { summary: `Today's ${target} call rows are ready.` };

    const n = ctx.config<number>("query_index", 0);
    const { area, type } = officeQuery(n);
    await ctx.saveConfig({ query_index: n + 1 });
    const offices = (await findOffices(ctx, type, area)).slice(0, 8);
    const sites: Site[] = [];
    for (const o of offices) sites.push({ ...o, area, type, pages: await readSite(o.website) });
    const readable = sites.filter((s) => s.pages.length);
    if (!readable.length) return { summary: `${type} in ${area}: no readable sites this time.` };

    const extracted = await ctx.llm.askJson<{ sites: People[] }>("extract", {
      effort: "low",
      maxTokens: 4000,
      schema: PEOPLE_SCHEMA as unknown as Record<string, unknown>,
      system: "You read business websites and list the decision-makers the site itself names (owner, broker, founder, managing director, team lead, head of sales). Copy names, titles, emails and phones EXACTLY as shown; use an empty string when not shown. Never guess an email. Also write one short talking point for a phone call about a team digital business card plan (what this business would care about).",
      prompt: readable.map((s, i) => `SITE #${i} ${s.name} (${s.website}):\n${s.pages.map((p) => textOf(p.html).slice(0, 2500)).join("\n")}`).join("\n\n====\n\n"),
    });
    const rows = readable.flatMap((s, i) => officeLeads(s, extracted?.sites.find((x) => x.i === i)));
    const added = await recordLeads(ctx, rows);
    const synced = await syncLeadsToSheet(ctx.store, "office").catch(() => 0);
    const drafted = await draftEmails(ctx, rows.filter((r) => r.email && r.name).slice(0, 2));
    await partnerships(ctx, readable.map((s) => s.name));
    return { summary: `${type} in ${area}: ${added} new call rows${synced ? ` (${synced} on the sheet)` : ""}, ${drafted} email drafts.` };
  },
};

async function draftEmails(ctx: AgentContext, rows: Lead[]): Promise<number> {
  let made = 0;
  for (const r of rows) {
    const pid = await personFor(ctx.store, "email", r.email!, r.name);
    if (!pid || (await everContacted(ctx.store, pid))) continue;
    const system = `${HUMAN_VOICE}\n\n${productFacts()}`;
    const brief = `${r.name}, ${r.title} at ${r.company} (${r.business_type}, New York). Talking point: ${r.notes ?? "none"}. Source: ${r.source_url}`;
    const prompt = `Write a short personal email from one of SwiftCard's two founders to this person about the SwiftCard Office Plan (digital business cards and a shared lead inbox for their whole team). First line "Subject: ...". Under 110 words. Specific to their business, no hype, one clear ask: a 10-minute call.\n\n${brief}`;
    const first = await ctx.llm.ask("draft", { system, effort: "medium", maxTokens: 1000, prompt });
    if (!first.text) continue;
    const { final, record } = await debate(ctx, {
      kind: "dm",
      draft: first.text,
      brief,
      rules: system,
      revise: async (d, issues) => (await ctx.llm.ask("revise", { system, effort: "medium", maxTokens: 1000, prompt: `${prompt}\n\nDRAFT:\n${d}\n\nFix: ${issues.join("; ")}` })).text || d,
    });
    const res = await propose(ctx, {
      kind: "dm",
      title: `Office email to ${r.name} (${r.company})`,
      summary: `${r.title} at ${r.company} in New York. Approve it, then send it from your own email.`,
      body: final,
      platform: "email",
      person: { platform: "email", handle: r.email!, name: r.name },
      debate: record,
      meta: { company: r.company, phone: r.phone, source_url: r.source_url },
    });
    if (res.ok) made++;
  }
  ctx.stat("emails_drafted", made);
  return made;
}

async function partnerships(ctx: AgentContext, names: string[]) {
  const last = ctx.config<number>("partners_at", 0);
  if (Date.now() - last < 7 * 86400_000) return;
  await ctx.saveConfig({ partners_at: Date.now() });
  const res = await ctx.llm.ask("partners", {
    effort: "low",
    maxTokens: 1200,
    system: "You suggest practical partnerships for a tiny startup that sells digital business cards and a team plan to real estate offices and local businesses.",
    prompt: `Suggest 3 to 5 concrete partnership ideas in New York City (associations, brokerage networks, coworking spaces, real estate schools, vendors who already sell to these offices). One line each, starting with "- ". Plain words. Businesses we just looked at: ${names.slice(0, 10).join(", ")}.`,
  });
  if (!res.text) return;
  await propose(ctx, { kind: "ask", title: "Partnership ideas this week", summary: "Ideas for partners who already reach the offices we want. Approve the ones worth a call.", body: res.text, platform: "web" });
}

export const OFFICE: AgentDef[] = [officeOutreach];
