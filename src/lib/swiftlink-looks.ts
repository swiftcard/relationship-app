// ── Swift Links "Looks" — named, composed page themes ───────────────────────
//
// The old "Social design" was three raw knobs (background / text / font), and
// Free got none of them — every Free page was the same dark sheet. Nobody
// composes a good palette from three color pickers; they pick a vibe. So the
// page now works like the card templates' "Looks": one choice sets the whole
// scheme — sheet, page backdrop, text, accent, tile surface — composed to
// read well together, with the Pro pickers acting as fine-tuning on top.
//
// Design reference: hoo.be (dissected 2026-08-18). Their premium feel is a
// LIGHT editorial page — white sheet, dark text, flat image tiles — which is
// why the default Look here is light ("Paper"), not the old dark stock. The
// old stock survives, unchanged, as "Onyx".
//
// PLAN LINE (matches plan-content's "Social design" being a Pro feature, with
// a deliberate Free floor): Free picks between the two FREE_SWIFTLINK_LOOKS;
// the rest of the library and the custom color pickers stay Pro. Enforced
// server-side in lib/plan's sanitizeCustomizationForPlan via freeSafeLook().
//
// Every look must pass tests/swiftlink-looks.test.ts: text-on-sheet and
// accentText-on-accent both ≥ 4.5:1 (WCAG AA). Change a value, run the test.

import { isHex, lookFromTone } from "@/lib/photo-tone";

export type SwiftLinkLook = {
  id: string;
  /** Shown in the picker. */
  name: string;
  /** Which group this look sits in — the picker's three dropdowns. See
   *  LOOK_FAMILIES. */
  family: LookFamily;
  /** Governs how neutral chrome (rings, hovers, shadows) renders. */
  mode: "light" | "dark";
  /** The sheet — the page's main surface behind name/bio/socials/links. */
  sheet: string;
  /** The backdrop behind the phone-width column on desktop. */
  page: string;
  /** Name, bio, labels. */
  text: string;
  /** The action color — Connect button, selected states. */
  accent: string;
  /** Text on the accent (a light accent needs dark text). */
  accentText: string;
  /** Surface behind link tiles while their image loads / with no image. */
  tile: string;
  /** Optional second stop: the sheet renders as a top-to-bottom gradient from
   *  `sheet` to this. `sheet` stays the single source of truth for everything
   *  that needs ONE color — the hero fade's end stop, the sticky mini-header's
   *  translucent bar — because the gradient's 0% stop IS `sheet`, so those
   *  chrome pieces still meet the surface seamlessly. Text must pass AA
   *  against BOTH stops (tested). */
  sheetTo?: string;
  /** Photo-backed look: the owner's headshot, blurred and dimmed, fills the
   *  whole column behind a translucent glass sheet. The hex fields above are
   *  the no-photo fallback AND the contrast floor — the overlay only ever
   *  darkens past them. */
  aura?: boolean;
  /** GLASS family: a soft colour wash fills the column and the sheet floats
   *  over it as frosted glass. Stops run top-left to bottom-right.
   *
   *  Stored as stops rather than a CSS string so the CONTRAST TEST can do the
   *  arithmetic. Text on a glass look does not sit on `sheet`; it sits on
   *  `sheet` blended over the wash at `frost` alpha, and it is the worst stop
   *  that has to pass AA, not the sheet. A raw gradient string would make that
   *  untestable, and "it looked fine on the one photo I tried" is exactly how
   *  an unreadable theme ships. */
  wash?: string[];
  /** How opaque the frosted sheet is over the wash, 0-1. Lower = more colour
   *  shows through = less contrast, so it is part of the AA sum above. */
  frost?: number;
  /** "Photo match": the scheme is derived from the header photo's own colour
   *  (lib/photo-tone) by resolveLook. The hex fields above are the fallback
   *  for a page with no photo to read. */
  photoMatch?: boolean;
};

