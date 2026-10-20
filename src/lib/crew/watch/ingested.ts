import type { CrewStore } from "../store";
import { fingerprintOf, normalizeFailure, type RawFinding } from "./findings";
import type { Finding } from "../types";

// Results the existing monitors post to /api/crew/ingest (uptime.yml every
// 15 minutes, nightly-qa.yml nightly and after every deploy).

export type NightlySummary = { healthy: boolean; failedCount: number; sections: { name: string; failures: string[] }[]; at: string };
export type HealthJson = { base?: string; healthy: boolean; checked?: number; failedCount?: number; results: { name: string; ok: boolean; detail: string; ms: number }[] };
type Stored<T> = { at: string; run: string | null; data: T };

export async function latestIngest<T>(store: CrewStore, source: "health" | "nightly"): Promise<Stored<T> | null> {
  return store.kvGet<Stored<T>>(`ingest:${source}`);
}

/** Failures from the nightly sections an agent owns, one finding per distinct failure. */
export function nightlyFindings(summary: NightlySummary, sections: RegExp[], kind: Finding["kind"], source: string): RawFinding[] {
  const out: RawFinding[] = [];
  for (const s of summary.sections ?? []) {
    if (!sections.some((re) => re.test(s.name))) continue;
    for (const f of s.failures ?? []) {
      out.push({
        fingerprint: `${source}:${fingerprintOf(s.name, normalizeFailure(f))}`,
        kind,
        source,
        title: `${s.name}: ${f}`.slice(0, 220),
        detail: { section: s.name, failure: f.slice(0, 1500), nightly_at: summary.at },
      });
    }
  }
  return out;
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
