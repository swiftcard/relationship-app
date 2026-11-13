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

/**
 * Who a preview may be built for: the person in charge of a team or office,
 * because only they can buy an Office plan (owner's rule, 2026-11-11). An
 * individual agent or loan officer is never a buyer, so there is no value for one.
 */
export const BUYER_ROLES = ["broker_owner", "managing_broker", "team_lead", "branch_manager"] as const;
export type BuyerRole = (typeof BUYER_ROLES)[number];
export const BUYER_ROLE_LABELS: Record<BuyerRole, string> = {
  broker_owner: "Broker-owner", managing_broker: "Managing broker", team_lead: "Team lead", branch_manager: "Branch manager",
};

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
export const SOURCE_FIELDS = ["owner_name", "owner_title", "phone", "email", "logo_url", "headshot_url", "colors", "address", "website", "social_links", "specialty", "team_members", "buyer_role", "buyer_second", "team_size", "detail", "license", "current_tool", "linkedin_url", "warm_path"] as const;
export type SourceField = (typeof SOURCE_FIELDS)[number];
export const SOURCE_LABELS: Record<SourceField, string> = {
  owner_name: "Owner's name", owner_title: "Owner's title", phone: "Phone", email: "Email", logo_url: "Logo",
  headshot_url: "Headshot", colors: "Brand colors", address: "Office address", website: "Website",
  social_links: "Social links", specialty: "Tagline", team_members: "Team members",
  buyer_role: "Decision-maker", buyer_second: "Decision-maker, second source", team_size: "Team size", detail: "The hook",
  license: "License line", current_tool: "What they use today", linkedin_url: "Their LinkedIn profile", warm_path: "Warm path",
};
/**
 * `owner` is the owner of SwiftCard saying "I told you this myself" (pasted
 * notes, 2026-11-13): it counts as confirmed with no page behind it. Only ever
 * present when true.
 */
export type FactSource = { url: string; uncertain: boolean; note: string; owner?: boolean };
export type FactSources = Partial<Record<SourceField, FactSource>>;

// ── Personalization (owner's bar, 2026-11-12) ───────────────────────────────

/**
 * A true, checkable thing about THIS office beyond its name, logo and
 * location. Each keeps the page it came from and a date: the day of the fact
 * (a listing date, a closing) or, for something undated, the day it was read.
 */
export const SPECIFIC_KINDS = ["listing", "sale", "open_house", "recruiting", "cell_numbers", "years", "award", "other"] as const;
export type SpecificKind = (typeof SPECIFIC_KINDS)[number];
export const SPECIFIC_LABELS: Record<SpecificKind, string> = {
  listing: "Current listing", sale: "Recent sale", open_house: "Upcoming open house", recruiting: "Recruiting post",
  cell_numbers: "Agents listing personal cells", years: "Years in business", award: "Award", other: "Other",
};
/** `owner`: the owner supplied this fact themselves, so it needs no page or date. Only ever present when true. */
/**
 * `quiet`: true and useful to know, and never quoted back to them: a former
 * name, an old or home address, a follower count. Said in a message it reads
 * as having been watched (owner, 2026-11-13). Only ever present when true.
 */
export type Specific = { kind: SpecificKind; text: string; source_url: string; dated: string; uncertain: boolean; owner?: boolean; quiet?: boolean };
export const MAX_SPECIFICS = 6;
/** How many verified specifics a preview needs before it may go out. */
export const MIN_SPECIFICS = 3;

/** The three things SwiftCard does that a hook may be built on. */
export const HOOK_ANGLES = ["views", "departures", "open_house"] as const;
export type HookAngle = (typeof HOOK_ANGLES)[number];
export const HOOK_ANGLE_LABELS: Record<HookAngle, string> = {
  views: "Knowing when a card is opened",
  departures: "Keeping contacts when an agent leaves",
  open_house: "Tracking open-house leads",
};

/** What the office uses today to share contact details. A competitor changes the pitch; it doesn't rule them out. */
export const CURRENT_TOOLS = ["paper", "link_in_bio", "popl", "linq", "blinq", "hihello", "dot", "other_digital"] as const;
export type CurrentTool = (typeof CURRENT_TOOLS)[number];
export const CURRENT_TOOL_LABELS: Record<CurrentTool, string> = {
  paper: "Paper cards", link_in_bio: "A link in bio", popl: "Popl", linq: "Linq", blinq: "Blinq", hihello: "HiHello", dot: "Dot", other_digital: "Another digital card",
};
export const COMPETITOR_TOOLS: readonly CurrentTool[] = ["popl", "linq", "blinq", "hihello", "dot", "other_digital"];

// ── Outreach written for one prospect (2026-11-13) ──────────────────────────

/**
 * The messages written for THIS prospect when their card was built, by the
 * /build-card command (never by a paid API call inside the app). The texts
 * that carry the link hold the placeholder `{link}`, filled in when shown.
 */
