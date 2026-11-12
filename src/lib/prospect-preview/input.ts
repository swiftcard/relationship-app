import {
  BUYER_ROLES, DEFAULT_BRAND_PRIMARY, DEFAULT_BRAND_SECONDARY, DEFAULT_EXPIRY_DAYS, MAX_TEAM_MEMBERS, SOCIAL_KEYS, SOURCE_FIELDS,
  type BuyerRole, type FactSources, type PreviewStatus, type SocialLinks, type TeamMember,
} from "./types";

// ── Card Builder: reading the create form ───────────────────────────────────
// Bounded strings and allow-lists by hand, like every other form here (the
// codebase has no schema library). Pure: no database, so it is unit-tested.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

export const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** "Harbor Realty Group" → "harbor-realty-group". Empty when nothing survives. */
export function slugify(v: string): string {
  return v
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * The address of a new preview: the office's name plus a short random tail.
 * The tail is what keeps an unlisted page unlisted. "harbor-realty" can be
 * guessed by anyone who knows the prospect; "harbor-realty-k3x9qa" cannot.
 */
export function newSlug(officeName: string, tail: string = randomTail()): string {
  const base = slugify(officeName) || "preview";
  return `${base}-${tail}`;
}

export function randomTail(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (0/o, 1/l/i)
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => alphabet[b % alphabet.length]).join("");
}