// ── The three families ───────────────────────────────────────────────────────
//
// Owner request 2026-09-10: the flat list of looks becomes a small number of
// labelled groups that drop down, with new "clearer, less cartoony, more
// see-through" designs alongside the originals.
//
// Grouped by MATERIAL, which is the one split a non-designer can predict from
// the name alone — you can tell by looking at a page which of the three it is.
// Grouping by mood ("Bold", "Calm") reads well in a deck and is unusable in a
// picker, because two people never agree on which bucket a colour is in.

export type LookFamily = "solid" | "gradient" | "glass";

export const LOOK_FAMILIES: { id: LookFamily; name: string; blurb: string }[] = [
  { id: "solid", name: "Solid", blurb: "One clean colour behind everything." },
  { id: "gradient", name: "Gradient", blurb: "Two colours, softly blended down the page." },
  { id: "glass", name: "Glass", blurb: "Frosted and see-through, with colour glowing behind." },
];

export const SWIFTLINK_LOOKS: SwiftLinkLook[] = [
  // ── SOLID — one flat colour behind everything ─────────────────────────────
  {
    // The DEFAULT since 2026-10-15 (owner, after link.me). FREE. The page
    // takes its colour from the owner's own header photo — see lib/photo-tone
    // and resolveLook below. The hex values here are Paper's, byte-for-byte:
    // they are what renders whenever there is no photo to match (a logo or
    // initials header, a video, a photo that will not load), so a page without
    // a photo looks exactly as it did when Paper was the default.
    id: "match", name: "Photo match", family: "solid", mode: "light", photoMatch: true,
    sheet: "#FAFAF7", page: "#ECEAE4", text: "#111827",
    accent: "#1D4ED8", accentText: "#FFFFFF", tile: "#E8E6DF",
  },
  {
    // The default until 2026-10-15. Light, warm-white, editorial — the hoo.be
    // register. FREE.
    id: "paper", name: "Paper", family: "solid", mode: "light",
    sheet: "#FAFAF7", page: "#ECEAE4", text: "#111827",
    accent: "#1D4ED8", accentText: "#FFFFFF", tile: "#E8E6DF",
  },
  {
    // The pre-Looks stock page, byte-for-byte — existing pages keep their
    // exact colors by selecting this. FREE.
    id: "onyx", name: "Onyx", family: "solid", mode: "dark",
    sheet: "#191A1A", page: "#09090B", text: "#FFFFFF",
    accent: "#1D4ED8", accentText: "#FFFFFF", tile: "#242526",
  },
  {
    // hoo.be ships a palette by this name; warm pink + terracotta.
    id: "blush", name: "Blush", family: "solid", mode: "light",
    sheet: "#FBF2EF", page: "#F1E3DE", text: "#46292B",
    accent: "#A8433C", accentText: "#FFFFFF", tile: "#F0E0DA",
  },
  {
    id: "sand", name: "Sand", family: "solid", mode: "light",
    sheet: "#F7F1E4", page: "#EDE4D0", text: "#3B2E1A",
    accent: "#92400E", accentText: "#FFFFFF", tile: "#EDE5D2",
  },
  {
    // Monochrome minimal — near-black accent on silver.
    id: "chrome", name: "Chrome", family: "solid", mode: "light",
    sheet: "#F4F5F7", page: "#E5E7EB", text: "#0F172A",
    accent: "#111827", accentText: "#FFFFFF", tile: "#E9EAEE",
  },
  {
    id: "forest", name: "Forest", family: "solid", mode: "dark",
    sheet: "#0C231E", page: "#06140F", text: "#E7F6EF",
    accent: "#10B981", accentText: "#052E27", tile: "#143229",
  },
  {
    id: "midnight", name: "Midnight", family: "solid", mode: "dark",
    sheet: "#0B1220", page: "#05080F", text: "#E6EDFB",
    accent: "#60A5FA", accentText: "#0B1220", tile: "#131C2E",
  },
  {
    id: "orchid", name: "Orchid", family: "solid", mode: "dark",
    sheet: "#1C1229", page: "#0F0A18", text: "#F3EEFB",
    accent: "#A78BFA", accentText: "#1C1229", tile: "#271A38",
  },
  {
    // The dark WARM one. Every other dark solid is cool or neutral (Onyx,
    // Forest, Midnight, Orchid), so a warm brand had nothing here to sit on.
    // Oxblood with an antique-gold accent. Gold rather than the obvious rose:
    // a light pink on wine reads as sweet, and Blush already owns pink in this
    // family. Wine and gold is the pairing this colour has always wanted, and
    // the accent still has to be light enough to carry dark label text.
    id: "claret", name: "Claret", family: "solid", mode: "dark",
    sheet: "#22121B", page: "#120A0E", text: "#F9E9EF",
    accent: "#D4AF6A", accentText: "#241004", tile: "#2E1A25",
  },
  {
    // The light COOL one. Paper is warm white, Chrome is neutral silver —
    // neither reads as organic. Muted green-grey, calm rather than fresh.
    id: "sage", name: "Sage", family: "solid", mode: "light",
    sheet: "#F1F4EE", page: "#E1E8DB", text: "#1F2A1C",
    accent: "#3F6212", accentText: "#FFFFFF", tile: "#E6ECE0",
  },

  // ── GRADIENT — two colours falling down the page ──────────────────────────
  // hoo.be's premium themes are soft gradients rather than flats.
  {
    // Peach dawn falling into rose. Warm, feminine, creator-coded.
    id: "dawn", name: "Dawn", family: "gradient", mode: "light",
    sheet: "#FFF4EC", sheetTo: "#FBDDE2", page: "#F4E2D8", text: "#4A1D0E",
    accent: "#C2410C", accentText: "#FFFFFF", tile: "#F8E4DC",
  },
  {
    // Sea light — pale aqua into a soft harbour blue. The cool counterpart to
    // Dawn, for anyone whose brand is not warm.
    id: "tide", name: "Tide", family: "gradient", mode: "light",
    sheet: "#EFF8FB", sheetTo: "#DCEBF7", page: "#D3E4EE", text: "#0C2A36",
    accent: "#0E7490", accentText: "#FFFFFF", tile: "#DFEEF4",
  },
  {
    // Deep navy sinking into violet. The dark-mode gradient flagship.
    id: "nebula", name: "Nebula", family: "gradient", mode: "dark",
    sheet: "#121A33", sheetTo: "#2A1B4D", page: "#090D1D", text: "#EDEBFB",
    accent: "#A5B4FC", accentText: "#121A33", tile: "#1D2440",
  },
  {
    // Near-black lifting into slate. Deliberately the quietest thing in the
    // library — no hue to date it, nothing that reads as a colour choice.
    id: "ink", name: "Ink", family: "gradient", mode: "dark",
    sheet: "#111318", sheetTo: "#1B2330", page: "#08090C", text: "#EEF1F6",
    accent: "#94A3B8", accentText: "#0F1319", tile: "#1C1F26",
  },
  {
    // Ivory settling into taupe. The light counterpart to Ink: the quiet one,
    // with no hue strong enough to date it or to fight a logo.
    id: "linen", name: "Linen", family: "gradient", mode: "light",
    sheet: "#FBF7F0", sheetTo: "#EFE7DA", page: "#E5DCCB", text: "#2B241A",
    accent: "#6B5B45", accentText: "#FFFFFF", tile: "#F2ECE1",
  },
  {
    // Pale green into soft eucalyptus. Nothing else in the library is a light
    // green, and it is the register wellness, property and outdoor brands ask
    // for by name.
    id: "meadow", name: "Meadow", family: "gradient", mode: "light",
    sheet: "#F0F9F2", sheetTo: "#DDF0E3", page: "#D2E7D8", text: "#10291B",
    accent: "#065F46", accentText: "#FFFFFF", tile: "#E2F1E6",
  },
  {
    // Deep water: teal sinking into midnight blue. Distinct from Nebula, which
    // ends in violet, and from Ink, which has no hue at all.
    id: "lagoon", name: "Lagoon", family: "gradient", mode: "dark",
    sheet: "#06222B", sheetTo: "#0B2F4A", page: "#041520", text: "#E3F4F8",
    accent: "#22D3EE", accentText: "#04252C", tile: "#0C2E38",
  },
  {
    // Plum burning down into rust. The dark WARM gradient — the one register
    // the four originals left out entirely.
    id: "sunset", name: "Sunset", family: "gradient", mode: "dark",
    sheet: "#2A0F26", sheetTo: "#4A1A12", page: "#170812", text: "#FCEDE4",
    accent: "#FB923C", accentText: "#3A1704", tile: "#35161F",
  },

  // ── GLASS — a colour wash under a frosted sheet ───────────────────────────
  // The wash fills the whole column; the sheet floats over it at `frost`
  // alpha with a heavy backdrop blur, so the colour reads as light coming
  // through rather than as a painted background. Every `frost`/`wash` pair is
  // AA-checked against its WORST stop in tests/swiftlink-looks.test.ts.
  {
    // Cool daylight — sky, lilac and mint under white frost. The "clearer"
    // one: almost no colour on the surface, all of it in the light behind.
    id: "frost", name: "Frost", family: "glass", mode: "light",
    sheet: "#F4F7FB", page: "#DDE6F2", text: "#111C2E",
    accent: "#1D4ED8", accentText: "#FFFFFF", tile: "#E6ECF5",
    wash: ["#9CC7EE", "#C3B6EA", "#9FE0D2"], frost: 0.58,
  },
  {
    // Warm greys and pale sand. The least decorated look here — for someone
    // who wants texture and depth without a colour having an opinion.
    id: "mist", name: "Mist", family: "glass", mode: "light",
    sheet: "#F7F6F3", page: "#E4E1DB", text: "#1C1B18",
    accent: "#3F3B34", accentText: "#FFFFFF", tile: "#EDEBE6",
    wash: ["#CFC6B6", "#DFCCC2", "#C2C7BE"], frost: 0.58,
  },
  {
    // Teal into indigo into violet, seen through smoked glass. The northern
    // lights, which is the one piece of colour theatre this family earns.
    id: "aurora", name: "Aurora", family: "glass", mode: "dark",
    sheet: "#0C1420", page: "#060A12", text: "#E8F0FA",
    accent: "#5EEAD4", accentText: "#062A26", tile: "#16202F",
    wash: ["#0F6B70", "#26399A", "#6A2FA0"], frost: 0.48,
  },
  {
    // Plum, rust and amber banked down low. Warm, close, evening.
    id: "ember", name: "Ember", family: "glass", mode: "dark",
    sheet: "#170F12", page: "#0D0809", text: "#FAEDE7",
    accent: "#F59E0B", accentText: "#2B1A02", tile: "#241619",
    wash: ["#5E1B4E", "#93301E", "#A76410"], frost: 0.48,
  },
  {
    // Blush, peach and lavender behind white frost. The light WARM glass —
    // Frost is cool and Mist is grey, so a warm brand had no light option
    // in this family at all.
    id: "bloom", name: "Bloom", family: "glass", mode: "light",
    sheet: "#FDF6F4", page: "#F2E3E0", text: "#3A1C24",
    accent: "#BE185D", accentText: "#FFFFFF", tile: "#F6E7E4",
    wash: ["#F3C9D6", "#F6D4BE", "#DCCBEE"], frost: 0.58,
  },
  {
    // Emerald into sea-green into moss, under smoked glass. Deep water and
    // deep forest at once; the only green in the family.
    id: "jade", name: "Jade", family: "glass", mode: "dark",
    sheet: "#08160F", page: "#04100A", text: "#E4F5EA",
    accent: "#34D399", accentText: "#04281A", tile: "#12241A",
    wash: ["#0C5F3C", "#0B6357", "#2A6B22"], frost: 0.48,
  },
  {
    // Steel and slate with the faintest warm turn at the end. No colour to
    // speak of — the glass equivalent of Ink, for a page that wants depth and
    // texture and no opinion whatsoever.
    id: "graphite", name: "Graphite", family: "glass", mode: "dark",
    sheet: "#121316", page: "#08090B", text: "#EDEEF1",
    accent: "#A1A1AA", accentText: "#101114", tile: "#1D1E22",
    wash: ["#3E4450", "#2C2E36", "#4A4340"], frost: 0.48,
  },
  {
    // The owner's own headshot, blurred and dimmed, as the page atmosphere —
    // a personalized theme nobody has to design. Same frosted sheet as its
    // family; the difference is that the thing behind the glass is a photo,
    // so it is the one look whose wash the owner supplies. Falls back to
    // these solid colors (an Onyx-family dark) when the card has no photo.
    id: "aura", name: "Aura", family: "glass", mode: "dark", aura: true,
    sheet: "#101016", page: "#08080C", text: "#FFFFFF",
    accent: "#E5E7EB", accentText: "#101016", tile: "#1A1A22",
  },
];

