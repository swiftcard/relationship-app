import { readFile } from "node:fs/promises";
import { join } from "node:path";

// THE brand link-preview picture. Rendered by src/app/opengraph-image.tsx for
// the homepage and every marketing page, and by the per-card preview route as
// its fallback for a card that is offline/deleted or fails to render, so a
// swiftcard.me link unfurls with the same picture everywhere a real card
// can't be shown.
//
// It is the homepage hero as a still (owner, 2026-10-05: "more realistic with
// our actual product"): the light hero backdrop, the real headline with the
// words it rotates through, the hero's own subtitle and four feature lines,
// and on the right real SwiftCard phones. The phones are not drawn here —
// public/og/phone-*.png are screenshots of the live homepage hero's centre
// phone (Realtor in front, Attorney and Insurance behind, the way the hero
// cycles through people). Re-capture them if that phone's design changes.
//
// A preview is a PNG, so it cannot animate. The rotation is shown instead:
// "your number / your links / your socials" sit above "everything", which
// carries the hero's swoosh underline.
//
// Every external input is optional: a failed font fetch falls back to the
// Geist that next/og bundles, a missing asset simply leaves its slot out,
// and the image still renders. Text is Latin-1 only so no glyph can be
// missing from the bundled font.

const INK = "#0f172a";
const BODY = "#334155";
const BLUE = "#2563eb";

export type BrandOgFont = { name: string; data: ArrayBuffer; weight: 500 | 700 | 800; style: "normal" };

export type BrandOgInputs = {
  logo: string | null;
  /** Real homepage phone screenshots: the front one and the two behind it. */
  phones: { front: string | null; left: string | null; right: string | null };
  fonts: BrandOgFont[];
  headlineFont: "Bricolage" | "Geist";
};

