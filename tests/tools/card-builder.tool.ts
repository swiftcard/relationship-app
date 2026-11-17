import { it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentContext } from "@/lib/crew/context";
import { companyKey } from "@/lib/crew/leads/quality";
import { recordLeads } from "@/lib/crew/leads/record";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import type { Lead } from "@/lib/crew/types";
import { pullBrandColors } from "@/lib/prospect-preview/colors-server";
import { cleanHttpsUrl, UUID_RE } from "@/lib/prospect-preview/input";
import { paddedLogoSrc } from "@/lib/prospect-preview/card";
import { scoreFit, type FitEvidence, type FitInput, type FitKey } from "@/lib/prospect-preview/fit";
import { callBrief } from "@/lib/prospect-preview/call";
import { addToQueue, finishBatch, listConnections, listEvents, listQueue, logBatchItem, ownerBackground, recentBatches, settleQueueItem, startBatch } from "@/lib/prospect-preview/desk";
import { batchBrief, styleNotes } from "@/lib/prospect-preview/learn";
import { checkOutreach, readOutreach, resolveOutreach, staleNumbers } from "@/lib/prospect-preview/outreach";
import { connectionsAt } from "@/lib/prospect-preview/warm";
import { assessQuality, isVerified } from "@/lib/prospect-preview/quality";
import { BUYER_ROLE_LABELS, BUYER_ROLES, CURRENT_TOOL_LABELS, CURRENT_TOOLS, LINK_SLOT, OUTREACH_KEYS, SOURCE_FIELDS, SOURCE_LABELS, TEXT_LIMIT, type BuyerRole, type CurrentTool, type ProspectPreview } from "@/lib/prospect-preview/types";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createDraftFrom, extrasFrom, fieldsFrom, links, standing, type Json } from "@/lib/prospect-preview/draft-core";
import { MAX_BATCH } from "@/lib/prospect-preview/batch-input";
import { claimBatch, readCandidates, setCandidates } from "@/lib/prospect-preview/desk";
import { checkOpeners, openerFacts, openerMessage, openerText, rankOpeners, readOpeners, scoreTotal, OPENER_HOOK_LABELS } from "@/lib/prospect-preview/opener";
import { applyJudge, judgeMessage, readJudgeVerdict } from "@/lib/prospect-preview/opener-judge";
import { lookupPhoneKind, nanp } from "@/lib/prospect-preview/phone-type";

// ── Card Builder's command-line tool ────────────────────────────────────────
// Run by scripts/card-builder.mjs (never by `npm test`). It is a vitest file
// only so it can use the app's own code: the form checks, the lead recorder,
// the real preview page. See that script for the commands.
//
// RULES IT ENFORCES, whatever the caller asks for:
//   - a lead or a preview is only for a buyer: broker-owner, managing broker,
//     team lead or branch manager
//   - a preview is created as a DRAFT, and only a draft can be changed
//   - a headshot needs a source on their own site or brokerage profile
//   - nobody on the do-not-contact list, and nobody already contacted, is listed
//   - an office is scored on the six stated criteria, and one that is
//     disqualified (corporate decides, under 5 people, no named leader, only
//     a general line and address) is never saved as a lead
//   - the quality gate's override belongs to the owner: nothing here sets it
//   - "confirmed by the owner" is only for what the owner themselves supplied:
//     it must carry their words as its note
//   - the messages it saves are complete, 160 characters or under for a text,
//     with no emoji and no "free", and only ever on a draft
//   - the opening texts it saves pass every rule in lib/prospect-preview/opener.ts
//   - nobody who is already a SwiftCard user is built for
//   - nothing is published and nothing is sent

const APP_URL = process.env.NEXT_PUBLIC_APP_URL && !/localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_APP_URL) ? process.env.NEXT_PUBLIC_APP_URL : "https://swiftcard.me";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const lower = (v: unknown) => str(v).toLowerCase();
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;

// ── leads: office leads with no preview yet ─────────────────────────────────

