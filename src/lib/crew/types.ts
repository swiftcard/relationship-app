// ── Crew: shared types ──────────────────────────────────────────────────────
// The agent system behind /admin/crew. Plan: docs/plans/agent-system.md.

export type TeamId = "system" | "watchdog" | "replies" | "contact" | "leads" | "office" | "marketing";
export type Role = "worker" | "manager" | "head";
export type Tier = "haiku" | "sonnet" | "opus" | "fable";

export type ApprovalKind =
  | "reply"
  | "comment"
  | "dm"
  | "connect_note"
  | "post"
  | "blog_post"
  | "code_fix"
  | "email_list_export"
  | "spend"
  | "ask";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "done";

export type Platform =
  | "reddit"
  | "instagram"
  | "threads"
  | "bluesky"
  | "facebook"
  | "quora"
  | "indiehackers"
  | "linkedin"
  | "alignable"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "x"
  | "hackernews"
  | "web"
  | "email"
  | "site";

export type TouchKind =
  | "replied"
  | "commented"
  | "dm_drafted"
  | "dm_sent"
  | "connect_sent"
  | "emailed"
  | "called"
  | "lead_listed"
  /** The person said no, or unsubscribed, from the Sheet: every channel stops. */
  | "opted_out";

/** Every env var Crew reads. env.ts is the only file that touches process.env for these. */
export type EnvKey =
  | "CREW_ANTHROPIC_API_KEY"
  | "CREW_OPENAI_API_KEY"
  | "CREW_OPENAI_MODEL"
  | "CREW_TICK_SECRET"
  | "CREW_GITHUB_TOKEN"
  | "CREW_STRIPE_READ_KEY"
  | "VERCEL_TOKEN"
  | "REDDIT_CLIENT_ID"
  | "REDDIT_CLIENT_SECRET"
  | "REDDIT_USER_AGENT"
  | "GOOGLE_SHEETS_SA_JSON"
  | "CREW_LEADS_SHEET_ID"
  | "CREW_OFFICE_SHEET_ID"
  // The Google Sheets headquarters ("SwiftCard Leads"), src/lib/crew/sheets.
  | "CREW_SHEET_ID"
  | "CREW_SHEET_ID_TEST"
  | "CREW_SHARED_DRIVE_ID"
  | "CREW_SHEET_SHARE_EMAILS"
  | "CREW_SHEET_HOOK_SECRET"
  | "BLUESKY_HANDLE"
  | "BLUESKY_APP_PASSWORD";

export type Schedule =
  | { kind: "every"; minutes: number }
  /** America/New_York wall-clock time. `days` = 0 (Sun) … 6 (Sat); omitted = every day. */
  | { kind: "daily"; hour: number; minute?: number; days?: number[] }
  /** Runs when there is pasted input waiting for it, checked every tick. */
  | { kind: "on_input"; platforms: Platform[] };

export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  webSearches: number;
};

export type Settings = {
  kill_all: boolean;
  daily_usd_cap: number;
  team_caps: Partial<Record<TeamId, { usd?: number }>>;
  disclosure_on: boolean;
  disclosure: string;
  /** Cheapest setup that still works: Haiku for sorting and short comments,
   *  Watchdog and manager reports with no AI, Sonnet tie-breaks. */
  economy: boolean;
  /** ChatGPT (or a Claude skeptic) checks each outward draft before the inbox. */
  second_opinion: boolean;
};

export type AgentState = {
  id: string;
  enabled: boolean;
  model_override: Tier | null;
  daily_usd_cap: number | null;
  config: Record<string, unknown>;
  last_run_at: string | null;
  next_run_at: string | null;
  lease_until: string | null;
  status_note: string | null;
  /** Set by the team manager from chat ("pause Reddit for today"); null = not paused. */
  paused_until?: string | null;
  pause_note?: string | null;
};

// ── The office: one door per team, opening hours, the manager's chat ────────

/** New York minutes after midnight; `days` = 0 (Sun) … 6 (Sat). Same-day hours only (close > open). */
export type OfficeHours = { days: number[]; open: number; close: number };

