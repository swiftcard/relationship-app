// ── Card Builder: "New batch" (owner, 2026-11-16) ───────────────────────────
// The owner types a target ("realtors in Great Neck", "mortgage teams in
// Manhattan") or drops in a CSV, picks a count up to 100 and "run now" or
// "run overnight". That makes a REQUESTED batch; the Mac agent
// (scripts/card-builder-mac/agent.mjs) picks it up and runs /build-batch on it
// in chunks, so nothing times out. Pure, tested in tests/card-builder-batch.test.ts.

export const MAX_BATCH = 100;
/** How many prospects one /build-batch run builds before handing back: small enough to finish well inside an hour. */
export const BATCH_CHUNK = 10;
/** "Run overnight" starts at this hour, New York time. */
export const OVERNIGHT_HOUR = 23;

export type BatchRequest = { label: string; wanted: number; kind: "now" | "tonight"; rows: string[] };

const cell = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const HEADERS: [RegExp, string][] = [
  [/^(full ?)?name$|^agent|^contact/, "name"], [/^first/, "first"], [/^last/, "last"],
  [/compan|brokerage|office|firm|team/, "company"], [/title|role/, "title"],
  [/city|town|area|location|neighbou?rhood/, "city"], [/state/, "state"],
  [/mobile|cell/, "mobile"], [/phone|tel/, "phone"], [/e-?mail/, "email"],
  [/web|site|url|link|zillow|profile/, "url"], [/note/, "notes"],
];

/**
 * One line per prospect from a CSV, as the queue holds them: "Dana Whitfield,
 * Owner at Harbor Realty, Great Neck · mobile 516-555-0101 · https://…". A
 * file with no header row is read as name, company, city, phone, email, url.
 */
export function csvToProspects(text: string, max: number = MAX_BATCH): string[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return [];
  const head = rows[0].map((h) => cell(h).toLowerCase());
  const mapped = head.map((h) => HEADERS.find(([re]) => re.test(h))?.[1] ?? null);
  const hasHeader = mapped.filter(Boolean).length >= 2;
  const keys = hasHeader ? mapped : ["name", "company", "city", "phone", "email", "url"];
  const out: string[] = [];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const v: Record<string, string> = {};
    r.forEach((c, i) => { const k = keys[i]; if (k && cell(c) && !v[k]) v[k] = cell(c); });
    const name = v.name || [v.first, v.last].filter(Boolean).join(" ");
    const who = [name, v.title && v.company ? `${v.title} at ${v.company}` : v.company || v.title].filter(Boolean).join(", ");
    const where = [v.city, v.state].filter(Boolean).join(", ");
    const line = [[who, where].filter(Boolean).join(", "), v.mobile ? `mobile ${v.mobile}` : "", v.phone ? `phone ${v.phone}` : "", v.email ?? "", v.url ?? "", v.notes ? `notes: ${v.notes}` : ""].filter(Boolean).join(" · ").slice(0, 600);
    if (line.length >= 2 && (name || v.company || v.url)) out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/** The New batch form. A refusal is a sentence for the owner. */
export function parseBatchForm(get: (k: string) => unknown, csvText: string | null): { ok: true; value: BatchRequest } | { ok: false; error: string } {
  const target = cell(get("target")).slice(0, 200);
  const rows = csvText ? csvToProspects(csvText) : [];
  if (csvText && !rows.length) return { ok: false, error: "That file has no prospects in it that could be read. One per row: name, company, city, phone, email, link." };
  if (!target && !rows.length) return { ok: false, error: "Type who to find (\"realtors in Great Neck\"), or add a CSV." };
  const asked = Number(cell(get("count")));
  const wanted = rows.length ? Math.min(rows.length, MAX_BATCH) : Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_BATCH) : 0;
  if (!wanted) return { ok: false, error: `How many? Anywhere from 1 to ${MAX_BATCH}.` };
  const kind = get("when") === "tonight" ? "tonight" : "now";
  const label = target || `CSV: ${rows.length} prospect${rows.length === 1 ? "" : "s"}`;
  return { ok: true, value: { label, wanted, kind, rows } };
}

/** When a batch may start: now, or tonight at 11pm New York time (now, if it is already the middle of the night). */
export function batchRunAfter(kind: "now" | "tonight", now: Date = new Date()): Date {
  if (kind === "now") return now;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour >= OVERNIGHT_HOUR || hour < 5) return now;
  return new Date(now.getTime() + (OVERNIGHT_HOUR - hour) * 3_600_000 - (now.getUTCMinutes() * 60_000 + now.getUTCSeconds() * 1000));
}
