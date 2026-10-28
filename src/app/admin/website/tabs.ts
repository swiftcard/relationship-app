// ── The Website page's tabs ─────────────────────────────────────────────────
// How many came → what they read → where they came from → who they are →
// how it's counted. A plain module so the server page can read it.

export const WEBSITE_TABS = [
  { key: "traffic", label: "Traffic" },
  { key: "pages", label: "Pages" },
  { key: "sources", label: "Sources" },
  { key: "audience", label: "Audience" },
  { key: "settings", label: "Settings" },
] as const;

export type WebsiteTab = (typeof WEBSITE_TABS)[number]["key"];

export function resolveWebsiteTab(v: string | undefined): WebsiteTab {
  return (WEBSITE_TABS.find((t) => t.key === v)?.key ?? "traffic") as WebsiteTab;
}
