export type CardLink = {
  emoji?: string; // legacy — new links have no emoji (picker removed)
  label: string;
  url: string;
  /** Swift Links tile size (see lib/swiftlink-tiles). Absent = the legacy
   *  auto (renders as grid, odd one promoted); the picker now always writes one. */
  size?: "featured" | "grid" | "compact";
  /** Compact rows: "tile" (standard), "solid" or "outline". Set per link in
   *  Social design → Link buttons. Absent = the page-wide legacy setting. */
  rowStyle?: "tile" | "solid" | "outline";
  /** Featured/Grid tiles: an uploaded photo or short video shown as the
   *  tile's preview instead of the link's own. */
  media?: { url: string; type: "image" | "video" };
  /** Frosted glass for THIS link (Social design → Link buttons → Blur): a
   *  compact row turns translucent with a blur behind it; a Featured or Grid
   *  tile gets a frosted band under its title. Absent on a compact row = the
   *  page's older page-wide "Blur the link buttons" setting. Pro. */
  glass?: boolean;
  /** "header" = a section heading on the Swift Links page (label only, no
   *  destination — its url is ignored). Absent = an ordinary link. */
  kind?: "link" | "header";
};

export type CardTestimonial = {
  name: string;
  text: string;
};

export type CustomElementType = "field" | "text" | "logo" | "headshot" | "socials" | "social" | "qr" | "divider" | "shape";
export type CustomField = "name" | "title" | "company" | "phone" | "email" | "website" | "address" | "fax";
export type CustomSocial = "instagram" | "linkedin" | "twitter" | "tiktok" | "snapchat" | "youtube" | "facebook";

export type CustomElement = {
  id: string;
  type: CustomElementType;
  field?: CustomField;   // for type "field"
  text?: string;         // for type "text"
  social?: CustomSocial; // for type "social" (one platform: icon + handle)
  x: number;             // left, % of card width (0-100)
  y: number;             // top, % of card height (0-100)
  fontSize?: number;     // px (text/field/socials/social)
  color?: string;        // overrides layout text color
  bold?: boolean;        // text/field
  italic?: boolean;      // text/field
  size?: number;         // px (logo/headshot/qr)
  width?: number;        // px (divider)

  // ── Free design (AI design + its fine-tune editor, 2026-09-23) ─────────────
  // All optional, so a card saved by the previous positioned designer renders
  // exactly as before. Sizes stay in design px at the 460px card, like
  // fontSize/size above; positions stay in % of the card.
  /** Which point `x` names: the left edge (default), the centre, or the right edge. */
  align?: "left" | "center" | "right";
  /** This element's own font (a CSS stack); the card's font when absent. */
  font?: string;
  /** Font weight, 300-900. Wins over `bold`. */
  weight?: number;
  /** Uppercase text. */
  upper?: boolean;
  /** Letter spacing in em, -0.05 to 0.5. */
  tracking?: number;
  /** Contact fields (phone, email, website, address, fax): draw the matching icon before the text. */
  icon?: boolean;
  /** Headshot / logo frame. Headshots default to "circle", logos to "rounded". */
  frame?: "circle" | "rounded" | "square";
  /** type "shape": which shape. */
  shape?: "rect" | "circle";
  /** type "shape": width and height, % of the card's width and height. */
  w?: number;
  h?: number;
  /** type "shape": its fill — a colour or a gradient. */
  fill?: string;
  /** type "shape": corner radius, design px (rect only). */
  radius?: number;
  /** type "shape": outline colour and width (design px). */
  stroke?: string;
  strokeWidth?: number;
  /** 0.05-1. Shapes, and anything else that should sit back. */
  opacity?: number;
  /** Degrees, -60 to 60. Shapes only. */
  rotate?: number;
};

/** The choices an AI design was made from, so "Try another" can reuse them. */
export type AiDesignBrief = {
  theme: string;
  colors: string[];
  headshot: boolean;
  logo: boolean;
  /** How many designs have been generated from this brief; each one differs. */
  variant: number;
};

// ── Block layout (the current custom designer) ──────────────────────────────
// Blocks FLOW inside zones instead of floating at x/y. That is the whole reason
// a custom card can no longer overlap, clip a value, or drift between the editor
// and the published card: there is no arrangement that produces those, because
// nothing is positioned absolutely. Size comes from `emphasis`, never from a
// number the owner types, so it stays proportional to the card at any width.
export type CardZone = "left" | "right";
export type CardEmphasis = "hero" | "normal" | "quiet";
/** How the two zones sit relative to each other. */
export type CardSkeleton = "split" | "mirror" | "stacked";

export type CustomBlock = {
  id: string;
  type: CustomElementType;
  field?: CustomField;   // type "field"
  social?: CustomSocial; // type "social"
  text?: string;         // type "text"
  /** Off blocks stay in the list so turning one back on restores it in place. */
  on: boolean;
  zone: CardZone;
  emphasis: CardEmphasis;
  color?: string;
};