async function leads(args: string[]) {
  const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i === -1 ? "" : args[i + 1] ?? ""; };
  const area = flag("area") ? new RegExp(flag("area"), "i") : null;
  const limit = Math.max(1, Math.min(100, Number(flag("limit")) || 20));
  const db = getAdminSupabase();
  const { data, error } = await db.from("crew_leads")
    .select("id, name, title, company, email, phone, business_type, city, region, source_url, score, why, hook, notes, created_at")
    .eq("list", "office").eq("region_restricted", false).order("score", { ascending: false, nullsFirst: false }).limit(2000);
  if (error) throw new Error(error.message);
  const out: Json[] = [];
  let total = 0;
  for (const l of data ?? []) {
    if (area && !area.test([l.city, l.region, l.company, l.notes, l.source_url].join(" "))) continue;
    total++;
    if (out.length >= limit) continue;
    const s = await standing({ company: l.company as string, source_url: l.source_url as string, email: l.email as string, phone: l.phone as string });
    // "already a lead" is itself here; anything else is a reason to leave it.
    if (s.skip) continue;
    out.push(l);
  }
  return { ok: true, in_area: total, without_preview_or_contact: out.length, leads: out, note: "A lead here is a COMPANY. Confirm the named person is the decision-maker (broker-owner, managing broker, team lead, branch manager) before building anything." };
}

// ── check ───────────────────────────────────────────────────────────────────

async function check(file: string) {
  const list = readJson(file) as Candidate[];
  if (!Array.isArray(list)) throw new Error("check wants a JSON array of { company, website, email, phone }.");
  const results = [];
  for (const c of list) results.push({ company: c.company ?? null, ...(await standing(c)) });
  return { ok: true, results };
}

// ── save-leads ──────────────────────────────────────────────────────────────

/** What one office looks like to the scorer (lib/prospect-preview/fit.ts). */
function fitInput(l: Json): FitInput {
  const size = Number(l.team_size);
  return {
    name: str(l.name),
    team_size: Number.isInteger(size) && size > 0 ? size : null,
    phone: str(l.phone),
    phone_kind: str(l.phone_kind),
    email: str(l.email),
    corporate_decides: l.corporate_decides === true,
    evidence: (l.evidence ?? {}) as Partial<Record<FitKey, FitEvidence>>,
  };
}

const toolOf = (l: Json): CurrentTool | null => ((CURRENT_TOOLS as readonly string[]).includes(str(l.current_tool)) ? (str(l.current_tool) as CurrentTool) : null);

/** The score and its breakdown for each office, without saving anything. */
function fit(file: string) {
  const list = readJson(file) as Json[];
  if (!Array.isArray(list)) throw new Error("fit wants a JSON array of offices.");
  return { ok: true, results: list.map((l) => ({ company: str(l.company) || null, ...scoreFit(fitInput(l)), current_tool: toolOf(l) ? CURRENT_TOOL_LABELS[toolOf(l)!] : "not checked" })) };
}

/**
 * [{ name, buyer_role, buyer_source, title?, company, website, email?, phone?,
 *    phone_kind?: "mobile" | "direct" | "office line", business_type?, city?,
 *    region?, team_size?, corporate_decides?, why, hook?,
 *    current_tool?: paper | link_in_bio | popl | linq | blinq | hihello | dot | other_digital,
 *    current_tool_source?,
 *    evidence: { independent, active, in_person, growing: { met: true|false|null, note, source, date } } }]
 * The score is worked out here from the six criteria; a `fit` number in the
 * file is ignored.
 */