/** One row per team (crew_teams). The desk ("system") has no door: only the office lock stops it. */
export type TeamRow = {
  team: TeamId;
  /** The door when no hours are set. */
  door_open: boolean;
  hours: OfficeHours | null;
  /** A one-tap open/lock while hours are set, until the next scheduled change. */
  override_open: boolean | null;
  override_until: string | null;
  /** The manager's standing order for the team ("focus on dentists this week"). */
  focus: string | null;
  focus_until: string | null;
  focus_by: string | null;
};

export type ChatAuthor = "owner" | "manager" | "system";
export type ChatMessage = {
  id: string;
  created_at: string;
  team: TeamId;
  author: ChatAuthor;
  body: string;
  /** "pending" while the manager is still writing. */
  status: "pending" | "done" | "failed";
  meta: Record<string, unknown>;
};

/** What a manager may do from chat. Only ever narrows what the team does. */
export type ChatOrder =
  | { type: "pause_agent"; agent: string; until: "end_of_day" | "tomorrow_morning" | "until_resumed" }
  | { type: "resume_agent"; agent: string }
  | { type: "set_focus"; text: string; days: number }
  | { type: "clear_focus" };

export type Approval = {
  id: string;
  created_at: string;
  agent_id: string;
  team: TeamId;
  kind: ApprovalKind;
  status: ApprovalStatus;
  title: string;
  summary: string;
  body: string;
  platform: Platform | null;
  target_url: string | null;
  person_id: string | null;
  debate: DebateRecord | null;
  model_used: string | null;
  meta: Record<string, unknown>;
  decided_at: string | null;
  reject_reason: string | null;
  done_at: string | null;
  expires_at: string;
};

export type DebateTurn = { who: "worker" | "critic" | "manager"; model: string; text: string; verdict?: "agree" | "revise"; issues?: string[] };
export type DebateRecord = {
  skipped: boolean;
  reason?: string;
  rounds: number;
  outcome: "agreed" | "revised_agreed" | "tiebreak" | "single";
  line: string;
  turns: DebateTurn[];
  critic: string;
};

export type Finding = {
  id: string;
  fingerprint: string;
  agent_id: string;
  kind: "bug" | "speed" | "security" | "ui" | "flow" | "payment" | "app";
  source: string;
  title: string;
  detail: Record<string, unknown>;
  count: number;
  first_seen: string;
  last_seen: string;
  status: "open" | "proposed" | "fixed" | "ignored";
  approval_id: string | null;
};

export type Lead = {
  list: "cold" | "office";
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  title?: string | null;
  business_type?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  region_restricted?: boolean;
  source_platform: Platform;
  source_url: string;
  notes?: string | null;
};

export type CrewInput = {
  id: string;
  created_at: string;
  platform: Platform;
  kind: "post" | "profile" | "page";
  url: string | null;
  text: string;
  status: "new" | "used" | "skipped";
};

// ── The Google Sheet (src/lib/crew/sheets) ──────────────────────────────────

/** What a row in the Sheet points at. */
export type SheetEntityKind = "approval" | "lead" | "finding" | "custom";

/** One row of one tab, as the backend remembers it (crew_sheet_rows). */
export type SheetRow = {
  id: string;
  tab: string;
  row_key: string;
  entity_kind: SheetEntityKind;
  entity_id: string;
  /** The Status word the owner sees (and may change) in the Sheet. */
  status: string;
  /** Every owner-owned column, by column key: Notes, Date Contacted, an edited message… */
  owner_cols: Record<string, string>;
  /** Hash of the agent-owned cells last written, so an unchanged row costs no write. */
  agent_hash: string;
  created_at: string;
  synced_at: string | null;
  owner_edited_at: string | null;
};

/** One line of the Activity Log (crew_activity): the full audit trail. */
export type ActivityRow = {
  id: string;
  at: string;
  agent_id: string | null;
  platform: string | null;
  action: string;
  target: string | null;
  message: string | null;
  result: string;
  error: string | null;
  row_key: string | null;
  approved_by: string | null;
  simulated: boolean;
};

/** An edit the owner made to a draft in the Sheet (crew_edits), kept as a writing example. */
export type EditRow = {
  id: string;
  at: string;
  agent_id: string;
  kind: ApprovalKind;
  approval_id: string;
  before: string;
  after: string;
};

export type RunResult = {
  summary: string;
  stats?: Record<string, number>;
  /** Wait at least this long before the next run (nothing new found, or today's ceiling reached). */
  restMinutes?: number;
  status?: "ok" | "skipped";
};
