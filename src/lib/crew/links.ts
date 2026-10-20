import { campaignLink } from "@/lib/campaign-links";
import { isCampaignSource } from "@/lib/referral";
import type { Platform } from "./types";

// ── Tracked links in drafts ─────────────────────────────────────────────────
// Every link an agent puts in a draft is a /go/<code> campaign link, so a
// click and the signup it leads to count under that agent's name (the code IS
// the signup source; see lib/campaign-links).

const PREFIX: Partial<Record<Platform, string>> = {
  instagram: "ig",
  facebook: "fb",
  linkedin: "li",
  tiktok: "tt",
  youtube: "yt",
  pinterest: "pin",
  reddit: "rd",
  alignable: "al",
};

/** e.g. ("reddit", "reply") → "rd_cr_reply_k3x9". Null where no prefix exists (Quora, Threads…). */
export function crewCampaignCode(platform: Platform, use: string, seed: string): string | null {
  const p = PREFIX[platform];
  if (!p) return null;
  const tag = use.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 16);
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const code = `${p}_cr_${tag}_${h.toString(36).slice(0, 6)}`;
  return isCampaignSource(code) ? code : null;
}

export function crewLink(platform: Platform, use: string, seed: string, profession?: string | null): string {
  const code = crewCampaignCode(platform, use, seed);
  return code ? campaignLink(code, profession) : "https://swiftcard.me";
}
