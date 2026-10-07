"use client";

// Featured links — hoo.be-informed tile system driven by lib/swiftlink-tiles:
// - FEATURED: full-width 1.91:1 image card (video thumbnail or og:image) with
//   a dark bottom gradient, centered 2-line title, favicon circle top-left.
// - GRID: the same card at half width, packing in pairs; the odd tile out is
//   promoted to featured by layoutTiles so none ever sits beside a gap.
// - COMPACT: a slim row — icon circle, label, chevron — for plain links that
//   don't deserve a big image tile. Mode-aware so it reads on light Looks.
// - Links with no preview image get a branded gradient tile so they still
//   look designed; a glossy shine sweeps across image tiles (link.me's touch).
// - YouTube/Vimeo tiles play INLINE (paid): tapping play swaps the tile to an
//   autoplaying embed. Free renders every link compact and videos link out —
//   featured tiles, the grid and inline video are the advertised premium.

import { fallbackTile } from "@/lib/swiftlink-looks";
import { useEffect, useRef, useState } from "react";
import { videoThumbnail, videoEmbed } from "@/lib/video";
import { triggerSignupNudge } from "@/lib/nudge";
import { trackLinkClick } from "@/lib/track-link-click";
import { layoutTiles, resolveRowStyle, tileMedia, type SizedLink } from "@/lib/swiftlink-tiles";
import { faviconFor } from "@/lib/link-brand";
import { fetchLinkPreview, type LinkPreview as Preview } from "@/lib/link-preview-client";

// Fallback gradients for links with no preview image — picked by index so
// neighboring tiles differ.

// An uploaded tile video. autoplay+muted+loop+playsinline is what iOS Safari
// and the shell's WKWebView require for silent inline autoplay; the effect
// re-asserts muted (it must be true BEFORE play() for the policy to allow it)
// and nudges play() for the cases where the attribute alone is not enough —
// a tile that hydrates after the element was created, or a page restored from
// the back/forward cache. When autoplay is refused anyway (Low Power Mode),
// preload="auto" leaves the first frame showing, so the tile still has its
// image and the link still opens on tap.
function TileVideo({ src, onFail }: { src: string; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }, [src]);
  return (
    <video
      ref={ref}
      // #t=0.001: when autoplay is refused (Low Power Mode), WebKit still
      // paints the first frame of a seeked clip — a black tile otherwise.
      src={`${src}#t=0.001`}
      className="absolute inset-0 w-full h-full object-cover"
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
      // A clip that cannot play (deleted upload, unsupported codec) hands the
      // tile back to the link's own preview rather than leave a black box.
      onError={onFail}
    />
  );
}

// The picture a tile shows, in order: the owner's upload, the video's frame,
// the link's own preview. Each is tried as-is, then once through the
// same-origin /api/img-proxy (hotlink-protected or http-only images load
// there), and only then given up for the next — and with none left, the tile
// is the Look's designed fallback. A tile never shows a broken image.
type PictureStage = 1 | 2; // 1 = direct load failed, 2 = proxy failed too
function pickPicture(candidates: (string | null | undefined)[], failed: Record<string, PictureStage>): { src: string; key: string } | null {
  for (const c of candidates) {
    if (!c) continue;
    const stage = failed[c];
    if (!stage) return { src: c, key: c };
    if (stage === 1) return { src: `/api/img-proxy?url=${encodeURIComponent(c)}&w=1200`, key: c };
  }
  return null;
}

function fullHref(url: string) {
  const v = (url || "").trim();
  if (!v) return "#";
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  return `https://${v.replace(/^\/+/, "")}`;
}

// Perceived lightness of the button color — a custom light button needs dark
// text (the Look's accentText only vouches for the Look's own accent).
function isLightHex(hex: string): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 > 0.5;
}

