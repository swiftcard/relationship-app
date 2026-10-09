// ── Central plan configuration ──────────────────────────────────────────────
// All plan limits, the trial length, and the Pro-only design keys live here so
// nothing drifts. If you change a number, change it HERE — every route and
// component reads from this file.
import { metaForTemplate, freeSafeValues } from "./template-style-presets";
import { isFreeFinish, getFinish } from "./card-finishes";
import { freeSafeLook, getLook, DEFAULT_SWIFTLINK_LOOK } from "./swiftlink-looks";

export const PLAN_LIMITS = {
  FREE_CARD_LIMIT: 1,          // max cards on Free (Pro/Office: unlimited)
  FREE_MAX_LINKS: 2,           // max additional Swift Links (action-link buttons) on Free; Pro/Office: unlimited
  // ── Monthly free meters (refresh on the 1st; counted per-ACCOUNT via
  //    profiles.customization._usage so deleting a card can never reset them).
  FREE_LEADS_PER_MONTH: 5,     // new leads/month before extras soft-lock behind Pro
  // NOTE: the AI business-card scanner is Pro-only (owner decision, Jul 2026) —
  // there is no free scan allowance, so there's no limit constant for it.
  // AI follow-up drafts are Pro-only too (owner, 2026-09-23: "free cannot do
  // any AI follow-ups"). The old 3-a-month allowance was only ever enforced on
  // an endpoint no screen called, so Free never actually received a draft.
  OFFICE_MIN_SEATS: 2,         // minimum seats for the Office plan
} as const;

// Displayed prices on /pricing, in cents (USD) — the ONE source of truth for
// what SwiftCard charges. The checkout route fetches the actual Stripe Price
// object for whatever priceId is requested and refuses to check out if its
// unit_amount doesn't match here, so a mispriced Stripe Product can never
// silently charge someone something different from what they saw on the page.
// Change a number here AND in Stripe's dashboard together — never one without the other.
export const PLAN_PRICES = {
  PRO_MONTHLY_CENTS: 499,               // $4.99/mo
  PRO_ANNUAL_CENTS: 5400,                // $54.00/yr (~$4.50/mo, 10% off monthly)
  OFFICE_MONTHLY_PER_SEAT_CENTS: 399,    // $3.99/mo per seat
  OFFICE_ANNUAL_PER_SEAT_CENTS: 4309,    // $43.09/yr per seat (399 * 12 * 0.9, 10% off)
} as const;

// Internal lead tag: a lead captured beyond the free monthly cap. Stored on the
// lead, hidden from the owner (blurred) until they upgrade — never deleted, and
// unlocked automatically the moment the account is paid.
export const LOCKED_LEAD_TAG = "sc-locked";

// Opt-in Pro trial: when someone SUBSCRIBES to Pro they get this many days
// free first (card collected at checkout; Stripe bills automatically when the
// trial ends unless they cancel). One trial per customer — enforced in the
// checkout route. Free signups get Free only; there is no automatic trial.
// (The legacy comment below describes the discontinued reverse trial; the
// cron that expires old grants still reads this value for those accounts.)
// Legacy: every NEW signup got a full-Pro reverse trial for this many days, then the
// daily cron downgrades them to Free (never touches a real paying subscriber).
export const TRIAL_DAYS = 14;

// Length of one app-level "free month" grant, in days (referral/promo rewards).
export const FREE_MONTH_DAYS = 30;

// Customization keys that are Pro-only design controls. Snapped to the nearest
// Free-safe preset (or dropped, for the legacy `font` key) server-side for
// non-paid accounts so a downgraded or hand-crafted request can't keep an
// arbitrary custom value. (Free baseline customization — about, address, bio,
// socials, testimonials, links up to the cap — is never touched.)
export const PRO_CUSTOMIZATION_KEYS = ["accentColor", "font", "bgColor", "surfaceColor", "textColor", "infoColor", "fontFamily",
  // Title color and Company color (owner, 2026-10-09) — colours like the
  // rest, so a Free card snaps them to that template's swatches.
  "titleColor", "companyColor",
  // Card FINISH and panel media (lib/card-finishes.ts). `finish` is only
  // PARTLY Pro — Flat, Sheen and Halo are free — so it is snapped below
  // rather than dropped. Panel media is Pro outright: an uploaded photo or
  // video has no free equivalent to snap to.
  "finish", "panelMedia", "panelMediaType", "panelMediaPoster", "panelDim"] as const;