/** The looks in one family, in library order. */
export function looksInFamily(family: LookFamily): SwiftLinkLook[] {
  return SWIFTLINK_LOOKS.filter((l) => l.family === family);
}

/** The family a stored look id belongs to — used to open the right dropdown. */
export function familyOfLook(id?: string | null): LookFamily {
  return getLook(id).family;
}

/**
 * The CSS gradient for a glass look's wash.
 *
 * 160deg, not 180: the wash reads as light entering the page from one corner
 * rather than as a horizontal band, which is the difference between "frosted
 * glass" and "a striped background".
 */
export function washGradient(look: SwiftLinkLook): string | null {
  if (!look.wash?.length) return null;
  const stops = look.wash.map((c, i) => `${c} ${Math.round((i / Math.max(1, look.wash!.length - 1)) * 100)}%`);
  return `linear-gradient(160deg, ${stops.join(", ")})`;
}

/** Look ids Free accounts may store and render. Order = picker order. */
export const FREE_SWIFTLINK_LOOKS = ["match", "paper", "onyx"] as const;

/** The default for every page with no stored choice: the page takes its colour
 *  from the owner's header photo (owner, 2026-10-15). With no photo it renders
 *  as Paper — light, per the owner's 2026-08-18 call "default should be light". */
export const DEFAULT_SWIFTLINK_LOOK = "match";

