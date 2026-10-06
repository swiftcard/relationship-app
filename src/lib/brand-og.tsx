import { readFile } from "node:fs/promises";
import { join } from "node:path";

// THE brand link-preview picture. Rendered by src/app/opengraph-image.tsx for
// the homepage and every marketing page, and by the per-card preview route as
// its fallback for a card that is offline/deleted or fails to render, so a
// swiftcard.me link unfurls with the same picture everywhere a real card
// can't be shown: the real logo tile (never a lettered stand-in), the site's
// display face for the headline, and a floating card on the right.
//
// Every external input is optional: a failed font fetch falls back to the
// Geist that next/og bundles, a missing asset simply leaves its slot out,
// and the image still renders. Text is Latin-1 only so no glyph can be
// missing from the bundled font.

const ACCENT = "#2563eb";
// Dana (ClassicPro persona from the homepage showcase) — a real-looking card
// with a real headshot, the same one the hero rotates through.
const CARD_BG = "linear-gradient(160deg, #1c3a5e 0%, #2f6f8f 100%)";

// A tiny QR-looking block grid so the card reads as "scannable" at a glance.
// Three finder squares + a deterministic scatter; no real payload.
function MiniQR({ size: px }: { size: number }) {
  const n = 9;
  const cell = px / n;
  const finder = (r: number, c: number) => (r < 3 && c < 3) || (r < 3 && c >= n - 3) || (r >= n - 3 && c < 3);
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let on: boolean;
      if (finder(r, c)) {
        const rr = r % (n - 3) >= 3 ? r - (n - 3) : r;
        const cc = c >= n - 3 ? c - (n - 3) : c;
        on = rr === 0 || rr === 2 || cc === 0 || cc === 2 || (rr === 1 && cc === 1);
      } else {
        on = ((r * 7 + c * 13 + (r * c) % 5) % 3) !== 0;
      }
      if (!on) continue;
      cells.push(
        <div
          key={`${r}-${c}`}
          style={{ position: "absolute", left: c * cell, top: r * cell, width: cell - 1, height: cell - 1, background: "#0f172a", borderRadius: 1 }}
        />
      );
    }
  }
  return (
    <div style={{ display: "flex", position: "relative", width: px, height: px, background: "#ffffff", borderRadius: 8, padding: 0 }}>
      <div style={{ display: "flex", position: "relative", width: px, height: px, transform: "scale(0.82)" }}>{cells}</div>
    </div>
  );
}


export type BrandOgFont = { name: string; data: ArrayBuffer; weight: 500 | 700 | 800; style: "normal" };

