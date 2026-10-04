// ── CONTACT sources — how a contact reached this user's card ────────────────
export const SOURCE_LABELS: Record<string, string> = {
  instagram_bio: "Instagram bio",
  snapchat: "Snapchat",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  qr_code: "QR code scan",
  nfc_card: "NFC tap",
  direct_link: "Card link",       // opened the card's plain URL (sent by text/DM/etc.)
  text_message: "Text message",
  email_signature: "Swift Signature",
  apple_wallet: "Apple Wallet",
  // The Swift Links page hardcodes source="swift_links" on every event it
  // records (links/[username]/page.tsx). Without an entry here that fell through
  // to the raw-slug fallback and printed a lowercase "swift links" to real users.
  swift_links: "Swift Links",
  manual: "Added by hand",        // the user typed the contact in themselves
  imported: "CSV import",
  scanner: "Card scanner",
  unknown: "Not tracked",
};

/**
 * " from a QR code" — how a source reads INSIDE a notification sentence.
 *
 * The labels above are column headings ("QR code scan", "NFC tap", "Card
 * link"), and pasted into a sentence they read wrong: "Someone downloaded your
 * contact card from QR code scan" (2026-09-23 notification review). Empty for
 * no source and for a plain card link, which is not news. Leading space
 * included, so callers can drop it straight in.
 */
const SOURCE_PHRASES: Record<string, string> = {
  qr_code: "from a QR code",
  nfc_card: "from an NFC tap",
  email_signature: "from your Swift Signature",
  swift_links: "from your Swift Links",
  apple_wallet: "from Apple Wallet",
  text_message: "from a text message",
  instagram_bio: "from your Instagram bio",
};
export function sourcePhrase(source: string | null | undefined): string {
  if (!source || source === "direct_link" || source === "unknown") return "";
  const p = SOURCE_PHRASES[source];
  if (p) return ` ${p}`;
  const label = SOURCE_LABELS[source];
  return label ? ` from ${label}` : "";
}

export function getSourceLabel(source: string | null | undefined): string {
  if (!source) return "Not tracked";
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ");
}

// ── SIGNUP sources — how a new ACCOUNT found SwiftCard (admin analytics) ─────
// Written so the admin instantly knows what each row means without a legend.
export const SIGNUP_SOURCE_LABELS: Record<string, string> = {
  direct:       "Organic — came to the site on their own",
  referral:     "Referral link (friend's /r/ code)",
  preview:      "Test It Live demo",
  save_contact: "Saved someone's contact, then signed up",
  share_info:   "Shared their info on a card, then signed up",
  vcard:        "Downloaded a vCard, then signed up",
  link_button:  "Tapped a Swift Links button",
  badge:        "'Made with SwiftCard' badge",
  view_tracking_page: "'Business card view tracking' landing page",
  link_in_bio_page:   "'Link in bio with analytics' landing page",
  follow_up:    "Link in a follow-up email/text",
};

// Social campaign sources (lib/referral.ts CAMPAIGN_PLATFORMS): ig_bio →
// "Instagram — bio link", ig_p_ab12 → "Instagram — post ab12".
const CAMPAIGN_NAMES: Record<string, string> = { ig: "Instagram", fb: "Facebook", li: "LinkedIn", tt: "TikTok", yt: "YouTube", pin: "Pinterest", rd: "Reddit" };
const CAMPAIGN_PLACES: Record<string, string> = { bio: "bio link", dm: "message", ad: "ad", story: "story", comment: "comment", prospect: "outreach message", post: "post", page: "page button", reply: "reply" };

export function campaignSourceLabel(source: string): string | null {
  const m = source.match(/^(ig|fb|li|tt|yt|pin|rd)_(.+)$/);
  if (!m) return null;
  const [, platform, rest] = m;
  const post = rest.match(/^p_(.+)$/);
  const creator = rest.match(/^creator_(.+)$/);
  const place = post ? `post ${post[1]}` : creator ? `creator @${creator[1]}` : (CAMPAIGN_PLACES[rest] ?? rest.replace(/_/g, " "));
  return `${CAMPAIGN_NAMES[platform]} — ${place}`;
}

export function getSignupSourceLabel(source: string | null | undefined): string {
  if (!source) return SIGNUP_SOURCE_LABELS.direct;
  return SIGNUP_SOURCE_LABELS[source] ?? campaignSourceLabel(source) ?? source.replace(/_/g, " ");
}
