"use client";

// ── "Link buttons" — how EACH additional link appears on the Swift Links page ─
// Lives on the Social design tab/step (the card editor's and the wizard's),
// replacing two older controls: the per-link Auto/Featured/Grid/Compact
// picker that sat on the Socials tab, and the page-wide Standard/Solid/
// Outline row style that sat here. Owner order 2026-09-09: one place, per
// link, so a page can mix a compact row, a grid pair and a featured tile.
//
// Per link:
//   Featured / Grid  → a "Preview" sub-row: the link's own preview (og:image /
//                      video thumbnail) or an uploaded photo or short video.
//   Compact          → a "Row style" sub-row: Standard / Solid / Outline.
// Only the sub-row that applies is shown, so each link is two taps at most.
//
// Pro-gated like every other design control: Free sees the picker disabled
// (the live page renders every Free link as a standard compact row anyway,
// so an enabled picker would be a control that lies). Section headers have
// no look of their own and are skipped.

import { useRef, useState } from "react";
import LinkPreviewThumb from "@/components/LinkPreviewThumb";
import type { CardLink } from "@/components/card-templates/types";
import { TILE_SIZES, resolveRowStyle, type RowStyle, type TileSize } from "@/lib/swiftlink-tiles";
import { BUTTON_STYLES } from "@/lib/swiftlink-looks";
// One uploader for every owner-supplied photo/video — see lib/upload-media for
// why a video cannot go through /api/upload the way a photo does.
import { isAllowedMedia, uploadMedia, uploadErrorMessage, WRONG_TYPE_MESSAGE, IMAGE_TYPES, VIDEO_TYPES } from "@/lib/upload-media";

/** Mini glyph for a row style: standard = quiet translucent row; solid =
 *  filled row; outline = bordered row. */
export function RowStyleGlyph({ id }: { id: RowStyle }) {
  if (id === "solid") {
    return <span className="w-8 h-4 rounded-full bg-gray-300 flex items-center justify-center"><span className="w-4 h-[3px] rounded bg-gray-700" /></span>;
  }
  if (id === "outline") {
    return <span className="w-8 h-4 rounded-full border-[1.5px] border-gray-300 flex items-center justify-center"><span className="w-4 h-[3px] rounded bg-gray-400" /></span>;
  }
  return <span className="w-8 h-4 rounded-full bg-gray-700 ring-1 ring-gray-500 flex items-center justify-center"><span className="w-4 h-[3px] rounded bg-gray-400" /></span>;
}

/** Mini glyph for a tile size: a wide tile, a half-width pair, a slim row. */
function TileSizeGlyph({ id }: { id: TileSize }) {
  if (id === "featured") return <span className="w-9 h-4 rounded-[3px] bg-gray-400/90" />;
  if (id === "grid") {
    return (
      <span className="w-9 h-4 flex gap-[3px]">
        <span className="flex-1 rounded-[3px] bg-gray-400/90" />
        <span className="flex-1 rounded-[3px] bg-gray-400/90" />
      </span>
    );
  }
  return <span className="w-9 h-4 flex items-center"><span className="w-full h-[7px] rounded-full bg-gray-400/90" /></span>;
}

const pick = "flex flex-col items-center gap-1.5 px-2 py-2 rounded-lg border text-[0.6875rem] font-semibold transition-colors disabled:opacity-40";
const pickOn = "border-blue-600 bg-blue-600/10 text-blue-200";
const pickOff = "border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600";

