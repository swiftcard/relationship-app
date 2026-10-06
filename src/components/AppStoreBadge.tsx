import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/app-store";
import NativeHidden from "@/components/NativeHidden";

// ── The one "Download on the App Store" badge ────────────────────────────────
//
// Every download surface on the marketing site and in the post-signup flow
// renders THIS. It used to be copy-pasted markup in the homepage hero and the
// footer, which is how two badges on one page end up different sizes with
// different hover states — and how a change like the shine below lands on one
// and not the other.
//
// Self-activating, same contract as every other APP_STORE_URL consumer: renders
// nothing until the env var is set, so it is safe to place anywhere before a
// listing exists (see lib/app-store.ts).
//
// NOT a client component — it has no interactivity, so server-rendered pages
// (homepage, footer) keep shipping zero JS for it. The shine is pure CSS.

type Size = "sm" | "pair";

const SIZES: Record<Size, { pad: string; glyph: string; top: string; main: string; gap: string; radius: string }> = {
  // Desktop nav bar: renders 120×40, which fits the 64px bar beside Log in and
  // Get started free without crowding either. Desktop only — the mobile bar has
  // no room for it at any size (the logo, the primary CTA and the menu trigger
  // already fill a 375px row), which is why the nav badge is inside a
  // `hidden lg:flex` cluster and there is no phone equivalent.
  sm: { pad: "px-3 py-1.5", glyph: "w-[17px] h-[17px]", top: "text-[0.5625rem]", main: "text-[0.78125rem]", gap: "gap-2", radius: "rounded-xl" },
  // Phone hero (owner, 2026-10-06): App Store + Google Play as a matched pair,
  // each half of a two-column grid under the full-width "See how it works".
  // Fixed 52px so the two are identical whatever their label widths; natural
  // width again from sm up, where the pair sits inline.
  pair: { pad: "sc-asb-pair w-full sm:w-auto h-[52px] justify-center px-3 sm:px-5", glyph: "w-6 h-6", top: "text-[0.625rem] tracking-[0.02em]", main: "text-[1.0625rem]", gap: "gap-2.5", radius: "rounded-[14px]" },
};

// ONE LOOK, everywhere (owner, 2026-09-18): the desktop header's. There used
// to be a "black" and a "glass" tone, and on the cream app theme the black one
// lost its "App Store" line entirely — the light theme remaps .text-white to
// near-black, so it rendered black on black. The colours now live in
// globals.css (.sc-appstore-badge), under class names no theme remap touches:
// the pill is always the header's dark glass and its words are always white.
// Size is the header's (`sm`, 120×40) everywhere except the phone hero's
// matched `pair`.

export function AppleGlyph({ className, color = "#fff" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className ?? ""} shrink-0`} fill={color}>
      <path d="M16.365 1.43c0 1.14-.417 2.2-1.11 2.98-.75.84-1.98 1.49-3.02 1.4-.13-1.09.42-2.24 1.09-2.98.76-.85 2.07-1.47 3.04-1.4zM20.5 17.02c-.55 1.27-.82 1.84-1.53 2.96-.99 1.57-2.39 3.52-4.12 3.53-1.54.01-1.93-1-4.02-.99-2.09.01-2.52 1.01-4.06.99-1.73-.02-3.06-1.78-4.05-3.35-2.77-4.38-3.06-9.52-1.35-12.25 1.21-1.94 3.13-3.08 4.94-3.08 1.84 0 3 1.01 4.52 1.01 1.48 0 2.38-1.01 4.51-1.01 1.61 0 3.32.88 4.54 2.39-3.99 2.19-3.34 7.88.1 9.25z" />
    </svg>
  );
}

export default function AppStoreBadge({
  size = "sm",
  className = "",
  onClick,
}: {
  size?: Size;
  className?: string;
  /** Extra work on tap (the post-signup popup closes itself). Client callers only. */
  onClick?: () => void;
}) {
  if (!APP_STORE_URL) return null;
  const s = SIZES[size];

  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Download on the App Store"
      onClick={onClick}
      // overflow-hidden clips the shine to the pill; relative is what it anchors
      // to. Both are load-bearing — without them the sweep runs across whatever
      // sits next to the badge.
      className={`sc-appstore-badge relative overflow-hidden inline-flex items-center ${s.gap} ${s.radius} ${s.pad} transition-colors ${className}`}
    >
      <AppleGlyph className={s.glyph} />
      <span className="leading-tight">
        <span className={`sc-asb-top block ${s.top}`}>Download on the{" "}</span>
        <span className={`sc-asb-main block font-semibold ${s.main} tracking-tight`}>App&nbsp;Store</span>
      </span>
      <span className="rd-appstore-shine" aria-hidden="true" />
    </a>
  );
}

/** Google Play's four-colour play mark, sized like AppleGlyph. */
function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className ?? ""} shrink-0`}>
      <path fill="#00D7FE" d="M3.6 1.8c-.3.3-.4.8-.4 1.4v17.6c0 .6.1 1.1.4 1.4l.1.1L13.5 12.5v-.2L3.7 1.7z" />
      <path fill="#FFCE00" d="M16.8 15.8l-3.3-3.3v-.2l3.3-3.3.1.1 3.9 2.2c1.1.6 1.1 1.7 0 2.3l-3.9 2.2z" />
      <path fill="#FF3A44" d="M16.9 15.7l-3.4-3.3L3.6 22.3c.4.4 1 .4 1.7.1l11.6-6.7" />
      <path fill="#00F076" d="M16.9 9.1L5.3 2.5c-.7-.4-1.3-.3-1.7.1l9.9 9.9z" />
    </svg>
  );
}