async function saveLeads(file: string) {
  const list = readJson(file) as Json[];
  if (!Array.isArray(list)) throw new Error("save-leads wants a JSON array.");
  const refused: { company: string; why: string }[] = [];
  const disqualified: { company: string; why: string[] }[] = [];
  const breakdown: Json[] = [];
  const rows: Lead[] = [];
  for (const l of list) {
    const company = str(l.company);
    const refuse = (why: string) => refused.push({ company: company || "(no company)", why });
    const scored = scoreFit(fitInput(l));
    if (scored.disqualified.length) { disqualified.push({ company: company || "(no company)", why: scored.disqualified }); continue; }
    if (!company || !str(l.name)) { refuse("needs the company and the decision-maker's name"); continue; }
    if (!(BUYER_ROLES as readonly string[]).includes(str(l.buyer_role))) { refuse("buyer_role must be broker_owner, managing_broker, team_lead or branch_manager: nobody else can buy an Office plan"); continue; }
    const source = cleanHttpsUrl(l.buyer_source) ?? "";
    if (!source) { refuse("buyer_source: the https page that names this person and their role"); continue; }
    const website = cleanHttpsUrl(l.website) ?? source;
    if (!str(l.email) && !str(l.phone)) { refuse("needs a phone number or an email"); continue; }
    const s = await standing({ company, website, email: str(l.email), phone: str(l.phone) });
    if (s.skip || s.lead_id) { refuse(s.reasons.join("; ")); continue; }
    const size = Number(l.team_size);
    const tool = toolOf(l);
    breakdown.push({ company, score: scored.score, lines: scored.lines, current_tool: tool ? CURRENT_TOOL_LABELS[tool] : "not checked" });
    rows.push({
      list: "office",
      name: str(l.name),
      title: str(l.title) || BUYER_ROLE_LABELS[str(l.buyer_role) as BuyerRole],
      company,
      email: lower(l.email) || null,
      phone: str(l.phone) || null,
      business_type: str(l.business_type) || null,
      city: str(l.city) || null,
      region: str(l.region) || null,
      country: "US",
      source_platform: "web",
      source_url: website,
      score: scored.score,
      why: str(l.why).slice(0, 400) || null,
      hook: str(l.hook).slice(0, 300) || null,
      notes: [
        `Decision-maker: ${BUYER_ROLE_LABELS[str(l.buyer_role) as BuyerRole]} (${source}).`,
        str(l.phone) ? `Phone is their ${str(l.phone_kind) || "office line"}.` : "",
        Number.isInteger(size) && size > 0 ? `About ${size} people.` : "",
        scored.summary,
        tool ? `Shares contact details today with: ${CURRENT_TOOL_LABELS[tool]}${cleanHttpsUrl(l.current_tool_source) ? ` (${cleanHttpsUrl(l.current_tool_source)})` : ""}.` : "What they share contact details with today: not checked.",
        "Found by /find-offices for Card Builder.",
      ].filter(Boolean).join(" "),
    });
  }
  rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  // The agents' own recorder: suppression, one lead per company, the ledger.
  const stats: Record<string, number> = {};
  const ctx = { store: new SupabaseStore(), now: () => new Date(), stat: (k: string, n = 1) => { stats[k] = (stats[k] ?? 0) + n; } } as unknown as AgentContext;
  const added = rows.length ? await recordLeads(ctx, rows) : 0;
  const keys = rows.map((r) => companyKey(r)).filter((k): k is string => !!k);
  const { data } = keys.length
    ? await getAdminSupabase().from("crew_leads").select("id, name, title, company, phone, email, city, score, why, source_url").in("company_key", keys).order("score", { ascending: false })
    : { data: [] };
  return { ok: true, added, stats, refused, disqualified, breakdown, saved: data ?? [] };
}

// ── drafts ──────────────────────────────────────────────────────────────────

/**
 * The checklist as the edit screen shows it, and every message as the screens
 * will show it: the ones written for this prospect (set-outreach), or the
 * templates where none were.
 */
async function quality(id: string) {
  if (!UUID_RE.test(id)) throw new Error("quality wants the preview's id.");
  const { getPreviewById } = await import("@/lib/prospect-preview/store");
  const p = await getPreviewById(id);
  if (!p) throw new Error("No preview with that id.");
  const q = assessQuality(p);
  const link = `${APP_URL}/p/${p.slug}`;
  const m = resolveOutreach(p, { link, sender: null });
  return {
    ok: true, status: p.status, office: p.office_name, decision_maker: p.owner_name, score: q.score, too_generic: q.tooGeneric, overridden_by_owner: p.quality_override,
    checks: q.checks.map((c) => ({ check: c.label, done: c.ok, needed_to_publish: c.required, points: `${c.earned}/${c.points}`, ...(c.fix ? { fix: c.fix } : {}) })),
    specifics: p.specifics.map((sp, i) => ({ position: i, text: sp.text, verified: isVerified(sp), confirmed_by_owner: sp.owner === true })),
    warm_path: p.warm_path ?? null,
    phone_kind: p.phone_kind ?? null,
    openers: p.openers ? { problems: checkOpeners(p.openers, p, staleNumbers(p)), default: openerText(p.openers), all: p.openers.candidates.map((c) => ({ hook: c.hook, total: scoreTotal(c), text: c.text })) } : "not written yet: run set-openers",
    numbers_flagged_as_possibly_stale: staleNumbers(p),
    could_not_confirm: [
      ...SOURCE_FIELDS.filter((k) => p.sources[k]?.uncertain).map((k) => `${SOURCE_LABELS[k]}: marked uncertain${p.sources[k]?.note ? ` (${p.sources[k]!.note})` : ""}`),
      ...p.specifics.filter((sp) => !isVerified(sp)).map((sp) => `Specific not verified: ${sp.text}`),
      ...q.checks.filter((c) => !c.ok).map((c) => `Missing: ${c.label}`),
    ],
    messages: {
      written_for_this_prospect: m.written,
      opens_with_the_hook: m.specific,
      problems: checkOutreach(p.outreach ?? null, { link, specifics: p.specifics, complete: true, linkedin: !!p.linkedin_url, warmName: p.warm_path?.name ?? null, stale: staleNumbers(p) }),
      first_text: m.versions?.a ?? m.ask, first_text_second_version: m.versions?.b ?? null,
      linkedin_profile: p.linkedin_url ?? null, linkedin_connection_note: m.linkedin?.note ?? null, linkedin_message_after_accept: m.linkedin?.dm ?? null, text_with_link: m.text, email_subject: m.email.subject, email: m.email.body,
      call_opener: callBrief(p, { sender: null }).opener, voicemail: m.voicemail,
      nudge_no_view_after_2_days: m.nudge_no_view, nudge_viewed_no_pickup: m.nudge_viewed,
    },
  };
}