/** An address we are willing to show and to fetch: https only. */
export function cleanHttpsUrl(v: unknown): string | null {
  const s = clean(v, 600);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
export const cleanLogoUrl = cleanHttpsUrl;

/**
 * One teammate per line: "Name, Title, https://their-picture". The title and
 * the picture are optional; a last part that is an https address is the picture.
 */
export function parseTeam(v: unknown): TeamMember[] {
  if (typeof v !== "string") return [];
  const out: TeamMember[] = [];
  for (const line of v.split(/\r?\n/)) {
    const parts = line.split(",");
    let headshot: string | null = null;
    if (parts.length > 1 && /^\s*https:\/\//i.test(parts[parts.length - 1])) headshot = cleanHttpsUrl(parts.pop());
    const name = clean(parts[0], 80);
    const title = clean(parts.slice(1).join(","), 80);
    if (name) out.push({ name, title, ...(headshot ? { headshot } : {}) });
    if (out.length >= MAX_TEAM_MEMBERS) break;
  }
  return out;
}

/** The team as the edit form's textarea shows it (parseTeam reads it back). */
export function formatTeam(team: TeamMember[]): string {
  return team.map((m) => [m.name, m.title, m.headshot].filter((x, i) => i === 0 || x || (i === 1 && m.headshot)).join(", ")).join("\n");
}

/** Rows read back from the database: never trust the jsonb's shape. */
export function readTeam(v: unknown): TeamMember[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((m) => {
      const headshot = cleanHttpsUrl((m as TeamMember | null)?.headshot);
      return { name: clean((m as TeamMember | null)?.name, 80), title: clean((m as TeamMember | null)?.title, 80), ...(headshot ? { headshot } : {}) };
    })
    .filter((m) => m.name)
    .slice(0, MAX_TEAM_MEMBERS);
}

export function readSocials(v: unknown): SocialLinks {
  const out: SocialLinks = {};
  if (!v || typeof v !== "object") return out;
  for (const k of SOCIAL_KEYS) {
    const url = cleanHttpsUrl((v as Record<string, unknown>)[k]);
    if (url) out[k] = url;
  }
  return out;
}

export function readSources(v: unknown): FactSources {
  const out: FactSources = {};
  if (!v || typeof v !== "object") return out;
  for (const k of SOURCE_FIELDS) {
    const s = (v as Record<string, unknown>)[k] as { url?: unknown; uncertain?: unknown; note?: unknown } | null | undefined;
    if (!s || typeof s !== "object") continue;
    const url = cleanSourceUrl(s.url) ?? "";
    const note = clean(s.note, 200);
    const uncertain = s.uncertain === true;
    if (url || note || uncertain) out[k] = { url, uncertain, note };
  }
  return out;
}

/** Where a fact was found: any http(s) page. */
export function cleanSourceUrl(v: unknown): string | null {
  const s = clean(v, 600);
  if (!s) return null;
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A headshot may only come from the person's own business website or their
 * brokerage profile (owner's rule, 2026-11-11). A picture lifted from a social
 * network or a search result is someone's personal photo, not their business
 * one. The rule is checked on the SOURCE page the researcher names.
 */
const NOT_A_HEADSHOT_SOURCE = /(^|\.)(linkedin\.com|facebook\.com|fb\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com|pinterest\.com|google\.[a-z.]+|bing\.com|gstatic\.com|googleusercontent\.com)$/i;
export function headshotSourceAllowed(sourceUrl: string | null | undefined): boolean {
  if (!sourceUrl) return false;
  try {
    return !NOT_A_HEADSHOT_SOURCE.test(new URL(sourceUrl).hostname);
  } catch {
    return false;
  }
}

export const cleanHex = (v: unknown, fallback: string): string => {
  const s = clean(v, 7);
  return HEX_RE.test(s) ? s.toUpperCase() : fallback;
};

/** The digits a dialer needs: "(212) 555-0199 x4" → "+12125550199"-style. */
export function telHref(phone: string): string {
  const plus = phone.trim().startsWith("+") ? "+" : "";
  const digits = phone.split(/(?:ext\.?|x)\s*\d+$/i)[0].replace(/\D/g, "");
  return `tel:${plus}${digits}`;
}

/** Everything staff type about a prospect: the create form and the edit screen share it. */
export type PreviewFields = {
  office_name: string;
  owner_name: string;
  owner_title: string | null;
  phone: string;
  email: string | null;
  logo_url: string | null;
  headshot_url: string | null;
  address: string | null;
  website: string | null;
  social_links: SocialLinks;
  specialty: string | null;
  brand_primary: string;
  brand_secondary: string;
  team_members: TeamMember[];
  sources: FactSources;
  buyer_role: BuyerRole;
  buyer_reason: string | null;
  team_size: number | null;
  detail: string | null;
};

export type NewPreviewInput = PreviewFields & {
  slug: string;
  status: PreviewStatus;
  expires_at: string;
  crew_lead_id: string | null;
};

type Refusal = { ok: false; error: string };
export type ParsedFields = { ok: true; value: PreviewFields } | Refusal;
export type ParsedPreview = { ok: true; value: NewPreviewInput } | Refusal;

/** The sources table of the edit screen: src_<fact>, unc_<fact>, note_<fact>. */
export function parseSources(get: (key: string) => unknown): FactSources {
  const raw: Record<string, unknown> = {};
  for (const k of SOURCE_FIELDS) {
    const unc = get(`unc_${k}`);
    raw[k] = { url: get(`src_${k}`), uncertain: unc === "on" || unc === true || unc === "true", note: get(`note_${k}`) };
  }
  return readSources(raw);
}

/**
 * The fields of a preview, checked. Every refusal is a sentence the person
 * filling in the form can act on.
 */
export function parsePreviewFields(get: (key: string) => unknown): ParsedFields {
  const office_name = clean(get("office_name"), 120);
  const owner_name = clean(get("owner_name"), 80);
  const phone = clean(get("phone"), 40);
  if (!office_name) return { ok: false, error: "Add the office's name." };
  if (!owner_name) return { ok: false, error: "Add the owner's name." };
  if (phone.replace(/\D/g, "").length < 7) return { ok: false, error: "Add the owner's phone number. The alert tells you to call it." };

  // A preview is only for someone who can buy an Office plan.
  const buyer_role = clean(get("buyer_role"), 40) as BuyerRole;
  if (!(BUYER_ROLES as readonly string[]).includes(buyer_role)) {
    return { ok: false, error: "Pick their role. A preview is only built for the person in charge of the team or office: a broker-owner, managing broker, team lead or branch manager." };
  }
  const sizeRaw = clean(get("team_size"), 6);
  const team_size = sizeRaw === "" ? null : Number(sizeRaw);
  if (team_size !== null && (!Number.isInteger(team_size) || team_size < 1 || team_size > 10000)) return { ok: false, error: "Team size is a whole number of people. Leave it empty if you don't know." };

  const email = clean(get("email"), 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };

  const https = (key: string, what: string): string | null | Refusal => {
    const raw = clean(get(key), 600);
    const url = cleanHttpsUrl(raw);
    return raw && !url ? { ok: false, error: `${what} needs a full https:// address.` } : url;
  };
  const logo_url = https("logo_url", "The logo");
  if (logo_url && typeof logo_url === "object") return logo_url;
  const headshot_url = https("headshot_url", "The headshot");
  if (headshot_url && typeof headshot_url === "object") return headshot_url;
  const website = https("website", "The website");
  if (website && typeof website === "object") return website;

  const social_links: SocialLinks = {};
  for (const k of SOCIAL_KEYS) {
    const url = https(`social_${k}`, "Each social link");
    if (url && typeof url === "object") return url;
    if (url) social_links[k] = url;
  }

  const sources = parseSources(get);
  if (headshot_url && !headshotSourceAllowed(sources.headshot_url?.url)) {
    return { ok: false, error: "A headshot needs its source: the page on their own business website or brokerage profile it came from. Pictures from social networks or image search aren't used." };
  }
  const team_members = parseTeam(get("team_members"));
  if (team_members.some((m) => m.headshot) && !headshotSourceAllowed(sources.team_members?.url)) {
    return { ok: false, error: "Team headshots need the team's source: the page on their own website or brokerage profile they came from." };
  }

  return {
    ok: true,
    value: {
      office_name,
      owner_name,
      owner_title: clean(get("owner_title"), 80) || null,
      phone,
      email: email || null,
      logo_url: logo_url as string | null,
      headshot_url: headshot_url as string | null,
      address: clean(get("address"), 200) || null,
      website: website as string | null,
      social_links,
      specialty: clean(get("specialty"), 140) || null,
      brand_primary: cleanHex(get("brand_primary"), DEFAULT_BRAND_PRIMARY),
      brand_secondary: cleanHex(get("brand_secondary"), DEFAULT_BRAND_SECONDARY),
      team_members,
      sources,
      buyer_role,
      buyer_reason: clean(get("buyer_reason"), 240) || null,
      team_size,
      detail: clean(get("detail"), 200) || null,
    },
  };
}

/** 1 to 90 days from now, or a refusal. Empty means the default. */
export function parseExpiryDays(v: unknown): number | Refusal {
  const raw = clean(v, 4);
  const days = raw === "" ? DEFAULT_EXPIRY_DAYS : Number(raw);
  return !Number.isInteger(days) || days < 1 || days > 90 ? { ok: false, error: "The link can stay up for 1 to 90 days." } : days;
}

export const expiryFrom = (days: number, now: Date = new Date()): string => new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

/**
 * The create form, checked. A new preview is always a DRAFT: nobody outside
 * staff can open it until it is published from its edit screen.
 */
export function parsePreviewForm(get: (key: string) => unknown, now: Date = new Date()): ParsedPreview {
  const fields = parsePreviewFields(get);
  if (!fields.ok) return fields;

  const wanted = clean(get("slug"), 64).toLowerCase();
  const slug = wanted ? slugify(wanted) : newSlug(fields.value.office_name);
  if (!SLUG_RE.test(slug)) return { ok: false, error: "The link name needs at least 3 letters or numbers." };

  const days = parseExpiryDays(get("expires_days"));
  if (typeof days === "object") return days;

  const lead = clean(get("crew_lead_id"), 40);
  if (lead && !UUID_RE.test(lead)) return { ok: false, error: "The lead ID isn't one of ours. Leave it empty if you're not sure." };

  return { ok: true, value: { ...fields.value, slug, status: "draft", expires_at: expiryFrom(days, now), crew_lead_id: lead || null } };
}
