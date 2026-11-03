import type { AgentContext } from "../context";
import { companyKey } from "./quality";

export type Candidate = { name: string; website: string; type: string; area: string; city?: string; state?: string };
type Pending = { at: string; items: Candidate[] };
const MAX_AGE = 90 * 86_400_000;

/** Reuse the unattempted results of earlier paid searches before buying more.
 * Only discovery metadata is cached, never HTML or a verdict about a contact.
 * Saved companies are excluded before any fetch or enrichment, across lists.
 */
export async function candidateBatch(ctx: AgentContext, limit: number, discover: () => Promise<Candidate[]>): Promise<Candidate[]> {
  const key = `lead-candidates:v1:${ctx.def.id}`;
  const pending = await ctx.store.kvGet<Pending>(key);
  const fresh = async (items: Candidate[]) => {
    const keys = items.map((c) => companyKey({ source_url: c.website, company: c.name }));
    const taken = await ctx.store.companyKeysTaken(keys.filter((k): k is string => !!k));
    return items.filter((_c, i) => {
      const k = keys[i];
      if (!k) return false;
      if (taken.has(k)) { ctx.stat("duplicates_rejected"); return false; }
      taken.add(k);
      return true;
    });
  };
  let items = pending && ctx.now().getTime() - Date.parse(pending.at) < MAX_AGE ? await fresh(pending.items) : [];
  let at = pending?.at ?? ctx.now().toISOString();
  if (items.length) ctx.stat("cached_candidates", items.length);
  else {
    items = await fresh(await discover());
    at = ctx.now().toISOString();
  }
  const count = Math.max(1, Math.min(12, Math.floor(limit) || 1));
  ctx.stat("sites_not_attempted", Math.max(0, items.length - count));
  await ctx.store.kvSet(key, { at, items: items.slice(count, count + 24) });
  return items.slice(0, count);
}