export type CustomLayout = {
  background: string;
  fontFamily: string;
  textColor: string;
  /** Icons, job title, hairlines. */
  accentColor?: string;
  /**
   * The side zone's own surface. Optional, and the reason a custom card can be
   * TWO-TONE — a coloured panel beside a light field, or a band across the top.
   * Without it, forking Classic Pro or Local Business could only ever be an
   * approximation, because their whole identity is the second surface.
   */
  panelBackground?: string;
  /** Text sitting ON the panel, when the panel's tone differs from the card's. */
  panelTextColor?: string;
  skeleton?: CardSkeleton;
  /** Present on every layout built by the current designer. */
  blocks?: CustomBlock[];
  /**
   * LEGACY absolute-positioned elements. Kept so a card saved by the old
   * designer still renders exactly as its owner left it; nothing new writes it.
   */
  elements: CustomElement[];
  /**
   * DESIGN TRANSFER: a finished card face, as an image. When set, the card IS
   * this picture (plus the live QR the renderer overlays) and the block layout
   * is dormant, not deleted — "Remove exact design" just clears this field and
   * the owner's blocks come back untouched. Written only by the approve step
   * of /api/design-transfer; normalizeCustomLayout drops anything that isn't
   * an https URL on our own storage/app hosts.
   */
  faceImage?: string;
  /**
   * COPY A CARD (2026-10-08): the copied design's ARTWORK — colours, panels,
   * shapes, borders, with every letter, logo and face left out — as an image
   * under a free design's elements. The owner's details sit on top as real
   * elements, so the copy is edited like any AI design (drag, resize,
   * restyle) and no letter is ever model-drawn. Same URL guard as faceImage.
   */
  bgImage?: string;
  /**
   * Set on a design made by AI design: the choices it was made from. Only
   * used by the designer ("Try another"); the card never reads it.
   */
  ai?: AiDesignBrief;
};

export type CardAddress = {
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  zip?: string;
};

export type PhoneLabel = "mobile" | "office";

export type CardPhone = {
  number: string;
  label: PhoneLabel;
  showOnCard: boolean;
};

export type CardCustomization = {
  accentColor?: string;
  font?: string;
  // ── Preset-template style overrides (Pro) ──────────────────────────────────
  // Optional. When absent, each template falls back to its own baked-in design,
  // so cards saved before these existed render exactly as before.
  bgColor?: string;      // primary branding surface (navy panel, dark bg, stripe…)
  textColor?: string;    // hero/name text color
  surfaceColor?: string; // the card's SECOND surface (info panel, body, photo panel)
                         // — only on templates that have one; see lib/template-style.ts
  fontFamily?: string;   // card typography (a full CSS font stack)
  // ── Finish + panel media (lib/card-finishes.ts) ───────────────────────────
  // The material laid over bgColor, and an optional photo or video behind it.
  // Composed into one `background` by panelBackground(), so all six templates
  // pick them up without knowing they exist. Absent = the card renders exactly
  // as it did before any of this.
  finish?: string;             // "sheen" | "brushed" | … ; absent/"flat" = plain
  panelMedia?: string;         // uploaded photo or video URL
  panelMediaType?: string;     // "image" | "video"
  panelMediaPoster?: string;   // a video's first frame — what non-browser surfaces paint
  panelDim?: number;           // scrim over the media, 0–0.85
  // Socials that live ONLY here, with no top-level CardData field: the save
  // writes them into customization and CustomCard reads them back out of it.
  // They were missing from this type, so CustomCard had to reach them through
  // a cast — which in turn hid them from the card builders, whose previewData
  // is typed as CardData. Result: the Custom template's live preview dropped
  // both icons while the saved card showed them. Declared here so the compiler
  // keeps preview and card in agreement.
  snapchat?: string;
  facebook?: string;
  youtube?: string;
  about?: string;
  address?: CardAddress;
  links?: CardLink[];
  testimonials?: CardTestimonial[];
  customLayout?: CustomLayout;
  phones?: CardPhone[];
  fax?: string;
  // How the company logo renders on the card. "auto" (and absent — every card
  // saved before this existed) keeps the classic behavior: fixed height, auto
  // width, so square/wide/banner marks each read naturally. "circle" wraps the
  // whole mark in a circular plate — nothing is ever cropped (owner spec).
  logoShape?: "auto" | "circle";
  // Photo First's headshot. Absent (every card saved before this existed) is
  // the full-height photo; "circle" puts it in a circle on the photo panel's
  // colour (surfaceColor). Every plan — a layout choice, not a Pro colour.
  photoShape?: "circle";
};

export type CardData = {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website?: string;
  address?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  tiktok?: string;
  snapchat?: string;
  about?: string;
  initials?: string;
  photoUrl?: string | null;
  logoUrl?: string | null;
  cardUrl?: string;
  customization?: CardCustomization;
};

// Socials are shown in the "Swift Links" section, not on the card design itself.
// Strip them from the data given to the standard templates.
export function withoutSocials(data: CardData): CardData {
  return { ...data, instagram: "", twitter: "", tiktok: "", linkedin: "", snapchat: "" };
}

export const SAMPLE_DATA: CardData = {
  name: "Alex Morgan",
  title: "Realtor®",
  company: "Coastline Realty",
  phone: "(415) 555-0188",
  email: "alex@coastlinerealty.com",
  website: "coastlinehomes.com",
  address: "1200 Ocean Ave, San Francisco, CA 94122",
  instagram: "@coastlinerealty",
  twitter: "@alexmorgan",
  tiktok: "@coastlinerealty",
  linkedin: "linkedin.com/in/alexmorgan",
  initials: "AM",
  photoUrl: null,
  logoUrl: null,
  cardUrl: "swiftcard.me/alexmorgan",
};

// The one demo headshot used across the marketing site. Deliberately NOT on
// SAMPLE_DATA: that object is spread into real users' live previews (see
// OnboardingForm), and inheriting a stock face there would show a signed-in
// person a stranger's photo on their own card.
export const DEMO_HEADSHOT = "/marketing/demo-girl.jpg";

// SAMPLE_DATA for marketing surfaces, where the demo person SHOULD have a face
// — notably Photo First, which is nothing but the photo.
export const SAMPLE_DATA_WITH_PHOTO: CardData = { ...SAMPLE_DATA, photoUrl: DEMO_HEADSHOT };

// MiniQR moved to ./MiniQR.tsx — this module is value-imported by ~30 files
// including several client homepage components, so it must stay free of the
// `qrcode` encoder (performance audit).
