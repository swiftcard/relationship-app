import type { AgentDef } from "../agent-def";
import type { AgentContext } from "../context";
import { mailtos, pageTitle, phonesIn, readSite, textOf } from "../leads/fetch-page";
import { cleanEmails, leadsToday, recordLeads } from "../leads/record";
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

export const DAILY_CEILING = 3000;

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
  return items
    .filter((b) => /^https?:\/\//.test(b.website) && !/(yelp|facebook|instagram|linkedin|zillow|realtor\.com|yellowpages|bbb\.org|google|mapquest|angi|thumbtack|houzz|nextdoor)\./i.test(b.website))
    .map((b) => ({ name: b.name, website: b.website, city: b.city || undefined, state: b.state || undefined }));
}

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

export function leadsFromSite(biz: Biz, pages: { url: string; html: string }[], type: string): Lead[] {
  if (!pages.length) return [];
  const host = new URL(pages[0].url).hostname;
  const emails = cleanEmails(pages.flatMap((p) => [...mailtos(p.html), textOf(p.html)]), host).slice(0, 3);
  const phone = phonesIn(pages.map((p) => textOf(p.html)).join(" "))[0] ?? null;
  const company = biz.name || pageTitle(pages[0].html) || host;
  const where = pages.find((p) => emails.some((e) => p.html.toLowerCase().includes(e)))?.url ?? pages[0].url;
  return emails.map((email) => ({
    list: "cold" as const,
    name: null,
    email,
    phone,
    company: company.slice(0, 120),
    business_type: type,
    city: biz.city ?? null,
    region: biz.state ?? null,
    country: "US",
    source_platform: "web" as const,
    source_url: where,
  }));
}

const base = { team: "leads" as const, role: "worker" as const, tier: "sonnet" as const, maxPending: 2 };

export const leadsWeb: AgentDef = {
  ...base,
  id: "leads-web",
  name: "Open-web leads",
  schedule: { kind: "every", minutes: 30 },
  dailyUsd: 3,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  purpose: "Runs all day: searches for business types in US cities (like real estate offices in Charlotte), reads their own websites and saves the business emails they publish to the lead sheet.",
  async run(ctx) {
    const ceiling = ctx.config<number>("daily_ceiling", DAILY_CEILING);
    if ((await leadsToday(ctx, "cold")) >= ceiling) return { summary: `Reached today's ceiling of ${ceiling} leads.` };
    const n = ctx.config<number>("query_index", 0);
    const { type, city } = queryAt(n);
    await ctx.saveConfig({ query_index: n + 1 });
    const found = await findBusinesses(ctx, type, city);
    const perRun = ctx.config<number>("sites_per_run", 12);
    const sites = await pool(found.slice(0, perRun), 4, async (b) => leadsFromSite(b, await readSite(b.website), type));
    const added = await recordLeads(ctx, sites.flat());
    ctx.stat("sites_read", Math.min(found.length, perRun));
    const synced = await syncLeadsToSheet(ctx.store, "cold").catch((e) => (ctx.log(`sheet: ${e instanceof Error ? e.message : e}`), 0));
    return { summary: `${type} in ${city}: read ${Math.min(found.length, perRun)} sites, saved ${added} new emails${synced ? `, ${synced} copied to the sheet` : ""}.` };
  },
};

export const leadsReddit: AgentDef = {
  ...base,
  id: "leads-reddit",
  name: "Reddit leads",
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
  name: "Quora leads",
  schedule: { kind: "daily", hour: 16, minute: 30 },
  dailyUsd: 0.3,
  needs: ["CREW_ANTHROPIC_API_KEY"],
  purpose: "Looks for business owners on Quora who list a public business email, and saves them to the lead sheet. No messages.",
  async run(ctx) {
    const found = await searchPlatform(ctx, "quora", ["profiles or answers by realtors, loan officers, recruiters or local service business owners that list a business email address"], 15);
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

export const leadsFacebook = pasteLeads("facebook", "leads-facebook", "Facebook group leads", "Facebook group posts and pages");
export const leadsAlignable = pasteLeads("alignable", "leads-alignable", "Alignable leads", "Alignable profiles");

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
