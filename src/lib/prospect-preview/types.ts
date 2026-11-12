// ── Card Builder: the shapes ────────────────────────────────────────────────
// A preview card staff build for a sales prospect (admin → Card Builder), the
// page it lives on (/p/<slug>) and the real views of it. Rows are typed by
// hand, like every other table here (there are no generated database types).
// Schema: supabase/prospect-previews.sql.

/** `headshot` is only ever set when there is one: an https address of their picture. */
export type TeamMember = { name: string; title: string; headshot?: string };

/**
 * draft   being built; /p/<slug> answers 404 and only staff can look at it
 * live    published: the link opens until it expires
 * paused  taken down by hand
 */
export type PreviewStatus = "draft" | "live" | "paused";

/** The places a prospect's office is found, as full https addresses. */
export const SOCIAL_KEYS = ["linkedin", "instagram", "facebook", "x", "youtube", "tiktok", "zillow"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
export type SocialLinks = Partial<Record<SocialKey, string>>;
export const SOCIAL_LABELS: Record<SocialKey, string> = {
  linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", x: "X", youtube: "YouTube", tiktok: "TikTok", zillow: "Zillow",
};

/**
 * Every researched fact keeps where it came from. `uncertain` is the
 * researcher saying "check this before you rely on it"; the edit screen flags
 * those. Keyed by the fact, not the column, so "team" covers the whole list.
 */
export const SOURCE_FIELDS = ["owner_name", "owner_title", "phone", "email", "logo_url", "headshot_url", "colors", "address", "website", "social_links", "specialty", "team_members"] as const;
export type SourceField = (typeof SOURCE_FIELDS)[number];
export const SOURCE_LABELS: Record<SourceField, string> = {
  owner_name: "Owner's name", owner_title: "Owner's title", phone: "Phone", email: "Email", logo_url: "Logo",
  headshot_url: "Headshot", colors: "Brand colors", address: "Office address", website: "Website",
  social_links: "Social links", specialty: "Specialty", team_members: "Team members",
};
export type FactSource = { url: string; uncertain: boolean; note: string };
export type FactSources = Partial<Record<SourceField, FactSource>>;

export type ProspectPreview = {
  id: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  status: PreviewStatus;
  slug: string;
  office_name: string;
  owner_name: string;
  owner_title: string | null;
  phone: string;
  email: string | null;
  logo_url: string | null;
  /** The owner's own picture. Only ever from their business site or brokerage profile. */
  headshot_url: string | null;
  address: string | null;
  website: string | null;
  social_links: SocialLinks;
  /** One line: what this office is known for. */
  specialty: string | null;
  brand_primary: string;
  brand_secondary: string;
  team_members: TeamMember[];
  sources: FactSources;
  called: boolean;
  called_at: string | null;
  notes: string | null;
  crew_lead_id: string | null;
};

export type DeviceType = "phone" | "tablet" | "desktop";

/** A preview as Card Builder lists it: with its real views counted. */
export type PreviewListRow = ProspectPreview & {
  views: number;
  last_viewed_at: string | null;
  /** Any of its views reached the "Your team" strip. */
  team_strip_scrolled: boolean;
  /** How many different devices have looked. */
  devices: number;
};

/** What the admin banner needs about a prospect who is looking right now. */
export type LiveAlert = {
  view_id: string;
  preview_id: string;
  owner_name: string;
  office_name: string;
  phone: string;
  viewed_at: string;
  device_label: string | null;
};

export const DEFAULT_EXPIRY_DAYS = 14;
export const MAX_TEAM_MEMBERS = 12;
export const DEFAULT_BRAND_PRIMARY = "#2C3A52";
export const DEFAULT_BRAND_SECONDARY = "#FFFFFF";