export function getLook(id?: string | null): SwiftLinkLook {
  return SWIFTLINK_LOOKS.find((l) => l.id === id)
    ?? SWIFTLINK_LOOKS.find((l) => l.id === DEFAULT_SWIFTLINK_LOOK)!;
}

/**
 * The Look a page actually renders: getLook, plus — for "Photo match" — the
 * scheme derived from `photoTone`, the header photo's colour (lib/photo-tone).
 * No tone (no photo, a logo or initials header, a photo that would not load)
 * leaves the Look's own fallback colours in place.
 */
export function resolveLook(id: string | null | undefined, photoTone: string | null | undefined): SwiftLinkLook {
  const look = getLook(id);
  if (!look.photoMatch || !isHex(photoTone)) return look;
  return lookFromTone(photoTone, look);
}

export function isFreeLook(id?: string | null): boolean {
  return (FREE_SWIFTLINK_LOOKS as readonly string[]).includes(id ?? "");
}

/** What a FREE page actually renders/stores: a free look survives, anything
 *  else (a Pro look after downgrade, junk) falls to the default. */
export function freeSafeLook(id?: string | null): string {
  return isFreeLook(id) ? (id as string) : DEFAULT_SWIFTLINK_LOOK;
}

/** rgba() of a hex color — the sticky mini-header's translucent bar. */
export function hexAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ── Social icon styling (hoo.be-informed) ───────────────────────────────────
//
// hoo.be lets a page make its social chips one uniform color or keep brand
// colors, and vary their shape. Same here: SHAPE × FILL, chosen in "Social
// design" next to the Look. Both are Pro fine-tuning (they live in
// LINK_STYLE_KEYS, stripped for Free at create and gated at render), so Free
// pages keep the stock brand-colored circles.

