#!/usr/bin/env node
// ── Remove card images left behind by deleted QA test accounts ───────────────
//
// Every QA script (qa-flows, qa-sweep, qa-a11y, qa-mac, the shell checks …)
// seeds a throwaway account named qa-…, and its `finally` block deletes the
// account's rows and auth user. None of them removes the rendered card images,
// which are cached at <slug>.png in the card-shares and card-signatures
// buckets. By 2026-10-20 those leftovers were 7,180 files / 2.8 GB of a 3 GB
// total, and Supabase warned the organization it would be restricted on
// 2026-10-22 for being over the free plan's 1 GB of storage.
//
// SAFETY
//   • Only files named qa-<letters/digits/dashes>.png at the top of the two
//     buckets. A real person's image is never a candidate, even if orphaned.
//   • Only if NO card (current slug or any _prevSlugs) and NO profile has that
//     name, so a QA run in progress, or anyone who picked a qa- name, keeps
//     their image.
//   • Only files older than 6 hours (no QA run lasts that long).
//   • Refuses to run if the card list comes back empty (a failed query would
//     otherwise make everything look orphaned).
//   • Dry run by default. `--go` is required to delete.
//   • The images are caches: if one were ever wrong, the app draws it again on
//     demand (see the comment in src/app/api/account/delete/route.ts).
//
// Usage:  node scripts/cleanup-qa-images.mjs          # count what would go
//         node scripts/cleanup-qa-images.mjs --go     # delete it

import { existsSync, readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const env = existsSync(`${ROOT}/.env.local`) ? readFileSync(`${ROOT}/.env.local`, "utf8") : "";
const g = (k) => process.env[k] ?? process.env[k.replace(/^NEXT_PUBLIC_/, "")] ?? (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL");
const SVC = g("SUPABASE_SERVICE_ROLE_KEY");
if (!SB || !SVC) { console.error("missing SUPABASE url / service role key"); process.exit(2); }

const GO = process.argv.includes("--go");
const BUCKETS = ["card-shares", "card-signatures"];
const QA_NAME = /^(qa-[a-z0-9-]+)\.png$/i;
const MIN_AGE_MS = 6 * 3600_000;

const headers = { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" };
async function api(path, init) {
  const r = await fetch(SB + path, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function allRows(table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await api(`/rest/v1/${table}?select=${select}`, { headers: { Range: `${from}-${from + 999}` } });
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function listBucket(bucket) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await api(`/storage/v1/object/list/${bucket}`, {
      method: "POST",
      body: JSON.stringify({ prefix: "", limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    out.push(...page.filter((o) => o.id)); // folders have no id
    if (page.length < 1000) return out;
  }
}

const cards = await allRows("cards", "username,customization");
const profiles = await allRows("profiles", "username");
if (!cards.length) { console.error("refusing: the cards query returned nothing"); process.exit(3); }

const inUse = new Set();
for (const c of cards) {
  if (c.username) inUse.add(c.username.toLowerCase());
  const prev = c.customization?._prevSlugs;
  if (Array.isArray(prev)) for (const s of prev) if (typeof s === "string") inUse.add(s.toLowerCase());
}
for (const p of profiles) if (p.username) inUse.add(p.username.toLowerCase());
console.log(`${cards.length} cards, ${profiles.length} profiles → ${inUse.size} names in use`);

const now = Date.now();
const mb = (b) => `${(b / 1048576).toFixed(0)} MB`;
let totalFiles = 0, totalBytes = 0;

for (const bucket of BUCKETS) {
  const objects = await listBucket(bucket);
  const doomed = objects.filter((o) => {
    const m = o.name.match(QA_NAME);
    if (!m || inUse.has(m[1].toLowerCase())) return false;
    return now - new Date(o.created_at).getTime() > MIN_AGE_MS;
  });
  const bytes = doomed.reduce((s, o) => s + (o.metadata?.size ?? 0), 0);
  const allBytes = objects.reduce((s, o) => s + (o.metadata?.size ?? 0), 0);
  console.log(`${bucket}: ${objects.length} files (${mb(allBytes)}); ${doomed.length} QA leftovers (${mb(bytes)})`);
  totalFiles += doomed.length;
  totalBytes += bytes;

  if (!GO) continue;
  let removed = 0;
  for (let i = 0; i < doomed.length; i += 100) {
    const batch = doomed.slice(i, i + 100).map((o) => o.name);
    const res = await api(`/storage/v1/object/${bucket}`, { method: "DELETE", body: JSON.stringify({ prefixes: batch }) });
    removed += Array.isArray(res) ? res.length : 0;
  }
  console.log(`  deleted ${removed}`);
}

console.log(GO ? `Done: removed ${totalFiles} files, ${mb(totalBytes)}.` : `Dry run: would remove ${totalFiles} files, ${mb(totalBytes)}. Run again with --go to delete.`);