/**
 * { first_text, first_text_b, link_text, email_subject, email_body,
 *   call_opener, voicemail, nudge_no_view, nudge_viewed,
 *   linkedin_note, linkedin_dm   (both required when the draft has linkedin_url),
 *   uses: { first_text: <position in specifics>, first_text_b: …, link_text: …,
 *           email_body: …, call_opener: …, voicemail: …, nudge_no_view: …,
 *           nudge_viewed: …, linkedin_dm: … } }
 * first_text_b is a second version of the first text built on a DIFFERENT
 * specific. linkedin_note is 200 characters at most, with no link and no pitch.
 * No follower counts, no number flagged as possibly stale, nothing built on a
 * specific marked quiet, never "see who opens it". With a warm path, the
 * first text names it.
 * Write {link} where the preview's link goes (link_text and email_body need
 * it; first_text must not have it). Every message is required, each is built
 * on a VERIFIED specific, and they use different ones where the preview has
 * them. A text is 160 characters at most with the link in. No emojis, no
 * "free". Refused with every problem listed; nothing is saved until it is clean.
 */
async function setOutreachFor(id: string, file: string) {
  if (!UUID_RE.test(id)) throw new Error("set-outreach wants the preview's id first.");
  const { getPreviewById } = await import("@/lib/prospect-preview/store");
  const p = await getPreviewById(id);
  if (!p) throw new Error("No preview with that id.");
  const raw = readJson(file) as Json;
  const unknown = Object.keys(raw).filter((k) => k !== "uses" && !(OUTREACH_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw new Error(`These aren't messages: ${unknown.join(", ")}. Use: ${OUTREACH_KEYS.join(", ")}, and uses.`);
  const outreach = readOutreach({ ...raw, written_at: new Date().toISOString() });
  const link = `${APP_URL}/p/${p.slug}`;
  const problems = checkOutreach(outreach, { link, specifics: p.specifics, complete: true, linkedin: !!p.linkedin_url, warmName: p.warm_path?.name ?? null, stale: staleNumbers(p) });
  if (problems.length) throw new Error(`Not saved. ${problems.join(" ")} (A text is ${TEXT_LIMIT} characters at most once ${LINK_SLOT} becomes ${link}, which is ${link.length} characters.)`);
  // Only a draft: a published preview's words are changed by a person, on the edit screen.
  const { data, error } = await getAdminSupabase().from("prospect_previews")
    .update({ outreach, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft").select("id, slug, status");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("No DRAFT with that id. A published preview's messages are only changed on its edit screen.");
  return { ok: true, status: data[0].status, saved: OUTREACH_KEYS.length, ...links(data[0] as { id: string; slug: string }) };
}

async function createDraft(file: string) {
  return createDraftFrom(readJson(file) as Json);
}

async function updateDraft(id: string, file: string) {
  if (!UUID_RE.test(id)) throw new Error("update-draft wants the preview's id first.");
  const raw = readJson(file) as Json;
  const fields = fieldsFrom(raw);
  const extras = extrasFrom(raw);
  // Only a draft: a published preview is in front of a prospect and is changed by a person, on the edit screen.
  const { data, error } = await getAdminSupabase().from("prospect_previews")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft").select("id, slug, status");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("No DRAFT with that id. A published preview is only changed on its edit screen.");
  if (Object.keys(extras).length) await getAdminSupabase().from("prospect_previews").update(extras).eq("id", id).eq("status", "draft");
  return { ok: true, status: data[0].status, ...links(data[0] as { id: string; slug: string }) };
}

// ── shots: look at it on a phone and on a computer ──────────────────────────

async function shots(id: string, dir?: string) {
  if (!UUID_RE.test(id)) throw new Error("shots wants the preview's id.");
  const { getPreviewById } = await import("@/lib/prospect-preview/store");
  const preview = (await getPreviewById(id)) as ProspectPreview | null;
  if (!preview) throw new Error("No preview with that id.");
  const { appCss, launchBrowser } = await import("../render/harness");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { default: PreviewView } = await import("@/app/p/[slug]/PreviewView");
  const logoSrc = paddedLogoSrc(preview, false);
  const { logoResponse } = await import("@/lib/prospect-preview/logo-server");
  const logo = logoSrc ? await logoResponse(preview.logo_url, preview.brand_primary) : null;
  const logoPng = logo?.ok ? Buffer.from(await logo.arrayBuffer()) : null;
  const markup = renderToStaticMarkup(createElement(PreviewView, { preview, bookUrl: "/demo", logoSrc: logoPng ? logoSrc : null }));
  const css = await appCss();
  const outDir = dir || join(tmpdir(), "card-builder-shots");
  mkdirSync(outDir, { recursive: true });
  const browser = await launchBrowser();
  const files: Json[] = [];
  try {
    for (const [name, width, height] of [["phone", 390, 844], ["desktop", 1280, 900]] as const) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      // The app's own files (the SwiftCard icon) come from ./public, not the live site.
      await page.route("http://card-builder.local/**", (route) => {
        // The padded logo is a route of the app; here it is made by the same code.
        if (logoPng && /^\/p\/[^/]+\/logo$/.test(new URL(route.request().url()).pathname)) return route.fulfill({ contentType: "image/png", body: logoPng });
        const file = join("public", decodeURIComponent(new URL(route.request().url()).pathname));
        return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: "" });
      });
      await page.setContent(`<!doctype html><html data-sc-theme="light"><head><meta charset="utf-8"><base href="http://card-builder.local/"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><style>body{margin:0}</style></head><body>${markup}</body></html>`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const vw = window.innerWidth;
        if (document.documentElement.scrollWidth > vw) out.push("the page scrolls sideways");
        document.querySelectorAll("img").forEach((img) => { if (!img.complete || img.naturalWidth === 0) out.push(`picture didn't load: ${img.src.slice(0, 120)}`); });
        document.querySelectorAll("h1, h2, p, a[data-claim]").forEach((el) => {
          if (el.closest("[inert]") || el.closest("[data-team-strip]")) return;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) out.push(`text runs off the screen: "${(el.textContent ?? "").slice(0, 60)}"`);
        });
        const card = document.querySelector("[data-owner-card] [inert] > div > div") as HTMLElement | null;
        if (!card || getComputedStyle(card).opacity !== "1") out.push("the owner's card isn't drawn");
        return out;
      });
      const file = join(outDir, `${preview.slug}-${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      files.push({ view: name, width, file, problems });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return { ok: true, status: preview.status, shots: files, note: "Open each PNG and LOOK at it: a logo that is the wrong shape, a headshot of the wrong person or colours that fight are not things a script can see." };
}

// ── colors ──────────────────────────────────────────────────────────────────

async function colors(logo?: string, website?: string) {
  const got = await pullBrandColors({ logo_url: cleanHttpsUrl(logo), website: cleanHttpsUrl(website) });
  return got ? { ok: true, ...got } : { ok: false, error: "Couldn't read colours from that logo or site. Pick them by eye from the site instead, and mark the colors source uncertain." };
}

// ── the queue, batches, warm paths and the owner's style ────────────────────

/** What the owner dropped into the Add box and nobody has built yet. */
async function queue(args: string[] = []) {
  const i = args.indexOf("--batch");
  const batch = i === -1 ? null : args[i + 1] ?? "";
  if (batch !== null && !UUID_RE.test(batch)) throw new Error("--batch wants the batch id.");
  const items = await listQueue("queued", batch);
  return { ok: true, waiting: items.length, items: items.map((q) => ({ id: q.id, input: q.input, owners_own_notes: q.is_notes, added: q.created_at })), note: "An item marked owners_own_notes is the owner's own words: its facts are confirmed by the owner. Settle each one with queue-settle as soon as it is built, skipped or failed." };
}

/** { outcome: "built" | "skipped" | "failed", preview_id?, note?, batch_id? } */
async function queueSettle(id: string, file: string) {
  if (!UUID_RE.test(id)) throw new Error("queue-settle wants the queue item's id first.");
  const raw = readJson(file) as Json;
  const outcome = str(raw.outcome);
  if (outcome !== "built" && outcome !== "skipped" && outcome !== "failed") throw new Error("outcome is built, skipped or failed.");
  const preview_id = str(raw.preview_id) || null;
  if (outcome === "built" && (!preview_id || !UUID_RE.test(preview_id))) throw new Error("A built item needs its preview_id.");
  if (outcome !== "built" && !str(raw.note)) throw new Error("Say why in note: the owner reads it.");
  const ok = await settleQueueItem(id, outcome, { note: str(raw.note) || null, preview_id, batch_id: UUID_RE.test(str(raw.batch_id)) ? str(raw.batch_id) : null });
  if (!ok) throw new Error("No queue item with that id.");
  return { ok: true, id, outcome };
}

/** One line per prospect, for a run that was handed names instead of the Add box. */
async function queueAdd(file: string) {
  const raw = readJson(file) as Json;
  const lines = Array.isArray(raw.lines) ? (raw.lines as unknown[]).map((l) => str(l)).filter(Boolean) : [];
  if (!lines.length) throw new Error("queue-add wants { lines: [\"Harbor Realty Group, Brooklyn\", …] }.");
  return { ok: true, added: await addToQueue(lines.map((input) => ({ input: input.slice(0, 600), is_notes: false }))) };
}

/**
 * { label: "<what was typed>", kind: "now" | "tonight", wanted: <count> }
 * A run with the same label that started in the last day and never finished
 * is RESUMED: its items come back, and anything already built is not rebuilt.
 */
async function batchStart(file: string) {
  const raw = readJson(file) as Json;
  // A batch made with "New batch" in the admin: opened by its id, never by its words.
  if (str(raw.batch_id)) {
    if (!UUID_RE.test(str(raw.batch_id))) throw new Error("batch_id isn't a batch id.");
    const b = await claimBatch(str(raw.batch_id));
    if (!b) throw new Error("No batch with that id.");
    const built = b.items.filter((i) => i.outcome === "built").length;
    const done = new Set(b.items.map((i) => i.office.toLowerCase()));
    return {
      ok: true, batch_id: b.id, label: b.label, kind: b.kind, wanted: b.wanted, status: b.status, chunk: b.chunks ?? 1,
      built_so_far: built, still_wanted: Math.max(0, (b.wanted ?? 0) - built), already_done: b.items,
      candidates_left: (b.candidates ?? []).filter((c) => !done.has(c.office.toLowerCase())),
      note: "Skip every office in already_done. Work down candidates_left before searching for more; save new finds with batch-candidates.",
    };
  }
  const wanted = Number(raw.wanted);
  if (Number.isFinite(wanted) && wanted > MAX_BATCH) throw new Error(`A batch is ${MAX_BATCH} at most. Run a second one for more.`);
  const got = await startBatch({ label: str(raw.label), kind: str(raw.kind) === "tonight" ? "tonight" : "now", wanted: Number.isInteger(wanted) && wanted > 0 ? wanted : null });
  if (!got) throw new Error("batch-start wants { label, kind, wanted }.");
  return { ok: true, batch_id: got.batch.id, resumed: got.resumed, already_done: got.batch.items, note: got.resumed ? "This run was started before and didn't finish. Skip every office in already_done and carry on." : "New batch. Log every office with batch-log as soon as its outcome is known." };
}

/** { office, outcome: "built" | "skipped" | "failed", preview_id?, reason? }: logged the moment it is known, so a run that dies loses nothing. */
async function batchLog(id: string, file: string) {
  if (!UUID_RE.test(id)) throw new Error("batch-log wants the batch id first.");
  const raw = readJson(file) as Json;
  const outcome = str(raw.outcome);
  if (!str(raw.office) || (outcome !== "built" && outcome !== "skipped" && outcome !== "failed")) throw new Error("batch-log wants { office, outcome: built | skipped | failed, preview_id?, reason? }.");
  if (outcome === "built" && !UUID_RE.test(str(raw.preview_id))) throw new Error("A built office needs its preview_id.");
  if (outcome !== "built" && !str(raw.reason)) throw new Error("Say why in reason, in a few plain words: the owner reads it (\"already contacted\", \"couldn't confirm who is in charge\").");
  const batch = await logBatchItem(id, { office: str(raw.office), outcome, preview_id: str(raw.preview_id) || null, reason: str(raw.reason) || null });
  if (!batch) throw new Error("No batch with that id.");
  return { ok: true, batch_id: id, logged: batch.items.length, built: batch.items.filter((i) => i.outcome === "built").length };
}

async function briefOf(id: string) {
  const { listPreviews } = await import("@/lib/prospect-preview/store");
  const batch = (await recentBatches(30)).find((b) => b.id === id);
  if (!batch) throw new Error("No batch with that id.");
  const list = await listPreviews();
  return batchBrief(batch, list.ready ? list.rows : []);
}

/** Marks the batch finished. The app then sends the owner ONE push (within a few minutes; an overnight batch waits for 8am). */
async function batchFinish(id: string) {
  if (!UUID_RE.test(id)) throw new Error("batch-finish wants the batch id.");
  if (!(await finishBatch(id))) throw new Error("No batch with that id.");
  return { ok: true, ...(await briefOf(id)), approve_link: `${APP_URL}/admin/card-builder/approve`, note: "The owner's push is sent by the app, not from here." };
}

async function batchStatus(id: string) {
  if (!UUID_RE.test(id)) throw new Error("batch-status wants the batch id.");
  return { ok: true, ...(await briefOf(id)) };
}

/**
 * { company }: who the owner already knows there (from their own LinkedIn
 * connections export), and the owner's own schools and past employers to look
 * for in the prospect's public bio.
 */
async function warm(file: string) {
  const raw = readJson(file) as Json;
  if (!str(raw.company)) throw new Error("warm wants { company }.");
  const connections = await listConnections();
  const background = await ownerBackground();
  return {
    ok: true, connections_on_file: connections.length,
    connections_at_this_office: connectionsAt(str(raw.company), connections),
    owners_schools: background.schools, owners_past_employers: background.employers,
    note: "A connection marked exact: false is at a firm of the same name and may be another office: say so. A shared school or employer only counts when a public page about the PROSPECT says it; give that page as warm_path.source_url. Never guess one.",
  };
}

/** [{ office, person?, city?, website?, lead_id?, score? }], best first: the offices found for a batch, so the next chunk carries on down the list. */
async function batchCandidates(id: string, file: string) {
  if (!UUID_RE.test(id)) throw new Error("batch-candidates wants the batch id first.");
  const list = readJson(file);
  if (!Array.isArray(list)) throw new Error("batch-candidates wants a JSON list of { office, person, city, website, lead_id, score }.");
  const clean = readCandidates(list);
  if (!(await setCandidates(id, clean))) throw new Error("No batch with that id.");
  return { ok: true, batch_id: id, saved: clean.length };
}

/**
 * { phone }: is it a mobile? The line-type lookup (lib/prospect-preview/phone-type.ts) when it is set up
 * here (about a cent); otherwise says it couldn't tell. Only a mobile can get
 * the opener over iMessage.
 */
async function phoneType(phone: string) {
  if (!str(phone)) throw new Error("phone-type wants a phone number.");
  const kind = await lookupPhoneKind(phone);
  return { ok: true, phone, e164: nanp(phone), phone_kind: kind, note: kind ? (kind === "mobile" ? "A mobile: it can get an iMessage." : "Not a mobile. Look for their own cell on their profile pages before giving up.") : "Couldn't check here (the line-type lookup isn't set up on this machine). Say what the page called it: phone_kind mobile only when the page says it is their cell or mobile." };
}

/**
 * { candidates: [{ hook, text, uses, scores: { specificity, human, curiosity } }] }
 * The opening texts for this prospect: five on five different hooks where the
 * facts allow (three at least), each scored 1–10 on the three. Saved only on a
 * draft, and only when every one passes every rule. The best total becomes the
 * default and the runner-up the alternate.
 */
async function setOpenersFor(id: string, file: string) {
  if (!UUID_RE.test(id)) throw new Error("set-openers wants the preview's id first.");
  const { getPreviewById, setOpeners } = await import("@/lib/prospect-preview/store");
  const p = await getPreviewById(id);
  if (!p) throw new Error("No preview with that id.");
  if (p.status !== "draft") throw new Error("Only a draft's openers are written here. A published one is edited on the review screen.");
  const raw = readJson(file) as Json;
  const read = readOpeners({ candidates: raw.candidates });
  const given = Array.isArray(raw.candidates) ? raw.candidates.length : 0;
  if (!read) throw new Error("No usable openers. Each needs hook, text, uses and scores { specificity, human, curiosity } of 1 to 10.");
  if (read.candidates.length !== given) throw new Error(`${given - read.candidates.length} of the openers are missing a hook (${Object.keys(OPENER_HOOK_LABELS).join(", ")}), text or a 1–10 score.`);
  const ranked = rankOpeners(read.candidates);
  const problems = checkOpeners(ranked, p, staleNumbers(p));
  if (problems.length) throw new Error(`Not saved. ${problems.join(" ")}`);
  // Step 10b: the independent judge's ranking (the opener-judge agent's JSON, as "judge") sets the default.
  const verdict = readJudgeVerdict(raw.judge, ranked.candidates.map((c) => c.text));
  if (!verdict) throw new Error("Not saved: no usable \"judge\" in the file. Run step 10b: `judge-input <id> <file.json>`, give its prompt to the opener-judge agent, and put its JSON answer ({ \"ranking\": [ { \"n\", \"reason\" } ] }, every text ranked once) in the file as \"judge\". If you changed any text since, run judge-input again.");
  const openers = applyJudge(ranked, verdict, { owner_name: p.owner_name, facts: openerFacts(p), stale: staleNumbers(p) });
  if (!(await setOpeners(id, openers))) throw new Error("That didn't save.");
  const link = `${APP_URL}/p/${p.slug}`;
  return {
    ok: true, id, default: openerMessage(openerText(openers)!, link), picked_by: openers.picked_by,
    ranked: openers.candidates.map((c, i) => ({ position: i, hook: c.hook, judge_rank: c.judge?.rank ?? null, judge_reason: c.judge?.reason ?? null, total: scoreTotal(c), ...c.scores, default: i === openers.pick, alternate: i === openers.alt, text: c.text, characters: c.text.length })).sort((a, b) => (a.judge_rank ?? 99) - (b.judge_rank ?? 99)),
  };
}

/**
 * Step 10b: exactly what the opener-judge agent is shown (the prospect's
 * verified facts and the candidate texts, numbered; no hooks, no scores).
 */
async function judgeInput(id: string, file: string) {
  if (!UUID_RE.test(id)) throw new Error("judge-input wants the preview's id first.");
  const { getPreviewById } = await import("@/lib/prospect-preview/store");
  const p = await getPreviewById(id);
  if (!p) throw new Error("No preview with that id.");
  const raw = readJson(file) as Json;
  const read = readOpeners({ candidates: raw.candidates });
  if (!read) throw new Error("No usable openers in that file.");
  return { ok: true, prompt: judgeMessage(openerFacts(p), read.candidates.map((c) => c.text)), note: "Give this prompt, word for word and nothing else, to the opener-judge agent. Put its JSON answer in the openers file as \"judge\", then run set-openers." };
}

/**
 * The owner's own corrections, as examples of their voice, and how earlier
 * openers did (sent and opened, by hook and by segment). Read before writing
 * any message. With a preview id, `opener_results.this_segment` is that
 * prospect's segment.
 */
async function style(id?: string) {
  const notes = styleNotes(await listEvents());
  const { loadOpenerResults } = await import("@/lib/prospect-preview/opener-results");
  let p: Pick<ProspectPreview, "batch_id"> | null = null;
  if (id && UUID_RE.test(id)) { const { getPreviewById } = await import("@/lib/prospect-preview/store"); p = await getPreviewById(id); }
  const opener_results = await loadOpenerResults(p);
  return { ok: true, ...notes, opener_results, note: notes.edits.length || notes.sent_as.length ? "Write like the 'after' side. These are the owner's own words." : "No edits yet: there is nothing to learn from. Follow the rules in build-card.md." };
}

async function run(args: string[]): Promise<Json> {
  const [cmd, a, b] = args;
  switch (cmd) {
    case "leads": return leads(args.slice(1));
    case "check": return check(a);
    case "fit": return fit(a);
    case "quality": return quality(a);
    case "save-leads": return saveLeads(a);
    case "create-draft": return createDraft(a);
    case "update-draft": return updateDraft(a, b);
    case "set-outreach": return setOutreachFor(a, b);
    case "queue": return queue(args.slice(1));
    case "set-openers": return setOpenersFor(a, b);
    case "judge-input": return judgeInput(a, b);
    case "phone-type": return phoneType(a);
    case "batch-candidates": return batchCandidates(a, b);
    case "queue-add": return queueAdd(a);
    case "queue-settle": return queueSettle(a, b);
    case "batch-start": return batchStart(a);
    case "batch-log": return batchLog(a, b);
    case "batch-finish": return batchFinish(a);
    case "batch-status": return batchStatus(a);
    case "warm": return warm(a);
    case "style": return style(a);
    case "shots": return shots(a, b);
    case "colors": return colors(a, b);
    default: throw new Error(`Unknown command "${cmd}". See scripts/card-builder.mjs.`);
  }
}

it("card-builder tool", async () => {
  const out = process.env.CARD_TOOL_OUT;
  if (!out) throw new Error("Run this through scripts/card-builder.mjs.");
  let result: Json;
  try {
    result = await run(JSON.parse(process.env.CARD_TOOL_ARGS ?? "[]") as string[]);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  writeFileSync(out, JSON.stringify(result, null, 2));
});
