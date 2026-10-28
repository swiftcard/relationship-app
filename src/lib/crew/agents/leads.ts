import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { mailtos, pageTitle, phonesIn, readSiteDetailed, textOf } from "../leads/fetch-page";
import { funnelLine, recordSites, screenSearch, startFunnel } from "../leads/diagnostics";
import { assessSites, type SiteAssessment } from "../leads/assess";
import { DECISION_ROLE, isGenericEmail, leadScore, namedOnSite, safeText, scoreLeads, withEmailStatus } from "../leads/quality";
import { cleanEmails, leadsToday, recordLeads } from "../leads/record";
import { pairs, rotate } from "../replies/engine";
import { minutesToTomorrow } from "../schedule";
import { PROFESSIONS, US_METROS } from "../search-plan";
import { emailsIn } from "../ledger";
import { redditConfigured, searchSubreddits } from "../sources/reddit";
import { syncLeadsToSheet } from "../sources/sheets";
import { searchItems, searchPlatform } from "../sources/web-discovery";
import type { Lead, Platform } from "../types";

// ── Team 3: Email lead scraping (list building only) ────────────────────────
// No agent here sends anything. They find business people who PUBLICLY share
// an email for business, record name + email + where + when, and copy new
// rows to the Google Sheet. The meeting's 2,000 to 3,000 a day is a ceiling;
// the manager reports the real count. Facebook groups and Alignable can't be
// read by apps (and their terms forbid scraping), so those two work only from
// what the owner pastes. LinkedIn scraping breaks LinkedIn's terms, so that
// agent exists only as a locked placeholder.

export const BUSINESS_TYPES = [
  "real estate offices",
  "real estate teams",
  "mortgage brokers",
  "loan officers",
  "insurance agencies",
  "recruiting agencies",
  "staffing agencies",
  "property management companies",
  "real estate investors wholesale",
  "window cleaning companies",
  "landscaping companies",
  "plumbing companies",
  "HVAC companies",
  "roofing contractors",
  "house cleaning services",
  "car dealerships",
  "photographers",
  "sales training companies",
];

export const US_CITIES = [
  "New York, NY", "Los Angeles, CA", "Chicago, IL", "Houston, TX", "Phoenix, AZ", "Philadelphia, PA", "San Antonio, TX", "San Diego, CA", "Dallas, TX", "Austin, TX",
  "Jacksonville, FL", "Fort Worth, TX", "Columbus, OH", "Charlotte, NC", "Indianapolis, IN", "Seattle, WA", "Denver, CO", "Nashville, TN", "Oklahoma City, OK", "Boston, MA",
  "Las Vegas, NV", "Portland, OR", "Memphis, TN", "Louisville, KY", "Baltimore, MD", "Milwaukee, WI", "Albuquerque, NM", "Tucson, AZ", "Fresno, CA", "Sacramento, CA",
  "Kansas City, MO", "Atlanta, GA", "Miami, FL", "Raleigh, NC", "Omaha, NE", "Minneapolis, MN", "Tampa, FL", "Orlando, FL", "Cleveland, OH", "Pittsburgh, PA",
  "Cincinnati, OH", "St. Louis, MO", "Salt Lake City, UT", "Richmond, VA", "Birmingham, AL", "Boise, ID", "Scottsdale, AZ", "Charleston, SC", "Greenville, SC", "Knoxville, TN",
];

/** New leads a day, unless Controls → "New leads per day (max)" says otherwise (the spec's target; the same number the Controls tab shows). */
export const DAILY_LEAD_LIMIT = 1000;

/** The n-th query of an endless rotation through business types × cities. */
export function queryAt(n: number): { type: string; city: string } {
  const i = n % (BUSINESS_TYPES.length * US_CITIES.length);
  return { type: BUSINESS_TYPES[i % BUSINESS_TYPES.length], city: US_CITIES[Math.floor(i / BUSINESS_TYPES.length) % US_CITIES.length] };
}

type Biz = { name: string; website: string; city?: string; state?: string };

async function findBusinesses(ctx: AgentContext, type: string, city: string): Promise<Biz[]> {
  const items = await searchItems<{ name: string; website: string; city: string; state: string }>(ctx, {
    system: "You find local businesses' official websites from web search results.",
    prompt: `Find ${type} in ${city} (not law firms). For each: name, website = the business's own website as shown in the results (never a directory, review site or social media; skip the business if its own site isn't in the results), city, state (two-letter code).`,
    fields: ["name", "website", "city", "state"],
    maxUses: 5,
    want: 15,
  });
  return screenSearch(ctx, items, WEB_DIRECTORIES).map((b) => ({ name: b.name, website: b.website, city: b.city || undefined, state: b.state || undefined }));
}

/** Directories, review and social sites: never a business's own website. */
export const WEB_DIRECTORIES = /(yelp|facebook|instagram|linkedin|zillow|realtor\.com|yellowpages|bbb\.org|google|mapquest|angi|thumbtack|houzz|nextdoor)\./i;

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) out.push(await fn(items[i++]));
    }),
  );
  return out;
}

