// ── Card finishes: the material laid over the panel colour ──────────────────
//
// A card's branding panel could be a colour or a two-stop gradient, and that
// was the whole vocabulary. A FINISH is a material composed OVER whatever
// colour the owner already picked, so it multiplies with the six templates and
// every colour instead of being another list of presets to scroll.
//
// PAINTED, NEVER BLURRED. Swift Links does its glass with `backdrop-filter`,
// which is correct there — a Swift Links page only ever exists in a browser.
// A CARD DOES NOT. The same markup is also:
//
//   • rasterised to PNG for the download and share image  (html-to-image)
//   • drawn into link-preview images                      (next/og · satori)
//   • pasted into email signatures                        (mail clients)
//
// `backdrop-filter` renders in none of those. Port the Swift Links glass across
// and you ship a card that looks right on screen and wrong in every exported
// form. So "Frosted" below is a painted sheet — layered gradients that composite
// to the same look and survive every one of those renderers.
//
// WHY THIS REACHES ALL SIX TEMPLATES WITH NO TEMPLATE CHANGES: each of them
// resolves its panel as `style.bgColor ?? <its own default>` and hands that to
// one `background:`. Composing here, inside templateStyle(), means ClassicPro,
// ModernBold, PhotoFirst, LocalBusiness, LuxuryMinimal and LogoFirst — and every
// one of the seventeen places that render a template — pick it up for free.

export type FinishFamily = "plain" | "light" | "material";

export type CardFinish = {
  id: string;
  name: string;
  family: FinishFamily;
  /** One line, shown under the swatch in the editor. */
  blurb: string;
  /** Free accounts may pick this one. The rest come with Pro. */
  free: boolean;
  /**
   * This finish LIGHTENS the panel, so a white name can disappear into it.
   * The editor uses this to warn, and never to silently rewrite a colour the
   * owner chose — see TemplateStyleControls.
   */
  lightens?: boolean;
  /**
   * CSS background layers painted ABOVE the panel colour, topmost first.
   * Every layer must be a gradient — no `backdrop-filter`, no `filter`, no
   * `mix-blend-mode`; see the note at the top of this file.
   */
  layers: string[];
};

export const FINISH_FAMILIES: { id: FinishFamily; name: string; blurb: string }[] = [
  { id: "plain",    name: "Plain",    blurb: "The color on its own." },
  { id: "light",    name: "Light",    blurb: "How light falls across the card." },
  { id: "material", name: "Material", blurb: "What the card feels like it is made of." },
];

export const CARD_FINISHES: CardFinish[] = [
  {
    id: "flat", name: "Flat", family: "plain", free: true,
    blurb: "The color on its own, the way every card renders today.",
    layers: [],
  },

  // ── LIGHT — the surface is unchanged, the lighting is not ──────────────────
  {
    id: "sheen", name: "Sheen", family: "light", free: true,
    blurb: "A soft band of light across the panel, like satin stock catching a lamp.",
    layers: ["linear-gradient(103deg, rgba(255,255,255,0) 26%, rgba(255,255,255,0.13) 44%, rgba(255,255,255,0) 62%)"],
  },
  {
    id: "halo", name: "Halo", family: "light", free: true,
    blurb: "A glow behind your logo, so the mark sits in its own pool of light.",
    layers: ["radial-gradient(120% 88% at 50% 26%, rgba(255,255,255,0.20), rgba(255,255,255,0) 62%)"],
  },
  {
    id: "frosted", name: "Frosted", family: "light", free: false, lightens: true,
    blurb: "Color behind a milky sheet with a bright top edge. Glass, painted rather than blurred.",
    layers: [
      "linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.13) 34%, rgba(255,255,255,0.07) 100%)",
      "radial-gradient(130% 80% at 22% 0%, rgba(255,255,255,0.26), rgba(255,255,255,0) 58%)",
    ],
  },

  // ── MATERIAL — the card reads as a substance ──────────────────────────────
  {
    id: "brushed", name: "Brushed", family: "material", free: false,
    blurb: "Fine directional grain with a diagonal highlight, like anodized metal.",
    layers: [
      "repeating-linear-gradient(96deg, rgba(255,255,255,0.055) 0 1px, rgba(0,0,0,0.05) 1px 3px)",
      "linear-gradient(102deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 38%, rgba(0,0,0,0.14) 100%)",
    ],
  },
  {
    id: "carbon", name: "Carbon", family: "material", free: false,
    blurb: "A tight woven twill. Reads technical without shouting.",
    layers: [
      "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 2px, rgba(0,0,0,0.09) 2px 4px)",
      "repeating-linear-gradient(-45deg, rgba(255,255,255,0.045) 0 2px, rgba(0,0,0,0.075) 2px 4px)",
    ],
  },
  {
    id: "linen", name: "Linen", family: "material", free: false,
    blurb: "A crosshatch weave, the closest thing to textured card stock.",
    layers: [
      "repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 3px)",
      "repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 3px)",
    ],
  },
  {
    id: "gilt", name: "Gilt edge", family: "material", free: false,
    blurb: "A foil rule down the edge with a warm sheen. The premium-stock move.",
    layers: [
      "linear-gradient(90deg, rgba(212,175,122,0.95) 0 2.5px, rgba(212,175,122,0) 2.5px)",
      "linear-gradient(108deg, rgba(212,175,122,0.16) 0%, rgba(212,175,122,0) 42%)",
    ],
  },
];

