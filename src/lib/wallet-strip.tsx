import { ImageResponse } from "next/og";
import type { ResolvedCardMeta } from "@/lib/resolve-card";
import {
  passPalette, toAppleRgb, withAlpha, mix, type PassPalette, type SampledSurface,
} from "@/lib/wallet-palette";
import { fitLine } from "@/lib/wallet-fit";
import {
  BAND_W, BAND_H, PAD_LEFT, PAD_RIGHT, IMG, GAP,
  NAME_BASE, NAME_MIN, TITLE_BASE, TITLE_MIN, COMPANY_BASE, COMPANY_MIN,
  IDENTITY_W, CONTENT_SCALE, bandVariant, initialsOf, surfaceLayers,
} from "@/lib/wallet-band";

// Re-exported: this module was the original home of the band's shape, and
// callers (and tests) still reach for it here.
export { bandVariant } from "@/lib/wallet-band";

// ── The Wallet pass band ────────────────────────────────────────────────────
//
// Apple gives a storeCard exactly one canvas — a 375×144pt strip — plus a flat
// colour for everything under it. This module composes that band.
//
// It does NOT put a picture of the card in it. That was the previous design and
// it is what made the pass look empty: a 1.75:1 card scaled to fit a 3.05:1
// band is 57% of the width, so the rest of the band was grey ground, and the
// pass body below it was blank. The band now runs edge to edge and is composed
// from the card's PARTS — its panel exactly as the card paints it (colour,
// finish such as Linen, panel photo, the template's own texture and accent
// bar), its mark or headshot, and its name, title and company in the colours
// and case the template sets them in — sized for this shape rather than
// shrunk into it. What "the card's panel" means per template is decided once,
// in wallet-palette.
//
// Two rules make it work for every card the product can produce:
//
//   1. ONE layout, one geometry. Every band leads with the same 241px square —
//      headshot, logo panel or monogram — so the text column starts at the same
//      x and is measured against the same box on every card in the wallet. Six
//      bespoke per-template layouts each had their own overflow edges, and a
//      custom card fitted none of them. What survives at this size is colour
//      and typographic voice, which arrive from wallet-palette as data.
//   2. No CONTENT is positioned absolutely (only the painted surface layers
//      under it are), and every string goes through fitLine(), which VERIFIES
//      its layout rather than estimating it — the size it returns is one the
//      text has actually been wrapped at. A long company name cannot reach the
//      edge, and a long name cannot take a third line, no matter what else is
//      on the band.
//
// Geometry: rendered once at @3x (1125×432) with Satori, downscaled with sharp
// for @2x/@1x — the same next/og + Node-runtime combination the per-card OG
// image already uses in production. The size is not a preference; see H below.

type Meta = NonNullable<ResolvedCardMeta>;

export type PassStrips = { x1: Buffer; x2: Buffer; x3: Buffer };

/** The pass chrome colours, in the rgb() form pass.json wants. */
export type PassTheme = {
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
};

export type WalletDesign = {
  theme: PassTheme;
  strips: PassStrips;
  palette: PassPalette;
  /** A remote photo/logo the card has could not be loaded — the strip shows
   *  initials instead. The pass still builds, but must not be fingerprinted
   *  as final (see api/wallet/pass). */
  degraded: boolean;
};

// ── Canvas ──────────────────────────────────────────────────────────────────
//
// Every measurement below now lives in lib/wallet-band.ts, because the
// marketing surfaces draw this same band in the DOM and two renderers for one
// design only stay identical if they read the same numbers. The reasoning for
// each value moved with it; the short version:
//
//   BAND_H is 432 (= 144pt @3x), NOT 123pt. A storeCard's strip slot is 123pt
//   only when the pass carries a header field; this pass has none, so the slot
//   is the full 144pt and Wallet aspect-FILLS it. A 123-tall image gets scaled
//   up to cover, which cropped 32pt off each side — and the left edge is where
//   the headshot, logo and monogram live.
//
//   PAD_LEFT > PAD_RIGHT on purpose: Wallet masks the strip to the pass's
//   rounded corners, and the leading edge is the one carrying the mark.