/**
 * One lead per business: the decision-maker the site names (with their own
 * email when the site shows it), else the site's best address, with the
 * score, why and hook from the site read. Everything the model reports is
 * checked against the pages: a name the site doesn't show is dropped, and so
 * is an email. A business the read calls no fit at all is skipped.
 */
export function leadsFromSite(biz: Biz, pages: { url: string; html: string }[], type: string, found?: SiteAssessment): Lead[] {
  if (!pages.length) return [];
  if (found && found.fit <= 0) return [];
  const host = new URL(pages[0].url).hostname;
  const text = pages.map((p) => textOf(p.html)).join(" ");
  const html = pages.map((p) => p.html.toLowerCase()).join(" ");
  const emails = cleanEmails(pages.flatMap((p) => [...mailtos(p.html), textOf(p.html)]), host);
  const onSite = (e: string) => !!e && (html.includes(e.toLowerCase()) || text.toLowerCase().includes(e.toLowerCase()));
  const people = (found?.people ?? []).filter((p) => p.name && DECISION_ROLE.test(p.title) && namedOnSite(p.name, text));
  const invented = (found?.people ?? []).filter((p) => !namedOnSite(p.name, text));
  const person = people.find((p) => onSite(p.email)) ?? people[0] ?? null;
  const personal = person && onSite(person.email) ? person.email.toLowerCase() : null;
  const email = personal ?? emails.find((e) => !isGenericEmail(e)) ?? emails[0] ?? null;
  if (!email) return [];
  const phone = phonesIn(text)[0] ?? null;
  const company = biz.name || pageTitle(pages[0].html) || host;
  const where = pages.find((p) => p.html.toLowerCase().includes(email))?.url ?? pages[0].url;
  const others = emails.filter((e) => e !== email).slice(0, 3);
  const name = person?.name.slice(0, 80) ?? null;
  const title = person?.title.slice(0, 80) ?? null;
  return [
    {
      list: "cold" as const,
      name,
      title,
      email,
      phone,
      company: company.slice(0, 120),
      business_type: type,
      city: biz.city ?? null,
      region: biz.state ?? null,
      country: "US",
      source_platform: "web" as const,
      source_url: where,
      notes: others.length ? `Other addresses on the site: ${others.join(", ")}` : null,
      why: found?.why.trim().slice(0, 300) || null,
      hook: safeText(found?.hook, invented)?.slice(0, 300) ?? null,
      message: safeText(found?.opener, invented)?.slice(0, 300) ?? null,
      // Scored again once the email's domain is checked (scoreLeads).
      score: found ? leadScore({ fit: found.fit, name, title, email, emailStatus: null, phone, industry: type }) : null,
    },
  ];
}

const base = { team: "leads" as const, role: "worker" as const, tier: "sonnet" as const, maxPending: 2 };

export const leadsWeb: AgentDef = {
  ...base,
  id: "leads-web",
  name: "Web Leads",
  continuous: true,
  schedule: { kind: "every", minutes: 30 },
  dailyUsd: 3,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  purpose: "Runs all day: searches for business types in US cities (like real estate offices in Charlotte), reads their own websites and saves one lead per business: the owner or manager the site names, the best email and phone it publishes, a score, why they fit and an opening line. Sheet sync copies them to Web Leads in the SwiftCard Leads sheet.",
  async run(ctx) {
    // Controls → "New leads per day (max)" wins over the agent's own default.
    const limit = Number((await ctx.store.getControls().catch(() => ({}) as Record<string, unknown>)).daily_lead_limit ?? NaN);
    const ceiling = Number.isFinite(limit) ? limit : DAILY_LEAD_LIMIT;
    if ((await leadsToday(ctx, "cold")) >= ceiling) return { summary: `Done for today: ${ceiling} new leads is today's limit. Back tomorrow.`, restMinutes: minutesToTomorrow(ctx.now()) };
    startFunnel(ctx);
    const n = ctx.config<number>("query_index", 0);
    const { type, city } = queryAt(n);
    await ctx.saveConfig({ query_index: n + 1 });
    const found = await findBusinesses(ctx, type, city);
    const perRun = ctx.config<number>("sites_per_run", 12);
    const read = await pool(found.slice(0, perRun), 4, async (b) => ({ biz: b, ...(await readSiteDetailed(b.website)) }));
    recordSites(ctx, { kept: found.length, outcomes: read.map((r) => r.outcome) });
    const readable = read.filter((r) => r.pages.length);
    // One cheap read of every site for the decision-maker, fit, why and hook (null: the pages alone still give the email).
    const assessed = await assessSites(ctx, readable.map((r) => ({ name: r.biz.name, website: r.biz.website, type, area: city, pages: r.pages })), { office: false }).catch(() => null);
    const fits = new Map<string, number>();
    const leads = readable.flatMap((r, i) => {
      const a = assessed?.find((x) => x.i === i);
      const out = leadsFromSite(r.biz, r.pages, type, a);
      if (a && a.fit <= 0) ctx.stat("rejected_poor_fit");
      else if (!out.length) ctx.stat("sites_no_contact");
      for (const l of out) if (a) fits.set(l.source_url, a.fit);
      return out;
    });
    const added = await recordLeads(ctx, scoreLeads(await withEmailStatus(leads), (l) => fits.get(l.source_url) ?? null));
    const synced = await syncLeadsToSheet(ctx.store, "cold").catch((e) => (ctx.log(`sheet: ${e instanceof Error ? e.message : e}`), 0));
    return { summary: `${type} in ${city}: saved ${added} new businesses${synced ? `, ${synced} copied to the sheet` : " (Sheet sync adds them to the Sheet)"}. Funnel: ${funnelLine(ctx.stats)}.` };
  },
};

