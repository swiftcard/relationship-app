import { getCardPageData } from "@/lib/card-page-data";
import { cardIsOffline, cardWithinPlanLimit } from "@/lib/card-active";
import { cardHeadshot } from "@/lib/card-media";
import { templateStyle, type TemplateStyle } from "@/lib/template-style";
import { normalizeCustomLayout } from "@/lib/custom-layout";
import { isPaidPlan, sanitizeCustomizationForPlan } from "@/lib/plan";
import type { CardCustomization } from "@/components/card-templates/types";

/**
 * The colours a CUSTOM card was designed in, already validated.
 *
 * Surfaced separately from `style` because a custom card's look lives in a
 * different shape entirely — a two-tone layout with its own panel surface —
 * and anything downstream that wants to match the card (the Wallet pass) has
 * to read the panel, not just the ground, or a Classic-Pro fork comes out the
 * wrong colour. `background`/`panelBackground` may be a gradient string, not
 * only a hex.
 */
export type ResolvedCustomDesign = {
  background: string;
  textColor: string;
  accentColor?: string;
  panelBackground?: string;
  panelTextColor?: string;
  fontFamily: string;
  /** Design transfer: the card IS this image, so no palette can be derived. */
  faceImage?: string;
  /** Copy a card: the artwork under a free design — its colours live in pixels too. */
  bgImage?: string;
};

export type ResolvedCardMeta = {
  name: string | null;
  title: string | null;
  company: string | null;
  photoUrl: string | null;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  accentColor: string | null;
  template: string | null;
  /**
   * Pro style overrides on a PRESET template (accent, background, hero text,
   * typeface). Every field optional — a card that never set one normalizes to
   * all-undefined and the template keeps its baked-in design.
   */
  style: TemplateStyle;
  /** Set only for a custom-designed card. Null for the six presets. */
  custom: ResolvedCustomDesign | null;
} | null;

// Resolves a public card by username the same way the card page body does:
// the cards table is the source of truth, falling back to a legacy un-migrated
// profile. Photo always comes from the owning profile. Deleted accounts → null.
// Keeps page metadata + OG/signature image in sync with the live card.
export async function resolveCardMeta(username: string): Promise<ResolvedCardMeta> {
  // Same rows the page body reads, from the same per-slug cache — Next calls
  // generateMetadata alongside the page, so querying here again doubled every
  // card view's database work for identical data. Callers outside a request
  // (the Wallet pass builder, the OG image) get a cache read too, which is
  // equally correct: an edit invalidates the tag.
  const { cardRow, cardOwner: owner, profileRow, awaitingPlan } = await getCardPageData(username);

  const deleted = cardRow
    ? !!(owner?.customization as { _deleted?: boolean } | null)?._deleted
    : !!(profileRow?.customization as { _deleted?: boolean } | null)?._deleted;
  if (deleted) return null;

  // Office kill-switch — a card an admin took offline resolves to nothing, so
  // its OG/share image, signature image and wallet pass go dark with the page.
  if (cardIsOffline(cardRow)) return null;

  // Plan kill-switch — extra Pro-era cards resolve to nothing (kills the OG
  // share image and the wallet pass alongside the page itself).
  if (cardRow && !(await cardWithinPlanLimit(cardRow.id, cardRow.user_id, owner?.plan))) return null;

  // Not live until a plan is chosen (lib/card-active rule 5) — no share image,
  // no link unfurl, no wallet pass for a card nobody else can open yet.
  if (cardRow && awaitingPlan) return null;

  const legacyOk =
    !cardRow &&
    !!profileRow &&
    !((profileRow.customization as { _migrated?: boolean } | null)?._migrated) &&
    !!profileRow.name;

  const src = (cardRow ?? (legacyOk ? profileRow : null)) as Record<string, unknown> | null;
  if (!src) return null;

  const cust = (src.customization ?? {}) as CardCustomization & { address?: string };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? (v as string) : null);

  // The template the card is ACTUALLY drawn with, mirroring the card page
  // exactly: the custom designer is Pro-only, so a downgraded card renders the
  // standard template instead. Anything reading this (the Wallet pass) has to
  // see the same template the visitor does, or it advertises a design the card
  // itself no longer shows.
  const plan = (cardRow ? owner?.plan : profileRow?.plan) as string | null | undefined;
  const rawTemplate = str(src.template);
  const template = rawTemplate === "custom" && !isPaidPlan(plan) ? "classic-pro" : rawTemplate;

  // A custom design is read ONLY when the card is actually rendered custom.
  //
  // Keying on the presence of customLayout instead was wrong in a way that
  // showed up on a real card immediately: aaron-lavi-malve-capital is
  // template "photo-first" and still carries a customLayout blob from a visit
  // to the designer. The card page ignores that blob; the pass followed it and
  // came out navy while the card was indigo. The layout is not deleted when a
  // template changes — by design, so switching back restores it — so its
  // presence says nothing about what is on screen.
  const rawLayout = template === "custom" ? cust.customLayout : null;
  const custom: ResolvedCustomDesign | null =
    rawLayout && typeof rawLayout === "object"
      ? (() => {
          const l = normalizeCustomLayout(rawLayout);
          return {
            background: l.background,
            textColor: l.textColor,
            accentColor: l.accentColor,
            panelBackground: l.panelBackground,
            panelTextColor: l.panelTextColor,
            fontFamily: l.fontFamily,
            faceImage: l.faceImage,
            bgImage: l.bgImage,
          };
        })()
      : null;

  const style = templateStyle({
    customization: sanitizeCustomizationForPlan(cust as Record<string, unknown>, isPaidPlan(plan), rawTemplate || "classic-pro"),
  });

  return {
    // Through the same render-time plan filter the card page runs. A Free
    // account can still have Pro colours, a finish or a panel photo SAVED (a
    // downgraded Pro — see sanitizeCustomizationForPlan); the page hides them,
    // so the Wallet pass copying this card must hide them too, or it shows a
    // design the card itself no longer has.
    style,
    custom,
    name: str(src.name),
    title: str(src.title),
    company: str(src.company),
    photoUrl: cardRow ? cardHeadshot(cardRow.customization, owner?.photo_url) : (profileRow?.photo_url ?? null),
    logoUrl: str(src.logo_url),
    phone: str(src.phone),
    email: str(src.email),
    website: str(src.website),
    address: str(src.address) ?? str(cust.address),
    // The FILTERED accent, like everything else here: the raw value let a
    // Free card's share image (and the signature fallback) show a Pro accent
    // colour the card page itself hides.
    accentColor: str(style.accentColor),
    template,
  };
}
