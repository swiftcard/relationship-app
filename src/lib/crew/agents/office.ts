import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { propose } from "../approvals";
import { debate } from "../debate";
import { productFacts } from "../facts";
import { everContacted, personFor } from "../ledger";
import { funnelLine, recordSites, screenSearch, startFunnel } from "../leads/diagnostics";
import { pageTitle, phonesIn, readSiteDetailed, textOf, type SiteOutcome } from "../leads/fetch-page";
import { assessSites, type SiteAssessment } from "../leads/assess";
import { leadScore, namedOnSite, safeText, scoreLeads, withEmailStatus } from "../leads/quality";
import { cleanEmails, recordLeads } from "../leads/record";
import { minutesToTomorrow, nyDayStart } from "../schedule";
import { SHEET_MAX_PENDING } from "./replies";
import { syncLeadsToSheet } from "../sources/sheets";
import { searchItems } from "../sources/web-discovery";
import type { RunRow } from "../store";
import type { Lead } from "../types";
import { HUMAN_VOICE } from "../voice";

// ── E: Office outreach (for Aaron and Manaj to call) ────────────────────────
// Finds New York City real estate teams and other businesses with a team:
// owners, brokers, managers and sales heads, with the name, phone and email
// their own website publishes. They go on the Office sheet as call-ready rows
// (~30 a day) with a one-line talking point. It also drafts a few personal
// emails for approval and, weekly, suggests partnerships. Nothing is sent.

// The first ten are the original rotation; the neighborhoods after them were
// added 2026-11-02, when every real estate search on those ten had been run.
export const NYC_AREAS = [
  "Manhattan", "Brooklyn", "Queens", "the Bronx", "Staten Island", "Long Island City", "Williamsburg", "Upper East Side", "Midtown Manhattan", "Park Slope",
  "Upper West Side", "Harlem", "Chelsea", "Tribeca", "West Village", "Lower East Side", "Financial District", "Washington Heights", "Murray Hill", "Gramercy",
  "Astoria", "Forest Hills", "Flushing", "Bayside", "Jackson Heights", "Sunnyside", "Bay Ridge", "Bushwick", "Bedford-Stuyvesant", "Crown Heights",
  "Greenpoint", "Cobble Hill", "Fort Greene", "Carroll Gardens", "DUMBO", "Prospect Heights", "Brooklyn Heights", "Ditmas Park", "Sunset Park", "Riverdale",
];
/** Searched in every area: their sites name a broker or team leader (73% and 52% of rows did, against 20% for mortgage brokerages). */
export const PRIORITY_TYPES = ["real estate teams", "real estate brokerages"];
/** Searched in the original ten areas only, after the real estate rounds. */
export const OTHER_TYPES = ["mortgage brokerages", "insurance agencies", "staffing agencies", "property management companies", "commercial real estate firms"];
export const OFFICE_TYPES = [...PRIORITY_TYPES, ...OTHER_TYPES];
/** Every search, in order: real estate teams in each area, then brokerages in each area, then the other types. */
export const OFFICE_ROTATION: { area: string; type: string }[] = [
  ...PRIORITY_TYPES.flatMap((type) => NYC_AREAS.map((area) => ({ area, type }))),
  ...OTHER_TYPES.flatMap((type) => NYC_AREAS.slice(0, 10).map((area) => ({ area, type }))),
];
/** A search run within this many days is skipped: it finds the same offices, already saved. */
export const RESEARCH_AFTER_DAYS = 90;
export const ROLE = /\b(owner|founder|co-?founder|principal|broker|managing|manager|director|team lead(er)?|head of sales|sales (manager|director)|vp|vice president|president|ceo|partner)\b/i;

type Site = { name: string; website: string; area: string; type: string; pages: { url: string; html: string }[] };
/** What the site read found; older callers pass only people and a talking point. */
type Found = Pick<SiteAssessment, "people" | "talking_point"> & Partial<Omit<SiteAssessment, "people" | "talking_point">>;

export function officeQuery(n: number): { area: string; type: string } {
  const len = OFFICE_ROTATION.length;
  return OFFICE_ROTATION[((n % len) + len) % len];
}

const key = (type: string, area: string) => `${type}|${area}`.toLowerCase();