/**
 * "Get it on Google Play" — the App Store badge's twin: same sizes, same dark
 * pill (.sc-appstore-badge), so the pair reads as one row wherever both sit.
 * Renders nothing until PLAY_STORE_URL is set (lib/app-store.ts), and never
 * inside the iOS shell: an Android download button in an iPhone app is noise
 * at best and an App Review 2.3.10 flag at worst.
 */
export function GooglePlayBadge({ size = "sm", className = "" }: { size?: Size; className?: string }) {
  if (!PLAY_STORE_URL) return null;
  const s = SIZES[size];
  return (
    <NativeHidden>
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Get it on Google Play"
        className={`sc-appstore-badge relative overflow-hidden inline-flex items-center ${s.gap} ${s.radius} ${s.pad} transition-colors ${className}`}
      >
        <PlayGlyph className={s.glyph} />
        <span className="leading-tight">
          <span className={`sc-asb-top block uppercase ${s.top}`}>Get it on{" "}</span>
          <span className={`sc-asb-main block font-semibold ${s.main} tracking-tight`}>Google&nbsp;Play</span>
        </span>
        <span className="rd-appstore-shine" aria-hidden="true" />
      </a>
    </NativeHidden>
  );
}

/**
 * The "you just made a card — now get the app" block.
 *
 * Placed at the ONE moment someone has proved they want this product and has
 * nothing else to do: the "Your card is live!" screen. There are two of those
 * screens (the /welcome page after signup, and step 5 of the card wizard for an
 * already-signed-in user), and they must not drift apart, so both render this.
 *
 * It sits directly under the notifications switch on purpose. On iPhone those
 * two are the same story — web push needs the site added to the home screen,
 * while the app just asks — so the switch above is the strongest possible
 * argument for the badge below. It goes BEFORE the continue button and never
 * replaces it: the card is created either way, and this must not read as a step
 * standing between the user and their dashboard.
 *
 * NativeHidden because inside the app itself this is nonsense.
 */
export function GetTheAppCard({ className = "" }: { className?: string }) {
  if (!APP_STORE_URL && !PLAY_STORE_URL) return null;
  return (
    <NativeHidden>
      <div className={`rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-center ${className}`}>
        <p className="text-sm font-semibold text-gray-100">{PLAY_STORE_URL ? "Get the SwiftCard app" : "Get SwiftCard on iPhone"}</p>
        <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-gray-400">
          Share your card with a tap, keep it in Apple Wallet, and see who viewed it — right from your phone.
        </p>
        <div className="mt-3.5 flex flex-wrap justify-center gap-2.5">
          {/* The header's badge, like every other one. Its colours are fixed
              (globals.css .sc-appstore-badge), so it reads on this card's
              light AND dark screens (/welcome, the builder). */}
          <AppStoreBadge />
          <GooglePlayBadge />
        </div>
      </div>
    </NativeHidden>
  );
}

