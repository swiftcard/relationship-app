#!/usr/bin/env node
// Set up (or re-sync) the SwiftCard Leads workbook right now, without waiting
// for the 15-minute clock. Calls POST /api/crew/sheet-setup on the live site
// (or BASE) with the tick secret. Reads CREW_TICK_SECRET from the environment
// first and .env.local second, like every other script here.
//
//   node scripts/crew-sheet-setup.mjs
//   BASE=http://localhost:3222 node scripts/crew-sheet-setup.mjs
//
// It prints the workbook URL and what the sync did. If no workbook exists yet
// and CREW_SHARED_DRIVE_ID is set in Vercel, the backend creates one and
// prints the id to put in CREW_SHEET_ID.

import { readFileSync } from "node:fs";

function envLocal(key) {
  if (process.env[key]) return process.env[key];
  try {
    const m = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(".env.local", "utf8"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

const base = (process.env.BASE || "https://swiftcard.me").replace(/\/$/, "");
const secret = envLocal("CREW_TICK_SECRET");
if (!secret) {
  console.error("CREW_TICK_SECRET is not set (environment or .env.local).");
  process.exit(2);
}

const r = await fetch(`${base}/api/crew/sheet-setup`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
const text = await r.text();
let j;
try {
  j = JSON.parse(text);
} catch {
  console.error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  process.exit(1);
}
if (!r.ok) {
  console.error(`HTTP ${r.status}:`, j);
  process.exit(1);
}
console.log(`Workbook: ${j.url ?? "(none yet)"}`);
console.log(`Read ${j.tabsRead} tabs; applied ${j.changes} of your changes (${j.refused} put back); added ${j.appended} rows; updated ${j.updated}; rebuilt ${j.derived} computed tabs.`);
for (const n of j.notes ?? []) console.log(`• ${n}`);
for (const e of j.errors ?? []) console.log(`✗ ${e}`);
process.exit(j.ok ? 0 : 1);
