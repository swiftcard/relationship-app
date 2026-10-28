// ── Company Analytics' tabs, in reading order ───────────────────────────────
// Growth → money → how people get there → what they do → who stays → who
// brings friends → are the numbers honest. Referrals and Retention used to be
// pages of their own (/admin/referrals, /admin/retention — both redirect here
// now); they are part of the same story, so they are tabs of it.
// A plain module (not "use client") so the server page can read the list.

export const ANALYTICS_TABS = [
  { key: "growth", label: "Growth" },
  { key: "revenue", label: "Revenue" },
  { key: "funnel", label: "Funnel" },
  { key: "engagement", label: "Engagement" },
  { key: "retention", label: "Retention" },
  { key: "referrals", label: "Referrals" },
  { key: "data", label: "Data quality" },
] as const;

export type AnalyticsTab = (typeof ANALYTICS_TABS)[number]["key"];

export function resolveAnalyticsTab(v: string | undefined): AnalyticsTab {
  return (ANALYTICS_TABS.find((t) => t.key === v)?.key ?? "growth") as AnalyticsTab;
}
