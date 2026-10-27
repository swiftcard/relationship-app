// ── What a tab of the SwiftCard Leads workbook looks like ───────────────────
// One TabSpec per tab. The columns are the contract between the backend and
// the people typing in the Sheet: agent-owned columns are written by the
// sync and never by hand; owner-owned columns (Status, Notes, dates, an
// edited message) are read back and never overwritten once the owner has
// typed in them. The last column of every row-based tab is the Key: the short
// id the backend finds the row by after any sort or filter.

export type ColumnKind =
  | "text"
  | "long" // wrapped, wide: a message, a post
  | "link" // =HYPERLINK(...) cell
  | "date"
  | "status" // dropdown from the tab's statuses
  | "number"
  | "key"; // the row key, narrow and grey

export type Column = {
  /** Stable id used in code and in crew_sheet_rows.owner_cols. */
  key: string;
  /** The header the owner sees. */
  header: string;
  kind?: ColumnKind;
  /** Pixels. */
  width?: number;
  /** Owner-owned: the backend writes it only while empty, then only reads it. */
  owner?: boolean;
  /** Agent-written but the owner may change it (a draft message). A change is recorded as an edit. */
  editable?: boolean;
  /** Dropdown values for a status column (defaults to the tab's statuses). */
  options?: string[];
  /** A note on the header cell. */
  note?: string;
};

export type TabLayout =
  /** One row per record; the sync upserts by Key. */
  | "rows"
  /** Rebuilt from scratch every sync (queue, stats, log); rows carry the Key of their source row. */
  | "derived"
  /** Free-form cells written by the daily rebuild (the Dashboard). */
  | "free"
  /** A table the owner types into (Suppression, Paste a Post, Meetings): new rows are read in. */
  | "input"
  /** A header and a note only (a placeholder for something not built or not allowed yet). */
  | "placeholder";

export type TabSpec = {
  /** Stable id ("reddit-reply"); crew_sheet_rows.tab holds it. */
  id: string;
  /** The tab's name in the workbook. */
  name: string;
  group: "operating" | "agent";
  layout: TabLayout;
  /** Agent ids whose work lands here. */
  agents: string[];
  /** One or two plain sentences on A1's note: what this tab is for and what to do with a row. */
  description: string;
  columns: Column[];
  /** The Status dropdown. */
  statuses: string[];
  /** The tab colour (hex, no #). */
  color?: string;
  /** For placeholders: why it is empty and what unlocks it. */
  placeholder?: string;
};

/** Agent task statuses (spec §13). An approved draft is NOT a sent one. */
export const TASK_STATUSES = ["New", "Ready", "Needs Review", "Approved", "Sent / Posted", "Replied", "Completed", "Skipped", "Failed", "Expired", "Not Interested", "Unsubscribed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Pipeline statuses for people (spec §13). */
export const PIPELINE_STATUSES = ["New", "Queued", "Contacted", "Replied", "Meeting", "Customer", "Not Interested", "Unsubscribed"] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PRIORITIES = ["High", "Medium", "Low"] as const;

export const KEY_COLUMN: Column = { key: "key", header: "Key", kind: "key", width: 90, note: "The backend's id for this row. Leave it alone; sorting and filtering are fine." };

export const c = (key: string, header: string, o: Partial<Column> = {}): Column => ({ key, header, ...o });
export const status = (o: Partial<Column> = {}): Column => ({ key: "status", header: "Status", kind: "status", owner: true, width: 130, ...o });
export const notes = (): Column => ({ key: "notes", header: "Notes", kind: "long", owner: true, width: 220 });
export const dateCol = (key: string, header: string, owner = false): Column => ({ key, header, kind: "date", width: 110, owner });
export const linkCol = (key: string, header: string, width = 150): Column => ({ key, header, kind: "link", width });
export const longCol = (key: string, header: string, width = 360, o: Partial<Column> = {}): Column => ({ key, header, kind: "long", width, ...o });

/** The prepared message column: written once by the agent, editable by the owner. */
export const messageCol = (header = "Message to Send"): Column => ({ key: "message", header, kind: "long", width: 420, editable: true, note: "Copy this, open the link in the next column, paste, send. Edit it here first if you like; the agent learns from your edits." });

/**
 * Whether a cell the owner types in counts: Status anywhere it appears; notes,
 * dates and messages only on the agent's own tab (a computed tab's other
 * columns are copies, rewritten every sync). The sync and the edit hook both
 * use this, so they can't disagree.
 */
export function ownerEditable(tab: TabSpec, col: Column): boolean {
  return col.kind === "status" || (tab.layout === "rows" && (!!col.owner || !!col.editable));
}

export function hasKeyColumn(spec: TabSpec): boolean {
  return spec.columns[spec.columns.length - 1]?.kind === "key";
}