export default function SwiftLinkButtons({
  links,
  tileBg = "#242526",
  mode = "dark",
  textColor = "#ffffff",
  paid = false,
  buttonStyle = "tile",
  glass = false,
  overMedia = false,
  buttonColor,
  accent = "#1D4ED8",
  accentText = "#FFFFFF",
  trackFor = null,
  trackSource = "swift_links",
  suppressTracking = false,
}: {
  links: SizedLink[];
  /** The Look's tile surface — behind a tile while its preview image loads. */
  tileBg?: string;
  /** The Look's mode — drives the compact row's neutral surface. */
  mode?: "light" | "dark";
  /** The Look's text color — compact row labels sit on the sheet itself. */
  textColor?: string;
  /** Paid owner: featured/grid tiles + inline video. Free (and the default,
   *  which fails CLOSED to the free rendering): every link compact. */
  paid?: boolean;
  /** "tile" (default) = the original tile system. "solid"/"outline" render
   *  EVERY link as a Linktree-style full-width row in the button color. */
  buttonStyle?: "tile" | "solid" | "outline";
  /** Frost the plain rows: translucent white over a blur of whatever is
   *  behind them. Only ever passed with page background media — over a flat
   *  colour a backdrop-filter has nothing to blur and the row would just look
   *  washed out. Set by the owner ("Blur the link buttons"). */
  glass?: boolean;
  /** There is a photo or video behind this list. Independent of `glass`:
   *  section headers sit directly on that media whether or not the ROWS are
   *  frosted, so they need the contrast either way. */
  overMedia?: boolean;
  /** Custom row color (Pro fine-tune) — defaults to the Look's accent. */
  buttonColor?: string;
  /** The Look's accent + its AA-tested text — the row color's default. */
  accent?: string;
  accentText?: string;
  /** The CARD SLUG these links belong to. Null (the default) in previews and the
   *  editor, where a tap must record nothing — this component renders inside the
   *  live designer, so tracking has to be opt-in rather than opt-out. */
  trackFor?: string | null;
  /** The page's own ?source= attribution, so a tap inherits the visit's channel. */
  trackSource?: string;
  /** Owner looking at their own page. */
  suppressTracking?: boolean;
}) {
  // Fetched preview (og:image + favicon fallback) by index. Compact rows use
  // the favicon; image tiles use both — one fetch serves every size.
  // Keyed by the link's URL, not its position: keyed by index, a reorder or a
  // delete showed one link's picture on another until a refetch landed.
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const requestedRef = useRef(new Set<string>());
  // Each link's icon is its site's logo from /api/link-icon (lib/link-brand
  // faviconFor) — known from the URL alone, so it starts loading with the page
  // instead of waiting on the preview scrape, and video links get theirs too
  // (they never asked for a preview, so their rows used to show a bare glyph).
  // A site with no logo answers 404 and the row keeps its emoji / link glyph.
  const [brokenFavicons, setBrokenFavicons] = useState<ReadonlySet<string>>(() => new Set());
  const markFaviconBroken = (u: string) => setBrokenFavicons((b) => (b.has(u) ? b : new Set(b).add(u)));
  // Icons that have actually painted. Until then the fallback shows, so a slow
  // icon is never an empty circle. Also adopted from the element on mount: this
  // list is server-rendered, and an icon that loads before hydration fires its
  // load event before React is listening (the card page's marks sat invisible
  // for exactly that reason — see LinkMark).
  const [loadedIcons, setLoadedIcons] = useState<ReadonlySet<string>>(() => new Set());
  const markIconLoaded = (u: string) => setLoadedIcons((s) => (s.has(u) ? s : new Set(s).add(u)));
  const adoptIcon = (u: string) => (el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) markIconLoaded(u);
  };
  // Tile pictures that failed, by their ORIGINAL url — see pickPicture.
  const [failedPictures, setFailedPictures] = useState<Record<string, PictureStage>>({});
  const failPicture = (u: string) =>
    setFailedPictures((f) => (f[u] === 2 ? f : { ...f, [u]: f[u] === 1 ? 2 : 1 }));
  const firstPreviewRunRef = useRef(true);
  // Index of the tile currently playing an inline video, if any.
  const [playing, setPlaying] = useState<number | null>(null);
  // Per-tile tone of the preview image's BOTTOM strip, where the title sits:
  // "light" flips the label dark-on-light, "dark" keeps white-on-dark (owner
  // request 2026-08-25 — a white title over a white website screenshot was
  // unreadable even through the scrim). Measured, not guessed: the image is
  // re-read through the same-origin /api/img-proxy so canvas sampling isn't
  // CORS-tainted, and the average luminance of the bottom 35% decides.
  // Unsampleable images (proxy miss, decode error) stay "dark" — the current
  // white-text + black-scrim treatment, which is the safer default.
  const [tileTone, setTileTone] = useState<Record<string, "light" | "dark">>({});

  // Sample every tile image once its URL is known (previews arrive async).
  // Runs in an effect — sampling flips state, which must never happen during
  // render.
  const sampledRef = useRef<Set<string>>(new Set());

  function sampleTone(imgUrl: string) {
    if (typeof window === "undefined") return;
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => {
      try {
        const w = 24, h = 10;
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        // Draw only the bottom 35% of the image — the strip under the title.
        ctx.drawImage(el, 0, el.naturalHeight * 0.65, el.naturalWidth, el.naturalHeight * 0.35, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let sum = 0;
        for (let p = 0; p < data.length; p += 4) {
          sum += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
        }
        const avg = sum / (data.length / 4);
        if (avg > 150) setTileTone((t) => ({ ...t, [imgUrl]: "light" }));
      } catch { /* tainted or decode failure — keep the dark default */ }
    };
    // 64px is plenty for a 32px brightness sample — and a fraction of the
    // full-size picture, which is already on screen from its own URL.
    el.src = `/api/img-proxy?url=${encodeURIComponent(imgUrl)}&w=64`;
  }

  useEffect(() => {
    links.forEach((link) => {
      if (link.kind === "header") return;
      const custom = tileMedia(link, paid);
      const url = custom?.type === "image" ? custom.url : videoThumbnail(link.url);
      if (url && !sampledRef.current.has(url)) { sampledRef.current.add(url); sampleTone(url); }
    });
    Object.values(previews).forEach((pv) => {
      if (pv?.image && !sampledRef.current.has(pv.image)) { sampledRef.current.add(pv.image); sampleTone(pv.image); }
    });
  }, [links, previews, paid]);

  // The URLs that need a scraped preview, as ONE string. The editors rebuild
  // the `links` array on every keystroke in any field, and this effect used to
  // depend on that array — so typing re-requested EVERY link's preview on every
  // key press, and typing a URL scraped "https://e", "https://ex", … from the
  // open web (bug audit 2026-10-06). Now each URL is fetched once, and edits
  // settle for 400ms first; the first render (a visitor opening the page) still
  // fetches immediately.
  const previewUrlsKey = links
    .filter((l) => l.kind !== "header" && !videoThumbnail(l.url))
    .map((l) => fullHref(l.url))
    .join("\n");
  useEffect(() => {
    const pending = (previewUrlsKey ? previewUrlsKey.split("\n") : []).filter((u) => {
      if (requestedRef.current.has(u)) return false;
      try { return new URL(u).hostname.includes("."); } catch { return false; }
    });
    const first = firstPreviewRunRef.current;
    firstPreviewRunRef.current = false;
    if (!pending.length) return;
    const timer = setTimeout(() => {
      for (const u of pending) {
        requestedRef.current.add(u);
        // Results are keyed by URL, so a late answer can only ever fill in its
        // own link — no cancellation needed when the list changes.
        fetchLinkPreview(u).then((d) => setPreviews((p) => ({ ...p, [u]: d })));
      }
    }, first ? 0 : 400);
    return () => clearTimeout(timer);
  }, [previewUrlsKey]);

  if (!links.length) return null;

  const tiles = layoutTiles(links, paid);
  const light = mode === "light";
  // Row styling COMPOSES with the per-link sizes: solid/outline restyle only
  // the COMPACT rows, while featured/grid keep their rich image/video previews
  // — the whole point of those sizes. (An earlier cut forced every link into
  // rows, which fought the owner's per-link picks; owner order 2026-09-01:
  // they must work together.) Since 2026-09-09 the row style is chosen PER
  // LINK in Social design (link.rowStyle); `buttonStyle` is the page-wide
  // setting older pages saved, and only fills in for links never touched.
  const btnColor = buttonColor || accent;
  // The Look's accentText is AA-tested against the Look's accent; a CUSTOM
  // color needs its text derived from its own lightness.
  const btnText = buttonColor ? (isLightHex(buttonColor) ? "#111827" : "#FFFFFF") : accentText;

  return (
    <div className="w-full mt-6 flex flex-wrap justify-between">
      {/* link.me's featured-link shine sweep */}
      <style>{`
        @keyframes sc-shine { 0% { transform: translateX(-160%) skewX(-18deg); } 55%, 100% { transform: translateX(320%) skewX(-18deg); } }
        .sc-shine { position: absolute; top: -10%; bottom: -10%; left: 0; width: 45%; pointer-events: none; z-index: 5;
          background: linear-gradient(105deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0) 100%);
          animation: sc-shine 3.8s ease-in-out infinite; }
      `}</style>

      {tiles.map(({ link, size }, i) => {
        // ── SECTION HEADER — a chapter title, not a destination ─────────────
        if (size === "header") {
          return (
            <p
              key={i}
              className="w-full text-left text-[0.6875rem] font-bold uppercase tracking-[0.14em] mt-4 mb-1.5 px-0.5"
              // A section header is the lightest-weight text on the page:
              // small, uppercase, and deliberately faint so it reads as a
              // divider rather than a link. On a flat sheet 0.55 is right. On
              // a photo it is the first thing to disappear — measured against
              // a bright sky patch, where it was barely legible — so over
              // media it comes up to 0.85 and keeps the sheet's text shadow.
              style={{ color: textColor, opacity: overMedia ? 0.85 : 0.55 }}
            >
              {link.emoji ? `${link.emoji} ` : ""}{link.label}
            </p>
          );
        }

        const href = fullHref(link.url);
        const videoThumb = videoThumbnail(link.url);
        const embed = videoEmbed(link.url);
        const pv = previews[href];
        const icon = faviconFor(link.url);
        const favicon = icon && !brokenFavicons.has(icon) ? icon : null;
        const iconShown = !!favicon && loadedIcons.has(favicon);
        // The logo itself; invisible (but loading) until it has painted.
        const iconImg = favicon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={adoptIcon(favicon)}
            src={favicon}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => markIconLoaded(favicon)}
            onError={() => markFaviconBroken(favicon)}
            className={`w-[20px] h-[20px] object-contain rounded-full ${iconShown ? "" : "absolute opacity-0"}`}
          />
        ) : null;

        // ── COMPACT — slim row on the sheet itself ──────────────────────────
        // "compact" is the stock translucent row; buttonStyle solid/outline
        // restyle the SAME row (favicon well, label, chevron) in the button
        // color — filled, or bordered. Only compact rows: featured/grid tiles
        // above keep their previews regardless of the row style.
        if (size === "compact") {
          const pickedRow = resolveRowStyle(link, buttonStyle);
          const variant = pickedRow === "solid" || pickedRow === "outline" ? pickedRow : "compact";
          // Glass applies to the STOCK row only. Solid and outline are colour
          // choices the owner made on purpose; frosting them would throw that
          // colour away. Featured/grid tiles are unaffected either way — they
          // paint their own image over the surface, so a backdrop blur behind
          // them would never be visible.
          // Per link (Link buttons → Blur) since 2026-09-17; a row never
          // touched falls back to the older page-wide switch, which only ever
          // frosted the stock rows.
          const glassRow = paid && (link.glass ?? (glass && variant === "compact"));
          const rowClass =
            variant === "solid"
              ? "shadow-[0_2px_10px_rgba(15,23,42,0.10)]"
              : variant === "outline"
                ? ""
                : glassRow
                  ? "ring-1 ring-white/[0.14]"
                  : light
                    ? "ring-1 bg-white ring-black/[0.08] shadow-[0_2px_10px_rgba(15,23,42,0.06)]"
                    : "ring-1 bg-white/[0.07] ring-white/10";
          const frost = { backdropFilter: "blur(20px) brightness(1.1) contrast(0.9)", WebkitBackdropFilter: "blur(20px) brightness(1.1) contrast(0.9)" };
          const rowStyle =
            variant === "solid"
              ? glassRow
                // Frosted SOLID: the owner's colour, translucent, over the blur.
                ? { background: `color-mix(in srgb, ${btnColor} 55%, transparent)`, ...frost }
                : { background: btnColor }
              : variant === "outline"
                ? glassRow
                  ? { boxShadow: `inset 0 0 0 1.5px ${btnColor}`, background: "rgba(255,255,255,0.08)", ...frost }
                  : { boxShadow: `inset 0 0 0 1.5px ${btnColor}` }
                : glassRow
                  ? {
                      // Measured off the reference page (linktr.ee, 2026-09-10):
                      // a 10% white fill over blur(20px) with a slight
                      // brightness lift and contrast drop. The lift is what
                      // stops the row going muddy over a dark photo; the
                      // contrast drop keeps a busy photo from reading THROUGH
                      // the row and fighting the label.
                      background: "rgba(255,255,255,0.10)",
                      backdropFilter: "blur(20px) brightness(1.1) contrast(0.9)",
                      WebkitBackdropFilter: "blur(20px) brightness(1.1) contrast(0.9)",
                    }
                  : undefined;
          // Solid rows carry their own text; outline/compact labels sit on the
          // sheet, so they keep the page's (AA-tested) text color.
          const labelColor = variant === "solid" ? btnText : textColor;
          const iconWell =
            variant === "solid"
              ? { background: isLightHex(btnColor) ? "rgba(15,23,42,0.06)" : "rgba(255,255,255,0.16)" }
              : undefined;
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                // No preventDefault anywhere near this: the navigation is the
                // browser's, and the event is a beacon that cannot delay it.
                trackLinkClick({ username: trackFor, surface: "links", url: href, source: trackSource, label: link.label, suppress: suppressTracking });
                triggerSignupNudge("link_button");
              }}
              className={`w-full mb-2.5 flex items-center gap-3 rounded-[14px] px-3.5 py-3 transition-transform active:scale-[0.98] ${rowClass}`}
              style={rowStyle}
            >
              <span
                className={`relative w-[34px] h-[34px] rounded-full shrink-0 flex items-center justify-center ${variant !== "solid" ? (light ? "bg-black/[0.05]" : "bg-white/10") : ""}`}
                style={iconWell}
              >
                {iconShown ? null : link.emoji ? (
                  <span className="text-[1rem] leading-none">{link.emoji}</span>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke={labelColor} strokeOpacity={0.7} strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  </svg>
                )}
                {iconImg}
              </span>
              <span className="flex-1 min-w-0 text-left text-[0.875rem] font-semibold truncate" style={{ color: labelColor }}>
                {link.label}
              </span>
              <svg viewBox="0 0 24 24" fill="none" stroke={labelColor} strokeOpacity={0.4} strokeWidth={2.2} className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </a>
          );
        }

        // ── FEATURED / GRID — image tiles ───────────────────────────────────
        // An uploaded photo replaces the link's own preview; an uploaded video
        // autoplays muted AS the tile (the link still opens on tap). Both are
        // Pro (tileMedia returns null for Free, which never reaches here anyway).
        const media = tileMedia(link, paid);
        const mediaVideo = media?.type === "video" && !failedPictures[media.url] ? media.url : null;
        // No upload → the link's own preview (owner, 2026-10-07: "the default
        // of that additional link is its preview"), with the fallbacks above.
        const picture = mediaVideo ? null : pickPicture([media?.type === "image" ? media.url : null, videoThumb, pv?.image], failedPictures);
        // The picture whose measured tone sets the title colour (unchanged for
        // an uploaded video: it reads the link's preview, as it always has).
        const img = mediaVideo ? videoThumb || pv?.image || null : picture?.key ?? null;
        // With no picture the tile is built from this page's own Look — see
        // fallbackTile() in lib/swiftlink-looks. It replaced four hard-coded
        // rainbow gradients that ignored the palette the owner picked.
        const fb = fallbackTile({ tile: tileBg, accent }, i);
        // Light-bottomed preview → dark title on a light scrim; anything else
        // → white on dark. The branded tile can land either way (a light Look
        // makes a light tile), so it reports its own lightness rather than
        // being assumed dark the way the old fixed gradients could be.
        const lightTile = img ? tileTone[img] === "light" : fb.light;
        const isPlaying = playing === i;
        const big = size === "featured" || isPlaying;

        // Inline video player — tile swaps to an autoplaying embed (paid only;
        // free never reaches here, every free link is compact).
        if (isPlaying && embed && !media) {
          return (
            <div key={i} className="relative w-full rounded-[14px] overflow-hidden mb-2.5 bg-black" style={{ aspectRatio: "16/9" }}>
              <iframe
                src={embed}
                className="absolute inset-0 w-full h-full"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                title={link.label}
              />
              <button
                type="button"
                onClick={() => setPlaying(null)}
                aria-label="Close video"
                className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/60 text-white/90 text-sm leading-none flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          );
        }

        // An aspect-ratio box (not a fixed height) keeps width and height
        // scaling together at every viewport, matching the ~1.91:1 preview
        // image's own ratio so it fits without cropping.
        const tileClasses = `relative overflow-hidden rounded-[14px] mb-2.5 block group transition-transform active:scale-[0.98] aspect-[1.91/1] ${
          big ? "w-full" : "w-[calc(50%-6px)]"
        }`;

        const inner = (
          <>
            {/* Uploaded video, image, or branded gradient fallback */}
            {mediaVideo ? (
              <TileVideo src={mediaVideo} onFail={() => setFailedPictures((f) => ({ ...f, [mediaVideo]: 2 }))} />
            ) : picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={picture.src}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                // Hotlink guards check the Referer; without one, a site's own
                // preview picture loads the way it does in Messages.
                referrerPolicy="no-referrer"
                // Server-rendered (an upload, a video frame): a failure before
                // hydration fired no onError, so read it off the element.
                ref={(el) => { if (el?.complete && el.naturalWidth === 0 && el.getAttribute("src") === picture.src) failPicture(picture.key); }}
                onError={() => failPicture(picture.key)}
              />
            ) : (
              // No picture: the branded surface carries the tile on its own.
              // Nothing is centred on it any more. A 36px emoji floating in
              // the middle of a coloured rectangle was the cartoon look, and
              // the chain-link glyph that stood in when there was no emoji was
              // worse — every tile on the page wearing the same generic icon.
              // Whatever the owner did choose (an emoji, or the site's
              // favicon) now appears as the same small top-left chip the
              // picture tiles have always used, so the two states match.
              <div className="absolute inset-0" style={{ background: fb.background }} />
            )}

            {/* Frosted band under the title (Link buttons → Blur, per link). */}
            {paid && link.glass && (
              <div
                className="absolute inset-x-0 bottom-0 z-[5] h-[40%]"
                style={{
                  background: lightTile ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.18)",
                  backdropFilter: "blur(14px) saturate(1.2)",
                  WebkitBackdropFilter: "blur(14px) saturate(1.2)",
                  borderTop: "1px solid rgba(255,255,255,0.18)",
                }}
              />
            )}
            {/* Bottom gradient so the title reads over any image — matched to
                the measured tone of the strip it covers. */}
            <div
              className={`absolute inset-x-0 bottom-0 h-[70%] ${paid && link.glass ? "opacity-40" : ""}`}
              style={{
                background: lightTile
                  ? "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.82) 100%)"
                  : "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 100%)",
              }}
            />

            {/* Favicon circle, top-left (link.me's iconbox). Shown once the
                site's logo has painted (or straight away with an emoji), so a
                site with no logo never leaves an empty white circle. */}
            {(favicon || link.emoji) && (
              <span
                className="absolute top-2 left-2 z-[6] w-[30px] h-[30px] rounded-full flex items-center justify-center transition-opacity duration-200"
                style={{
                  ...(lightTile
                    ? { background: "rgba(255,255,255,0.92)", boxShadow: "0 1px 3px rgba(15,23,42,0.18), inset 0 0 0 1px rgba(15,23,42,0.08)" }
                    : { background: "rgba(255,255,255,0.95)", boxShadow: "0 1px 3px rgba(0,0,0,0.28)" }),
                  opacity: iconShown || link.emoji ? 1 : 0,
                }}
              >
                {!iconShown && link.emoji && <span className="text-[0.9375rem] leading-none">{link.emoji}</span>}
                {iconImg}
              </span>
            )}

            {/* Play button for videos */}
            {videoThumb && !media && (
              <span className="absolute inset-0 z-[6] flex items-center justify-center">
                <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-[2px] flex items-center justify-center transition-transform group-hover:scale-110">
                  <svg viewBox="0 0 24 24" fill="#fff" className="w-5 h-5 ml-0.5"><path d="M8 5v14l11-7z" /></svg>
                </span>
              </span>
            )}

            {/* Centered title at the bottom, 2-line clamp */}
            <span className="absolute inset-x-0 bottom-[7px] z-[6] px-2 flex justify-center">
              <span
                className={`font-semibold text-center leading-[1.3] ${big ? "text-[1.125rem]" : "text-[1rem]"}`}
                // Break BETWEEN words (overflow-wrap), never mid-word — a word
                // only splits if it alone is wider than the tile, and the
                // 2-line clamp ends on a complete word with an ellipsis.
                style={{
                  color: lightTile ? "#0F172A" : "#ffffff",
                  textShadow: lightTile ? "0 1px 6px rgba(255,255,255,0.7)" : "0 1px 8px rgba(0,0,0,0.6)",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "normal", overflowWrap: "break-word",
                }}
              >
                {link.label}
              </span>
            </span>

            {/* Shine sweep */}
            <span className="sc-shine" aria-hidden="true" />
          </>
        );

        // Videos play inline; everything else opens the link.
        if (embed && !media) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                // Playing an embedded video IS the engagement with that link —
                // it just happens in place instead of in a new tab.
                trackLinkClick({ username: trackFor, surface: "links", url: link.url, source: trackSource, label: link.label, suppress: suppressTracking });
                triggerSignupNudge("link_button");
                setPlaying(i);
              }}
              className={`${tileClasses} text-left`}
              style={{ background: tileBg }}
            >
              {inner}
            </button>
          );
        }
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              trackLinkClick({ username: trackFor, surface: "links", url: href, source: trackSource, label: link.label, suppress: suppressTracking });
              triggerSignupNudge("link_button");
            }}
            className={tileClasses}
            style={{ background: tileBg }}
          >
            {inner}
          </a>
        );
      })}
    </div>
  );
}
