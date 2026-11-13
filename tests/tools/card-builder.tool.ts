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
import { cleanHttpsUrl, expiryFrom, formatTeam, newSlug, parsePreviewFields, UUID_RE } from "@/lib/prospect-preview/input";
import { paddedLogoSrc } from "@/lib/prospect-preview/card";
import { scoreFit, type FitEvidence, type FitInput, type FitKey } from "@/lib/prospect-preview/fit";
import { callBrief } from "@/lib/prospect-preview/call";
import { checkOutreach, readOutreach, resolveOutreach } from "@/lib/prospect-preview/outreach";
import { assessQuality, isVerified } from "@/lib/prospect-preview/quality";
import { BUYER_ROLE_LABELS, BUYER_ROLES, CURRENT_TOOL_LABELS, CURRENT_TOOLS, DEFAULT_EXPIRY_DAYS, LINK_SLOT, MAX_SPECIFICS, OUTREACH_KEYS, SOCIAL_KEYS, SOURCE_FIELDS, SOURCE_LABELS, TEXT_LIMIT, type BuyerRole, type CurrentTool, type ProspectPreview } from "@/lib/prospect-preview/types";
import { getAdminSupabase } from "@/lib/supabase-admin";

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
//   - nothing is published and nothing is sent

const APP_URL = process.env.NEXT_PUBLIC_APP_URL && !/localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_APP_URL) ? process.env.NEXT_PUBLIC_APP_URL : "https://swiftcard.me";

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const digits = (v: unknown) => str(v).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const lower = (v: unknown) => str(v).toLowerCase();
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;

// ── Who has already been contacted ──────────────────────────────────────────

type Candidate = { company?: string; website?: string; source_url?: string; email?: string; phone?: string; name?: string };
type Standing = { skip: boolean; reasons: string[]; lead_id: string | null; preview_id: string | null };