export type IconShape = "circle" | "squircle" | "square";
export type IconFill = "brand" | "accent" | "mono";

export const ICON_SHAPES: { id: IconShape; name: string }[] = [
  { id: "circle", name: "Circle" },
  { id: "squircle", name: "Squircle" },
  { id: "square", name: "Square" },
];

export const ICON_FILLS: { id: IconFill; name: string; hint: string }[] = [
  { id: "brand", name: "Brand", hint: "Each platform in its own color" },
  { id: "accent", name: "Accent", hint: "All chips in your Look's accent" },
  { id: "mono", name: "Mono", hint: "Quiet neutral chips" },
];

export const DEFAULT_ICON_SHAPE: IconShape = "circle";
export const DEFAULT_ICON_FILL: IconFill = "brand";

export function normalizeIconShape(v?: string | null): IconShape {
  return v === "squircle" || v === "square" ? v : DEFAULT_ICON_SHAPE;
}
export function normalizeIconFill(v?: string | null): IconFill {
  return v === "accent" || v === "mono" ? v : DEFAULT_ICON_FILL;
}

// ── Page header style (Linktree-informed, 2026-09-01) ───────────────────────
//
// "Cover" is the original link.me-style hero — a full square photo the sheet
// slides up over. "Banner" is the same treatment at a third of the screen.
// "Avatar" is the compact professional register (the Linktree norm): a small
// circle sitting on the sheet. "None" drops the header entirely — the whole
// page is one flat surface leading with the name. Structural, like the Look
// picker and the card-link toggle, so it's EVERY plan — not a Pro key.

