import {
  DEFAULT_BRAND_PRIMARY, DEFAULT_BRAND_SECONDARY, DEFAULT_EXPIRY_DAYS, MAX_TEAM_MEMBERS,
  type TeamMember,
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

/** One teammate per line: "Name, Title" (the title is optional). */
export function parseTeam(v: unknown): TeamMember[] {
  if (typeof v !== "string") return [];
  const out: TeamMember[] = [];
  for (const line of v.split(/\r?\n/)) {
    const at = line.indexOf(",");
    const name = clean(at === -1 ? line : line.slice(0, at), 80);
    const title = at === -1 ? "" : clean(line.slice(at + 1), 80);
    if (name) out.push({ name, title });
    if (out.length >= MAX_TEAM_MEMBERS) break;
  }
  return out;
}

/** Rows read back from the database: never trust the jsonb's shape. */
export function readTeam(v: unknown): TeamMember[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((m) => ({ name: clean((m as TeamMember | null)?.name, 80), title: clean((m as TeamMember | null)?.title, 80) }))
    .filter((m) => m.name)
    .slice(0, MAX_TEAM_MEMBERS);
}

/** A logo address we are willing to show and to fetch: https only. */
export function cleanLogoUrl(v: unknown): string | null {
  const s = clean(v, 600);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
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

export type NewPreviewInput = {
  slug: string;
  office_name: string;
  owner_name: string;
  owner_title: string | null;
  phone: string;
  email: string | null;
  logo_url: string | null;
  brand_primary: string;
  brand_secondary: string;
  team_members: TeamMember[];
  expires_at: string;
  crew_lead_id: string | null;
};

export type ParsedPreview = { ok: true; value: NewPreviewInput } | { ok: false; error: string };

/**
 * The create form, checked. Every refusal is a sentence the person filling in
 * the form can act on.
 */
export function parsePreviewForm(get: (key: string) => unknown, now: Date = new Date()): ParsedPreview {
  const office_name = clean(get("office_name"), 120);
  const owner_name = clean(get("owner_name"), 80);
  const phone = clean(get("phone"), 40);
  if (!office_name) return { ok: false, error: "Add the office's name." };
  if (!owner_name) return { ok: false, error: "Add the owner's name." };
  if (phone.replace(/\D/g, "").length < 7) return { ok: false, error: "Add the owner's phone number. The alert tells you to call it." };

  const email = clean(get("email"), 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };

  const rawLogo = clean(get("logo_url"), 600);
  const logo_url = cleanLogoUrl(rawLogo);
  if (rawLogo && !logo_url) return { ok: false, error: "The logo needs a full https:// address of an image." };

  const wanted = clean(get("slug"), 64).toLowerCase();
  const slug = wanted ? slugify(wanted) : newSlug(office_name);
  if (!SLUG_RE.test(slug)) return { ok: false, error: "The link name needs at least 3 letters or numbers." };

  const daysRaw = clean(get("expires_days"), 4);
  const days = daysRaw === "" ? DEFAULT_EXPIRY_DAYS : Number(daysRaw);
  if (!Number.isInteger(days) || days < 1 || days > 90) return { ok: false, error: "The link can stay up for 1 to 90 days." };

  const lead = clean(get("crew_lead_id"), 40);
  if (lead && !UUID_RE.test(lead)) return { ok: false, error: "The lead ID isn't one of ours. Leave it empty if you're not sure." };

  return {
    ok: true,
    value: {
      slug,
      office_name,
      owner_name,
      owner_title: clean(get("owner_title"), 80) || null,
      phone,
      email: email || null,
      logo_url,
      brand_primary: cleanHex(get("brand_primary"), DEFAULT_BRAND_PRIMARY),
      brand_secondary: cleanHex(get("brand_secondary"), DEFAULT_BRAND_SECONDARY),
      team_members: parseTeam(get("team_members")),
      expires_at: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
      crew_lead_id: lead || null,
    },
  };
}