async function standing(c: Candidate): Promise<Standing> {
  const db = getAdminSupabase();
  const reasons: string[] = [];
  let skip = false;
  const email = lower(c.email);
  const phone = digits(c.phone);

  if (email) {
    const { data } = await db.from("crew_suppression").select("value").in("value", [email, `@${email.split("@")[1]}`]).limit(1);
    if (data?.length) { skip = true; reasons.push("on the do-not-contact list"); }
    const { data: ids } = await db.from("crew_identities").select("person_id").eq("platform", "email").eq("handle_norm", email);
    if (ids?.length) {
      const { data: touches } = await db.from("crew_touches").select("kind, at").in("person_id", ids.map((i) => i.person_id as string)).neq("kind", "lead_listed").limit(5);
      if (touches?.length) { skip = true; reasons.push(`already contacted by the agents (${[...new Set(touches.map((t) => t.kind as string))].join(", ")})`); }
    }
  }

  const key = companyKey({ source_url: str(c.website) || str(c.source_url), company: c.company ?? null });
  let lead_id: string | null = null;
  if (key) {
    const { data } = await db.from("crew_leads").select("id, list").eq("company_key", key).limit(1);
    if (data?.length) { lead_id = data[0].id as string; reasons.push(`already a lead (${data[0].list as string} list)`); }
  }
  if (!lead_id && email) {
    const { data } = await db.from("crew_leads").select("id, list").ilike("email", email).limit(1);
    if (data?.length) { lead_id = data[0].id as string; reasons.push(`already a lead (${data[0].list as string} list)`); }
  }

  let preview_id: string | null = null;
  const { data: previews } = await db.from("prospect_previews").select("id, office_name, email, phone, crew_lead_id, asked_at, sent_at, called, call_outcome").limit(2000);
  for (const p of previews ?? []) {
    const same = (lead_id && p.crew_lead_id === lead_id) || (email && lower(p.email) === email) || (phone && digits(p.phone) === phone) || (c.company && lower(p.office_name) === lower(c.company));
    if (!same) continue;
    preview_id = p.id as string;
    const reached = p.asked_at || p.sent_at || p.called || p.call_outcome;
    reasons.push(reached ? "already has a preview and has been contacted" : "already has a preview");
    skip = true;
    break;
  }
  return { skip, reasons, lead_id, preview_id };
}

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
 * { office_name, owner_name, owner_title?, buyer_role, buyer_reason?, phone,
 *   email?, logo_url?, headshot_url?, address?, website?, specialty?, detail?,
 *   team_size?, brand_primary?, brand_secondary?, crew_lead_id?,
 *   license?, type_feel?: "sans" | "serif", current_tool?,
 *   specifics?: [{ kind, text, source_url, dated: "YYYY-MM-DD", uncertain? }]   (up to 6;
 *     kind: listing | sale | open_house | recruiting | cell_numbers | years | award | other),
 *   hook_specific?: <position in specifics, from 0>, hook_angle?: views | departures | open_house,
 *   hook_why?,
 *   team_members?: [{ name, title?, headshot? }],
 *   social_links?: { linkedin?, instagram?, facebook?, x?, youtube?, tiktok?, zillow? },
 *   sources?: { <fact>: { url, uncertain?, note?, owner? } } }
 * `"owner": true` on a source or a specific means the OWNER OF SWIFTCARD
 * supplied that fact themselves (pasted notes): it is confirmed by them and
 * needs no page. Its `note` must quote what they wrote. Never set it on
 * something that was researched.
 * Facts: owner_name, owner_title, phone, email, logo_url, headshot_url, colors,
 * address, website, social_links, specialty, team_members, buyer_role,
 * buyer_second (the SECOND site that confirms the name and role), team_size,
 * detail (the hook's fact), license, current_tool.
 * Leave out anything that wasn't confirmed.
 */
function fieldsFrom(raw: Json) {
  const flat: Json = { ...raw };
  if (Array.isArray(raw.team_members)) {
    flat.team_members = formatTeam((raw.team_members as Json[]).map((m) => ({ name: str(m.name), title: str(m.title), ...(str(m.headshot) ? { headshot: str(m.headshot) } : {}) })));
  }
  const social = (raw.social_links ?? {}) as Json;
  for (const k of SOCIAL_KEYS) flat[`social_${k}`] = social[k];
  const sources = (raw.sources ?? {}) as Record<string, Json>;
  const unknown = Object.keys(sources).filter((k) => !(SOURCE_FIELDS as readonly string[]).includes(k));
  if (unknown.length) throw new Error(`sources has facts this doesn't know: ${unknown.join(", ")}. Use: ${SOURCE_FIELDS.join(", ")}.`);
  for (const k of SOURCE_FIELDS) {
    flat[`src_${k}`] = sources[k]?.url;
    flat[`unc_${k}`] = sources[k]?.uncertain === true;
    flat[`note_${k}`] = sources[k]?.note;
    flat[`own_${k}`] = sources[k]?.owner === true;
    if (sources[k]?.owner === true && !str(sources[k]?.note)) throw new Error(`sources.${k} is marked confirmed by the owner but has no note. Put the owner's own words in "note", or give the page it came from instead.`);
  }
  if (typeof raw.team_size === "number") flat.team_size = String(raw.team_size);
  if (raw.specifics !== undefined && !Array.isArray(raw.specifics)) throw new Error("specifics is a list.");
  const specifics = (raw.specifics ?? []) as Json[];
  if (specifics.length > MAX_SPECIFICS) throw new Error(`At most ${MAX_SPECIFICS} specifics. Keep the strongest.`);
  specifics.forEach((sp, i) => {
    flat[`spec_kind_${i}`] = sp.kind; flat[`spec_text_${i}`] = sp.text; flat[`spec_src_${i}`] = sp.source_url;
    flat[`spec_date_${i}`] = sp.dated; flat[`spec_unc_${i}`] = sp.uncertain === true; flat[`spec_own_${i}`] = sp.owner === true;
  });
  if (typeof raw.hook_specific === "number") flat.hook_specific = String(raw.hook_specific);
  // The override of the quality gate is the owner's, on the edit screen. Never from here.
  if ("quality_override" in raw) throw new Error("quality_override can't be set from the command line: only the owner overrides the quality gate, on the edit screen.");
  const parsed = parsePreviewFields((k) => flat[k]);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

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
    ok: true, status: p.status, score: q.score, too_generic: q.tooGeneric, overridden_by_owner: p.quality_override,
    checks: q.checks.map((c) => ({ check: c.label, done: c.ok, needed_to_publish: c.required, points: `${c.earned}/${c.points}`, ...(c.fix ? { fix: c.fix } : {}) })),
    specifics: p.specifics.map((sp, i) => ({ position: i, text: sp.text, verified: isVerified(sp), confirmed_by_owner: sp.owner === true })),
    could_not_confirm: [
      ...SOURCE_FIELDS.filter((k) => p.sources[k]?.uncertain).map((k) => `${SOURCE_LABELS[k]}: marked uncertain${p.sources[k]?.note ? ` (${p.sources[k]!.note})` : ""}`),
      ...p.specifics.filter((sp) => !isVerified(sp)).map((sp) => `Specific not verified: ${sp.text}`),
      ...q.checks.filter((c) => !c.ok).map((c) => `Missing: ${c.label}`),
    ],
    messages: {
      written_for_this_prospect: m.written,
      opens_with_the_hook: m.specific,
      problems: checkOutreach(p.outreach ?? null, { link, specifics: p.specifics, complete: true }),
      first_text: m.ask, text_with_link: m.text, email_subject: m.email.subject, email: m.email.body,
      call_opener: callBrief(p, { sender: null }).opener, voicemail: m.voicemail,
      nudge_no_view_after_2_days: m.nudge_no_view, nudge_viewed_no_pickup: m.nudge_viewed,
    },
  };
}

