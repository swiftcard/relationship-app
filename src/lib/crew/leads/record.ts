import type { AgentContext } from "../context";
import { emailsIn, personFor } from "../ledger";
import { nyDayStart } from "../schedule";
import type { Lead } from "../types";
import { companyKey, usable } from "./quality";
import { isRestrictedRegion } from "./region";

// ── Saving leads: source and date always, suppression always ────────────────
// No message is sent by any lead agent. Each row keeps where and when it was
// found; anything on the suppression (unsubscribe) list, by address or whole
// domain, is never saved; GDPR-style regions are flagged and kept out of the
// sheet and exports. Being listed is recorded in the ledger as "lead_listed",
// which is NOT contact (it doesn't block a later DM).

export const BAD_LOCALS = /^(noreply|no-reply|donotreply|privacy|abuse|postmaster|webmaster|hostmaster|security|legal|dmca|unsubscribe|bounce)@/;

export function cleanEmails(raw: string[], siteHost?: string | null): string[] {
  const all = [...new Set(raw.flatMap((r) => emailsIn(r)))].filter((e) => !BAD_LOCALS.test(e) && e.length <= 120);
  if (!siteHost) return all;
  const host = siteHost.replace(/^www\./, "");
  // Prefer the business's own domain; keep free-mail addresses it publishes.
  const own = all.filter((e) => e.endsWith(`@${host}`) || e.split("@")[1].endsWith(`.${host}`));
  const free = all.filter((e) => /@(gmail|yahoo|outlook|hotmail|icloud|aol|me|live|msn)\.com$/.test(e));
  return [...own, ...free].length ? [...own, ...free] : all.slice(0, 1);
}

/**
 * Save leads: suppressed contacts never, one lead per company across both
 * lists (a company already on either list is a duplicate, and the leads
 * already saved are never touched), and the run's stats say what happened:
 * duplicates_rejected, contacts_suppressed, usable_leads (a phone, or an
 * email whose domain can receive mail), leads_added.
 */
export async function recordLeads(ctx: AgentContext, leads: Lead[]): Promise<number> {
  const keep: Lead[] = [];
  let suppressed = 0;
  let duplicates = 0;
  for (const l of leads) {
    if (!l.email && !l.phone) continue;
    const email = l.email?.toLowerCase() ?? null;
    const checks = email ? [email, `@${email.split("@")[1]}`] : [];
    if (checks.length && (await ctx.store.isSuppressed(checks))) {
      suppressed++;
      continue;
    }
    let host: string | null = null;
    try {
      host = new URL(l.source_url).hostname;
    } catch {
      /* pasted source */
    }
    keep.push({ ...l, email, company_key: l.company_key ?? companyKey(l), region_restricted: l.region_restricted || isRestrictedRegion({ country: l.country, host, email }) });
  }
  // One per company: against everything already saved, and within this batch.
  const taken = await ctx.store.companyKeysTaken(keep.map((l) => l.company_key).filter((k): k is string => !!k));
  const fresh: Lead[] = [];
  for (const l of keep) {
    if (l.company_key && taken.has(l.company_key)) {
      duplicates++;
      continue;
    }
    if (l.company_key) taken.add(l.company_key);
    fresh.push(l);
  }
  let added = 0;
  let useful = 0;
  for (const l of fresh) {
    // The database refuses an email already on this list (a duplicate too).
    if (!(await ctx.store.insertLeads([l]))) {
      duplicates++;
      continue;
    }
    added++;
    if (usable(l)) useful++;
    if (!l.email) continue;
    const pid = await personFor(ctx.store, "email", l.email, l.name);
    if (pid) await ctx.store.addTouch(pid, "email", "lead_listed", null);
  }
  ctx.stat("leads_added", added);
  ctx.stat(`leads_${fresh[0]?.source_platform ?? keep[0]?.source_platform ?? "none"}`, added);
  ctx.stat("usable_leads", useful);
  ctx.stat("duplicates_rejected", duplicates);
  ctx.stat("contacts_suppressed", suppressed);
  return added;
}

export async function leadsToday(ctx: AgentContext, list: Lead["list"]): Promise<number> {
  const by = await ctx.store.countLeadsSince(nyDayStart(ctx.now()).toISOString(), list);
  return Object.values(by).reduce((a, b) => a + b, 0);
}