export type HeroStyle = "cover" | "banner" | "avatar" | "none";

export const HERO_STYLES: { id: HeroStyle; name: string; hint: string }[] = [
  { id: "cover", name: "Cover photo", hint: "Your photo fills the top of the page — the classic" },
  { id: "banner", name: "Short banner", hint: "The cover at a third of the screen" },
  { id: "avatar", name: "Compact circle", hint: "A small round photo — more room for your links" },
  { id: "none", name: "No header", hint: "One flat page that leads with your name" },
];

export const DEFAULT_HERO_STYLE: HeroStyle = "cover";

export function normalizeHeroStyle(v?: string | null): HeroStyle {
  return v === "banner" || v === "avatar" || v === "none" ? v : DEFAULT_HERO_STYLE;
}

// What the header SHOWS. "auto" is the original fallback chain — headshot,
// then logo, then initials — and the explicit picks fall back down the same
// chain when the chosen asset doesn't exist (a card with no logo must never
// render an empty header). "custom" (owner request 2026-09-02) is a photo
// uploaded just for this header (customization.linkHeroImage) — a background
// of the owner's choice; with no image uploaded yet it falls down the auto
// chain like every other missing asset. Every plan, same rule as the style
// above.

export type HeroContent = "auto" | "photo" | "logo" | "initials" | "custom";

export const HERO_CONTENTS: { id: HeroContent; name: string; hint: string }[] = [
  { id: "auto", name: "Auto", hint: "Headshot, else logo, else initials" },
  { id: "photo", name: "Headshot", hint: "Always your photo" },
  { id: "logo", name: "Logo", hint: "Always your company logo" },
  { id: "initials", name: "Initials", hint: "Just your initials" },
  { id: "custom", name: "Upload photo or video", hint: "A photo or short video you upload just for this header" },
];

export const DEFAULT_HERO_CONTENT: HeroContent = "auto";

export function normalizeHeroContent(v?: string | null): HeroContent {
  return v === "photo" || v === "logo" || v === "initials" || v === "custom" ? v : DEFAULT_HERO_CONTENT;
}

export type HeroSource = { kind: "photo" | "video" | "logo" | "initials"; url: string | null };

/**
 * What the page header SHOWS — the owner's explicit pick, falling down the auto
 * chain (headshot → logo → initials) whenever the picked asset doesn't exist,
 * so the header can never render empty. One function, because the public page
 * (to sample the photo's colour on the server) and SwiftLinkProfile (to render
 * it) must never disagree about which picture that is.
 *
 * "custom" is an owner-uploaded header photo (https-only — the URL comes
 * through client-writable customization, so anything else falls through to
 * the auto chain rather than rendering an arbitrary scheme on a public page).
 */
