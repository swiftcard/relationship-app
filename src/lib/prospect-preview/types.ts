// ── Card Builder: the shapes ────────────────────────────────────────────────
// A preview card staff build for a sales prospect (admin → Card Builder), the
// page it lives on (/p/<slug>) and the real views of it. Rows are typed by
// hand, like every other table here (there are no generated database types).
// Schema: supabase/prospect-previews.sql.

export type TeamMember = { name: string; title: string };

export type PreviewStatus = "live" | "paused";

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
  brand_primary: string;
  brand_secondary: string;
  team_members: TeamMember[];
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