/** The searches this agent ran recently, read from its own run summaries ("real estate teams in Park Slope: …"). */
export function searchedRecently(runs: Pick<RunRow, "summary" | "started_at">[], now: Date, days = RESEARCH_AFTER_DAYS): Set<string> {
  const since = now.getTime() - days * 86_400_000;
  const out = new Set<string>();
  for (const r of runs) {
    if (new Date(r.started_at).getTime() < since) continue;
    const m = /^(.+?) in (.+?):/.exec(r.summary ?? "");
    if (m) out.add(key(m[1], m[2]));
  }
  return out;
}

/** The next search from slot `n` that hasn't been run recently; slot `n` itself if every one has. */
export function nextOfficeQuery(n: number, searched: Set<string>): { index: number; area: string; type: string } {
  for (let i = 0; i < OFFICE_ROTATION.length; i++) {
    const q = officeQuery(n + i);
    if (!searched.has(key(q.type, q.area))) return { index: n + i, ...q };
  }
  return { index: n, ...officeQuery(n) };
}

/**
 * One call row per office: the decision-maker the site names (the one whose
 * email the site shows first), with any other decision-makers named in the
 * talking point, and only contact details the site itself shows. When there's
 * a phone, the row carries a call opener even if there is no email.
 */
export function officeLeads(site: Site, found: Found | undefined): Lead[] {
  if (!site.pages.length) return [];
  if (found?.fit !== undefined && found.fit <= 0) return [];
  const rawText = site.pages.map((p) => textOf(p.html)).join(" ");
  const text = rawText.toLowerCase();
  const html = site.pages.map((p) => p.html.toLowerCase()).join(" ");
  const host = new URL(site.pages[0].url).hostname;
  const sitePhone = phonesIn(text)[0] ?? null;
  const company = (site.name || pageTitle(site.pages[0].html) || host).slice(0, 120);
  const onSite = (e: string) => !!e && (text.includes(e.toLowerCase()) || html.includes(e.toLowerCase()));
  const people = (found?.people ?? []).filter((p) => p.name && ROLE.test(p.title) && namedOnSite(p.name, rawText));
  const invented = (found?.people ?? []).filter((p) => !namedOnSite(p.name, rawText));
  const lead = people.find((p) => onSite(p.email)) ?? people[0] ?? null;
  const others = people.filter((p) => p !== lead).slice(0, 3).map((p) => `${p.name} (${p.title})`);
  const talking = [found?.talking_point?.trim(), others.length ? `Also on the site: ${others.join("; ")}.` : ""].filter(Boolean).join(" ");
  let row: Lead | null = null;
  const common = { list: "office" as const, company, business_type: site.type, city: "New York", region: "NY", country: "US", source_platform: "web" as const, source_url: site.pages[0].url, notes: talking.slice(0, 400) || null };
  if (lead) {
    const email = onSite(lead.email) ? lead.email.toLowerCase() : null;
    const digits = lead.phone.replace(/\D/g, "");
    const phone = digits.length >= 10 && text.replace(/\D/g, "").includes(digits.slice(-10)) ? digits : sitePhone;
    row = { ...common, name: lead.name.slice(0, 80), title: lead.title.slice(0, 80), email, phone };
  } else {
    // No named decision-maker on the site: still a callable office line.
    const email = cleanEmails([text], host)[0] ?? null;
    if (email || sitePhone) row = { ...common, name: null, title: "Main office", email, phone: sitePhone };
  }
  if (!row) return [];
  const fit = found?.fit;
  return [
    {
      ...row,
      why: found?.why?.trim().slice(0, 300) || null,
      hook: safeText(found?.hook, invented)?.slice(0, 300) ?? null,
      // A call opener needs a number to call.
      message: row.phone ? (safeText(found?.opener, invented)?.slice(0, 400) ?? null) : null,
      score: fit === undefined ? null : leadScore({ fit, name: row.name ?? null, title: row.title ?? null, email: row.email ?? null, emailStatus: null, phone: row.phone ?? null, industry: site.type }),
    },
  ];
}

