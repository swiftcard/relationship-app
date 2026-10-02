import { isCampaignSource } from "@/lib/referral";

// ── Tracked campaign links: swiftcard.me/go/<code> ──────────────────────────
// One short address per place a link lives (ig_bio, ig_dm, ig_p_<post>, …).
// The code IS the signup source, so a click and the signup it leads to are
// counted under the same name with no lookup table to keep in sync.

// Which card design the builder opens on for a profession — the same template
// that profession's persona wears on the homepage and its /for/ page, so the
// card someone saw in the ad is the one they start from.
export const PROFESSION_TEMPLATE: Record<string, string> = {
  "real-estate-agents": "photo-first",
  contractors: "local-business",
  "insurance-agents": "classic-pro",
  "loan-officers": "classic-pro",
  lawyers: "modern-bold",
  photographers: "photo-first",
  "barbers-and-stylists": "modern-bold",
  "car-salespeople": "logo-first",
  // Trades without a /for/ page of their own yet start on the trades design.
  hvac: "local-business",
  plumbers: "local-business",
  electricians: "local-business",
  roofers: "local-business",
};

/** Where a campaign link lands: the card builder, on that profession's design. */
export function campaignDestination(code: string, profession?: string | null): string {
  const q = new URLSearchParams();
  if (isCampaignSource(code)) q.set("src", code);
  const template = profession ? PROFESSION_TEMPLATE[profession.toLowerCase()] : undefined;
  if (template) q.set("template", template);
  const qs = q.toString();
  return qs ? `/cards/new?${qs}` : "/cards/new";
}

/** The public link for a code — what goes in a bio, a message or an ad. */
export function campaignLink(code: string, profession?: string | null): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me").replace(/\/$/, "");
  return `${base}/go/${code}${profession && PROFESSION_TEMPLATE[profession] ? `?for=${profession}` : ""}`;
}