async function asset(rel: string, mime: string): Promise<string | null> {
  try {
    const buf = await readFile(join(process.cwd(), "public", rel));
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// Google Fonts hands out TTFs (which Satori can read) when no browser UA is
// sent. Each family is independent and optional, and bounded so a slow font
// host can never hold up a preview.
async function googleFont(css: string, timeoutMs: number): Promise<ArrayBuffer | null> {
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const sheet = await fetch(`https://fonts.googleapis.com/css2?family=${css}&display=swap`, {
      headers: { "User-Agent": "" },
      signal,
    }).then((r) => r.text());
    const url = sheet.match(/src:\s*url\(([^)]+\.ttf)\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal });
    return res.ok ? res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** Reads the logo + phone screenshots from public/ and fetches the three font cuts. */
export async function loadBrandOgInputs(fontTimeoutMs = 8000): Promise<BrandOgInputs> {
  const [logo, front, left, right, display, sans, sansBold] = await Promise.all([
    asset("brand-icon-192.png", "image/png"),
    asset("og/phone-realtor.png", "image/png"),
    asset("og/phone-attorney.png", "image/png"),
    asset("og/phone-insurance.png", "image/png"),
    googleFont("Bricolage+Grotesque:opsz,wght@12..96,800", fontTimeoutMs),
    googleFont("Geist:wght@500", fontTimeoutMs),
    googleFont("Geist:wght@700", fontTimeoutMs),
  ]);
  const fonts = [
    display && { name: "Bricolage", data: display, weight: 800 as const, style: "normal" as const },
    sans && { name: "Geist", data: sans, weight: 500 as const, style: "normal" as const },
    sansBold && { name: "Geist", data: sansBold, weight: 700 as const, style: "normal" as const },
  ].filter(Boolean) as BrandOgFont[];
  return { logo, phones: { front, left, right }, fonts, headlineFont: display ? "Bricolage" : "Geist" };
}

// The hero's four feature lines, word for word, with its own icons.
const FEATURES: Array<{ t: string; d: string }> = [
  { t: "Share by link, QR code or NFC", d: "M9 15l6-6M11 6l1.2-1.2a4 4 0 015.6 5.6L16.6 11.6M13 18l-1.2 1.2a4 4 0 01-5.6-5.6L7.4 12.4" },
  { t: "Saved in one tap, no app", d: "M20 7L9.5 17.5 4 12" },
  { t: "Auto email & text follow-ups", d: "M4 6h16v12H4zM4 7l8 6 8-6" },
  { t: "Link in Bio + Email Signature", d: "M12 3l2.4 5.6L20 9.3l-4.3 3.9 1.2 5.8L12 16l-4.9 3 1.2-5.8L4 9.3l5.6-.7z" },
];

// Phone screenshots are 520x1107 (the hero phone at 2x, frame included).
const PHONE_RATIO = 1107 / 520;

function Phone({ src, width, left, top, rotate, shadow }: { src: string | null; width: number; left: number; top: number; rotate: number; shadow: string }) {
  if (!src) return null;
  const height = Math.round(width * PHONE_RATIO);
  return (
    <div style={{ position: "absolute", left, top, width, height, display: "flex", transform: `rotate(${rotate}deg)` }}>
      {/* The shadow lives on a rounded box the phone's own shape, since an
          image's transparent corners would otherwise cast a square one. */}
      <div style={{ position: "absolute", left: 4, top: 6, width: width - 8, height: height - 12, borderRadius: width * 0.16, boxShadow: shadow, display: "flex" }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={width} height={height} alt="" style={{ position: "absolute", left: 0, top: 0, width, height }} />
    </div>
  );
}

/**
 * The picture itself, 1200 wide. `height` is 630 for the site-wide image and
 * 686 for the card route (which keeps the card's own 1.75:1 frame); the extra
 * rows are split above and below so the composition stays centred.
 */
export function BrandOg({ logo, phones, headlineFont, height = 630 }: Omit<BrandOgInputs, "fonts"> & { height?: 630 | 686 }) {
  const H = height;
  const dy = Math.round((H - 630) / 2);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: "#f6f8fc",
        color: INK,
        fontFamily: "Geist",
      }}
    >
      {/* Backdrop: the hero's bright, airy feel. Near-white with a soft blue
          aura behind the phones and a faint violet wash low-left. */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: H, background: "linear-gradient(120deg, #ffffff 0%, #f5f7fd 50%, #eaf0fd 100%)", display: "flex" }} />
      <div
        style={{
          position: "absolute",
          left: 660,
          top: -140 + dy,
          width: 720,
          height: 720,
          borderRadius: 720,
          background: "radial-gradient(circle at center, rgba(59,130,246,0.30) 0%, rgba(59,130,246,0.10) 42%, rgba(59,130,246,0) 70%)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -220,
          top: 360 + dy,
          width: 640,
          height: 640,
          borderRadius: 640,
          background: "radial-gradient(circle at center, rgba(139,92,246,0.12) 0%, rgba(139,92,246,0) 65%)",
          display: "flex",
        }}
      />

      {/* LEFT: brand, headline, subtitle, features */}
      <div
        style={{
          position: "absolute",
          left: 64,
          top: 0,
          height: H,
          width: 640,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 26 }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} width={52} height={52} alt="" style={{ width: 52, height: 52, borderRadius: 13 }} />
          ) : null}
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1, lineHeight: 1, color: INK }}>SwiftCard</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", fontFamily: headlineFont, fontWeight: 800, fontSize: 52, letterSpacing: -1.8, lineHeight: 1.04, color: INK }}>
          <div style={{ display: "flex" }}>The digital business card</div>
          <div style={{ display: "flex" }}>that shares</div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 2 }}>
            <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 64,
                  backgroundImage: "linear-gradient(90deg, #1D3FB8 0%, #2563EB 46%, #4DA8F5 100%)",
                  backgroundClip: "text",
                  color: "transparent",
                  paddingBottom: 6,
                }}
              >
                everything
              </div>
              <svg width="318" height="20" viewBox="0 0 300 20" preserveAspectRatio="none" style={{ position: "absolute", left: 0, bottom: -10 }}>
                <defs>
                  <linearGradient id="sw" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor="#1D3FB8" />
                    <stop offset="46%" stopColor="#2563EB" />
                    <stop offset="100%" stopColor="#4DA8F5" />
                  </linearGradient>
                </defs>
                <path d="M4 14 C 70 4, 150 3, 296 9" fill="none" stroke="url(#sw)" strokeWidth="5" strokeLinecap="round" />
              </svg>
            </div>
            {/* The rotating word, as a still: what it cycles through before
                landing on "everything", fading in toward it. */}
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 26, paddingLeft: 16, borderLeft: "2px solid rgba(37,99,235,0.18)", fontFamily: "Geist", fontWeight: 700, fontSize: 20, letterSpacing: -0.3, lineHeight: 1.3 }}>
              <div style={{ display: "flex", color: "rgba(37,99,235,0.42)" }}>your number</div>
              <div style={{ display: "flex", color: "rgba(37,99,235,0.64)" }}>your links</div>
              <div style={{ display: "flex", color: "rgba(37,99,235,0.88)" }}>your socials</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 23, color: BODY, marginTop: 34, lineHeight: 1.3, fontWeight: 500 }}>
          Saves you in one tap, and does the follow-ups for you.
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 24, width: 620, rowGap: 14 }}>
          {FEATURES.map((f, i) => (
            <div key={f.t} style={{ display: "flex", alignItems: "center", gap: 10, width: i % 2 ? 290 : 320, fontSize: 18, fontWeight: 700, color: INK }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: "rgba(37,99,235,0.10)",
                  border: "1px solid rgba(37,99,235,0.22)",
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={BLUE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.d} />
                </svg>
              </div>
              {f.t}
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT: real SwiftCards on real phones — one in front, two behind,
          the way the homepage hero cycles through people. */}
      <Phone src={phones.left} width={200} left={716} top={112 + dy} rotate={-8} shadow="0 24px 50px rgba(15,23,42,0.22)" />
      <Phone src={phones.right} width={200} left={972} top={112 + dy} rotate={8} shadow="0 24px 50px rgba(15,23,42,0.22)" />
      <Phone src={phones.front} width={246} left={828} top={50 + dy} rotate={0} shadow="0 34px 70px rgba(15,23,42,0.34), 0 8px 20px rgba(15,23,42,0.18)" />

      <div style={{ position: "absolute", left: 0, bottom: 0, width: 1200, height: 5, display: "flex", background: `linear-gradient(90deg, #1D3FB8, ${BLUE}, #4DA8F5, rgba(77,168,245,0))` }} />
    </div>
  );
}