// Swift Links PAGE design keys ("Social design" step) — deliberately separate
// from the card's design keys above so styling the card never restyles the
// Swift Links page or vice versa (they are different surfaces with different
// looks). Pro-gated the same way: stripped server-side for non-paid accounts.
// linkHeroStyle is deliberately NOT here — the header style (cover/avatar) is
// structural and every-plan, the same rule as linkLook and the card-link toggle.
export const LINK_STYLE_KEYS = ["linkBgColor", "linkTextColor", "linkFontFamily", "linkIconShape", "linkIconFill", "linkButtonStyle", "linkButtonColor",
  // Page background media (2026-09-10): the photo/video behind the whole
  // page, its scrim, and the frosted link rows that go with it. Pro, like
  // every other look-and-feel key here — the compact-circle header itself
  // stays structural and every-plan (LINK_STRUCTURAL_KEYS).
  "linkBgMedia", "linkBgMediaType", "linkBgDim", "linkGlass",
  // The accent: the Connect button, and social icons set to Accent. Pro,
  // like every other colour here.
  "linkAccentColor"] as const;

// Swift Links keys that are STRUCTURAL and every-plan — never stripped by the
// sanitizer (the named Look has its own free-snap rule above). One list so the
// wizard's guest-draft restore and any future copier can carry them without
// re-deriving which keys are plan-gated.
export const LINK_STRUCTURAL_KEYS = ["linkLook", "linkHeroStyle", "linkHeroContent", "linkHeroImage", "linkHeroMediaType"] as const;

// A paid plan = Pro or Office (enterprise). Office is a superset of Pro.
export function isPaidPlan(plan?: string | null): boolean {
  return plan === "pro" || plan === "enterprise";
}

export function isOfficePlan(plan?: string | null): boolean {
  return plan === "enterprise";
}

// ── Free-tier color matching ─────────────────────────────────────────────────
// Free accounts can restyle a card using the SAME curated Looks/preset swatches
// Pro sees (see template-style-presets.ts + TemplateStyleControls.tsx) — only
// the arbitrary custom-color picker and the fully-custom designer stay Pro-only.
// So a value that isn't one of the current template's presets (a raw Pro custom
// pick, or a value left over from a different template) gets snapped to the
// closest one instead of being deleted outright.