export const DEFAULT_FINISH = "flat";

/** The finish for an id, falling back to Flat for unknown or unset values. */
export function getFinish(id?: string | null): CardFinish {
  return CARD_FINISHES.find((f) => f.id === id) ?? CARD_FINISHES[0];
}

export function isFreeFinish(id?: string | null): boolean {
  return getFinish(id).free;
}

/** Finish ids a Free account may keep. plan.ts snaps anything else back to Flat. */
export const FREE_FINISH_IDS = CARD_FINISHES.filter((f) => f.free).map((f) => f.id);

export const PANEL_DIM_DEFAULT = 0.32;

/**
 * A media URL that is safe to drop inside a CSS `url("…")`.
 *
 * The value reaches here from `customization`, which is owner-supplied JSON, and
 * lands inside a style attribute. A url() token ends at the first unescaped
 * quote, so `"); background: url(evil` would close the declaration and let the
 * rest be read as new CSS. Only same-origin paths and plain http(s) URLs are
 * allowed through, and the quote/backslash/newline characters that could end the
 * token are escaped rather than stripped, so a legitimate filename containing
 * one still resolves.
 */
export function cssUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  // Same-origin path, or a plain http(s) URL. Rejects javascript:, data: and
  // every other scheme outright rather than trying to sanitise one.
  if (!/^(https?:\/\/|\/)/i.test(url)) return null;
  // Control characters, as an explicit escape rather than the literal range:
  // a NUL or newline in source renders as a blank in most editors, so it reads
  // like a typo and invites someone to "fix" it. One smuggled into the value
  // could end the url() token early and let the rest be parsed as fresh CSS.
  // Real URLs percent-encode them, so nothing legitimate is refused.
  if (/[\x00-\x1f]/.test(url)) return null;
  return url.replace(/([\\"])/g, "\\$1");
}

export type PanelMedia = {
  url?: string | null;
  /** "video" still paints its poster here — CSS cannot play one. */
  poster?: string | null;
  /** How far to darken the media so a name stays readable, 0-0.85. */
  dim?: number | null;
};

function clampDim(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return PANEL_DIM_DEFAULT;
  return Math.min(0.85, Math.max(0, n));
}

/**
 * The finished `background` for a card's branding panel.
 *
 * Layer order, topmost first: the finish, then the scrim, then the photo, then
 * the owner's colour. The colour stays LAST so it is still the background-color
 * of the shorthand — which is what keeps `isDarkBg()` able to find the first
 * `#rrggbb` and decide whether the name needs to be light. Every finish layer
 * is deliberately written in rgba(), never hex, so it can never be mistaken for
 * the panel colour by that check.
 *
 * `base` is whatever the template resolved: a hex, or the template's own
 * gradient default. Passing an empty finish and no media returns it untouched,
 * so a card saved before any of this existed renders exactly as it did.
 */
export function composePanelBackground(
  base: string,
  finishId?: string | null,
  media?: PanelMedia | null,
): string {
  const layers: string[] = [...getFinish(finishId).layers];

  const rawMedia = media?.poster || media?.url;
  const safe = rawMedia ? cssUrl(rawMedia) : null;
  if (safe) {
    const dim = clampDim(media?.dim);
    if (dim > 0) layers.push(`linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim}))`);
    layers.push(`url("${safe}") center / cover no-repeat`);
  }

  if (!layers.length) return base;
  return [...layers, base].join(", ");
}
