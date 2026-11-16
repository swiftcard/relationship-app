import { companyKey } from "@/lib/crew/leads/quality";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { expiryFrom, formatTeam, newSlug, parsePreviewFields, UUID_RE } from "./input";
import { suppressionKey } from "./outbox";
import { lookupPhoneKind, nanp } from "./phone-type";
import { DEFAULT_EXPIRY_DAYS, MAX_SPECIFICS, PHONE_KINDS, SOCIAL_KEYS, SOURCE_FIELDS, type PhoneKind } from "./types";
import { readWarmPath } from "./warm";

// ── Card Builder: making a draft ─────────────────────────────────────────────
// Moved here, unchanged, from tests/tools/card-builder.tool.ts (2026-11-16) so
// the server's job worker (lib/card-builder-jobs) builds a draft with exactly
// the checks the command-line tool applies: who is already contacted, the
// form's own validation, a DRAFT only, never someone on the do-not-contact
// list or already a SwiftCard user. The tool imports these back.

export type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const digits = (v: unknown) => str(v).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const lower = (v: unknown) => str(v).toLowerCase();
const APP_URL = process.env.NEXT_PUBLIC_APP_URL && !/localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_APP_URL) ? process.env.NEXT_PUBLIC_APP_URL : "https://swiftcard.me";

// ── Who has already been contacted ──────────────────────────────────────────

export type Candidate = { company?: string; website?: string; source_url?: string; email?: string; phone?: string; name?: string };
export type Standing = { skip: boolean; reasons: string[]; lead_id: string | null; preview_id: string | null };

export async function standing(c: Candidate): Promise<Standing> {
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

  // Already one of ours: a SwiftCard account or card with this email or number (owner, 2026-11-16: "skip anyone already a user").
  if (email) {
    const [{ data: prof }, { data: card }] = await Promise.all([
      db.from("profiles").select("id").ilike("email", email).limit(1),
      db.from("cards").select("id").ilike("email", email).limit(1),
    ]);
    if (prof?.length || card?.length) { skip = true; reasons.push("already a SwiftCard user"); }
  }
  if (phone.length === 10) {
    const tail = `%${phone.slice(-4)}`;
    const [{ data: prof }, { data: card }] = await Promise.all([
      db.from("profiles").select("phone").ilike("phone", tail).limit(200),
      db.from("cards").select("phone").ilike("phone", tail).limit(200),
    ]);
    if ([...(prof ?? []), ...(card ?? [])].some((r) => digits(r.phone) === phone) && !reasons.includes("already a SwiftCard user")) { skip = true; reasons.push("already a SwiftCard user"); }
    const e164 = nanp(phone);
    if (e164) {
      const { data } = await db.from("crew_suppression").select("value").eq("value", suppressionKey(e164)).limit(1);
      if (data?.length && !reasons.includes("on the do-not-contact list")) { skip = true; reasons.push("on the do-not-contact list"); }
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
 * Also: linkedin_url (their OWN public profile, https://www.linkedin.com/in/…,
 * with its page under sources.linkedin_url), `"quiet": true` on a specific
 * that is true but must never be quoted back to them (a former name, an old
 * address, a follower count), warm_path { kind: connection | school |
 * employer, name, text, source_url? }, and batch_id (from batch-start).
 * Leave out anything that wasn't confirmed.
 */
export function extrasFrom(raw: Json): Json {
  const out: Json = {};
  if ("warm_path" in raw) {
    const warm = raw.warm_path === null ? null : readWarmPath(raw.warm_path);
    if (raw.warm_path !== null && !warm) throw new Error("warm_path needs kind (connection, school or employer), name and text.");
    if (warm && warm.kind !== "connection" && !warm.source_url) throw new Error("A shared school or employer needs source_url: the public page that says so about them.");
    out.warm_path = warm;
  }
  if ("phone_kind" in raw) {
    if (raw.phone_kind !== null && !(PHONE_KINDS as readonly unknown[]).includes(raw.phone_kind)) throw new Error(`phone_kind is one of ${PHONE_KINDS.join(", ")}.`);
    out.phone_kind = raw.phone_kind as PhoneKind | null;
  }
  if (str(raw.batch_id)) {
    if (!UUID_RE.test(str(raw.batch_id))) throw new Error("batch_id isn't a batch id.");
    out.batch_id = str(raw.batch_id);
  }
  return out;
}

export function fieldsFrom(raw: Json) {
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
    flat[`spec_quiet_${i}`] = sp.quiet === true;
  });
  if (typeof raw.hook_specific === "number") flat.hook_specific = String(raw.hook_specific);
  // The override of the quality gate is the owner's, on the edit screen. Never from here.
  if ("quality_override" in raw) throw new Error("quality_override can't be set from the command line: only the owner overrides the quality gate, on the edit screen.");
  const parsed = parsePreviewFields((k) => flat[k]);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}


export const links = (p: { id: string; slug: string }) => ({
  id: p.id,
  draft_link: `${APP_URL}/admin/card-builder/preview/${p.id}`,
  edit_link: `${APP_URL}/admin/card-builder/edit/${p.id}`,
  approve_link: `${APP_URL}/admin/card-builder/approve#p-${p.id}`,
  public_link_once_published: `${APP_URL}/p/${p.slug}`,
});


/** Make a DRAFT preview from the create-draft JSON (tests/tools/card-builder.tool.ts documents the shape). Refuses with a reason the caller can act on. */
export async function createDraftFrom(raw: Json) {
  const fields = fieldsFrom(raw);
  const extras = extrasFrom(raw);
  const lead = str(raw.crew_lead_id);
  if (lead && !UUID_RE.test(lead)) throw new Error("crew_lead_id isn't a lead id.");
  const s = await standing({ company: fields.office_name, website: fields.website ?? undefined, email: fields.email ?? undefined, phone: fields.phone });
  if (s.preview_id) throw new Error(`This office already has a preview (${s.preview_id}): ${s.reasons.join("; ")}. Use update-draft, or pick another office.`);
  if (s.reasons.some((r) => /do-not-contact|already contacted|already a SwiftCard user/.test(r))) throw new Error(`Not building this one: ${s.reasons.join("; ")}.`);
  // Is it a mobile? Asked of the line-type lookup when it is set up here; what the research said otherwise.
  const looked = fields.phone ? await lookupPhoneKind(fields.phone) : null;
  if (looked) extras.phone_kind = looked;
  const { data, error } = await getAdminSupabase().from("prospect_previews")
    .insert({ ...fields, ...extras, slug: newSlug(fields.office_name), status: "draft", expires_at: expiryFrom(DEFAULT_EXPIRY_DAYS), crew_lead_id: lead || s.lead_id })
    .select("id, slug, status").single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  return { ok: true, status: data.status, phone_kind: extras.phone_kind ?? null, ...(extras.phone_kind && extras.phone_kind !== "mobile" ? { flag: "No mobile number: this prospect can't get an iMessage. Look for their own cell on their profile pages; if there is none, the draft stays, flagged." } : {}), ...links(data as { id: string; slug: string }) };
}