export const OUTREACH_KEYS = ["first_text", "first_text_b", "link_text", "email_subject", "email_body", "call_opener", "voicemail", "nudge_no_view", "nudge_viewed", "linkedin_note", "linkedin_dm"] as const;
export type OutreachKey = (typeof OUTREACH_KEYS)[number];
export const OUTREACH_LABELS: Record<OutreachKey, string> = {
  first_text: "First text, no link", first_text_b: "First text, second version", linkedin_note: "LinkedIn connection note", linkedin_dm: "LinkedIn message after they accept", link_text: "Text with the link", email_subject: "Email subject", email_body: "Email",
  call_opener: "Call opener", voicemail: "Voicemail script", nudge_no_view: "Nudge: no view after 2 days", nudge_viewed: "Nudge: viewed, didn't pick up",
};
/** The ones sent as a text message: 160 characters at most, link included. */
export const OUTREACH_TEXTS: readonly OutreachKey[] = ["first_text", "first_text_b", "link_text", "nudge_no_view", "nudge_viewed"];
/** The two sent on LinkedIn, by hand. Only written when their public profile was found. */
export const OUTREACH_LINKEDIN: readonly OutreachKey[] = ["linkedin_note", "linkedin_dm"];
/**
 * A connection request's note. LinkedIn allows 300 characters on a paid
 * account and 200 on a basic one, so 200 works whichever the owner has.
 */
export const LINKEDIN_NOTE_LIMIT = 200;
export const OUTREACH_MAX: Record<OutreachKey, number> = {
  first_text: 320, first_text_b: 320, linkedin_note: 300, linkedin_dm: 1000, link_text: 320, email_subject: 120, email_body: 2000, call_opener: 600, voicemail: 600, nudge_no_view: 320, nudge_viewed: 320,
};
export const TEXT_LIMIT = 160;
export const LINK_SLOT = "{link}";
export type Outreach = Record<OutreachKey, string> & {
  /** Which of `specifics` (its position) each message is built on. */
  uses: Partial<Record<OutreachKey, number>>;
  written_at: string | null;
  /** Which first text the owner picked in Approve. Null = not picked yet: the first one. */
  first_pick?: "a" | "b" | null;
};

/** A way in that isn't cold: someone the owner knows there, or something they share. */
export const WARM_KINDS = ["connection", "school", "employer"] as const;
export type WarmKind = (typeof WARM_KINDS)[number];
export const WARM_LABELS: Record<WarmKind, string> = { connection: "You know someone there", school: "Same school", employer: "Same past employer" };
export type WarmPath = {
  kind: WarmKind;
  /** A sentence for the owner: "You're connected to Marcus Lee, Associate Broker there." */
  text: string;
  /** The person or place to name in the first text: "Marcus Lee", "Baruch". */
  name: string;
  /** Where a shared school or employer was read (a connection comes from the owner's own export). */
  source_url?: string;
};

export const TYPE_FEELS = ["sans", "serif"] as const;
export type TypeFeel = (typeof TYPE_FEELS)[number];

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
  /** Their own tagline, as they write it. */
  specialty: string | null;
  brand_primary: string;
  brand_secondary: string;
  team_members: TeamMember[];
  sources: FactSources;
  /** Null only on previews made before the rule (2026-11-11). */
  buyer_role: BuyerRole | null;
  /** Why this person is the one who decides, in a sentence. */
  buyer_reason: string | null;
  team_size: number | null;
  /** The hook's fact: one of the specifics, written to finish the sentence "I saw …". */
  detail: string | null;
  /** Their licence line exactly as they show it ("Licensed Real Estate Broker", "NMLS #123456"); null when they show none. */
  license: string | null;
  /** The type feel of their own site, for the card. Null = the house sans. */
  type_feel: TypeFeel | null;
  current_tool: CurrentTool | null;
  specifics: Specific[];
  /** Which of `specifics` the hook is built on (its position). */
  hook_specific: number | null;
  hook_angle: HookAngle | null;
  /** Why that fact matters to them, as a sentence. */
  hook_why: string | null;
  /** The owner chose to let a "too generic" preview go out as it is. */
  quality_override: boolean;
  quality_override_at: string | null;
  call_outcome: string | null;
  call_outcome_at: string | null;
  called: boolean;
  called_at: string | null;
  notes: string | null;
  /** The first text (no link) went out. */
  asked_at: string | null;
  /** The link went out, and how (the latest send). */
  sent_at: string | null;
  sent_channel: "text" | "email" | null;
  /** Only what a person decides: meeting_booked | won | lost. See lib/prospect-preview/pipeline.ts. */
  stage: string | null;
  crew_lead_id: string | null;
  /** The messages written for this prospect; null or absent = none, use the templates. */
  outreach?: Outreach | null;
  /** The owner pressed Skip in the Approve queue. */
  skipped_at?: string | null;
  nudge_no_view_at?: string | null;
  nudge_viewed_at?: string | null;
  /** Their own public LinkedIn profile (not the company page). */
  linkedin_url?: string | null;
  /** The connection note went (by hand), they accepted, the DM went. */
  linkedin_sent_at?: string | null;
  linkedin_accepted_at?: string | null;
  linkedin_dm_at?: string | null;
  warm_path?: WarmPath | null;
  /** The /build batch that made this preview. */
  batch_id?: string | null;
  /** The setup call they booked from their preview page (lib/demo). */
  demo_booking_id?: string | null;
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
