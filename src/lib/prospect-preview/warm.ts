import type { WarmPath } from "./types";

// ── Card Builder: warm paths ────────────────────────────────────────────────
// The owner uploads their own LinkedIn connections export (Settings › Data
// privacy › Get a copy of your data › Connections). For each prospect we look
// for someone the owner already knows at that office. A shared school or past
// employer comes from the owner's own background (typed once, next to the
// upload) and the prospect's public bio, checked by /build-card.
//
// Pure: the CSV reader and the matching are tested without a database
// (tests/prospect-preview-round2.test.ts). Nothing here contacts LinkedIn:
// there is no LinkedIn access of any kind, only the file the owner exported.

export type Connection = { first_name: string; last_name: string; url: string | null; company: string | null; position: string | null; connected_on: string | null; company_key: string | null };

/** One CSV record → fields, with quotes ("Smith, Jr." and doubled "" inside). */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
/** LinkedIn writes "12 Nov 2026". */
function isoDay(v: string): string | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(v.trim());
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
}

const NOISE = new Set(["the", "llc", "inc", "co", "corp", "corporation", "company", "ltd", "lp", "llp", "pllc", "pc", "at", "of", "and"]);
/** "The Harbor Realty Group, LLC" → "harbor realty group". Empty when nothing is left. */
export function companyKeyOf(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !NOISE.has(w)).join(" ");
}

export const MAX_CONNECTIONS = 30000;

/**
 * LinkedIn's Connections.csv. The file opens with a few lines of notes before
 * the header row, so the header is found, not assumed. A row needs a name.
 */
export function parseConnectionsCsv(text: string): { ok: true; rows: Connection[] } | { ok: false; error: string } {
  const rows = splitCsv(text.replace(/^﻿/, ""));
  const at = rows.findIndex((r) => r.some((c) => /^first name$/i.test(c.trim())) && r.some((c) => /^last name$/i.test(c.trim())));
  if (at === -1) return { ok: false, error: "That doesn't look like LinkedIn's Connections.csv: it has no \"First Name\" and \"Last Name\" columns." };
  const head = rows[at].map((c) => c.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const [fi, li, ui, ci, pi, di] = [col("first name"), col("last name"), col("url"), col("company"), col("position"), col("connected on")];
  const cell = (r: string[], i: number, max: number) => (i === -1 ? "" : (r[i] ?? "").replace(/\s+/g, " ").trim().slice(0, max));
  const out: Connection[] = [];
  for (const r of rows.slice(at + 1)) {
    const first_name = cell(r, fi, 80), last_name = cell(r, li, 80);
    if (!first_name && !last_name) continue;
    const url = cell(r, ui, 300), company = cell(r, ci, 160);
    out.push({
      first_name, last_name,
      url: /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(url) ? url : null,
      company: company || null,
      position: cell(r, pi, 160) || null,
      connected_on: isoDay(cell(r, di, 20)),
      company_key: companyKeyOf(company) || null,
    });
    if (out.length >= MAX_CONNECTIONS) break;
  }
  return out.length ? { ok: true, rows: out } : { ok: false, error: "No connections were found in that file." };
}

export type WarmMatch = { name: string; position: string | null; url: string | null; company: string; exact: boolean };

/**
 * The owner's connections at this office. `exact` when the two names are the
 * same once "The", "LLC" and the like are dropped; otherwise one name sits
 * inside the other ("CMG Home Loans" and "CMG Home Loans Staten Island
 * Branch"), which may be another branch of the same firm, and is said so.
 * A one-word name only ever matches exactly: "Compass" is not "Compass Point".
 */
export function connectionsAt(officeName: string, connections: Connection[]): WarmMatch[] {
  const key = companyKeyOf(officeName);
  if (!key) return [];
  const inside = (short: string, long: string) => short.split(" ").length >= 2 && (` ${long} `).includes(` ${short} `);
  const out: WarmMatch[] = [];
  for (const c of connections) {
    const k = c.company_key;
    if (!k) continue;
    const exact = k === key;
    if (!exact && !inside(k, key) && !inside(key, k)) continue;
    out.push({ name: `${c.first_name} ${c.last_name}`.trim(), position: c.position, url: c.url, company: c.company ?? "", exact });
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 5);
}

/** The warm path to show for a prospect: the one saved at build time, or a connection found in the export now. */
export function warmPathFor(p: { office_name: string; owner_name: string; warm_path?: WarmPath | null }, connections: Connection[]): WarmPath | null {
  if (p.warm_path) return p.warm_path;
  // The decision-maker themselves being a connection is the warmest path there is.
  const them = p.owner_name.trim().toLowerCase();
  const [m] = connectionsAt(p.office_name, connections).sort((a, b) => Number(b.name.toLowerCase() === them) - Number(a.name.toLowerCase() === them));
  if (!m) return null;
  const who = m.name.toLowerCase() === them ? `${m.name} is already a LinkedIn connection of yours` : `You're connected on LinkedIn to ${m.name}${m.position ? `, ${m.position}` : ""}`;
  return { kind: "connection", name: m.name, text: m.exact ? `${who}${m.name.toLowerCase() === them ? "." : " there."}` : `${who} at ${m.company}, which may be another office of the same firm.` };
}

export type OwnerBackground = { schools: string[]; employers: string[] };
export function readBackground(v: unknown): OwnerBackground {
  const list = (x: unknown) => (Array.isArray(x) ? x : typeof x === "string" ? x.split(/\r?\n|;/) : []).map((s) => String(s).replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean).slice(0, 20);
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { schools: list(r.schools), employers: list(r.employers) };
}

export function readWarmPath(v: unknown): WarmPath | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const kind = r.kind === "connection" || r.kind === "school" || r.kind === "employer" ? r.kind : null;
  const text = typeof r.text === "string" ? r.text.replace(/\s+/g, " ").trim().slice(0, 240) : "";
  const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  if (!kind || !text || !name) return null;
  const source_url = typeof r.source_url === "string" && /^https?:\/\//.test(r.source_url) ? r.source_url.slice(0, 600) : undefined;
  return { kind, text, name, ...(source_url ? { source_url } : {}) };
}