function hexOf(color: string): [number, number, number] | null {
  const m = color.match(/#([0-9a-f]{6})/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Perceptual-ish RGB distance (no need for anything fancier than Euclidean —
// we're picking "closest of ~6 swatches", not doing color science).
function colorDistance(a: string, b: string): number {
  const ca = hexOf(a);
  const cb = hexOf(b);
  if (!ca || !cb) return a === b ? 0 : Infinity;
  return Math.sqrt((ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2 + (ca[2] - cb[2]) ** 2);
}

// Snap `value` to whichever of `presets` is closest. An exact match passes
// through untouched; `undefined` (never set) stays `undefined` — there's
// nothing to convert, the template's own baked-in default already applies.
export function nearestPreset(value: string | undefined, presets: string[], fallback: string): string | undefined {
  if (value === undefined) return undefined;
  if (presets.includes(value)) return value;
  const pool = presets.length ? presets : [fallback];
  let best = pool[0];
  let bestDist = colorDistance(value, best);
  for (const p of pool.slice(1)) {
    const d = colorDistance(value, p);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

// Convert a card's customization + template to the closest Free-tier
// equivalent: every Pro-only color key gets snapped to the nearest preset for
// the (possibly downgraded) target template; nothing about the actual card
// CONTENT (name, links, photos, testimonials, address, …) is touched. Returns
// `changed: true` when there was actually something to convert, so callers can
// decide whether to show a "we applied a basic Free design" notice at all.
export function convertCustomizationToFreeClosest(
  customization: Record<string, unknown>,
  template: string | undefined,
): { customization: Record<string, unknown>; template: string; changed: boolean } {
  const cust = { ...customization };
  const hadCustomTemplate = template === "custom";
  const targetTemplate = hadCustomTemplate ? "classic-pro" : template || "classic-pro";
  const meta = metaForTemplate(targetTemplate);

  const bgColor = pickStr(cust.bgColor);
  const surfaceColor = pickStr(cust.surfaceColor);
  const textColor = pickStr(cust.textColor);
  const infoColor = pickStr(cust.infoColor);
  const accentColor = pickStr(cust.accentColor);
  const titleColor = pickStr(cust.titleColor);
  const companyColor = pickStr(cust.companyColor);

  // A Pro FINISH falls back to Flat rather than to another finish: Sheen is not
  // a "cheaper Brushed", so snapping between them would silently redesign the
  // card. Flat is the card's own look, which is the honest downgrade.
  const finish = pickStr(cust.finish);
  if (finish !== undefined && !isFreeFinish(finish)) delete cust.finish;
  // Panel media is Pro outright — there is no free photo to snap to — so it is
  // removed along with the scrim and the video poster that only make sense with
  // it. The card falls back to its colour, which is never worse than a card
  // rendering half a feature.
  delete cust.panelMedia;
  delete cust.panelMediaType;
  delete cust.panelMediaPoster;
  delete cust.panelDim;

  // A fully-custom card has no standard-template style keys to snap — leave
  // the target template's baked-in defaults in place rather than guessing.
  if (!hadCustomTemplate) {
    // freeSafeValues, not meta.*.presets: a curated Look is something the
    // product offers on the picker, so tapping one must not be undone on save.
    if (bgColor !== undefined) cust.bgColor = nearestPreset(bgColor, freeSafeValues(meta, "bg"), meta.bg.fallback);
    // Only three templates have a second surface. On the others the key is
    // meaningless, so it is dropped rather than snapped to a palette that
    // does not exist.
    if (surfaceColor !== undefined) {
      if (meta.surface) cust.surfaceColor = nearestPreset(surfaceColor, freeSafeValues(meta, "surface"), meta.surface.fallback);
      else delete cust.surfaceColor;
    }
    if (textColor !== undefined) cust.textColor = nearestPreset(textColor, freeSafeValues(meta, "text"), meta.text.fallback);
    if (infoColor !== undefined) cust.infoColor = nearestPreset(infoColor, meta.info.presets, meta.info.fallback);
    if (accentColor !== undefined) cust.accentColor = nearestPreset(accentColor, meta.accent.presets, meta.accent.fallback);
    if (titleColor !== undefined) cust.titleColor = nearestPreset(titleColor, meta.title.presets, meta.title.fallback);
    if (companyColor !== undefined) cust.companyColor = nearestPreset(companyColor, meta.company.presets, meta.company.fallback);
  } else {
    delete cust.bgColor;
    delete cust.surfaceColor;
    delete cust.textColor;
    delete cust.infoColor;
    delete cust.accentColor;
    delete cust.titleColor;
    delete cust.companyColor;
    delete cust.customLayout;
  }
  // `fontFamily` is already a closed preset list (CARD_FONT_OPTIONS) with no
  // custom-text-input equivalent, so the picked value IS its own closest
  // match — left as-is. The legacy `font` key has no known preset mapping.
  delete cust.font;

  // `changed` means the card will LOOK different on Free — not that a design
  // key was present. It used to be "any Pro-gated key is set", which fired the
  // "we'll apply a basic Free design" notice at someone who had tapped a Free
  // Look or picked a font: nothing about their card was about to change, and
  // the notice said it was. A false alarm at the plan step costs a signup, so
  // this is decided by comparing what came in with what goes out.
  const changed =
    hadCustomTemplate ||
    PRO_CUSTOMIZATION_KEYS.some((key) => {
      const before = customization[key];
      const after = cust[key];
      const wasEmpty = before === undefined || before === "";
      const isEmpty = after === undefined || after === "";
      return wasEmpty !== isEmpty || (!wasEmpty && before !== after);
    });

  return { customization: cust, template: targetTemplate, changed };
}

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * Name, in plain words, exactly what Free will change about this card.
 *
 * "Custom colors and premium design options are available on Pro" was the
 * whole of what someone got told before their card was rewritten — a sentence
 * about the PLAN, not about their card, which leaves them to discover what
 * actually happened by looking at the result. A person who spent ten minutes
 * on a card is owed the specifics before they choose, not a category.
 *
 * Derived from the converter itself rather than written by hand, so a new
 * Pro-only design key can never quietly stop being mentioned here.
 */
export function describeFreeDesignChanges(
  customization: Record<string, unknown>,
  template: string | undefined,
): string[] {
  const before = customization;
  const { customization: after, changed } = convertCustomizationToFreeClosest(customization, template);
  if (!changed) return [];

  const lines: string[] = [];

  if (template === "custom") {
    lines.push("Your custom design becomes the Classic Pro template");
  }

  const finish = pickStr(before.finish);
  if (finish && !isFreeFinish(finish)) {
    lines.push(`Your ${getFinish(finish).name} finish becomes Flat`);
  }

  if (pickStr(before.panelMedia)) {
    lines.push(before.panelMediaType === "video" ? "Your background video is removed" : "Your background photo is removed");
  }

  // One line for colours however many moved: listing four near-identical
  // hex swaps reads as a wall of noise, and the person cannot picture any of
  // them anyway. What matters is that the colours shift, not which.
  const COLOUR_KEYS = ["bgColor", "surfaceColor", "textColor", "titleColor", "companyColor", "infoColor", "accentColor"] as const;
  const movedColours = COLOUR_KEYS.filter((k) => {
    const b = pickStr(before[k]);
    const a = pickStr(after[k]);
    return b !== undefined && b !== a;
  }).length;
  if (movedColours > 0) {
    lines.push(movedColours === 1 ? "One of your colors moves to the closest free one" : "Your colors move to the closest free ones");
  }

  // A conversion the specifics above didn't cover — a key added later, or the
  // legacy `font` drop. Better a vague line than a confident empty list under
  // a heading that says something is about to change.
  if (!lines.length) lines.push("Some of your design settings change");

  return lines;
}

/**
 * The Pro-only design choices a card is currently using, named.
 *
 * describeFreeDesignChanges() answers "what will be taken away if you save on
 * Free", which is the right question at the end of the build wizard, where the
 * card is about to be converted. The edit screen asks a different one: someone
 * has deliberately tried Brushed or dropped in a background video, pressed Save
 * Changes, and needs to know WHAT they picked is Pro — not a list of losses.
 *
 * Same detection as the describer, so the two can never disagree about whether
 * a card is using Pro design; only the wording differs. Empty array means the
 * card saves on Free untouched.
 */
export function proFeaturesInUse(
  customization: Record<string, unknown>,
  template: string | undefined,
): string[] {
  const before = customization;
  const { customization: after, changed } = convertCustomizationToFreeClosest(customization, template);
  if (!changed) return [];

  const names: string[] = [];

  if (template === "custom") names.push("Your own custom design");

  const finish = pickStr(before.finish);
  if (finish && !isFreeFinish(finish)) names.push(`${getFinish(finish).name} finish`);

  if (pickStr(before.panelMedia)) {
    names.push(before.panelMediaType === "video" ? "Background video" : "Background photo");
  }

  const COLOUR_KEYS = ["bgColor", "surfaceColor", "textColor", "titleColor", "companyColor", "infoColor", "accentColor"] as const;
  if (COLOUR_KEYS.some((k) => {
    const b = pickStr(before[k]);
    return b !== undefined && b !== pickStr(after[k]);
  })) names.push("Your own colors");

  if (pickStr(before.fontFamily) && pickStr(before.fontFamily) !== pickStr(after.fontFamily)) {
    names.push("Your own font");
  }

  // Something the specifics above do not cover — a key added later. Never
  // return an empty list while the converter says the card changes, or the
  // save would be blocked with nothing shown to explain it.
  if (!names.length) names.push("Premium design settings");

  return names;
}

// Enforce Free limits on a card's customization blob: snap Pro-only design keys
// to the nearest Free-safe preset and cap link buttons. Returns a NEW object;
// never mutates the input. Paid accounts pass through untouched. `template` is
// used to pick the right preset set — omit it only for call sites that can't
// resolve one, where it falls back to the generic FALLBACK_META presets.
export function sanitizeCustomizationForPlan<T extends Record<string, unknown>>(
  customization: T | null | undefined,
  paid: boolean,
  template?: string,
  opts?: {
    /**
     * Skip the destructive parts when WRITING a downgraded account's card.
     *
     * This function is used for two different jobs: deciding what a Free
     * account may SHOW, and deciding what gets PERSISTED. Those are not the
     * same. Applied on write, the link slice and the colour snap don't hide
     * anything — they delete it. A downgraded Pro user with five Swift Links
     * who edited any unrelated field (a phone number, a title) came back with
     * three of them gone from the database, and their card colours
     * permanently snapped to the nearest Free preset. Re-subscribing did not
     * bring any of it back, because there was nothing left to restore.
     *
     * Safe because every render path enforces the cap itself: the card page
     * and dashboard and share page all run this function without this option,
     * and the Swift Links page slices to FREE_MAX_LINKS and gates page
     * theming on `ownerPaid` inline. So the over-limit links and Pro colours
     * are stored and hidden, which is what the plan actually means.
     */
    preserveDowngraded?: boolean;
    /**
     * Convert the DESIGN to Free but keep every Swift Link stored. Used when
     * someone whose Pro ended confirms "Continue on Free": the owner's rule is
     * that their design converts but no content is ever deleted, and links are
     * content. Every renderer already hides links past FREE_MAX_LINKS, so the
     * extras stay invisible on Free and come back with Pro.
     */
    keepLinks?: boolean;
  },
): T {
  let cust = { ...(customization ?? {}) } as Record<string, unknown>;
  if (paid || opts?.preserveDowngraded) return cust as T;
  // Free is capped at FREE_MAX_LINKS Swift Links (action-link buttons); extras
  // are trimmed. Pro/Office get unlimited links plus full design control.
  if (!opts?.keepLinks && Array.isArray(cust.links) && cust.links.length > PLAN_LIMITS.FREE_MAX_LINKS) {
    cust.links = (cust.links as unknown[]).slice(0, PLAN_LIMITS.FREE_MAX_LINKS);
  }
  cust = convertCustomizationToFreeClosest(cust, template).customization;
  // Swift Links "Social design": Free keeps a FREE-tier Look (see
  // lib/swiftlink-looks — the free pair is the deliberate floor of the
  // feature), while a Pro-only Look snaps to the default and the custom
  // fine-tune keys (bg/text/font) are dropped — those stay Pro.
  if (cust.linkLook !== undefined) {
    const safe = freeSafeLook(typeof cust.linkLook === "string" ? cust.linkLook : null);
    if (safe === DEFAULT_SWIFTLINK_LOOK && cust.linkLook !== DEFAULT_SWIFTLINK_LOOK) delete cust.linkLook;
    else cust.linkLook = safe;
  }
  for (const key of LINK_STYLE_KEYS) delete cust[key];
  return cust as T;
}

/**
 * The Pro-only SWIFT LINKS design choices in use, named.
 *
 * The Social design panel used to disable everything a Free account could not
 * keep. Owner, 2026-09-11: make it work exactly like Card design — every
 * control live so the page can be SEEN with it, the PRO tags left where they
 * are, and Save Changes the wall. This is the other half of that: the panel is
 * only safe to unlock if pressing Save names what was used, because the server
 * strips these keys when the page renders (sanitizeCustomizationForPlan) and a
 * silent revert is the one outcome worse than a locked control.
 *
 * Deliberately a SEPARATE function from proFeaturesInUse rather than more
 * branches inside the card converter: that converter also decides what a Free
 * card RENDERS as, and a change there reaches every card page in the product.
 * The card path stays byte-for-byte what it was.
 *
 * The wording follows the panel's own section headings — Look, Page background,
 * colours, Social icons, Link buttons — so the line names the thing they
 * actually touched. Empty array means the page saves on Free untouched.
 */
export function proLinkFeaturesInUse(
  style: Record<string, unknown>,
  links?: readonly { kind?: string | null; size?: string | null; media?: unknown; glass?: unknown }[] | null,
): string[] {
  const names: string[] = [];
  const s = (k: string) => pickStr(style[k]);

  // The Look, named — it is the one choice that changes the whole page, and
  // "Glass" means something to the person who just tapped it.
  const look = s("linkLook");
  if (look && freeSafeLook(look) !== look) {
    names.push(`The ${getLook(look).name} look for your Swift Links`);
  }

  // The photo or video behind the whole page. No free equivalent to fall back
  // to, so Free renders the Look's own surface instead.
  if (s("linkBgMedia")) {
    names.push(style.linkBgMediaType === "video" ? "Your Swift Links background video" : "Your Swift Links background photo");
  }

  // One line for all of them, the same reasoning as the card: four near-
  // identical hex swaps read as noise and nobody can picture them anyway.
  const COLOUR_OR_FONT = ["linkBgColor", "linkTextColor", "linkAccentColor", "linkButtonColor", "linkFontFamily"];
  if (COLOUR_OR_FONT.some((k) => s(k))) {
    names.push("Your own colors and font on Swift Links");
  }

  // How the buttons and icons are built: the page-wide styles, plus the
  // per-link ones. A Free page renders every link as a plain compact row with
  // no photo and no section headers (lib/swiftlink-tiles.ts), so a per-link
  // choice is exactly as Pro as the page-wide one and has to be named too, or
  // someone styles six links and watches all six come back plain.
  const styledButtons =
    !!s("linkIconShape") || !!s("linkIconFill") || !!s("linkButtonStyle") || !!style.linkGlass ||
    (links ?? []).some((l) => l?.kind === "header" || l?.size === "featured" || l?.size === "grid" || !!l?.media || l?.glass === true);
  if (styledButtons) names.push("How your links and social icons look");

  return names;
}