async function findOffices(ctx: AgentContext, type: string, area: string): Promise<{ name: string; website: string }[]> {
  const items = await searchItems<{ name: string; website: string }>(ctx, {
    system: "You find businesses' official websites from web search results.",
    prompt: `Find ${type} in ${area}, New York City, that have a team of agents or staff (not law firms). Prefer ones whose own site names its owner, broker or team leader. For each: name, and website = the URL from the results where this team is presented: its own website if shown, otherwise its team or agent page on its brokerage's site (for example compass.com/agents/..., elliman.com/team/...). Never a directory, listing site or social media. Skip any team with no URL in the results.`,
    fields: ["name", "website"],
    maxUses: 6,
    want: 12,
  });
  return screenSearch(ctx, items, OFFICE_DIRECTORIES);
}

/** Listing, review and social sites: never an office's own page. */
export const OFFICE_DIRECTORIES = /(yelp|facebook|instagram|linkedin|zillow|streeteasy|realtor\.com|google)\./i;

const OFFICE_ID = "office-outreach";

export const officeOutreach: AgentDef = {
  id: OFFICE_ID,
  name: "Office Prospects",
  team: "office",
  role: "worker",
  tier: "sonnet",
  continuous: true,
  schedule: { kind: "every", minutes: 360 },
  dailyUsd: 1.5,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  maxPending: SHEET_MAX_PENDING,
  approvalKind: "dm",
  purpose: "Finds NYC real estate teams and other businesses with staff: owners, brokers and sales heads with phone and email, about 30 a day, for you to call about the Office Plan. One row per office, with the decision-maker the site names, a score, a talking point and a call opener whenever there is a phone number, and sometimes a personal email.",
  async run(ctx) {
    const today = await ctx.store.countLeadsSince(nyDayStart(ctx.now()).toISOString(), "office");
    const target = ctx.config<number>("daily_rows", 30);
    const have = Object.values(today).reduce((a, b) => a + b, 0);
    if (have >= target) return { summary: `Done for today: ${target} call rows are ready. Back tomorrow.`, restMinutes: minutesToTomorrow(ctx.now()) };

    startFunnel(ctx);
    // The rotation slot, moved past any search run in the last 90 days (one read of this agent's own runs).
    const recent = await ctx.store.recentRuns(OFFICE_ID, 400).catch(() => [] as RunRow[]);
    const { index, area, type } = nextOfficeQuery(ctx.config<number>("query_index", 0), searchedRecently(recent, ctx.now()));
    await ctx.saveConfig({ query_index: index + 1 });
    const found = await findOffices(ctx, type, area);
    const offices = found.slice(0, 8);
    const sites: Site[] = [];
    const outcomes: SiteOutcome[] = [];
    for (const o of offices) {
      const r = await readSiteDetailed(o.website);
      outcomes.push(r.outcome);
      sites.push({ ...o, area, type, pages: r.pages });
    }
    recordSites(ctx, { kept: found.length, outcomes });
    const readable = sites.filter((s) => s.pages.length);
    // Which step came up empty: the search, or reading the sites it found.
    if (!readable.length) return { summary: `${type} in ${area}: ${offices.length ? "no readable sites this time" : "the search found no office websites"}. Funnel: ${funnelLine(ctx.stats)}.` };

    const assessed = await assessSites(ctx, readable, { office: true }).catch(() => null);
    const fits = new Map<string, number>();
    const rows = readable.flatMap((s, i) => {
      const a = assessed?.find((x) => x.i === i);
      const out = officeLeads(s, a);
      if (a && a.fit <= 0) ctx.stat("rejected_poor_fit");
      else if (!out.length) ctx.stat("sites_no_contact");
      for (const l of out) if (a) fits.set(l.source_url, a.fit);
      return out;
    });
    const added = await recordLeads(ctx, scoreLeads(await withEmailStatus(rows), (l) => fits.get(l.source_url) ?? null));
    const synced = await syncLeadsToSheet(ctx.store, "office").catch(() => 0);
    const drafted = await draftEmails(ctx, rows.filter((r) => r.email && r.name).slice(0, 2));
    return { summary: `${type} in ${area}: ${added} new call rows${synced ? ` (${synced} on the sheet)` : ""}, ${drafted} email drafts. Funnel: ${funnelLine(ctx.stats)}.` };
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
      meta: { company: r.company, phone: r.phone, source_url: r.source_url, email: r.email, name: r.name, title: r.title, business_type: r.business_type, talking_point: r.notes },
    });
    if (res.ok) made++;
  }
  ctx.stat("emails_drafted", made);
  return made;
}

export const OFFICE: AgentDef[] = [officeOutreach];
