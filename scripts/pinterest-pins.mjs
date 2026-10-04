#!/usr/bin/env node
// ── Pinterest: render the next pins and post them ───────────────────────────
//
// Runs from .github/workflows/pinterest-pins.yml. For each idea in
// src/lib/pinterest-pins.ts that has not been posted yet (asked of the site),
// it photographs https://swiftcard.me/pin/<slug> at 1000×1500 with a real
// browser, uploads the PNG to the public `pins` storage bucket, and asks the
// site to create the pin (/api/agents/pinterest/pin), which holds the Pinterest
// connection. A few per run, so the boards fill up over weeks the way a person
// would pin, not all at once.
//
// Needs: BOT_SECRET (= PUSH_CATCHUP_SECRET), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { chromium } from "playwright";

const BASE = process.env.APP_URL || "https://swiftcard.me";
const SECRET = process.env.INSTAGRAM_BOT_SECRET || process.env.PUSH_CATCHUP_SECRET;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PER_RUN = Math.max(1, Math.min(10, Number(process.env.PINS_PER_RUN || 3)));

const fail = (m) => { console.error(m); process.exit(1); };
if (!SECRET) fail("PUSH_CATCHUP_SECRET is not set — nothing can be pinned.");
if (!SB_URL || !SB_KEY) fail("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — the picture has nowhere to go.");

const api = async (method, body) => {
  const res = await fetch(`${BASE}/api/agents/pinterest/pin`, {
    method, headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const state = await api("GET");
if (state.status !== 200) fail(`site → ${state.status}: ${JSON.stringify(state.json).slice(0, 200)}`);
if (!state.json.ready) fail(state.json.message ?? "ledger table missing");
if (!state.json.connected) { console.log("Pinterest is not connected yet — connect it in Agent Flow → Settings. Nothing to do."); process.exit(0); }
const pending = (state.json.pending ?? []).slice(0, PER_RUN);
if (!pending.length) { console.log("Every pin idea is already posted."); process.exit(0); }
console.log(`${state.json.pending.length} idea(s) left; rendering ${pending.length}.`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1500 }, deviceScaleFactor: 2 });
  for (const slug of pending) {
    const url = `${BASE}/pin/${slug}`;
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    if (!res || res.status() !== 200) { console.log(`${slug}: page → ${res?.status()}`); continue; }
    await page.waitForTimeout(800); // web fonts and the card's photo
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1000, height: 1500 } });

    // Public bucket `pins` (supabase/agent-pinterest.sql); overwrite on re-run.
    const path = `${slug}.png`;
    const up = await fetch(`${SB_URL}/storage/v1/object/pins/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, "Content-Type": "image/png", "x-upsert": "true", "Cache-Control": "public, max-age=31536000" },
      body: png,
    });
    if (!up.ok) { console.log(`${slug}: upload → ${up.status} ${(await up.text()).slice(0, 160)}`); continue; }
    const image_url = `${SB_URL}/storage/v1/object/public/pins/${path}`;

    const made = await api("POST", { slug, image_url });
    if (made.status === 200 && made.json.ok) console.log(`${slug}: pinned → ${made.json.pin_url}${made.json.already ? " (already)" : ""}`);
    else console.log(`${slug}: not pinned — ${made.json.reason ?? made.status}`);
  }
} finally {
  await browser.close();
}
