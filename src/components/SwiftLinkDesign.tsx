"use client";

// ── "Social design" — the Swift Links PAGE's look ───────────────────────────
// The 4th step of the card wizard/editor. Deliberately separate from the card's
// TemplateStyleControls: the card and the Swift Links page are different
// surfaces, so each has its own keys (LINK_STYLE_KEYS in lib/plan) and styling
// one never restyles the other.
//
// Exports SwiftLinkStyleControls — a named-Look picker (the whole scheme in
// one tap; see lib/swiftlink-looks, designed against hoo.be) with the custom
// background / text / font pickers beneath it as Pro fine-tuning.
// The live PREVIEW is no longer a mock here: SwiftLinkLivePreview renders the
// REAL SwiftLinkProfile (embedded + scaled) so the wizard/editor/mini-builder
// previews are byte-for-byte the published page — see SwiftLinkLivePreview.tsx.
// Plan line: FREE picks between the two free Looks (light "Paper" default and
// the dark "Onyx" stock); the rest of the Look library and every custom picker
// carry PRO gating, enforced server-side in sanitizeCustomizationForPlan.

import { useLayoutEffect, useRef, useState } from "react";
import { CARD_FONT_OPTIONS } from "@/components/card-templates/shared";
// ProTag is the shared light-blue tag, so Social design and Card design tag
// Pro identically (owner, 2026-09-18).
import { DesignSteps, ProTag, type DesignStep } from "@/components/ui/DesignControls";
import {
  DEFAULT_SWIFTLINK_LOOK, isFreeLook, getLook,
  LOOK_FAMILIES, looksInFamily, washGradient, hexAlpha,
  type SwiftLinkLook, type LookFamily,
  ICON_SHAPES, ICON_FILLS, normalizeIconShape, normalizeIconFill,
  HERO_STYLES, normalizeHeroStyle,
  HERO_CONTENTS, normalizeHeroContent,
  normalizePageDim, MAX_PAGE_DIM,
} from "@/lib/swiftlink-looks";
import { isAllowedMedia, uploadMedia, uploadErrorMessage, WRONG_TYPE_MESSAGE, IMAGE_TYPES, VIDEO_TYPES } from "@/lib/upload-media";
import { resolveRowStyle } from "@/lib/swiftlink-tiles";
import LinkButtonsControls from "@/components/LinkButtonsControls";
import PlatformIcon from "@/components/PlatformIcon";
import type { CardLink } from "@/components/card-templates/types";

export type SwiftLinkStyle = {
  linkLook?: string;
  linkBgColor?: string;
  linkTextColor?: string;
  linkFontFamily?: string;
  linkIconShape?: string;
  linkIconFill?: string;
  /** Page header layout: "cover" (full hero, default), "banner" (a third of
   *  the screen), "avatar" (compact circle) or "none" (flat page).
   *  Structural — every plan, like the Look picker. */
  linkHeroStyle?: string;
  /** What the header shows: "auto" (headshot → logo → initials, default),
   *  "photo", "logo", "initials" or "custom" (an uploaded header photo).
   *  Every plan. */
  linkHeroContent?: string;
  /** The uploaded header photo for linkHeroContent "custom" — a public URL
   *  from /api/upload (field "hero"). Every plan. */
  linkHeroImage?: string;
  /** "video" when linkHeroImage is a short video (plays muted on a loop). */
  linkHeroMediaType?: string;
  /** PAGE BACKGROUND MEDIA — a photo or short video behind the whole page,
   *  offered only with the compact-circle header (see lib/swiftlink-looks for
   *  why). Pro: all four keys are in LINK_STYLE_KEYS. */
  linkBgMedia?: string;
  /** "image" | "video" — which element renders linkBgMedia. */
  linkBgMediaType?: string;
  /** Scrim over the media, 0-80%. The readability control. */
  linkBgDim?: number;
  /** Frost the plain link rows over the media. */
  linkGlass?: boolean;
  /** LEGACY page-wide row style ("tile" | "solid" | "outline") written by the
   *  pre-2026-09-09 "Link buttons" control. Still read as the fallback for a
   *  link with no rowStyle of its own; nothing writes it any more. */
  linkButtonStyle?: string;
  /** Solid/outline row color — defaults to the accent below. */
  linkButtonColor?: string;
  /** THE ACCENT: the Connect button, and social icons set to "Accent".
   *  Overrides the Look's own accent. Pro (LINK_STYLE_KEYS). */
  linkAccentColor?: string;
};

export const LINK_DEFAULT_BG = "#191a1a"; // the page's stock dark sheet
export const LINK_DEFAULT_TEXT = "#ffffff";

// Dark-leaning curated backgrounds — the page's translucent-white link cards
// and social chips are designed for rich/dark surfaces, so the presets stay in
// that family; the custom picker (Pro) allows anything.
const BG_PRESETS = ["#191a1a", "#0b1220", "#14203a", "#1d1330", "#052e2b", "#2a1414", "#1f2937"];
const TEXT_PRESETS = ["#ffffff", "#f8fafc", "#fde68a", "#a7f3d0", "#bfdbfe", "#fbcfe8"];
// Action colours — the Connect button, and the Solid/Outline link rows that
// fall back to it. One list, because they are the same decision at two scales:
// offering different swatches for each would imply they are unrelated.
const ACCENT_PRESETS = ["#1D4ED8", "#111827", "#A8433C", "#0F766E", "#7C3AED", "#B91C1C"];