export function resolveHero(
  style: { heroContent?: string; heroImage?: string; heroMediaType?: string } | undefined,
  photoUrl: string | null,
  logoUrl: string | null,
): HeroSource {
  const content = normalizeHeroContent(style?.heroContent);
  const custom = content === "custom" && style?.heroImage && /^https:\/\//.test(style.heroImage) ? style.heroImage : null;
  if (custom) return { kind: style?.heroMediaType === "video" ? "video" : "photo", url: custom };
  if (content === "initials") return { kind: "initials", url: null };
  if (content === "photo" && photoUrl) return { kind: "photo", url: photoUrl };
  if (content === "logo" && logoUrl) return { kind: "logo", url: logoUrl };
  if (photoUrl) return { kind: "photo", url: photoUrl };
  if (logoUrl) return { kind: "logo", url: logoUrl };
  return { kind: "initials", url: null };
}

// ── Link ROW style (Linktree-informed, 2026-09-01) ──────────────────────────
//
// Styles the COMPACT link rows only — it composes with the per-link sizes the
// owner picks on the Socials tab (auto/featured/grid/compact): featured and
// grid always keep their rich image/video previews, and this decides how the
// plain rows among them look. "tile" (the stored default id, kept for data
// stability) is the stock translucent row; "solid"/"outline" are Linktree-
// style rows — filled with (or outlined in) the button color, which defaults
// to the Look's accent and can be overridden with linkButtonColor. Pro
// fine-tuning, same plan line as the icon styling: both keys live in
// LINK_STYLE_KEYS, so Free stores/renders neither.

export type ButtonStyle = "tile" | "solid" | "outline";

export const BUTTON_STYLES: { id: ButtonStyle; name: string; hint: string }[] = [
  { id: "tile", name: "Standard", hint: "The stock translucent rows" },
  { id: "solid", name: "Solid", hint: "Solid color rows" },
  { id: "outline", name: "Outline", hint: "Bordered rows" },
];

export const DEFAULT_BUTTON_STYLE: ButtonStyle = "tile";

export function normalizeButtonStyle(v?: string | null): ButtonStyle {
  return v === "solid" || v === "outline" ? v : DEFAULT_BUTTON_STYLE;
}

// ── Page BACKGROUND media (Linktree-informed, 2026-09-10) ───────────────────
//
// A photo or a short video behind the WHOLE page, instead of a flat colour.
// Owner reference: linktr.ee/kelsieblevinsrealestate — a looping video filling
// the page, a small round avatar over it, and frosted translucent link rows.
//
// EVERY HEADER (owner, 2026-09-17: "under Background & text … the user has the
// option to add a photo or video"). It used to be tied to the compact-circle
// and no-header layouts, so the option vanished under a cover photo or banner
// and people could not find it. With a cover or banner the header photo now
// DISSOLVES into the background media (SwiftLinkProfile masks the hero's own
// alpha, the same technique the Glass looks use), so the two never meet at a
// hard line.
//
// Pro fine-tuning — all four keys live in LINK_STYLE_KEYS, so a Free page
// stores none of them and renders none of them.

export type PageMediaType = "image" | "video";

export function normalizePageMediaType(v?: string | null): PageMediaType {
  return v === "video" ? "video" : "image";
}

/**
 * The background URL, or null.
 *
 * https ONLY. This value arrives through client-writable customization and is
 * printed into an `src` on a PUBLIC page, so anything else — a `javascript:`
 * URL, a `data:` document, a plain http asset that would break the padlock —
 * must not render. Same rule the header photo (linkHeroImage) already applies.
 */
export function pageMediaUrl(v?: string | null): string | null {
  return typeof v === "string" && /^https:\/\//.test(v) ? v : null;
}

/** How dark the scrim over the background media is, as a percentage. */
export const DEFAULT_PAGE_DIM = 35;
export const MAX_PAGE_DIM = 80;

/**
 * The scrim, 0-80%.
 *
 * It is what makes text legible over an arbitrary photo, so it is clamped
 * rather than trusted: a stored 500, a negative, a NaN from a hand-edited
 * payload must all land somewhere sane instead of blanking the page or
 * removing the only contrast the text has.
 */