function LinkMediaControl({
  link,
  onChange,
  canUpload = true,
}: {
  link: CardLink;
  onChange: (patch: Partial<CardLink>) => void;
  /** False on the marketing mini-builder: there is no account to upload
   *  against and every upload route answers 401, so the picker would be a
   *  dead end. The tile still shows the link's OWN preview image, which is
   *  what a visitor gets until they sign up. */
  canUpload?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const media = link.media;

  async function pickFile(file: File) {
    if (!isAllowedMedia(file)) {
      setError(WRONG_TYPE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChange({ media: await uploadMedia(file, "link") });
    } catch (e) {
      // A guest in the wizard can't reach the upload routes (401) — the shared
      // helper turns that into "sign in first" rather than "Unauthorized".
      setError(uploadErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-800 bg-gray-950/40 px-2.5 py-2">
      <p className="text-[0.625rem] text-gray-500 mb-1.5 leading-snug">
        Preview — {media ? (media.type === "video" ? "your video plays on the tile" : "your photo fills the tile") : "the link’s own preview image"}
      </p>
      <input
        ref={fileRef}
        type="file"
        accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pickFile(f);
          e.target.value = ""; // re-picking the same file must fire again
        }}
      />
      <div className="flex items-center gap-2.5">
        {media?.type === "video" ? (
          // The #t=0.001 fragment makes iOS paint the first frame instead of
          // a black box — WebKit only renders a frame once the clip is seeked.
          <video src={`${media.url}#t=0.001`} muted playsInline preload="auto" className="w-14 h-10 rounded-md object-cover border border-gray-700 shrink-0 bg-black" aria-label="Uploaded video" />
        ) : media?.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.url} alt="Uploaded preview" className="w-14 h-10 rounded-md object-cover border border-gray-700 shrink-0" />
        ) : (
          <LinkPreviewThumb url={link.url} />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {!canUpload && (
            <p className="text-[0.625rem] text-gray-500 leading-snug">
              Shows the link&apos;s own preview. Sign up to use your own photo or video.
            </p>
          )}
          {canUpload && (<>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="px-2.5 py-1.5 rounded-lg border border-gray-700 bg-gray-800/40 text-[0.6875rem] font-semibold text-gray-300 hover:border-gray-600 transition-colors disabled:opacity-50"
          >
            {busy ? "Uploading…" : media ? "Replace" : "Upload photo or video"}
          </button>
          {media && !busy && (
            <button
              type="button"
              onClick={() => onChange({ media: undefined })}
              className="px-2.5 py-1.5 rounded-lg text-[0.6875rem] font-semibold text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
            >
              Use link preview
            </button>
          )}
          </>)}
        </div>
      </div>
      {error && <p className="text-[0.625rem] text-red-400 mt-1.5 leading-snug">{error}</p>}
      {!error && canUpload && (
        <p className="text-[0.625rem] text-gray-600 mt-1.5 leading-snug">
          {media
            ? "Cropped to fit the tile. Landscape fits best."
            : "Photos up to 5 MB, videos up to 25 MB. Landscape fits best."}
        </p>
      )}
    </div>
  );
}

// EVERY CONTROL HERE IS LIVE ON EVERY PLAN (owner, 2026-09-11). Per-link
// looks, photos and row styles used to be disabled for a Free account; they now
// behave like the card's design panel — you build the page you want, see it, and
// meet the wall at Save Changes, which names what needs Pro and offers to save
// the Free version instead. The `locked` prop is gone rather than ignored, so
// nothing here can half-disable again by accident; the PRO tag lives on the
// section heading in SwiftLinkDesign.
export default function LinkButtonsControls({
  links,
  onChange,
  pageRowStyle,
  pageGlass = false,
  canUpload = true,
  isLocked,
}: {
  links: CardLink[];
  /** The page's older page-wide "Blur the link buttons" (with background
   *  media): what an untouched compact row shows, so its switch never lies. */
  pageGlass?: boolean;
  onChange: (links: CardLink[]) => void;
  /** Rows the member may not restyle — the company's pinned links on an
   *  Office card. Shown, tagged "Company", with no controls: the server
   *  rebuilds those rows from the office's own list on every save, so a
   *  control here could only ever be silently undone (office audit 2026-09-16). */
  isLocked?: (l: CardLink) => boolean;
  /** Threaded to the per-tile media picker — see LinkMediaControl. */
  canUpload?: boolean;
  /** The page-wide row style older pages saved (linkButtonStyle) — what a
   *  link shows as until it gets its own pick. */
  pageRowStyle?: string;
}) {
  const patch = (i: number, p: Partial<CardLink>) => onChange(links.map((l, li) => (li === i ? { ...l, ...p } : l)));
  const real = links.filter((l) => l.kind !== "header");

  if (real.length === 0) {
    return (
      <p className="text-[0.6875rem] text-gray-500 bg-gray-950/40 border border-gray-800 rounded-lg px-3 py-2.5 leading-relaxed">
        No links yet — add them under Socials first.
      </p>
    );
  }

  // Grid tiles pack in pairs; the page promotes an unpaired one to full
  // width rather than leave it beside a gap (lib/swiftlink-tiles). Say so
  // whenever that will happen, so a "Grid" pick that shows full width never
  // looks like a bug.
  const gridCount = real.filter((l) => (l.size ?? "grid") === "grid").length;

  return (
    <div className="space-y-2">
      {gridCount % 2 === 1 && (
        <p className="text-[0.625rem] text-blue-200 bg-blue-600/10 border border-blue-600/30 rounded-lg px-2.5 py-1.5 leading-snug">
          Grid shows two per row — with {gridCount}, the first one is full width.
        </p>
      )}
      {links.map((l, i) => {
        if (l.kind === "header") return null;
        // A link saved before the picker always wrote a size resolves as grid
        // (see lib/swiftlink-tiles) — show that, so the control never lies.
        const size: TileSize = l.size === "featured" || l.size === "compact" || l.size === "grid" ? l.size : "grid";
        const rowStyle = resolveRowStyle(l, pageRowStyle);
        if (isLocked?.(l)) {
          return (
            <div key={i} className="rounded-xl border border-purple-500/25 bg-purple-500/[0.06] px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <LinkPreviewThumb url={l.url} />
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200 text-xs font-semibold truncate">{l.label || "Untitled link"}</p>
                  <p className="text-gray-500 text-[0.625rem] truncate">Set by your organization</p>
                </div>
                <span className="text-[0.5625rem] font-semibold uppercase tracking-wide text-purple-300 shrink-0">Company</span>
              </div>
            </div>
          );
        }
        return (
          <div key={i} className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5">
            <div className="flex items-center gap-2.5 mb-2">
              <LinkPreviewThumb url={l.url} />
              <div className="flex-1 min-w-0">
                <p className="text-gray-200 text-xs font-semibold truncate">{l.label || "Untitled link"}</p>
                <p className="text-gray-500 text-[0.625rem] truncate">{l.url}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`How "${l.label || "this link"}" appears on your Swift Links page`}>
              {TILE_SIZES.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  title={o.hint}
                  aria-pressed={size === o.id}
                  onClick={() => patch(i, { size: o.id })}
                  className={`${pick} ${size === o.id ? pickOn : pickOff}`}
                >
                  <TileSizeGlyph id={o.id} />
                  {o.name}
                </button>
              ))}
            </div>
            {size === "compact" ? (
              <div className="mt-2">
                <p className="text-[0.625rem] text-gray-500 mb-1.5 leading-snug">Row style</p>
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Row style">
                  {BUTTON_STYLES.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      title={o.hint}
                      aria-pressed={rowStyle === o.id}
                      // Written explicitly (even "tile") so a per-link pick
                      // always beats the legacy page-wide setting.
                      onClick={() => patch(i, { rowStyle: o.id })}
                      className={`${pick} ${rowStyle === o.id ? pickOn : pickOff}`}
                    >
                      <RowStyleGlyph id={o.id} />
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <LinkMediaControl link={l} onChange={(p) => patch(i, p)} canUpload={canUpload} />
            )}
            {/* Blur, per link and per size (owner, 2026-09-17: it used to be
                one page-wide switch under Page background). */}
            {(() => {
              const on = l.glass ?? (pageGlass && size === "compact" && rowStyle === "tile");
              return (
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => patch(i, { glass: !on })}
                  className="mt-2 w-full flex items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-800/40 px-2.5 py-2 text-left hover:border-gray-600 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-[0.6875rem] font-semibold text-gray-200">Blur</span>
                    <span className="block text-[0.625rem] text-gray-500 leading-snug">
                      {size === "compact" ? "Frosted row — best over a photo or video." : "A frosted band behind the title."}
                    </span>
                  </span>
                  <span aria-hidden className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${on ? "bg-blue-600" : "bg-gray-600"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                  </span>
                </button>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