export type BrandOgInputs = {
  logo: string | null;
  photo: string | null;
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

/** Reads the logo + persona photo from public/ and fetches the three font cuts. */
export async function loadBrandOgInputs(fontTimeoutMs = 8000): Promise<BrandOgInputs> {
  const [logo, photo, display, sans, sansBold] = await Promise.all([
    asset("brand-icon-192.png", "image/png"),
    asset("showcase/dana.jpg", "image/jpeg"),
    googleFont("Bricolage+Grotesque:opsz,wght@12..96,800", fontTimeoutMs),
    googleFont("Geist:wght@500", fontTimeoutMs),
    googleFont("Geist:wght@700", fontTimeoutMs),
  ]);
  const fonts = [
    display && { name: "Bricolage", data: display, weight: 800 as const, style: "normal" as const },
    sans && { name: "Geist", data: sans, weight: 500 as const, style: "normal" as const },
    sansBold && { name: "Geist", data: sansBold, weight: 700 as const, style: "normal" as const },
  ].filter(Boolean) as BrandOgFont[];
  return { logo, photo, fonts, headlineFont: display ? "Bricolage" : "Geist" };
}

/**
 * The picture itself, 1200 wide. `height` is 630 for the site-wide image and
 * 686 for the card route (which keeps the card's own 1.75:1 frame); the extra
 * rows are split above and below so the composition stays centred.
 */
export function BrandOg({ logo, photo, headlineFont, height = 630 }: Omit<BrandOgInputs, "fonts"> & { height?: 630 | 686 }) {
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
          background: "#05081a",
          color: "#ffffff",
          fontFamily: "Geist",
        }}
      >
        {/* Backdrop: deep navy with a royal-blue aura behind the card and a
            faint cool wash top-left so the dark isn't flat. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1200,
            height: H,
            background: "linear-gradient(135deg, #0c1430 0%, #05081a 55%, #040615 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 640,
            top: -120,
            width: 760,
            height: 760,
            borderRadius: 760,
            background: "radial-gradient(circle at center, rgba(37,99,235,0.55) 0%, rgba(37,99,235,0.18) 38%, rgba(37,99,235,0) 68%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -200,
            top: 380 + dy,
            width: 620,
            height: 620,
            borderRadius: 620,
            background: "radial-gradient(circle at center, rgba(99,102,241,0.22) 0%, rgba(99,102,241,0) 65%)",
          }}
        />
        {/* Hairline grid, barely there, for a product feel. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1200,
            height: H,
            backgroundImage:
              "linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* LEFT: brand + headline */}
        <div
          style={{
            position: "absolute",
            left: 72,
            top: 0,
            height: H,
            width: 600,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 36 }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} width={64} height={64} alt="" style={{ width: 64, height: 64, borderRadius: 15 }} />
            ) : null}
            <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1.2, lineHeight: 1 }}>SwiftCard</div>
          </div>

          <div
            style={{
              display: "flex",
              fontFamily: headlineFont,
              fontSize: 62,
              fontWeight: 800,
              lineHeight: 1.0,
              letterSpacing: -2,
              maxWidth: 580,
            }}
          >
            The digital business card that shares everything.
          </div>

          <div style={{ display: "flex", fontSize: 26, color: "#a5b4cf", marginTop: 26, lineHeight: 1.35, maxWidth: 540, fontWeight: 500 }}>
            Tap, QR, Apple Wallet or link. Built-in lead capture and automatic follow-up.
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 34 }}>
            {["Tap", "QR", "Apple Wallet", "Link"].map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  padding: "9px 16px",
                  borderRadius: 999,
                  fontSize: 20,
                  fontWeight: 500,
                  color: "#dbe4ff",
                  background: "rgba(59,130,246,0.14)",
                  border: "1px solid rgba(96,165,250,0.35)",
                }}
              >
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: a floating SwiftCard. Tilted a touch, glowing, so the preview
            shows the product instead of describing it. */}
        <div
          style={{
            position: "absolute",
            left: 690,
            top: 150 + dy,
            width: 440,
            height: 251,
            display: "flex",
            transform: "rotate(-6deg)",
          }}
        >
          {/* Ghost card behind for depth */}
          <div
            style={{
              position: "absolute",
              left: 22,
              top: 26,
              width: 440,
              height: 251,
              borderRadius: 28,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 440,
              height: 251,
              borderRadius: 28,
              background: CARD_BG,
              boxShadow: "0 40px 90px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.12), 0 0 80px rgba(37,99,235,0.35)",
              display: "flex",
              flexDirection: "column",
              padding: "26px 28px",
              color: "#f2fbff",
              overflow: "hidden",
            }}
          >
            {/* frosted sheen */}
            <div
              style={{
                position: "absolute",
                left: -60,
                top: -120,
                width: 520,
                height: 260,
                borderRadius: 260,
                background: "radial-gradient(circle at center, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%)",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo}
                  width={84}
                  height={84}
                  alt=""
                  style={{ width: 84, height: 84, borderRadius: 84, objectFit: "cover", border: "3px solid rgba(255,255,255,0.85)" }}
                />
              ) : null}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.6, lineHeight: 1.05 }}>Dana Whitfield</div>
                <div style={{ fontSize: 18, fontWeight: 500, color: "rgba(242,251,255,0.82)", marginTop: 6 }}>Insurance Advisor</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#ffffff", marginTop: 2 }}>Beacon Mutual</div>
              </div>
            </div>

            <div style={{ display: "flex", flexGrow: 1 }} />

            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "11px 20px",
                    borderRadius: 999,
                    background: "#ffffff",
                    color: "#1c3a5e",
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  Save contact
                </div>
                <div style={{ display: "flex", fontSize: 15, fontWeight: 500, color: "rgba(242,251,255,0.7)" }}>swiftcard.me/danawhitfield</div>
              </div>
              <MiniQR size={76} />
            </div>
          </div>
        </div>

        {/* Floating “Tap to share” chip near the card — the NFC moment. */}
        <div
          style={{
            position: "absolute",
            left: 650,
            top: 436 + dy,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 18px",
            borderRadius: 999,
            background: "rgba(5,8,26,0.85)",
            border: "1px solid rgba(96,165,250,0.45)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            color: "#ffffff",
            fontSize: 19,
            fontWeight: 700,
          }}
        >
          <div style={{ display: "flex", width: 10, height: 10, borderRadius: 10, background: "#22c55e", boxShadow: "0 0 12px #22c55e" }} />
          Lead captured · follow-up sent
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: 1200, height: 4, display: "flex", background: `linear-gradient(90deg, ${ACCENT}, #7c3aed, transparent)` }} />
      </div>
  );
}
