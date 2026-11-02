import type { CrewStore } from "../store";
import { fingerprintOf, legacyNightlyKey, normalizeFailure, splitWhere, type RawFinding } from "./findings";
import type { Finding } from "../types";

// Results the existing monitors post to /api/crew/ingest (uptime.yml every
// 15 minutes, nightly-qa.yml nightly and after every deploy).

export type NightlySummary = { healthy: boolean; failedCount: number; sections: { name: string; failures: string[] }[]; at: string };
export type HealthJson = { base?: string; healthy: boolean; checked?: number; failedCount?: number; results: { name: string; ok: boolean; detail: string; ms: number }[] };
type Stored<T> = { at: string; run: string | null; data: T };

export async function latestIngest<T>(store: CrewStore, source: "health" | "nightly"): Promise<Stored<T> | null> {
  return store.kvGet<Stored<T>>(`ingest:${source}`);
}

/**
 * Failures from the nightly sections an agent owns, one finding per distinct
 * problem: the same failure on eight screens ("pixel-8-free-settings:
 * status-bar-style-unset", "small-360-pro-settings: status-bar-style-unset",
 * …) is ONE finding that lists the screens, not eight cards.
 */
export function nightlyFindings(summary: NightlySummary, sections: RegExp[], kind: Finding["kind"], source: string): RawFinding[] {
  const groups = new Map<string, { section: string; problem: string; where: string[]; lines: string[] }>();
  for (const s of summary.sections ?? []) {
    if (!sections.some((re) => re.test(s.name))) continue;
    for (const f of s.failures ?? []) {
      const { where, problem } = splitWhere(f);
      const key = `${source}:${fingerprintOf(s.name, normalizeFailure(problem))}`;
      const g = groups.get(key) ?? { section: s.name, problem, where: [], lines: [] };
      if (where && !g.where.includes(where)) g.where.push(where);
      g.lines.push(f);
      groups.set(key, g);
    }
  }
  return [...groups.entries()].map(([fingerprint, g]) => ({
    fingerprint,
    kind,
    source,
    title: `${g.section}: ${g.problem}`.slice(0, 200) + (g.where.length > 1 ? ` (on ${g.where.length} screens)` : g.where.length ? ` (${g.where[0]})` : ""),
    count: 1,
    aliases: [...new Set(g.lines.map((f) => legacyNightlyKey(source, g.section, f)))],
    detail: { section: g.section, failure: g.problem.slice(0, 1500), where: g.where.slice(0, 60), nightly_at: summary.at },
  }));
}

export function healthFindings(h: HealthJson): RawFinding[] {
  return (h.results ?? [])
    .filter((r) => !r.ok)
    .map((r) => ({
      fingerprint: `health:${fingerprintOf(r.name)}`,
      kind: /speed|budget|quickly|ms\b/i.test(`${r.name} ${r.detail}`) ? ("speed" as const) : ("bug" as const),
      source: "health",
      title: `${r.name}: ${r.detail}`.slice(0, 220),
      detail: { check: r.name, detail: r.detail, ms: r.ms, base: h.base ?? null },
    }));
}
