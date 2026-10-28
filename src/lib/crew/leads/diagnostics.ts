import type { AgentContext } from "../context";
import type { SiteOutcome } from "./fetch-page";
import { companyKey } from "./quality";

// ── Where a lead run's businesses went ──────────────────────────────────────
// Every Web Leads and Office Prospects run records the same funnel in its
// stats: what the search returned, what was filtered out, which sites could
// be read and why the others couldn't, and what became of the readable ones.
// Counts only: no business name, address, email or phone ever goes in here,
// so a run's stats can be read and shared without exposing anyone.

/** Every key a lead run reports, in funnel order. Each one is written on every run, 0 included. */
export const LEAD_RUN_STATS = [
  "search_results",
  "search_filtered_directory",
  "search_filtered_invalid_url",
  "search_repeats",
  "unique_companies",
  "sites_not_attempted",
  "sites_attempted",
  "sites_blocked_robots",
  "sites_http_403",
  "sites_http_error",
  "sites_timeout",
  "sites_unreadable",
  "sites_readable",
  "sites_no_contact",
  "rejected_poor_fit",
  "duplicates_rejected",
  "contacts_suppressed",
  "leads_added",
  "usable_leads",
] as const;
export type LeadRunStat = (typeof LEAD_RUN_STATS)[number];

/** Start a run's funnel at zero, so a step that saw nothing still says 0 rather than being missing. */
export function startFunnel(ctx: Pick<AgentContext, "stat">): void {
  for (const k of LEAD_RUN_STATS) ctx.stat(k, 0);
}

/**
 * The search step: what came back, what was dropped (no usable URL, or a
 * directory, listing or social site), and how many different companies are
 * left. Returns the items to read, in the search's order (repeats kept, so
 * the run behaves exactly as before; the database turns a repeat away).
 */
export function screenSearch<T extends { name?: string; website: string }>(ctx: Pick<AgentContext, "stat">, items: T[], directory: RegExp): T[] {
  ctx.stat("search_results", items.length);
  const kept: T[] = [];
  const companies = new Set<string>();
  for (const b of items) {
    if (!/^https?:\/\//i.test(b.website ?? "")) {
      ctx.stat("search_filtered_invalid_url");
      continue;
    }
    if (directory.test(b.website)) {
      ctx.stat("search_filtered_directory");
      continue;
    }
    const key = companyKey({ source_url: b.website, company: b.name ?? null });
    if (key && companies.has(key)) ctx.stat("search_repeats");
    if (key) companies.add(key);
    kept.push(b);
  }
  ctx.stat("unique_companies", companies.size);
  return kept;
}

const OUTCOME_STAT: Record<SiteOutcome, LeadRunStat> = {
  readable: "sites_readable",
  robots: "sites_blocked_robots",
  http_403: "sites_http_403",
  http_error: "sites_http_error",
  timeout: "sites_timeout",
  unreadable: "sites_unreadable",
};

/** The site step: how many were tried, how many were left over the per-run cap, and what happened to each. */
export function recordSites(ctx: Pick<AgentContext, "stat">, o: { kept: number; outcomes: SiteOutcome[] }): void {
  ctx.stat("sites_attempted", o.outcomes.length);
  ctx.stat("sites_not_attempted", Math.max(0, o.kept - o.outcomes.length));
  for (const outcome of o.outcomes) ctx.stat(OUTCOME_STAT[outcome]);
}

/** One line for the run summary: where the businesses went, in counts. */
export function funnelLine(stats: Record<string, number>): string {
  const n = (k: LeadRunStat) => stats[k] ?? 0;
  const blocked = n("sites_blocked_robots") + n("sites_http_403");
  const failed = n("sites_http_error") + n("sites_timeout") + n("sites_unreadable");
  const parts = [
    `search ${n("search_results")}`,
    `${n("search_filtered_directory") + n("search_filtered_invalid_url")} filtered`,
    `${n("sites_attempted")} tried`,
    `${n("sites_readable")} readable`,
    ...(blocked ? [`${blocked} blocked (${n("sites_blocked_robots")} robots.txt, ${n("sites_http_403")} refused)`] : []),
    ...(failed ? [`${failed} failed`] : []),
    ...(n("rejected_poor_fit") ? [`${n("rejected_poor_fit")} poor fit`] : []),
    ...(n("duplicates_rejected") ? [`${n("duplicates_rejected")} duplicate`] : []),
    `${n("leads_added")} saved`,
  ];
  return parts.join(", ");
}