function isHex(v?: string): v is string {
  return !!v && /^#[0-9a-fA-F]{6}$/.test(v);
}

const rowLabel = "text-[0.6875rem] font-semibold text-gray-300 uppercase tracking-wide";

function SwatchRow({
  presets,
  value,
  fallbackHex,
  onPick,
  customLocked,
}: {
  presets: string[];
  value?: string;
  fallbackHex: string;
  onPick: (v: string | undefined) => void;
  customLocked: boolean;
}) {
  return (
    // The presets lean dark (the page's link cards are designed for rich/dark
    // surfaces), so on the editor's own dark panel they read as faded blobs.
    // A light well behind them + bigger swatches with a crisp ring makes each
    // color clearly visible.
    //
    // NOTHING HERE IS DISABLED ON FREE any more (owner, 2026-09-11): the whole
    // Social design panel now works exactly like Card design — every control is
    // live so the page can be previewed with it, the PRO tag on the section
    // says what costs money, and Save Changes is where it stops (the dialog
    // names what was used and offers the Free-safe save). The earlier fix this
    // comment described — disabling them because a Free pick "previewed live
    // but was stripped on save, silently reverting" — is answered by that
    // dialog, which is the thing that was actually missing.
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-200/90 px-2.5 py-2">
      {presets.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          aria-label="Color preset"
          className="w-8 h-8 rounded-lg transition-transform hover:scale-110 shadow-sm"
          style={{ background: p, border: value === p ? "2.5px solid #2563eb" : "1px solid rgba(15,23,42,0.25)" }}
        />
      ))}
      <label className="flex items-center gap-1 text-[0.625rem] text-gray-600 ml-0.5 cursor-pointer">
        custom{customLocked && <ProTag />}
        <input
          aria-label="Accent colour"
          type="color"
          value={isHex(value) ? value : fallbackHex}
          onChange={(e) => onPick(e.target.value)}
          className="w-8 h-8 rounded bg-transparent border border-gray-400 cursor-pointer"
        />
      </label>
      <button
        type="button"
        onClick={() => onPick(undefined)}
        className={`text-[0.625rem] px-2 py-1 rounded-lg border transition-colors ${
          value === undefined ? "border-blue-600 text-blue-700 font-semibold" : "border-gray-400 text-gray-600 hover:text-gray-900"
        }`}
      >
        Default
      </button>
    </div>
  );
}

/** One look, drawn as a miniature of the page it produces. */
function LookSwatch({
  look,
  active,
  proLocked,
  onPick,
}: {
  look: SwiftLinkLook;
  active: boolean;
  proLocked: boolean;
  onPick: () => void;
}) {
  const wash = washGradient(look);
  return (
    <button
      type="button"
      // TAPPABLE ON FREE, exactly like the card's Looks gallery. The page
      // previews with the Pro look; the PRO tag says what it costs, and Save
      // Changes is the wall (proFeaturesInUse → ProRequiredDialog).
      onClick={onPick}
      aria-pressed={active}
      title={look.name}
      className={`relative rounded-xl p-3 text-left transition-all border-2 overflow-hidden hover:scale-[1.02] ${
        active ? "border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.25)]" : "border-transparent"
      }`}
      style={{
        // The swatch paints the surface the look actually produces: the
        // gradient for gradient looks; a photo-like violet haze standing
        // in for the owner's blurred headshot on Aura.
        background: look.aura
          ? "linear-gradient(150deg, #3B2B52 0%, #17131E 45%, #24303F 100%)"
          : look.sheetTo
            ? `linear-gradient(180deg, ${look.sheet} 0%, ${look.sheetTo} 100%)`
            : look.sheet,
        boxShadow: active ? undefined : "inset 0 0 0 1px rgba(127,127,127,0.35)",
      }}
    >
      {/* A GLASS swatch is built the way the page is: the wash underneath, the
          frosted sheet over it. Painting a flat approximation instead would
          make the one family you cannot describe in words the one family the
          picker misrepresents. */}
      {wash && (
        <>
          <span aria-hidden className="absolute inset-0" style={{ background: wash }} />
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background: hexAlpha(look.sheet, look.frost ?? 0.7),
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          />
        </>
      )}
      {/* The swatch is a MINI PAGE, not an abstract chip — avatar dot,
          a name line in the look's text, and its accent as the Connect
          bar, so each card previews the page it produces. The look's OWN
          name sits in the name position (owner order 2026-09-02: no more
          "Sam Okafor" placeholder person) — it labels the template and
          previews its typography in one line. */}
      <span className="relative flex items-center gap-1.5">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ background: look.text, opacity: 0.25 }} />
        <span className="text-[0.75rem] font-extrabold leading-none truncate" style={{ color: look.text }}>{look.name}</span>
      </span>
      <span className="relative mt-1.5 block h-1 w-2/3 rounded-full" style={{ background: look.text, opacity: 0.18 }} />
      <span className="relative mt-2 block h-[14px] w-full rounded-full" style={{ background: look.accent }} />
      <span className="relative mt-2 flex items-center gap-1.5 min-h-[11px]">
        {look.aura && <span className="text-[0.5625rem] leading-none" style={{ color: look.text, opacity: 0.55 }}>your photo, blurred</span>}
        {proLocked && <ProTag />}
      </span>
    </button>
  );
}

