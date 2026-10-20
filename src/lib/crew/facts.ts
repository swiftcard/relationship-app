import { derivedFacts } from "@/lib/knowledge/derived";
import type { CrewStore } from "./store";

// ── What the agents may claim ───────────────────────────────────────────────
// SwiftCard's prices, limits and features come from the same derivation the
// support assistants use (lib/knowledge/derived.ts, which reads plan.ts), so a
// price change reaches every draft with no edit here. Competitor facts come
// only from crew_competitor_facts, and only while they are fresh.

export const COMPETITORS = ["hihello", "blinq", "popl", "linkme", "linktree", "hoobe"] as const;
export type Competitor = (typeof COMPETITORS)[number];

export const COMPETITOR_NAME: Record<Competitor, string> = {
  hihello: "HiHello",
  blinq: "Blinq",
  popl: "Popl",
  linkme: "Link.me",
  linktree: "Linktree",
  hoobe: "Hoobe",
};

export const FACT_MAX_AGE_DAYS = 30;

export function productFacts(): string {
  return `SWIFTCARD FACTS (the only product claims you may make):\n${derivedFacts({ commerce: true, audience: "visitor" })}`;
}

export function freshFacts<T extends { seen_at: string }>(rows: T[], now: Date, maxAgeDays = FACT_MAX_AGE_DAYS): T[] {
  return rows.filter((r) => now.getTime() - new Date(r.seen_at).getTime() <= maxAgeDays * 86400_000);
}

export async function competitorFacts(store: CrewStore, now: Date): Promise<string> {
  const fresh = freshFacts(await store.competitorFacts(), now);
  if (!fresh.length) return "COMPETITOR FACTS: none checked recently. Do not state any competitor's price or plan details.";
  const lines = fresh
    .sort((a, b) => (a.competitor + a.fact).localeCompare(b.competitor + b.fact))
    .map((f) => `- ${COMPETITOR_NAME[f.competitor as Competitor] ?? f.competitor} ${f.fact.replace(/_/g, " ")}: ${f.value} (checked ${f.seen_at.slice(0, 10)}, ${f.source_url})`);
  return `COMPETITOR FACTS (checked in the last ${FACT_MAX_AGE_DAYS} days; nothing else about competitors may be stated as fact):\n${lines.join("\n")}`;
}
