// ── Office analytics CSV export ──────────────────────────────────────────────
// Same manual, quote-escaped CSV style as the existing src/app/api/leads/export
// route — no CSV library exists anywhere in this app, so this doesn't
// introduce one.

export type EmployeeCsvRow = {
  name: string;
  cardName: string;
  views: number;
  uniqueVisitors: number;
  scans: number;
  leads: number;
  contactsSaved: number;
  swiftlinkViews: number;
  lastActivityAt: string | null;
};

// Prefixes a leading =, +, -, @, tab, or CR with a single quote before
// quoting — otherwise a cell value under attacker control (an employee or
// card name, both user-set) can be interpreted as a formula by Excel/Sheets
// when this CSV is opened (CSV/formula injection — security review).
function esc(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

const HEADER = [
  "Employee",
  "Card",
  "Card views",
  "Unique visitors",
  "QR/NFC scans",
  "Leads captured",
  "Contact downloads",
  "SwiftLink views",
  "Most recent activity",
].join(",");

export function buildEmployeeAnalyticsCsv(rows: EmployeeCsvRow[]): string {
  const lines = rows.map((r) =>
    [
      esc(r.name),
      esc(r.cardName),
      esc(r.views),
      esc(r.uniqueVisitors),
      esc(r.scans),
      esc(r.leads),
      esc(r.contactsSaved),
      esc(r.swiftlinkViews),
      esc(r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleDateString() : ""),
    ].join(",")
  );
  return [HEADER, ...lines].join("\n");
}
