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
import { BUYER_ROLE_LABELS, BUYER_ROLES, DEFAULT_EXPIRY_DAYS, SOCIAL_KEYS, SOURCE_FIELDS, type BuyerRole, type ProspectPreview } from "@/lib/prospect-preview/types";
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

/**
 * [{ name, buyer_role, buyer_source, title?, company, website, email?, phone?,
 *    phone_kind?: "mobile" | "direct" | "office line", business_type?, city?,
 *    region?, team_size?, fit: 0-100, why, hook? }]
 */
async function saveLeads(file: string) {
  const list = readJson(file) as Json[];
  if (!Array.isArray(list)) throw new Error("save-leads wants a JSON array.");
  const refused: { company: string; why: string }[] = [];
  const rows: Lead[] = [];
  for (const l of list) {
    const company = str(l.company);
    const refuse = (why: string) => refused.push({ company: company || "(no company)", why });
    if (!company || !str(l.name)) { refuse("needs the company and the decision-maker's name"); continue; }
    if (!(BUYER_ROLES as readonly string[]).includes(str(l.buyer_role))) { refuse("buyer_role must be broker_owner, managing_broker, team_lead or branch_manager: nobody else can buy an Office plan"); continue; }
    const source = cleanHttpsUrl(l.buyer_source) ?? "";
    if (!source) { refuse("buyer_source: the https page that names this person and their role"); continue; }
    const website = cleanHttpsUrl(l.website) ?? source;
    if (!str(l.email) && !str(l.phone)) { refuse("needs a phone number or an email"); continue; }
    const s = await standing({ company, website, email: str(l.email), phone: str(l.phone) });
    if (s.skip || s.lead_id) { refuse(s.reasons.join("; ")); continue; }
    const fit = Math.max(0, Math.min(100, Math.round(Number(l.fit) || 0)));
    const size = Number(l.team_size);
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
      score: fit,
      why: str(l.why).slice(0, 400) || null,
      hook: str(l.hook).slice(0, 300) || null,
      notes: [
        `Decision-maker: ${BUYER_ROLE_LABELS[str(l.buyer_role) as BuyerRole]} (${source}).`,
        str(l.phone) ? `Phone is their ${str(l.phone_kind) || "office line"}.` : "",
        Number.isInteger(size) && size > 0 ? `About ${size} people.` : "",
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
  return { ok: true, added, stats, refused, saved: data ?? [] };
}

// ── drafts ──────────────────────────────────────────────────────────────────

/**
 * { office_name, owner_name, owner_title?, buyer_role, buyer_reason?, phone,
 *   email?, logo_url?, headshot_url?, address?, website?, specialty?, detail?,
 *   team_size?, brand_primary?, brand_secondary?, crew_lead_id?,
 *   team_members?: [{ name, title?, headshot? }],
 *   social_links?: { linkedin?, instagram?, facebook?, x?, youtube?, tiktok?, zillow? },
 *   sources?: { <fact>: { url, uncertain?, note? } } }
 * Facts: owner_name, owner_title, phone, email, logo_url, headshot_url, colors,
 * address, website, social_links, specialty, team_members, buyer_role, team_size, detail.
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
  }
  if (typeof raw.team_size === "number") flat.team_size = String(raw.team_size);
  const parsed = parsePreviewFields((k) => flat[k]);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const links = (p: { id: string; slug: string }) => ({
  id: p.id,
  draft_link: `${APP_URL}/admin/card-builder/preview/${p.id}`,
  edit_link: `${APP_URL}/admin/card-builder/edit/${p.id}`,
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
  const markup = renderToStaticMarkup(createElement(PreviewView, { preview, calendarUrl: "/demo" }));
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
    case "save-leads": return saveLeads(a);
    case "create-draft": return createDraft(a);
    case "update-draft": return updateDraft(a, b);
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