export const leadsReddit: AgentDef = {
  ...base,
  id: "leads-reddit",
  name: "Reddit Leads",
  continuous: true,
  schedule: { kind: "daily", hour: 16, minute: 0 },
  dailyUsd: 0.1,
  needs: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USER_AGENT"],
  purpose: "Looks for business owners on Reddit who post a business email publicly, and saves them to the lead sheet. No messages.",
  async run(ctx) {
    if (!redditConfigured()) return { summary: "Needs the Reddit keys.", status: "skipped" };
    const subs = ["realtors", "RealEstate", "smallbusiness", "sweatystartup", "WindowCleaning", "landscaping", "Plumbing", "mortgage", "recruiting", "sales"];
    const leads: Lead[] = [];
    for (const q of ["\"email me at\"", "\"reach me at\"", "\"contact me at\""]) {
      for (const p of await searchSubreddits(subs, q, 25)) {
        for (const email of cleanEmails([p.text])) leads.push({ list: "cold", name: `u/${p.author}`, email, source_platform: "reddit", source_url: p.url, business_type: `r/${p.subreddit}`, country: null });
      }
    }
    ctx.stat("no_llm_needed");
    const added = await recordLeads(ctx, leads);
    await syncLeadsToSheet(ctx.store, "cold").catch(() => 0);
    return { summary: `Saved ${added} new emails from Reddit.` };
  },
};

export const leadsQuora: AgentDef = {
  ...base,
  id: "leads-quora",
  name: "Quora Leads",
  continuous: true,
  schedule: { kind: "daily", hour: 16, minute: 30 },
  dailyUsd: 0.3,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  purpose: "Looks for business owners on Quora who list a public business email, and saves them to the lead sheet. No messages.",
  async run(ctx) {
    const [[who, where]] = await rotate(ctx, "where_i", pairs(PROFESSIONS, US_METROS), 1);
    const found = await searchPlatform(ctx, "quora", [`profiles or answers by ${who} in ${where} that list a business email address`], 15);
    const leads = found.flatMap((f) => cleanEmails([f.text]).map((email) => ({ list: "cold" as const, name: f.author, email, source_platform: "quora" as const, source_url: f.url })));
    const added = await recordLeads(ctx, leads);
    await syncLeadsToSheet(ctx.store, "cold").catch(() => 0);
    return { summary: `Read ${found.length} Quora results, saved ${added} new emails.` };
  },
};

function pasteLeads(platform: Platform, id: string, name: string, why: string): AgentDef {
  return {
    ...base,
    id,
    name,
    schedule: { kind: "every", minutes: 60 },
    dailyUsd: 0,
    needs: [],
    purpose: `Saves any business email in the ${why} you paste into Paste a post. No AI, no messages.`,
    async run(ctx) {
      const since = ctx.config<string>("cursor", "1970-01-01T00:00:00Z");
      const inputs = await ctx.store.listInputsSince([platform], since, 200);
      if (!inputs.length) {
        ctx.stat("no_llm_needed");
        return { summary: "Nothing new pasted." };
      }
      const leads = inputs.flatMap((i) => emailsIn(i.text).map((email) => ({ list: "cold" as const, email, name: i.text.split("\n")[0].slice(0, 80), source_platform: platform, source_url: i.url ?? `paste:${i.id}` })));
      const added = await recordLeads(ctx, leads);
      await ctx.saveConfig({ cursor: inputs[inputs.length - 1].created_at });
      await syncLeadsToSheet(ctx.store, "cold").catch(() => 0);
      ctx.stat("no_llm_needed");
      return { summary: `Checked ${inputs.length} pasted items, saved ${added} new emails.` };
    },
  };
}

export const leadsFacebook = pasteLeads("facebook", "leads-facebook", "Facebook Group Leads", "Facebook group posts and pages");
export const leadsAlignable = pasteLeads("alignable", "leads-alignable", "Alignable Leads", "Alignable profiles");

export const leadsLinkedIn: AgentDef = {
  ...base,
  id: "leads-linkedin",
  name: "LinkedIn leads (not allowed)",
  schedule: { kind: "daily", hour: 17 },
  dailyUsd: 0,
  needs: [],
  purpose: "The meeting listed it once, then dropped it. Collecting emails from LinkedIn breaks LinkedIn's User Agreement, so this stays off.",
  locked: "Scraping LinkedIn breaks its User Agreement and risks the company account.",
  async run() {
    return { summary: "Locked.", status: "skipped" };
  },
};

export const LEADS: AgentDef[] = [leadsWeb, leadsReddit, leadsFacebook, leadsAlignable, leadsQuora, leadsLinkedIn];