const W = BAND_W;
const H = BAND_H;

// ── Remote images ───────────────────────────────────────────────────────────

/**
 * Only fetch card images from hosts our own upload flows write to. The URL
 * comes from a DB column the card owner controls and this fetch runs
 * server-side — without the allowlist it is an SSRF primitive (point logo_url
 * at an internal host and make the server call it). Anything else falls back
 * to initials.
 */
function allowedImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    const ok = new Set<string>();
    for (const env of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"]) {
      if (env) try { ok.add(new URL(env).hostname.toLowerCase()); } catch { /* ignore */ }
    }
    return ok.has(host);
  } catch {
    return false;
  }
}

// A remote image we were supposed to draw but couldn't (timeout, 5xx, bad
// bytes). Tracked per render so the pass route can refuse to fingerprint a
// pass that came out with initials where a photo belongs — otherwise that
// degraded pass carried the SAME content hash as the good one and no update
// ever re-delivered it.
let imageFailures = 0;
function isRemote(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//.test(url) && allowedImageHost(url);
}

async function fetchImage(url: string | null, attempt = 1): Promise<{ buf: Buffer; type: string } | null> {
  if (!url || !/^https?:\/\//.test(url) || !allowedImageHost(url)) return null;
  try {
    const ctrl = new AbortController();
    // First try is quick; the retry gives a slow CDN a real chance before the
    // pass silently falls back to initials.
    const t = setTimeout(() => ctrl.abort(), attempt === 1 ? 2500 : 6000);
    // redirect:"error" — storage URLs never redirect, and following one would
    // let an allowlisted URL bounce the request to an arbitrary host.
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", redirect: "error" }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/png";
    if (!/^image\//.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 100 || buf.byteLength > 6_000_000) return null;
    return { buf, type };
  } catch (e) {
    if (attempt === 1) return fetchImage(url, 2);
    console.warn("[wallet] image fetch failed after retry:", url.slice(0, 120), String(e).slice(0, 120));
    return null;
  }
}

const dataUri = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

async function loadBuffer(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  if (url.startsWith("data:")) {
    const b64 = url.split(",")[1];
    return b64 ? Buffer.from(b64, "base64") : null;
  }
  const got = await fetchImage(url);
  if (!got) imageFailures++;
  return got?.buf ?? null;
}

/**
 * The headshot, cropped to an exact square by sharp before Satori sees it.
 *
 * Not `objectFit: cover` on the img. That leans on the renderer to crop, and
 * when a renderer doesn't implement it the image is SCALED instead — a 3:4
 * portrait squashed into a circle, which is precisely the "headshots are
 * uneven" complaint. Cropping here means the element is fed a square and there
 * is nothing left to get wrong.
 */
async function preparePhoto(url: string | null, size: number): Promise<string | null> {
  const buf = await loadBuffer(url);
  if (!buf) return null;
  try {
    const sharp = (await import("sharp")).default;
    return dataUri(await sharp(buf).resize(size, size, { fit: "cover" }).png().toBuffer());
  } catch {
    return null;
  }
}

/**
 * The logo, measured and sized to its OWN aspect ratio inside the box.
 *
 * Brand marks are wordmarks, banners and squares in equal measure, and the
 * element is given explicit width and height derived from the real file rather
 * than a square it has to fit itself into. A 4:1 wordmark now renders as a 4:1
 * wordmark — no distortion, no crop, whatever was uploaded.
 */
async function prepareLogo(
  url: string | null, boxW: number, boxH: number,
): Promise<{ src: string; w: number; h: number } | null> {
  const buf = await loadBuffer(url);
  if (!buf) return null;
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const ratio = meta.width / meta.height;
    let w = boxW;
    let h = Math.round(boxW / ratio);
    if (h > boxH) { h = boxH; w = Math.round(boxH * ratio); }
    w = Math.max(1, w); h = Math.max(1, h);
    const out = await sharp(buf)
      .resize(w, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return { src: dataUri(out), w, h };
  } catch {
    return null;
  }
}

/**
 * The card's panel photo, cover-cropped to the band by sharp — the same
 * `center / cover` the card's CSS asks for, done before Satori sees it for
 * the reason preparePhoto gives.
 */
async function prepareMedia(url: string | null, w: number, h: number): Promise<string | null> {
  const buf = await loadBuffer(url);
  if (!buf) return null;
  try {
    const sharp = (await import("sharp")).default;
    return dataUri(await sharp(buf).resize(w, h, { fit: "cover", position: "centre" }).png().toBuffer());
  } catch {
    return null;
  }
}

/**
 * The surface colour of a design-transfer card, read off the card itself.
 *
 * A face-image card has no colour fields to copy — the design only exists as
 * pixels — so the pass samples the dominant colour and builds a gentle ramp
 * around it. The image is never shown on the band: it is a 1.75:1 card face,
 * and cover-cropping one into a 3.05:1 band cuts the owner's own information
 * off the top and bottom.
 */
export async function sampleSurface(buf: Buffer): Promise<SampledSurface | null> {
  try {
    const sharp = (await import("sharp")).default;
    const { dominant } = await sharp(buf).stats();
    if (!dominant) return null;
    const hex = `#${[dominant.r, dominant.g, dominant.b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
    return { top: mix(hex, "#ffffff", 0.05), bottom: mix(hex, "#000000", 0.12) };
  } catch {
    return null;
  }
}

// ── The band ────────────────────────────────────────────────────────────────

type Logo = { src: string; w: number; h: number };

/** A card design-px measurement drawn with the type, at @3x. */
const cpx = (designPx: number) => Math.round(designPx * CONTENT_SCALE * 100) / 100;

/**
 * The card's panel, painted from the one layer list both renderers share
 * (wallet-band surfaceLayers). Every box is absolutely positioned and they are
 * drawn in order, so the stack is the card's: colour, photo, scrim, finish,
 * template texture, then the template's own details.
 */
function Surface({ palette, media }: { palette: PassPalette; media: string | null }) {
  return (
    <>
      {surfaceLayers(palette.surface, W, H).map((layer, i) =>
        layer.kind === "media" ? (
          media ? (
            // Pre-cropped to exactly W×H by sharp — nothing for Satori to fit.
            // eslint-disable-next-line @next/next/no-img-element -- Satori, not the DOM
            <img key={i} src={media} alt="" width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }} />
          ) : null
        ) : (
          <div key={i} style={layer.style} />
        ),
      )}
    </>
  );
}

function Band({ meta, palette, photo, logo, media, surfaceOnly = false }: {
  meta: Meta; palette: PassPalette; photo: string | null; logo: Logo | null; media: string | null;
  /** Paint the surface alone — the tests' reference for "what is background". */
  surfaceOnly?: boolean;
}) {
  const { ink, inkMuted, accent, title: titleInk, voice, rule, nameShadow } = palette;
  const variant = bandVariant(palette.prefer, !!photo, !!logo);

  // One box on every pass: the lead square is always the same width, so a name
  // is measured against the same space no matter which card it belongs to.
  const box = IDENTITY_W(IMG);

  // The name gets two lines; nothing else does. It is the one string on the
  // band that must never be cut, and fitLine now VERIFIES the wrap rather than
  // budgeting for it, so two lines means two lines.
  const name = fitLine(meta.name || "SwiftCard", {
    box, base: NAME_BASE, min: NAME_MIN, uppercase: voice.caps, tracking: voice.tracking,
    maxLines: 2,
  });
  // A rule set before the title shares its line, so the title is measured
  // against what is left of the column.
  const titleRule = rule?.at === "before-title" ? cpx(rule.width) + cpx(6) : 0;
  const title = fitLine(meta.title, {
    box: box - titleRule, base: TITLE_BASE, min: TITLE_MIN,
    uppercase: voice.titleCaps, tracking: voice.titleTracking,
  });
  const company = fitLine(meta.company, {
    box, base: COMPANY_BASE, min: COMPANY_MIN,
    uppercase: voice.companyCaps, tracking: voice.companyTracking,
  });

  const shadow = nameShadow ? `0 ${cpx(nameShadow.y)}px ${cpx(nameShadow.blur)}px ${nameShadow.color}` : undefined;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden" }}>
      <Surface palette={palette} media={media} />

      {surfaceOnly ? null : (
        <div style={{
          position: "absolute", left: 0, top: 0, width: W, height: H,
          display: "flex", alignItems: "center",
          padding: `0 ${PAD_RIGHT}px 0 ${PAD_LEFT}px`, overflow: "hidden",
        }}>
          {variant === "portrait" ? (
            <Portrait url={photo} name={meta.name} ink={ink} accent={accent} />
          ) : (
            <Mark logo={logo} label={meta.company || meta.name} lead={palette.lead} />
          )}

          <div style={{ width: GAP, display: "flex", flex: "none" }} />

          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" }}>
            {/* The short accent rule the card sets over its name. Decoration,
                so it is the first thing to go when the name takes a second
                line — keeping it there is what pushed a three-part block past
                the band's usable height. */}
            {rule?.at === "above-name" && name.lines < 2 ? (
              <div style={{
                width: cpx(rule.width), height: cpx(rule.height), borderRadius: cpx(rule.height),
                background: rule.color, marginBottom: cpx(4), display: "flex",
              }} />
            ) : null}

            <div style={{
              fontSize: name.fontSize, letterSpacing: name.letterSpacing, fontWeight: voice.weight,
              color: ink, lineHeight: 1.08,
              ...(voice.caps ? { textTransform: "uppercase" as const } : {}),
              ...(shadow ? { textShadow: shadow } : {}),
            }}>{name.text}</div>

            {title.text ? (
              <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
                {rule?.at === "before-title" ? (
                  <div style={{
                    width: cpx(rule.width), height: Math.max(2, cpx(rule.height)),
                    background: rule.color, marginRight: cpx(6), display: "flex", flex: "none",
                  }} />
                ) : null}
                <div style={{
                  fontSize: title.fontSize, letterSpacing: title.letterSpacing, color: titleInk, fontWeight: 600,
                  lineHeight: 1.2,
                  ...(voice.titleCaps ? { textTransform: "uppercase" as const } : {}),
                }}>{title.text}</div>
              </div>
            ) : null}

            {company.text ? (
              <div style={{
                fontSize: company.fontSize, letterSpacing: company.letterSpacing, color: inkMuted, fontWeight: 600,
                marginTop: 6, lineHeight: 1.2,
                ...(voice.companyCaps ? { textTransform: "uppercase" as const } : {}),
              }}>{company.text}</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Portrait({ url, name, ink, accent }: { url: string | null; name: string | null; ink: string; accent: string }) {
  const ring = `6px solid ${withAlpha(accent, 0.75)}`;
  if (url) {
    // Already cropped square by sharp, so this is a straight scale — no
    // objectFit to honour and no way to end up with an oval face.
    // eslint-disable-next-line @next/next/no-img-element -- Satori, not the DOM
    return <img src={url} alt="" width={IMG} height={IMG} style={{ borderRadius: IMG, border: ring, flex: "none" }} />;
  }
  return (
    <div style={{
      width: IMG, height: IMG, borderRadius: IMG, border: ring, flex: "none",
      background: withAlpha(ink, 0.12), display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 86, fontWeight: 700, color: ink, letterSpacing: "0.01em",
    }}>{initialsOf(name)}</div>
  );
}

function Mark({ logo, label, lead }: { logo: Logo | null; label: string | null; lead: PassPalette["lead"] }) {
  // A panel, not a bare logo: brand marks arrive on every ground imaginable
  // (white PNGs, dark PNGs, transparent) and a translucent tile keeps all of
  // them legible without knowing which kind this one is. Its fill — or, on
  // Logo First, the hairline it gets instead — is the card's own.
  //
  // The panel is a fixed square on every card so the text column starts at the
  // same x in every pass — a panel that resized to each logo made the whole
  // wallet look ragged. The LOGO inside it keeps its own proportions.
  return (
    <div style={{
      width: IMG, height: IMG, borderRadius: 28, flex: "none",
      background: logo ? lead.tile : lead.monogram.background,
      ...(lead.edge ? { border: `3px solid ${lead.edge}` } : {}),
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    }}>
      {logo ? (
        // Explicit width and height, measured from the file by sharp — nothing
        // is left for the renderer to fit, so no mark is ever squashed.
        // eslint-disable-next-line @next/next/no-img-element -- Satori, not the DOM
        <img src={logo.src} alt="" width={logo.w} height={logo.h} />
      ) : (
        // The card's own monogram colours (Classic Pro's pale blue on its
        // accent tile, Local Business's amber on white). The default is ink on
        // a tint of the ink, which is guaranteed to separate; an accent can
        // legitimately be a close neighbour of the ground.
        <div style={{ fontSize: 88, fontWeight: 700, color: lead.monogram.color, letterSpacing: "0.04em", display: "flex" }}>
          {initialsOf(label)}
        </div>
      )}
    </div>
  );
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * The pass chrome: the card's DETAILS side. backgroundColor is the surface the
 * card sets its phone and email on, foregroundColor that text, labelColor the
 * colour of its contact icons.
 */
export function passThemeFrom(palette: PassPalette): PassTheme {
  return {
    backgroundColor: toAppleRgb(palette.body.background),
    foregroundColor: toAppleRgb(palette.body.value),
    labelColor: toAppleRgb(palette.body.label),
  };
}

/** Render the band at @3x, then downscale for @2x/@1x with sharp. */
export async function renderPassStrips(
  meta: Meta, palette: PassPalette, opts: { surfaceOnly?: boolean } = {},
): Promise<PassStrips & { degraded: boolean }> {
  const p: Meta = { ...meta };
  if (!(typeof p.name === "string" && p.name.trim())) p.name = "SwiftCard";
  // The mark is contained inside the panel's padded area; the headshot fills
  // its circle; the panel photo covers the band. All sized here, by sharp,
  // from the real files.
  const before = imageFailures;
  const mediaUrl = palette.surface.media?.url ?? null;
  const [photo, logo, media] = await Promise.all([
    preparePhoto(p.photoUrl, IMG),
    prepareLogo(p.logoUrl, IMG - 48, IMG - 48),
    prepareMedia(mediaUrl, W, H),
  ]);
  // Only a REMOTE image that failed to load counts; a card with no image at
  // all is drawn with initials (or its plain colour) by design and is final.
  const degraded = imageFailures > before && (isRemote(p.photoUrl) || isRemote(p.logoUrl) || isRemote(mediaUrl));

  const x3 = Buffer.from(
    await new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", fontFamily: "sans-serif" }}>
        <Band meta={p} palette={palette} photo={photo} logo={logo} media={media} surfaceOnly={opts.surfaceOnly} />
      </div>,
      { width: W, height: H }
    ).arrayBuffer()
  );

  const sharp = (await import("sharp")).default;
  const [x2, x1] = await Promise.all([
    sharp(x3).resize(750, 288).png().toBuffer(),
    sharp(x3).resize(375, 144).png().toBuffer(),
  ]);
  return { x1, x2, x3, degraded };
}

/**
 * The whole design for one card: palette, chrome, band.
 *
 * One entry point rather than the old three-tier cascade (stored capture →
 * per-template Satori strip → fixed navy pass). The cascade existed because
 * only a captured screenshot could represent a custom design; now that the
 * band is composed from the card's colours and parts, the same path serves
 * every card, and there is no tier where the pass silently stops matching.
 */
export async function buildWalletDesign(meta: Meta): Promise<WalletDesign> {
  // A design-transfer card's colours only exist as pixels — sample them. The
  // same goes for a copied card's artwork under a free design.
  let sampled: SampledSurface | null = null;
  const pixels = meta.custom?.faceImage ?? meta.custom?.bgImage;
  if (pixels) {
    const got = await fetchImage(pixels);
    if (got) sampled = await sampleSurface(got.buf);
  }

  const palette = passPalette(meta, sampled);
  const { degraded, ...strips } = await renderPassStrips(meta, palette);
  return { theme: passThemeFrom(palette), strips, palette, degraded };
}
