// ── Guest-draft → real-card claim logic (pure, server-safe) ──────────────────
// This module is imported by BOTH the claim route handler and the unit tests, so
// it must stay free of React / next / browser globals. It mirrors the field
// allow-list, username sanitation, and plan gating of src/app/api/cards/route.ts
// so a claimed guest draft behaves EXACTLY like a card created while logged in.
//
// The single most important property proven here: the inserted row's `user_id`
// is ALWAYS the session user id passed in by the route — never anything the
// (untrusted) draft payload supplied. See buildClaimInsert + its tests.
import { sanitizeCustomizationForPlan, convertCustomizationToFreeClosest } from "@/lib/plan";
import { normalizeSocial } from "@/lib/social-url";

// Keys we accept off a draft payload. Anything else (user_id, id, created_at,
// plan, …) is ignored — the allow-list IS the ownership guard.
const ALLOWED_STRING_FIELDS = [
  "name",
  "title",
  "company",
  "phone",
  "email",
  "website",
  "linkedin",
  "instagram",
  "twitter",
  "tiktok",
] as const;

export type DraftPayload = {
  username?: unknown;
  label?: unknown;
  template?: unknown;
  logo_url?: unknown;
  customization?: unknown;
} & Record<string, unknown>;

export type ClaimInsert = {
  user_id: string;
  username: string;
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  linkedin: string;
  instagram: string;
  twitter: string;
  tiktok: string;
  template: string;
  customization: Record<string, unknown>;
  logo_url: string | null;
  label: string | null;
  is_office_card?: boolean;
};

export type BuildResult =
  | { ok: true; insert: ClaimInsert; designConverted: boolean }
  | { ok: false; error: string; status: number };

// Same charset rule as api/cards: usernames flow into Supabase `.or()` filter
// strings elsewhere, so lock the slug to [a-z0-9-] at the source. Returns the
// normalized slug, or null if it can't be made valid.
export function sanitizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.toLowerCase().trim();
  if (!/^[a-z0-9-]{1,60}$/.test(normalized)) return null;
  return normalized;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Build the row to insert for a claim. `sessionUserId` comes from the verified
// session — NEVER from the payload. `paid` gates Pro-only design + the custom
// template exactly like the create route.
export function buildClaimInsert(
  sessionUserId: string,
  payload: DraftPayload | null | undefined,
  paid: boolean,
): BuildResult {
  const p = (payload ?? {}) as DraftPayload;

  const username = sanitizeUsername(p.username);
  if (!p.username) return { ok: false, error: "Username required.", status: 400 };
  if (!username) {
    return { ok: false, error: "Username can only contain letters, numbers, and hyphens.", status: 400 };
  }

  // Custom designer is Pro-only — Free can't claim a "custom" template.
  const rawTemplate = str(p.template) || "classic-pro";
  const template = !paid && rawTemplate === "custom" ? "classic-pro" : rawTemplate;

  // Snap Pro-only design keys to the nearest Free-safe preset / cap links for
  // Free — backend-enforced, not UI-hidden. `paid` here already accounts for a
  // guest's picked-but-not-yet-paid-for Pro/Office intent (see claim route).
  // Never the client's word on server bookkeeping ("_"-prefixed keys such as
  // _prevSlugs, which decide where an old address redirects) — same rule as
  // the card create and edit routes. The claim route stamps its own
  // _claimDraftId after this.
  const rawCustomization = { ...((p.customization ?? {}) as Record<string, unknown>) };
  for (const k of Object.keys(rawCustomization)) if (k.startsWith("_")) delete rawCustomization[k];
  // "Converted" means the card will look different from the one they built —
  // decided by the converter itself, not by whether a design key exists. A
  // guest who tapped a Free Look used to land on /welcome being told their
  // design was replaced when it wasn't.
  const designConverted = !paid && convertCustomizationToFreeClosest(rawCustomization, rawTemplate).changed;
  const customization = sanitizeCustomizationForPlan(rawCustomization, paid, rawTemplate);

  const insert: ClaimInsert = {
    user_id: sessionUserId,
    username,
    name: "",
    title: "",
    company: "",
    phone: "",
    email: "",
    website: "",
    linkedin: "",
    instagram: "",
    twitter: "",
    tiktok: "",
    template,
    customization,
    logo_url: typeof p.logo_url === "string" && p.logo_url ? p.logo_url : null,
    label: typeof p.label === "string" && p.label ? p.label : null,
  };

  for (const field of ALLOWED_STRING_FIELDS) {
    insert[field] = str(p[field]);
  }

  // Socials normalize on claim like /api/cards does on create — a guest-typed
  // value (full URL, handle, or spaced name) must store linkable.
  for (const field of ["linkedin", "instagram", "twitter", "tiktok"] as const) {
    insert[field] = normalizeSocial(insert[field], field);
  }

  return { ok: true, insert, designConverted };
}

// ── Idempotency ──────────────────────────────────────────────────────────────
// Claims stamp the originating draft id into customization._claimDraftId. A
// repeat claim (double OAuth callback, refresh, second tab) finds the already
// created row instead of inserting a duplicate.
export const CLAIM_DRAFT_ID_KEY = "_claimDraftId";

type CardRowLike = {
  id?: string | null;
  username?: string | null;
  customization?: Record<string, unknown> | null;
};

export function findClaimedCard<T extends CardRowLike>(
  cards: T[] | null | undefined,
  draftId: string | null | undefined,
): T | null {
  if (!draftId || !cards) return null;
  return (
    cards.find(
      (c) => (c.customization as Record<string, unknown> | null)?.[CLAIM_DRAFT_ID_KEY] === draftId,
    ) ?? null
  );
}

// Find a card the SESSION user already owns with this username — used to resolve
// a unique-violation (23505) into "you already have this" rather than an error,
// so a duplicate submit is idempotent instead of a hard failure.
export function findOwnCardByUsername<T extends CardRowLike>(
  cards: T[] | null | undefined,
  username: string,
): T | null {
  if (!cards) return null;
  return cards.find((c) => c.username === username) ?? null;
}

// ── Deferred (base64) image handling ─────────────────────────────────────────
// Guests can't upload (upload route is auth-gated), so images ride along the
// draft as data: URLs and are uploaded at claim time under the session user.
export function isDataUrl(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("data:");
}

export function parseDataUrl(
  dataUrl: string,
): { mime: string; base64: string } | null {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || "application/octet-stream";
  const isBase64 = !!m[2];
  if (!isBase64) return null; // only base64 data URLs are supported
  return { mime, base64: m[3] };
}

export function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}

/**
 * An image that is ALREADY hosted: the suggested company logo (lib/logo-provider,
 * img.logo.dev) or an imported headshot. Nothing to upload — the URL is kept as
 * is, the same as /api/cards stores it for a signed-in build.
 *
 * Owner, 2026-09-29: a guest's card lost its logo. The wizard's draft keeps the
 * logo only in `images.logo` (payload.logo_url is null), and this claim used to
 * accept only data: URLs there — so the suggested logo, an https URL, was
 * dropped the moment the account was created, and the card reached the plan
 * step (and Free) without it. https only; nothing else is a card image.
 */
export function isHostedImageUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2048) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

// Same guard as the upload route — reject anything that isn't an allowed image.
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
