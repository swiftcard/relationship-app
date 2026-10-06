import type { CardData, CardCustomization } from "@/components/card-templates/types";
import { cardSlug, prettyCardSlug } from "@/lib/slug";
import { cardHeadshot } from "@/lib/card-media";
import { sanitizeCustomizationForPlan } from "@/lib/plan";
import { unitLine } from "@/lib/address-unit";
import { clampAddress, clampField } from "@/lib/card-limits";

/**
 * ONE builder for the card object every surface renders.
 *
 * There were five, hand-maintained, in five files: the public card page, the
 * Swift Signature on /share, the dashboard preview, the card editor and the OG
 * resolver. They were written to agree and had already stopped:
 *
 *   - /share read `snapchat` and `address` out of the RAW customization while
 *     the public card read them out of the plan-SANITIZED one.
 *   - the dashboard omitted `snapchat` altogether, so a card showing a Snapchat
 *     handle publicly lost it in the dashboard preview — and in the signature
 *     and share images captured FROM that preview.
 *   - each derived `initials`, `address` and `cardUrl` with its own copy of the
 *     same three-line join.
 *
 * A signature that "has to look identical to the card" cannot be built by a
 * second implementation of the card. So there is one function now, every
 * surface calls it, and drift is not something anyone has to remember to avoid.
 *
 * THE RULE THIS ENFORCES: every rendered field comes from the CARD ROW. Nothing
 * is read off the account. The single exception is the legacy headshot
 * fallback, which lives inside cardHeadshot and is explicitly opt-out per card
 * (a card that has ever set `photoUrl` — including to null — owns its own).
 * That exception is why one card used to show another card's face.
 */

/** The columns of a `cards` row this reads. Loose, because callers `select("*")`. */
export type CardRowLike = {
  name?: string | null;
  title?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  instagram?: string | null;
  twitter?: string | null;
  tiktok?: string | null;
  linkedin?: string | null;
  username?: string | null;
  logo_url?: string | null;
  template?: string | null;
  customization?: unknown;
};

type Addr = { street?: string; unit?: string; city?: string; state?: string; zip?: string };

/** The card's address as the templates want it: up to three hard-broken lines. */
export function formatCardAddress(addr: Addr | null | undefined): string {
  if (!addr) return "";
  return [
    [addr.street, unitLine(addr.unit)].filter(Boolean).join(", "),
    addr.city ?? "",
    [addr.state, addr.zip].filter(Boolean).join(" "),
  ].filter(Boolean).join("\n");
}

export function cardInitials(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "SC";
  return n.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "SC";
}

export type BuiltCard = {
  data: CardData;
  /** The plan-sanitized customization, so callers don't sanitize a second time. */
  customization: CardCustomization & {
    bio?: string;
    facebook?: string;
    snapchat?: string;
    youtube?: string;
    address?: Addr;
    links?: { emoji: string; label: string; url: string }[];
    testimonials?: { name: string; text: string }[];
  };
  /** The template to render, already plan-gated. */
  template: string;
};

export function buildCardData(
  card: CardRowLike,
  opts: {
    /** Base URL, e.g. https://swiftcard.me. */
    appUrl: string;
    /** Whether the OWNER is on a paid plan — drives design sanitization. */
    isPro: boolean;
    /**
     * The account photo, used ONLY as the legacy fallback inside cardHeadshot,
     * for cards that predate per-card headshots. Pass null to opt out entirely.
     */
    accountPhotoUrl?: string | null;
  },
): BuiltCard {
  const rawTemplate = (card.template as string) || "classic-pro";

  // Sanitized ONCE, here, with this card's own template — the argument matters:
  // on a downgraded account colours snap to the nearest preset OF THAT
  // TEMPLATE, so omitting it snapped one surface to classic-pro's palette while
  // another snapped to the real one, and the two stopped matching.
  const customization = sanitizeCustomizationForPlan(
    (card.customization ?? {}) as Record<string, unknown>,
    opts.isPro,
    rawTemplate,
  ) as BuiltCard["customization"];

  // The custom template is Pro-only. A downgraded account keeps the saved
  // layout but renders the free fallback, and every surface must agree on that.
  const template = rawTemplate === "custom" && !opts.isPro ? "classic-pro" : rawTemplate;

  const username = card.username ?? "";
  // Printed at most lib/card-limits long, whatever is stored: a card saved
  // before the limits existed, or imported from a scanned card, still fits
  // (card-every-template.test.ts measures every template at these limits).
  const data: CardData = {
    name: clampField("name", card.name),
    title: clampField("title", card.title),
    company: clampField("company", card.company),
    phone: clampField("phone", card.phone),
    email: clampField("email", card.email),
    website: clampField("website", card.website),
    instagram: card.instagram || "",
    twitter: card.twitter || "",
    tiktok: card.tiktok || "",
    linkedin: card.linkedin || "",
    // Snapchat lives in the customization blob and only the custom template
    // renders it (withoutSocials strips it elsewhere). Read from the SANITIZED
    // blob, like every other customization-derived field here.
    snapchat: customization.snapchat || "",
    initials: cardInitials(card.name),
    // The one place an account value may be consulted, and only for cards that
    // have never set a headshot of their own.
    photoUrl: cardHeadshot(card.customization, opts.accountPhotoUrl ?? null),
    logoUrl: card.logo_url || null,
    // Printed pretty ("AaronLavi-MalveCapital") when the stored slug is the
    // derived one — the public routes are case-insensitive, so the pretty
    // casing resolves. A custom or deduped slug prints exactly as stored.
    cardUrl: `${opts.appUrl.replace(/^https?:\/\//, "")}/${
      cardSlug(card.name || "", card.company) === username ? prettyCardSlug(card.name || "", card.company) : username
    }`,
    address: clampAddress(formatCardAddress(customization.address)),
    customization,
  };

  return { data, customization, template };
}
