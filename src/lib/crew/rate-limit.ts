import type { CrewStore } from "./store";
import type { Platform } from "./types";
import { nyDayStart } from "./schedule";

// ── Conservative caps with warm-up ──────────────────────────────────────────
// The meeting's daily numbers are ceilings, not targets. A new account starts
// at a fifth of the ceiling and climbs a fifth a week, so week 1 is 20%, week
// 5 and on is 100%. Drafting stops at the cap; nothing here posts anything.

export function warmedCap(ceiling: number, warmupStart: string, now: Date): number {
  const weeks = Math.max(0, Math.floor((now.getTime() - new Date(`${warmupStart}T00:00:00Z`).getTime()) / (7 * 86400_000)));
  const share = Math.min(1, 0.2 * weeks + 0.2);
  return Math.max(1, Math.floor(ceiling * share));
}

/** Drafts this agent may still create today on this platform+action. */
export async function remainingToday(
  store: CrewStore,
  o: { agentId: string; platform: Platform; action: string; defaultCeiling: number; now: Date },
): Promise<{ cap: number; used: number; left: number }> {
  let rl = await store.getRateLimit(o.platform, o.action);
  if (!rl) {
    await store.setRateLimit(o.platform, o.action, o.defaultCeiling);
    rl = { ceiling: o.defaultCeiling, warmup_start: o.now.toISOString().slice(0, 10) };
  }
  const cap = warmedCap(rl.ceiling, rl.warmup_start, o.now);
  const used = await store.countApprovalsCreatedSince(o.agentId, nyDayStart(o.now).toISOString());
  return { cap, used, left: Math.max(0, cap - used) };
}
