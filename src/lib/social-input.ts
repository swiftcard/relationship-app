// ── What do I actually type in the Instagram box? ───────────────────────────
//
// Owner report 2026-09-15: "the way that they're told to put their social links
// in is very confusing. For example, LinkedIn: do they just type their name in,
// or do they have to type out linkedin.com/in/their name?"
//
// The cause was the placeholders disagreeing with each other. LinkedIn said
// "linkedin.com/in/you" and Facebook said "facebook.com/you" (type a URL) while
// Instagram, TikTok, X and Snapchat said "@username" (type a handle) — so the
// box itself gave a different answer per row and none of them said which was
// required. `socialUrl` has always accepted all of it, but nobody could tell.
//
// ONE answer now, every platform: type your username. This module is the single
// place that says so, so the wizard and the card editor cannot drift again.
// Since 2026-09-29 the box itself shows the start of the link (the `stem`) in
// front of the username — see components/SocialHandleField — so there is no
// longer a per-platform placeholder or a "becomes …" hint to keep in step.
//
// Storage is deliberately unchanged — `normalizeSocial` still decides what we
// keep (a URL-ish string for LinkedIn/Facebook/YouTube, "@handle" for the
// rest), and a pasted full profile URL still works exactly as before. This is
// what the person is TOLD, not what we save.

export type SocialInputKey =
  | "linkedin"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "twitter"
  | "snapchat"
  | "youtube";

export type SocialInputSpec = {
  key: SocialInputKey;
  /** The field label. */
  label: string;
  /** The address we build from it, shown in the box in front of the username. */
  stem: string;
  /** A real-looking username, used when a value can't become a link. */
  example: string;
};

// Order matches the card's own social order (see buildConnectLinks).
export const SOCIAL_INPUTS: SocialInputSpec[] = [
  { key: "linkedin",  label: "LinkedIn",    stem: "linkedin.com/in/",  example: "alexmorgan" },
  { key: "instagram", label: "Instagram",   stem: "instagram.com/",    example: "alexmorgan" },
  { key: "tiktok",    label: "TikTok",      stem: "tiktok.com/@",      example: "alexmorgan" },
  { key: "facebook",  label: "Facebook",    stem: "facebook.com/",     example: "alexmorgan" },
  { key: "twitter",   label: "X (Twitter)", stem: "x.com/",            example: "alexmorgan" },
  { key: "snapchat",  label: "Snapchat",    stem: "snapchat.com/add/", example: "alexmorgan" },
  { key: "youtube",   label: "YouTube",     stem: "youtube.com/@",     example: "alexmorgan" },
];

/** Lookup by key, for call sites that already iterate their own order. */
export function socialInput(key: string): SocialInputSpec | undefined {
  return SOCIAL_INPUTS.find((s) => s.key === key);
}
