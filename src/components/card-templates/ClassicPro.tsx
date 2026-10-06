// ClassicPro — Executive Navy
// Style: Navy branding panel + white info panel
// Includes: Logo, name, title, phone, email, website, social row, QR
// Best for: Finance, consulting, legal, corporate, healthcare

import { isDarkBg, panelBackground } from "@/lib/template-style";
import { MiniQR as QR } from "./MiniQR";
import type { CardData } from "./types";
import { cardAspect, ContactRows, fitFactor, fitCompany, splitLogoRow, fitTitleFluid, titleBox, fitName, heroGrow, logoStyle, logoCircleStyle, cardLogoShape, qrSize, templateStyle, CARD_BASE_FONT, infoPaletteFrom, IcoLinkedIn, IcoInsta, IcoX, IcoTikTok, nameClass, textWidthFactor, cardFontClass } from "./shared";
import PanelVideo from "./PanelVideo";

const NAVY = "#0e1b35";
const BLUE_DEFAULT = "#2563eb";

export default function ClassicPro({ data }: { data: CardData }) {
  const style = templateStyle(data);
  const BLUE = style.accentColor ?? BLUE_DEFAULT;
  const panelBg = panelBackground(style, `linear-gradient(160deg, ${NAVY} 0%, #162947 100%)`);
  // The info panel is restylable now, and its presets include deep shades.
  // Offering a dark surface while the details stay navy ink would hand
  // someone an unreadable card, so the whole right side flips together.
  const infoSurface = style.surfaceColor ?? "#fff";
  const darkInfo = isDarkBg(infoSurface);
  const infoInk = darkInfo
    ? { strong: "#ffffff", mid: "#e5e7eb", soft: "#d1d5db", muted: "#9ca3af" }
    : { strong: NAVY, mid: "#334155", soft: "#475569", muted: "#64748b" };
  const f = fitFactor(data); // auto-fit: more info → everything sizes down together
  // Row is 152 design px: panel 40% of 460 = 184, less 16px padding either side.
  // The logo keeps 48% of it for an ordinary name and gives ground only as the
  // longest word grows, down to a 46px floor. Measured against the DOM at 71px
  // for the default split.
  const { logoMaxPct, companyPx } = splitLogoRow({
    row: 152, gap: 8, hasLogo: !!data.logoUrl, defaultLogoFrac: 0.48, minLogo: 46,
    company: data.company, targetPx: 11, trackingEm: 0.03, uppercase: false,
    widthFactor: textWidthFactor(cardFontClass(data), false),
  });
  const companyFit = fitCompany(13.5, data.company, 18, companyPx, 0.03, false, f, textWidthFactor(cardFontClass(data), false));
  const socials = [
    data.linkedin  && { icon: <IcoLinkedIn />, handle: data.linkedin, color: "#60a5fa" },
    data.instagram && { icon: <IcoInsta />,    handle: data.instagram, color: "#c084fc" },
    data.twitter   && { icon: <IcoX />,        handle: data.twitter,  color: "#94a3b8" },
    data.tiktok    && { icon: <IcoTikTok />,   handle: data.tiktok,   color: "#94a3b8" },
  ].filter(Boolean) as { icon: React.ReactNode; handle: string; color: string }[];

  return (
    <div
      className="sc-card relative w-full flex rounded-2xl overflow-hidden"
      style={{
        aspectRatio: cardAspect(data),
        // The info panel — white by default, and restylable since 2026-09-10
        // (it was a hard-coded constant, so half the card could not be themed).
        background: infoSurface,
        fontFamily: style.fontFamily ?? CARD_BASE_FONT,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)",
      }}
    >
      {/* ── Left navy branding panel ─────────────────────── */}
      <div
        className="relative flex flex-col justify-between"
        style={{
          width: "40%",
          background: panelBg,
          // Isolate so PanelVideo's z-index:-1 sits above this background
          // and below the panel's own content, instead of escaping upward.
          isolation: "isolate",
          padding: "18px 16px 16px",
        }}
      >
        <PanelVideo style={style} />
        {/* Subtle dot texture */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "14px 14px",
          }}
        />

        {/* Company logo + name */}
        <div className="relative flex items-center gap-2">
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.logoUrl}
              alt="logo"
              className="rounded-lg"
              style={cardLogoShape(data) === "circle"
                ? logoCircleStyle(f, 46)
                : logoStyle(f, 46, { background: "rgba(255,255,255,0.1)", maxWidth: data.company ? logoMaxPct : "88%" })}
            />
          ) : (
            <div
              className="rounded-lg flex items-center justify-center shrink-0 font-black"
              style={{
                width: Math.round(40 * heroGrow(f)), height: Math.round(40 * heroGrow(f)),
                background: BLUE,
                color: "#bfdbfe",
                fontSize: Math.round(18 * heroGrow(f)),
              }}
            >
              {(data.company || data.name || "K")[0].toUpperCase()}
            </div>
          )}
          <span
            className="text-white/80 font-bold leading-tight min-w-0"
            style={{ ...companyFit, overflowWrap: "anywhere" }}
          >
            {data.company}
          </span>
        </div>

        {/* Name + title — hero */}
        {/* titleBox: the job title sizes itself to THIS column (shared.tsx). */}
        <div className="relative" style={titleBox}>
          <div className="w-8 h-[2px] mb-2.5 rounded-full" style={{ background: BLUE }} />
          <h2
            className={`font-extrabold leading-tight ${nameClass(style)}`}
            style={{ fontSize: fitName(24 * heroGrow(f), data.name, 16), overflowWrap: "anywhere", minWidth: 0, lineHeight: 1.12, color: style.textColor }}
          >
            {data.name}
          </h2>
          <p
            className="text-blue-300 font-semibold mt-1.5"
            style={{ ...fitTitleFluid(9.5, data.title, { tracking: 0.16, f }), letterSpacing: "0.16em", textTransform: "uppercase" }}
          >
            {data.title}
          </p>
        </div>

        {/* Social icons row */}
        {socials.length > 0 && (
          <div className="relative flex items-center gap-2.5">
            {socials.map((s, i) => (
              <span key={i} style={{ color: s.color }} className="opacity-80">{s.icon}</span>
            ))}
          </div>
        )}
      </div>

      {/* ── Right info panel ─────────────────────────────── */}
      <div
        className="flex-1 flex flex-col justify-between"
        style={{ padding: "16px 18px 14px", borderLeft: "1px solid #e8eef8" }}
      >
        {/* Contact rows — shared block, auto-fits to the amount of info */}
        {/* The QR is the block's bottom-right corner, so a packed card's rows
            use the width beside it instead of running onto it. */}
        <div className="mt-0.5 flex flex-col min-h-0" style={{ flex: "1 1 0" }}>
          <ContactRows
            data={data}
            palette={style.infoColor ? infoPaletteFrom(style.infoColor) : infoInk}
            qr={{
              size: qrSize(f),
              // The QR keeps a light plate on a dark panel: a scanner needs the
              // contrast, and inverting it is the one thing that stops it scanning.
              node: <QR size={qrSize(f)} bg="#f0f5ff" fg={NAVY} url={data.cardUrl} />,
            }}
          />
        </div>

        {/* Social handles (compact, if space) */}
        {socials.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-[4px]">
            {socials.slice(0, 2).map((s, i) => (
              <div key={i} className="flex items-center gap-1.5" style={{ color: infoInk.muted }}>
                {s.icon}
                <span style={{ fontSize: 9.5 }}>{s.handle}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom gradient accent */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: 4, background: `linear-gradient(90deg, ${BLUE}, #7c3aed)` }}
      />
    </div>
  );
}