export function normalizePageDim(v?: number | string | null): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_PAGE_DIM;
  return Math.min(MAX_PAGE_DIM, Math.max(0, Math.round(n)));
}

/**
 * The base colour behind the background media.
 *
 * Deliberately a FIXED near-black rather than the Look's sheet or the owner's
 * custom page colour. Over media the page's text is forced to white (a light
 * Look's near-black text is invisible on a dark photo), and this colour is
 * what shows in the seconds before the photo decodes, or forever if it 404s.
 * Pairing white text with a light sheet there would produce an unreadable
 * page, so the one surface that can appear underneath is pinned dark.
 */
export const PAGE_MEDIA_BASE = "#0D0D10";

// ── The tile a link falls back to when it has no picture ─────────────────────
//
// Until now that fallback was one of four hard-coded gradients, picked by the
// link's index: indigo→purple→pink, cyan→blue→indigo, amber→red→pink,
// emerald→teal→sky. So a page built on the warm "Sand" Look, whose owner never
// chose a single one of those colours, got a purple tile, a blue tile, a red
// tile and a green tile — four saturated hues that belonged to nobody, sitting
// directly under a name and a headshot. It is the single loudest thing that
// made a real person's page look generated rather than designed, and it made
// the marketing hero look it too, because the hero mirrors this exact code.
//
// A tile with no picture now takes its colour from the page's own Look. The
// four tiles are four steps of ONE brand-derived ramp rather than four
// unrelated colours, so a wall of them reads as a set. The variation is real
// but small: enough that a 2x2 grid is not four identical blocks, never enough
// to leave the palette.

/** `a` mixed into `b` at `t` (0 = all b, 1 = all a). Both must be #rrggbb. */
function mixHex(a: string, b: string, t: number): string {
  const pa = /^#([0-9a-fA-F]{6})$/.exec(a);
  const pb = /^#([0-9a-fA-F]{6})$/.exec(b);
  if (!pa || !pb) return a;
  const na = parseInt(pa[1], 16);
  const nb = parseInt(pb[1], 16);
  const ch = (sh: number) => {
    const va = (na >> sh) & 255;
    const vb = (nb >> sh) & 255;
    return Math.round(vb + (va - vb) * t);
  };
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance, the WCAG definition. */
function luminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
}

/** Is this colour light enough to need dark text on top? */
export function isLightSurface(hex: string): boolean {
  return luminance(hex) > 0.42;
}

// How much accent goes into each tile, cycling every four. Deliberately not a
// straight ramp — 1st and 3rd sit close, 2nd and 4th push further — so a 2x2
// grid never reads as a gradient someone forgot to finish.
const TILE_MIX = [0.34, 0.62, 0.46, 0.78];

export type FallbackTile = {
  /** Ready for `style={{ background }}`. */
  background: string;
  /** True when the tile is light enough that its label must be dark. */
  light: boolean;
};

/**
 * The branded stand-in for a link tile with no image.
 *
 * Takes just the two colours it needs rather than a whole Look, so the live
 * renderer — which is handed `tileBg` and `accent` as separate props — and the
 * marketing mirror, which holds the Look itself, can both call it. The two gradient stops are the same mix nudged apart in lightness,
 * which gives the tile a soft sheen instead of a flat fill — a flat block at
 * this size looks like a missing image, and a sheen looks like a surface.
 */
export function fallbackTile(look: { tile: string; accent: string }, index: number): FallbackTile {
  const t = TILE_MIX[((index % TILE_MIX.length) + TILE_MIX.length) % TILE_MIX.length];
  const base = mixHex(look.accent, look.tile, t);
  // Push the top stop toward white and the bottom toward black on a dark tile;
  // the reverse on a light one, so the sheen always falls the same way.
  const light = isLightSurface(base);
  const top = mixHex(light ? "#FFFFFF" : "#FFFFFF", base, light ? 0.34 : 0.14);
  const bottom = mixHex("#000000", base, light ? 0.06 : 0.16);
  return {
    background: `linear-gradient(145deg, ${top} 0%, ${base} 52%, ${bottom} 100%)`,
    light,
  };
}