/**
 * The Look picker: three labelled groups that drop down.
 *
 * Owner request 2026-09-10. The flat grid of every look at once had grown to
 * seventeen cards — a wall you scroll past rather than a choice you make — and
 * it gave the new see-through designs nowhere to be introduced. Grouping by
 * MATERIAL (see LOOK_FAMILIES) is the split a non-designer can predict: you can
 * tell which of the three a page is by looking at it.
 *
 * Behaviour chosen so the control never hides the thing you came for:
 *   • All three start closed; you open the one you want (owner, 2026-09-29).
 *   • A closed group still shows its selection — the look's name and a swatch
 *     of its real surface — so you can read your current design without
 *     opening anything.
 *   • One open at a time, the same accordion idiom as Settings, so the panel
 *     cannot grow into the same wall this replaced.
 *   • Free keeps both its looks in Solid and can still OPEN the two Pro groups
 *     to see what they are. Hiding them would make the upgrade abstract.
 */
function LookPicker({
  value,
  onPick,
  locked,
}: {
  value?: string;
  onPick: (id: string | undefined) => void;
  /** Free session: free Looks stay tappable (that IS the free feature); the
   *  Pro library renders with a PRO tag, disabled. */
  locked: boolean;
}) {
  const selected = value ?? DEFAULT_SWIFTLINK_LOOK;
  const selectedLook = getLook(selected);
  // Every group starts CLOSED (owner, 2026-09-29): Solid used to open on its
  // own — it holds the default look, so it was open for nearly everyone — and
  // the owner wants people to pick Solid, Gradient or Glass themselves. The
  // closed row still names the current look, so nothing is hidden.
  const [open, setOpen] = useState<LookFamily | null>(null);

  // ── Opening a group cleanly (owner, 2026-09-29) ──────────────────────────
  // Measured in tests/render/look-picker-open.interactive.test.ts, two things
  // went wrong on every tap:
  //   1. Only one group is open at a time, so opening Glass while Solid is open
  //      collapses Solid's ten looks ABOVE it and the row you tapped flew ~500px
  //      up the screen, out from under your finger — the next tap could land on
  //      a different row.
  //   2. Opening a group in the lower half of the screen left its looks below
  //      the fold, so it looked like nothing had happened.
  // Fix: remember where the tapped row was; after React commits (before
  // paint), scroll by however far it moved so it stays put — instantly, so
  // there is nothing to see — then glide just far enough to show the looks.
  const rowRefs = useRef<Partial<Record<LookFamily, HTMLButtonElement | null>>>({});
  const groupRefs = useRef<Partial<Record<LookFamily, HTMLDivElement | null>>>({});
  const tapped = useRef<{ fam: LookFamily; top: number } | null>(null);

  function toggle(fam: LookFamily, isOpen: boolean) {
    const row = rowRefs.current[fam];
    tapped.current = !isOpen && row ? { fam, top: row.getBoundingClientRect().top } : null;
    setOpen(isOpen ? null : fam);
  }

  useLayoutEffect(() => {
    const t = tapped.current;
    tapped.current = null;
    if (!t || open !== t.fam) return;
    const row = rowRefs.current[t.fam];
    const group = groupRefs.current[t.fam];
    if (!row || !group) return;
    // 1 — keep the row where it was. Whatever scrolls this panel: the page in
    // the editors, a scrolling pop-up in the website builder.
    const moved = row.getBoundingClientRect().top - t.top;
    if (Math.abs(moved) > 1) {
      const scroller = scrollParentOf(row);
      if (scroller) scroller.scrollTop += moved;
      else window.scrollBy(0, moved);
    }
    // 2 — then bring the opened looks on screen: the least scroll that shows
    // the whole group, but never so far that the row you tapped slides under
    // something pinned at the top. The visible area is MEASURED, not assumed:
    // the website builder pins a live preview over the top of its pop-up on a
    // phone, and Office branding has the tab bar along the bottom.
    const raf = requestAnimationFrame(() => {
      const scroller = scrollParentOf(row);
      const { top: safeTop, bottom: safeBottom } = visibleBand(row, scroller);
      const g = group.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const need = g.bottom - safeBottom;
      if (need <= 0) return;
      const by = Math.min(need, Math.max(0, r.top - safeTop));
      if (by < 1) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const opts: ScrollToOptions = { top: by, behavior: reduce ? "auto" : "smooth" };
      if (scroller) scroller.scrollBy(opts);
      else window.scrollBy(opts);
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden divide-y divide-gray-800">
      {LOOK_FAMILIES.map((fam) => {
        const looks = looksInFamily(fam.id);
        const isOpen = open === fam.id;
        const holdsSelection = selectedLook.family === fam.id;
        // A whole group is Pro when none of its looks are free — true for
        // Gradient and Glass, and the tag says so on the row rather than
        // making you open it to find out.
        const famLocked = locked && !looks.some((l) => isFreeLook(l.id));
        return (
          <div key={fam.id} ref={(el) => { groupRefs.current[fam.id] = el; }}>
            <button
              ref={(el) => { rowRefs.current[fam.id] = el; }}
              type="button"
              onClick={() => toggle(fam.id, isOpen)}
              aria-expanded={isOpen}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                isOpen ? "bg-gray-800/50" : "hover:bg-gray-800/30"
              }`}
            >
              {/* The group's own swatch — three chips of the material, so the
                  row shows what "Glass" means before you open it. */}
              <span className="flex -space-x-1 shrink-0">
                {looks.slice(0, 3).map((l) => (
                  <span
                    key={l.id}
                    className="w-4 h-4 rounded-full ring-1 ring-gray-900"
                    style={{
                      background: washGradient(l)
                        ?? (l.aura
                          ? "linear-gradient(150deg, #3B2B52 0%, #17131E 45%, #24303F 100%)"
                          : l.sheetTo
                            ? `linear-gradient(180deg, ${l.sheet} 0%, ${l.sheetTo} 100%)`
                            : l.sheet),
                    }}
                  />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[0.6875rem] font-semibold text-gray-200">{fam.name}</span>
                  {famLocked && <ProTag />}
                  {holdsSelection && (
                    <span className="text-[0.5625rem] font-bold uppercase tracking-wide text-blue-300">{selectedLook.name}</span>
                  )}
                </span>
                <span className="block text-[0.625rem] text-gray-500 leading-snug">{fam.blurb}</span>
              </span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                className={`w-3.5 h-3.5 shrink-0 text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {isOpen && (
              <div className="grid grid-cols-2 gap-2 px-2.5 pb-2.5 pt-0.5">
                {looks.map((l) => (
                  <LookSwatch
                    key={l.id}
                    look={l}
                    active={selected === l.id}
                    proLocked={locked && !isFreeLook(l.id)}
                    onPick={() => onPick(l.id === DEFAULT_SWIFTLINK_LOOK ? undefined : l.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The nearest ancestor that scrolls (a pop-up's body), or null for the page. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * The part of the screen `el` can actually be seen in: its scroller's box (or
 * the window), less anything pinned over the top or bottom of it — a sticky
 * header or live preview, a fixed tab bar. Pinned things are found by what
 * they ARE (position sticky/fixed, overlapping this column, not an ancestor of
 * `el`), so a new bar anywhere in the product is respected without a number
 * here to keep in sync. 8px of air on each side.
 */
function visibleBand(el: HTMLElement, scroller: HTMLElement | null): { top: number; bottom: number } {
  const box = scroller?.getBoundingClientRect();
  let top = box ? box.top : 0;
  let bottom = box ? box.bottom : window.innerHeight;
  const mid = (top + bottom) / 2;
  const col = el.getBoundingClientRect();
  const scope = scroller ?? document.body;
  for (const n of scope.querySelectorAll<HTMLElement>('[class*="sticky"], [class*="fixed"]')) {
    if (n.contains(el)) continue;
    const pos = getComputedStyle(n).position;
    if (pos !== "sticky" && pos !== "fixed") continue;
    const b = n.getBoundingClientRect();
    if (b.width === 0 || b.height === 0 || b.right <= col.left || b.left >= col.right) continue;
    if (b.bottom <= top || b.top >= bottom) continue;
    // A full-screen layer is a BACKDROP (the wizard's dimmed overlay behind
    // its pop-up), not a bar — it covers nothing the person can see past.
    if (b.height >= (bottom - top) * 0.9) continue;
    if ((b.top + b.bottom) / 2 < mid) top = Math.max(top, b.bottom);
    else bottom = Math.min(bottom, b.top);
  }
  return { top: top + 8, bottom: bottom - 8 };
}

function IconStyleControls({
  look,
  shape,
  fill,
  onChange,
}: {
  look: ReturnType<typeof getLook>;
  shape: ReturnType<typeof normalizeIconShape>;
  fill: ReturnType<typeof normalizeIconFill>;
  onChange: (patch: Partial<SwiftLinkStyle>) => void;
}) {
  const radius = (sh: string) => (sh === "circle" ? "9999px" : sh === "squircle" ? "10px" : "5px");
  // The three demo chips preview the CURRENT selection against the CURRENT
  // Look, so what you see here is what the page renders — same contract as
  // the live preview beside the panel.
  const chipStyle = (brand: string): React.CSSProperties =>
    fill === "accent"
      ? { background: look.accent, color: look.accentText }
      : fill === "mono"
        ? look.mode === "light"
          ? { background: "#FFFFFF", color: "#111827", boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.12)" }
          : { background: "rgba(255,255,255,0.12)", color: "#FFFFFF" }
        : { background: brand, color: "#fff" };
  return (
    <div className="space-y-3">
      {/* Live chips on the Look's own sheet */}
      <div className="flex items-center justify-center gap-2.5 rounded-xl py-3" style={{ background: look.sheet }}>
        {/* The real glyphs the page draws (PlatformIcon). These used to be the
            letters "in" three times — LinkedIn's mark in Instagram pink and
            YouTube red (2026-09-22 signup review). */}
        {([["LinkedIn", "#0A66C2"], ["Instagram", "#E4405F"], ["YouTube", "#FF0000"]] as const).map(([platform, brand]) => (
          <span
            key={platform}
            aria-label={platform}
            className="w-9 h-9 flex items-center justify-center"
            style={{ ...chipStyle(brand), borderRadius: radius(shape) }}
          >
            <PlatformIcon label={platform} className="w-4 h-4" />
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {ICON_SHAPES.map((o) => {
          const active = shape === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange({ linkIconShape: o.id === "circle" ? undefined : o.id })}
              className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border text-[0.6875rem] font-semibold transition-colors disabled:opacity-40 ${
                active ? "border-blue-600 bg-blue-600/10 text-blue-200" : "border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600"
              }`}
            >
              <span className="w-4 h-4 bg-gray-300" style={{ borderRadius: radius(o.id) }} />
              {o.name}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {ICON_FILLS.map((o) => {
          const active = fill === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange({ linkIconFill: o.id === "brand" ? undefined : o.id })}
              title={o.hint}
              className={`px-2 py-2 rounded-lg border text-[0.6875rem] font-semibold transition-colors disabled:opacity-40 ${
                active ? "border-blue-600 bg-blue-600/10 text-blue-200" : "border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600"
              }`}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The header's own photo or video (owner, 2026-09-17: make "Upload photo" much
// more obvious, "+ Upload photo"). One full-width dashed button that opens the
// file picker straight away — no "select the option, then find the Choose
// button" two-step. Uploading SELECTS it (linkHeroContent "custom"); once there
// is an upload it shows as a thumbnail with Replace and Remove, and, if the
// owner went back to Auto/Headshot/Logo/Initials, a "Use it" to switch back.
// Deferred (field "hero"): the URL is persisted by the editor's normal save.
function HeroMediaUpload({
  value,
  onChange,
}: {
  value: SwiftLinkStyle;
  onChange: (patch: Partial<SwiftLinkStyle>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = value.linkHeroImage;
  const isVideo = value.linkHeroMediaType === "video";
  const active = !!url && normalizeHeroContent(value.linkHeroContent) === "custom";

  async function pick(file: File) {
    if (!isAllowedMedia(file)) { setError(WRONG_TYPE_MESSAGE); return; }
    setBusy(true);
    setError(null);
    try {
      const media = await uploadMedia(file, "hero");
      onChange({ linkHeroContent: "custom", linkHeroImage: media.url, linkHeroMediaType: media.type === "video" ? "video" : undefined });
    } catch (e) {
      setError(uploadErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(",")}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) pick(f);
        e.target.value = ""; // re-picking the same file must fire again
      }}
    />
  );

  return (
    <div className="mt-1.5">
      {input}
      {url ? (
        <div className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${active ? "border-blue-600 bg-blue-600/10" : "border-gray-700 bg-gray-800/40"}`}>
          {isVideo ? (
            <video src={`${url}#t=0.001`} muted loop autoPlay playsInline preload="auto" className="w-11 h-11 rounded-md object-cover border border-gray-700 shrink-0 bg-black" aria-label="Header video" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Header" className="w-11 h-11 rounded-md object-cover border border-gray-700 shrink-0" />
          )}
          <span className={`flex-1 min-w-0 text-[0.6875rem] font-semibold ${active ? "text-blue-200" : "text-gray-300"}`}>
            {active ? (isVideo ? "Your header video" : "Your header photo") : (isVideo ? "Your uploaded video" : "Your uploaded photo")}
          </span>
          {!active && !busy && (
            <button type="button" onClick={() => onChange({ linkHeroContent: "custom" })} className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[0.6875rem] font-semibold text-white transition-colors">
              Use it
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="px-2.5 py-1.5 rounded-lg border border-gray-700 bg-gray-800/40 text-[0.6875rem] font-semibold text-gray-300 hover:border-gray-600 transition-colors disabled:opacity-50">
            {busy ? "Uploading…" : "Replace"}
          </button>
          {!busy && (
            <button
              type="button"
              onClick={() => onChange({ linkHeroImage: undefined, linkHeroMediaType: undefined, ...(active ? { linkHeroContent: undefined } : {}) })}
              className="px-1.5 py-1.5 text-[0.6875rem] font-semibold text-gray-500 hover:text-gray-300 transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-blue-500/60 bg-blue-600/10 hover:bg-blue-600/15 hover:border-blue-400 px-3 py-2.5 text-xs font-bold text-blue-300 transition-colors disabled:opacity-60"
        >
          {busy ? "Uploading…" : <><span className="text-base leading-none">+</span> Upload photo or video</>}
        </button>
      )}
      {error && <p className="text-[0.625rem] text-red-400 mt-1.5 leading-snug">{error}</p>}
    </div>
  );
}

// ── Page background media ───────────────────────────────────────────────────
//
// Add / Edit / Remove for the photo or video behind the whole page, plus the
// two controls that only make sense once one is set: how far to darken it, and
// whether the plain link rows go frosted over it.
//
// Offered under EVERY header (owner, 2026-09-17) — see lib/swiftlink-looks.
function PageBackgroundMedia({
  value,
  onChange,
}: {
  value: SwiftLinkStyle;
  onChange: (patch: Partial<SwiftLinkStyle>) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = value.linkBgMedia;
  const isVideo = value.linkBgMediaType === "video";
  const dim = normalizePageDim(value.linkBgDim);

  async function pickFile(file: File) {
    if (!isAllowedMedia(file)) {
      setError(WRONG_TYPE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const media = await uploadMedia(file, "pagebg");
      // The type is written WITH the url, in one patch. Two patches could
      // interleave with another edit and leave a video url flagged as an
      // image, which renders an <img> pointed at an mp4 — a broken page.
      //
      // Frosting defaults ON for a first background. Side by side it is not
      // close: over a busy photo the stock translucent rows let the picture
      // read straight through the labels, and the frosted ones stay crisp.
      // `?? true` and not `|| true`: once the owner has turned it off it is
      // stored as an explicit false, and replacing the photo must not quietly
      // turn it back on.
      onChange({
        linkBgMedia: media.url,
        linkBgMediaType: media.type,
        linkGlass: value.linkGlass ?? true,
      });
    } catch (e) {
      setError(uploadErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2.5">
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
        {url ? (
          isVideo ? (
            // muted + playsInline so the thumbnail can show a frame without
            // the browser refusing to load it or making noise in the editor.
            <video
              src={`${url}#t=0.001`}
              muted
              playsInline
              preload="auto"
              className="w-12 h-12 rounded-lg object-cover border border-gray-700 shrink-0 bg-black"
              aria-label="Background video"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Page background" className="w-12 h-12 rounded-lg object-cover border border-gray-700 shrink-0" />
          )
        ) : (
          <span className="w-12 h-12 rounded-lg border border-dashed border-gray-600 bg-gray-800/40 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5 text-gray-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A1.5 1.5 0 0021.75 19.5V4.5A1.5 1.5 0 0020.25 3H3.75A1.5 1.5 0 002.25 4.5v15A1.5 1.5 0 003.75 21z" />
            </svg>
          </span>
        )}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800/40 text-[0.6875rem] font-semibold text-gray-300 hover:border-gray-600 transition-colors disabled:opacity-50 disabled:hover:border-gray-700"
          >
            {busy ? "Uploading…" : url ? "Replace" : "+ Add photo or video"}
          </button>
          {url && !busy && (
            <button
              type="button"
              // Clears the type alongside the url. Leaving a stale "video"
              // behind would mislabel the NEXT photo the owner adds.
              onClick={() => onChange({ linkBgMedia: undefined, linkBgMediaType: undefined })}
              className="px-3 py-1.5 rounded-lg text-[0.6875rem] font-semibold text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-[0.625rem] text-red-400 mt-1.5 leading-snug">{error}</p>}
      {!url && !error && (
        <p className="text-[0.625rem] text-gray-500 mt-1.5 leading-snug">
          A photo or a short video fills the page behind everything. Portrait shots fit best. Photos up to 5 MB, videos up to 25 MB.
        </p>
      )}

      {url && (
        <>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[0.625rem] text-gray-400 leading-snug">Darken</p>
              <span className="text-[0.625rem] font-semibold text-gray-400 tabular-nums">{dim}%</span>
            </div>
            {/* The readability control, not a decoration: a bright photo makes
                white text vanish, and this is the only thing that fixes it.
                Shown with the media because on its own it does nothing. */}
            <input
              type="range"
              min={0}
              max={MAX_PAGE_DIM}
              step={5}
              value={dim}
              aria-label="Darken the background"
              onChange={(e) => onChange({ linkBgDim: normalizePageDim(e.target.value) })}
              className="w-full accent-blue-500 disabled:opacity-50"
            />
            <p className="text-[0.625rem] text-gray-500 mt-0.5 leading-snug">Darker backgrounds make your name and links easier to read.</p>
          </div>

          {/* "Blur" moved to each link under Link buttons (owner, 2026-09-17). */}
        </>
      )}
    </div>
  );
}

export function SwiftLinkStyleControls({
  value,
  onChange,
  locked = false,
  links,
  onLinksChange,
  canUpload = true,
  isLinkLocked,
}: {
  value: SwiftLinkStyle;
  onChange: (patch: Partial<SwiftLinkStyle>) => void;
  locked?: boolean;
  /** Company rows on an Office card: shown in Link buttons, never restyled. */
  isLinkLocked?: (l: CardLink) => boolean;
  /** The card's additional links, for the per-link "Link buttons" section.
   *  Both editors pass them; the marketing mini-builder doesn't. */
  links?: CardLink[];
  onLinksChange?: (links: CardLink[]) => void;
  /** False where there is no signed-in account to upload against — the
   *  marketing mini-builder, whose sketch is a visitor's doodle. Every upload
   *  route answers 401 there, so the "Add" button would be a dead end; the
   *  same reasoning that gives the mini-builder no "Link buttons" section. */
  canUpload?: boolean;
}) {

  // ── SECTION ORDER IS DELIBERATE: the panel is a route, not a list ─────────
  //
  //   1 Page header → 2 Look → 3 Background & text → 4 Font
  //   5 Social icons → 6 Connect button → 7 Link buttons
  //
  // Shape first, then the whole surface, then the page's own PARTS in the order
  // a visitor scrolls past them.
  //
  // Page header leads (owner order 2026-09-15: "the page header should be first
  // because that will set how they design their whole page based off of what
  // they choose"). It is the one STRUCTURAL choice here — cover, short banner,
  // compact circle or none — and it decides how much page there is left to
  // style. It also gates the background's photo/video upload, so leading with
  // it puts the dependency in front of the control that depends on it instead
  // of behind it.
  //
  // Everything that made the previous order good is kept:
  //
  //   • Page background and Text color still sit next to the Look (owner,
  //     2026-09-10: they belong together), and still near the top, where the
  //     preview is — on a phone this step is ~3.3 screens tall with the preview
  //     pinned above, so distance from the preview is what a control costs.
  //   • The accent still lands BETWEEN the social icons and the link buttons,
  //     which is both where the Connect button sits on the page and where it
  //     has to be so nobody sets a row colour before meeting the master control
  //     those rows fall back to.
  //
  // The background section keeps its inline "switch to the compact circle"
  // button. It is now a shortcut back rather than the only way to resolve the
  // dependency, which costs nothing and saves a scroll.
  // One numbered path, the same as Card design (owner, 2026-09-16: "they
  // first choose a page header and then they choose the look and then it
  // groups the rest of those things into steps. Don't make it a million
  // steps"). The order above is kept; the two group headings became numbers,
  // and the page's own colours (background + text) share one step.
  const steps: DesignStep[] = [
    {
      key: "header",
      label: "Page header",
      help: "How your photo sits at the top — a full cover, a short banner, a compact circle, or no header at all.",
      body: (
        <>
        <div className="grid grid-cols-2 gap-1.5">
          {HERO_STYLES.map((o) => {
            const active = normalizeHeroStyle(value.linkHeroStyle) === o.id;
            return (
              <button
                key={o.id}
                type="button"
                title={o.hint}
                onClick={() => onChange({ linkHeroStyle: o.id === "cover" ? undefined : o.id })}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[0.6875rem] font-semibold text-left transition-colors ${
                  active ? "border-blue-600 bg-blue-600/10 text-blue-200" : "border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600"
                }`}
              >
                {/* Mini page sketch: cover = tall photo band; banner = short
                    band; avatar = small circle; none = just content lines */}
                <span className="w-7 h-9 rounded-[5px] bg-gray-900 border border-gray-600 overflow-hidden flex flex-col items-center shrink-0">
                  {o.id === "cover" ? (
                    <><span className="w-full h-4 bg-gray-400" /><span className="mt-1 h-[3px] w-4 rounded bg-gray-500" /></>
                  ) : o.id === "banner" ? (
                    <><span className="w-full h-2.5 bg-gray-400" /><span className="mt-1 h-[3px] w-4 rounded bg-gray-500" /><span className="mt-0.5 h-[3px] w-4 rounded bg-gray-600" /></>
                  ) : o.id === "avatar" ? (
                    <><span className="mt-1.5 w-3 h-3 rounded-full bg-gray-400" /><span className="mt-1 h-[3px] w-4 rounded bg-gray-500" /></>
                  ) : (
                    <><span className="mt-1.5 h-[3px] w-4 rounded bg-gray-500" /><span className="mt-1 h-[3px] w-4 rounded bg-gray-600" /><span className="mt-1 h-[3px] w-4 rounded bg-gray-600" /></>
                  )}
                </span>
                {o.name}
              </button>
            );
          })}
        </div>
        {/* What the header shows — hidden for "No header" (nothing to show). */}
        {normalizeHeroStyle(value.linkHeroStyle) !== "none" && (
          <div className="mt-2.5">
            <p className="text-[0.625rem] text-gray-500 mb-1.5 leading-snug">Header shows — Auto uses your headshot, else your logo, else initials. Or upload your own photo or video.</p>
            <div className="grid grid-cols-4 gap-1.5">
              {HERO_CONTENTS.filter((o) => o.id !== "custom").map((o) => {
                const active = normalizeHeroContent(value.linkHeroContent) === o.id
                  // "custom" with nothing uploaded renders Auto, so Auto reads as picked.
                  || (o.id === "auto" && normalizeHeroContent(value.linkHeroContent) === "custom" && !value.linkHeroImage);
                return (
                  <button
                    key={o.id}
                    type="button"
                    title={o.hint}
                    onClick={() => onChange({ linkHeroContent: o.id === "auto" ? undefined : o.id })}
                    className={`px-1 py-2 rounded-lg border text-[0.6875rem] font-semibold transition-colors ${
                      active ? "border-blue-600 bg-blue-600/10 text-blue-200" : "border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    {o.name}
                  </button>
                );
              })}
            </div>
            {canUpload && <HeroMediaUpload value={value} onChange={onChange} />}
          </div>
        )}
        </>
      ),
    },
    {
      key: "look",
      label: "Look",
      help: "One tap sets the whole page — background, text, and button color, composed to read well together. Open a style below to see its designs.",
      body: (
        <>
        {/* Picking a Look also clears the fine-tune background/text overrides:
            they'd win over the Look at render time, so a stale custom color
            would make every Look "not work" until the user found and reset it. */}
        <LookPicker value={value.linkLook} onPick={(v) => onChange({ linkLook: v, linkBgColor: undefined, linkTextColor: undefined, linkButtonColor: undefined, linkAccentColor: undefined })} locked={locked} />
        {locked && (
          <p className="text-[0.625rem] text-gray-500 mt-2 leading-snug">Paper and Onyx are included free — the rest of the library comes with Pro.</p>
        )}
        </>
      ),
    },
    {
      key: "colors",
      label: "Background & text",
      body: (
        <>
        <p className={`${rowLabel} mb-0.5`}>Page background{locked && <span className="ml-1.5 align-middle"><ProTag /></span>}</p>
        <p className="text-[0.625rem] text-gray-500 mb-1.5 leading-snug">
          A colour, or a photo or video filling the whole page behind your links.
        </p>
        <SwatchRow
          presets={BG_PRESETS}
          value={value.linkBgColor}
          fallbackHex={LINK_DEFAULT_BG}
          onPick={(v) => onChange({ linkBgColor: v })}
          customLocked={locked}
        />
        {/* Every header (owner, 2026-09-17). With a cover or banner the header
            photo dissolves into it on the page. */}
        {canUpload && <PageBackgroundMedia value={value} onChange={onChange} />}
        <div className="mt-4">
        {/* Tagged like Page background: a text colour is Pro on save
            (proLinkFeaturesInUse, "Your own colors and font"), so it says so. */}
        <p className={`${rowLabel} mb-0.5`}>Text color{locked && <span className="ml-1.5 align-middle"><ProTag /></span>}</p>
        <p className="text-[0.625rem] text-gray-500 mb-1.5 leading-snug">Your name, bio and link labels.</p>
        <SwatchRow
          presets={TEXT_PRESETS}
          value={value.linkTextColor}
          fallbackHex={LINK_DEFAULT_TEXT}
          onPick={(v) => onChange({ linkTextColor: v })}
          customLocked={locked}
        />
        </div>
        </>
      ),
    },
    {
      key: "font",
      label: "Font",
      help: "Sets the typeface across your Swift Links page.",
      // Any font but Default is Pro on save (proLinkFeaturesInUse).
      trailing: locked ? <ProTag /> : undefined,
      body: (
        <div className="grid grid-cols-2 gap-1.5">
          {[{ label: "Default", value: undefined as string | undefined }, ...CARD_FONT_OPTIONS].map((o) => {
            const active = value.linkFontFamily === o.value || (value.linkFontFamily == null && o.value == null);
            return (
              <button
                key={o.label}
                type="button"
                onClick={() => onChange({ linkFontFamily: o.value })}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                  active ? "border-blue-600 bg-blue-600/10" : "border-gray-700 hover:border-gray-600 bg-gray-800/40"
                }`}
              >
                <span className={`text-xs ${active ? "text-blue-200" : "text-gray-300"}`}>{o.label}</span>
                <span className="text-base leading-none text-white" style={{ fontFamily: o.value }}>Ag</span>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      key: "icons",
      label: "Social icons",
      help: "The shape and color of your social chips.",
      trailing: locked ? <ProTag /> : undefined,
      body: (
        <IconStyleControls
          look={getLook(value.linkLook)}
          shape={normalizeIconShape(value.linkIconShape)}
          fill={normalizeIconFill(value.linkIconFill)}
          onChange={onChange}
        />
      ),
    },
    // The accent sits between the social icons and the link buttons: that is
    // where the Connect button sits on the page, and it is the colour BOTH of
    // its neighbours fall back to.
    {
      key: "connect",
      label: "Connect button",
      help: "Your page's action color — the Connect button, and your social icons when they're set to Accent. Default uses your Look's own.",
      trailing: locked ? <ProTag /> : undefined,
      body: (
        <SwatchRow
          presets={ACCENT_PRESETS}
          value={value.linkAccentColor}
          fallbackHex={getLook(value.linkLook).accent}
          onPick={(v) => onChange({ linkAccentColor: v })}
          customLocked={locked}
        />
      ),
    },
    // Per-link looks — wherever the caller owns the links.
    ...(links && onLinksChange
      ? [{
          key: "links",
          label: "Link buttons",
          help: "Choose how each additional link appears. Featured and Grid show a big preview you can swap for your own photo or video; Compact is a slim row you can style.",
          trailing: locked ? <ProTag /> : undefined,
          body: (
            <>
          <LinkButtonsControls links={links} onChange={onLinksChange} pageRowStyle={value.linkButtonStyle} pageGlass={!!value.linkGlass && !!value.linkBgMedia} canUpload={canUpload} isLocked={isLinkLocked} />
          {links.some((l) => l.kind !== "header" && (l.size ?? "grid") === "compact" && resolveRowStyle(l, value.linkButtonStyle) !== "tile") && (
            <div className="mt-2.5">
              <p className="text-[0.625rem] text-gray-500 mb-1.5 leading-snug">Button color for Solid and Outline rows — leave Default to match your Connect button.</p>
              <SwatchRow
                presets={ACCENT_PRESETS}
                value={value.linkButtonColor}
                // The EFFECTIVE accent, not the Look's raw one: with a custom
                // Connect colour set, a "Default" swatch showing the Look's
                // would preview a colour these rows never render.
                fallbackHex={value.linkAccentColor || getLook(value.linkLook).accent}
                onPick={(v) => onChange({ linkButtonColor: v })}
                customLocked={locked}
              />
            </div>
          )}
            </>
          ),
        }]
      : []),
  ];

  return <DesignSteps steps={steps} label="Design your Swift Links page, step by step" name="swiftlinks" />;
}