/**
 * { first_text, link_text, email_subject, email_body, call_opener, voicemail,
 *   nudge_no_view, nudge_viewed,
 *   uses: { first_text: <position in specifics>, link_text: …, email_body: …,
 *           call_opener: …, voicemail: …, nudge_no_view: …, nudge_viewed: … } }
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
  const problems = checkOutreach(outreach, { link, specifics: p.specifics, complete: true });
  if (problems.length) throw new Error(`Not saved. ${problems.join(" ")} (A text is ${TEXT_LIMIT} characters at most once ${LINK_SLOT} becomes ${link}, which is ${link.length} characters.)`);
  // Only a draft: a published preview's words are changed by a person, on the edit screen.
  const { data, error } = await getAdminSupabase().from("prospect_previews")
    .update({ outreach, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft").select("id, slug, status");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("No DRAFT with that id. A published preview's messages are only changed on its edit screen.");
  return { ok: true, status: data[0].status, saved: OUTREACH_KEYS.length, ...links(data[0] as { id: string; slug: string }) };
}

const links = (p: { id: string; slug: string }) => ({
  id: p.id,
  draft_link: `${APP_URL}/admin/card-builder/preview/${p.id}`,
  edit_link: `${APP_URL}/admin/card-builder/edit/${p.id}`,
  approve_link: `${APP_URL}/admin/card-builder/approve#p-${p.id}`,
  public_link_once_published: `${APP_URL}/p/${p.slug}`,
});

async function createDraft(file: string) {
  const raw = readJson(file) as Json;
  const fields = fieldsFrom(raw);
  const lead = str(raw.crew_lead_id);
  if (lead && !UUID_RE.test(lead)) throw new Error("crew_lead_id isn't a lead id.");
  const s = await standing({ company: fields.office_name, website: fields.website ?? undefined, email: fields.email ?? undefined, phone: fields.phone });
  if (s.preview_id) throw new Error(`This office already has a preview (${s.preview_id}): ${s.reasons.join("; ")}. Use update-draft, or pick another office.`);
  if (s.reasons.some((r) => /do-not-contact|already contacted/.test(r))) throw new Error(`Not building this one: ${s.reasons.join("; ")}.`);
  const { data, error } = await getAdminSupabase().from("prospect_previews")
    .insert({ ...fields, slug: newSlug(fields.office_name), status: "draft", expires_at: expiryFrom(DEFAULT_EXPIRY_DAYS), crew_lead_id: lead || s.lead_id })
    .select("id, slug, status").single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  return { ok: true, status: data.status, ...links(data as { id: string; slug: string }) };
}

async function updateDraft(id: string, file: string) {
  if (!UUID_RE.test(id)) throw new Error("update-draft wants the preview's id first.");
  const fields = fieldsFrom(readJson(file) as Json);
  // Only a draft: a published preview is in front of a prospect and is changed by a person, on the edit screen.
  const { data, error } = await getAdminSupabase().from("prospect_previews")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft").select("id, slug, status");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("No DRAFT with that id. A published preview is only changed on its edit screen.");
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
  const logo = logoSrc ? await logoResponse(preview.logo_url) : null;
  const logoPng = logo?.ok ? Buffer.from(await logo.arrayBuffer()) : null;
  const markup = renderToStaticMarkup(createElement(PreviewView, { preview, calendarUrl: "/demo", logoSrc: logoPng ? logoSrc : null }));
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
