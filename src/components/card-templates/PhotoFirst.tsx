// PhotoFirst — Portrait Pro
// Style: Full-height photo on the left, clean white info panel on the right
// Includes: Profile photo (full-height), name overlay, company, phone, email, website, QR
// Best for: Real estate, beauty, fitness, coaches, personal brand, healthcare

import { panelBackground } from "@/lib/template-style";
import React from "react";
import { MiniQR as QR } from "./MiniQR";
import type { CardData } from "./types";
import { cardAspect, ContactRows, DetailsGap, fitFactor, fitCompany, splitLogoRow, fitTitleFluid, titleBox, fitName, heroGrow, logoStyle, logoCircleStyle, cardLogoShape, qrSize, templateStyle, CARD_BASE_FONT, isDarkBg, infoPaletteFrom, IcoInsta, IcoX, IcoTikTok, IcoLinkedIn, nameClass, textWidthFactor, cardFontClass } from "./shared";
import PanelVideo from "./PanelVideo";

const ACCENT_DEFAULT = "#6d28d9";
const PHOTO_BG_DEFAULT = "linear-gradient(145deg, #4f46e5 0%, #7c3aed 60%, #6d28d9 100%)";

export default function PhotoFirst({ data }: { data: CardData }) {
  const style = templateStyle(data);
  const ACCENT = style.accentColor ?? ACCENT_DEFAULT;
  // The photo panel keeps a fixed brand backdrop (only visible with no photo).
  // The photo panel. bgColor already means the INFO panel on this template,
  // so the brand backdrop behind the photo gets the second surface.
  const photoBg = style.surfaceColor ?? PHOTO_BG_DEFAULT;
  // bgColor now tints the INFO PANEL — the surface behind the contact text.
  // Default is the clean white panel; a dark choice flips the text to light.
  const infoBg = panelBackground(style, "#ffffff");
  const darkInfo = isDarkBg(infoBg);
  const infoPalette = darkInfo
    ? { company: "#ffffff", strong: "#ffffff", mid: "#e5e7eb", soft: "#d1d5db", muted: "#9ca3af", border: "rgba(255,255,255,0.14)", qrBg: "#ffffff" }
    : { company: "#111827", strong: "#1e1b4b", mid: "#374151", soft: "#4b5563", muted: "#6b7280", border: "#f0ebff", qrBg: "#f5f0ff" };
  // An explicit infoColor overrides the auto-derived detail text colors.
  const rowPal = style.infoColor
    ? infoPaletteFrom(style.infoColor)
    : { strong: infoPalette.strong, mid: infoPalette.mid, soft: infoPalette.soft, muted: infoPalette.muted };
  const companyColor = style.infoColor ?? infoPalette.company;
  const f = fitFactor(data); // auto-fit: more info → everything sizes down together
  // Row is 242 design px: info panel is 460 - 40% = 276, less 17px padding
  // either side. The roomiest of the five, which is why this is the one
  // template whose logo could take a larger share (52%) to begin with.
  const { logoMaxPct, companyPx } = splitLogoRow({
    row: 242, gap: 8, hasLogo: !!data.logoUrl, defaultLogoFrac: 0.52, minLogo: 60,
    company: data.company, targetPx: 12, trackingEm: 0, uppercase: false,
    widthFactor: textWidthFactor(cardFontClass(data), false),
  });
  const companyFit = fitCompany(13.5, data.company, 20, companyPx, 0, false, f, textWidthFactor(cardFontClass(data), false));
  const socials = [
    data.instagram && { icon: <IcoInsta />,    color: "#c084fc" },
    data.twitter   && { icon: <IcoX />,        color: "#64748b" },
    data.tiktok    && { icon: <IcoTikTok />,   color: "#64748b" },
    data.linkedin  && { icon: <IcoLinkedIn />, color: "#818cf8" },
  ].filter(Boolean) as { icon: React.ReactNode; color: string }[];

  return (
    <div
      className="sc-card relative w-full flex rounded-2xl overflow-hidden"
      style={{
        aspectRatio: cardAspect(data),
        background: "#fff",
        fontFamily: style.fontFamily ?? CARD_BASE_FONT,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)",
      }}
    >
      {/* ── Left: full-height photo panel ──────────────── */}
      <div
        className="relative flex flex-col justify-end shrink-0"
        style={{
          width: "40%",
          background: photoBg,
          overflow: "hidden",
        }}
      >
        {/* Radial highlight for depth */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 60% 20%, rgba(167,139,250,0.35) 0%, transparent 60%)",
          }}
        />

        {/* Photo or avatar */}
        {data.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.photoUrl}
            alt={data.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="rounded-full flex items-center justify-center font-black text-white"
              style={{
                width: "52%", aspectRatio: "1/1",
                background: "rgba(255,255,255,0.15)",
                border: "2px solid rgba(255,255,255,0.3)",
                fontSize: "clamp(18px, 4.5vw, 30px)",
              }}
            >
              {data.initials ?? (data.name ?? "").split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
          </div>
        )}

        {/* Gradient overlay at bottom — name sits on top of it */}
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{ height: "50%", background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%)" }}
        />

        {/* Name + title over photo */}
        {/* titleBox: the job title sizes itself to THIS column (shared.tsx). */}
        <div className="relative px-3.5 pb-3" style={titleBox}>
          <h2
            className={`font-extrabold leading-tight ${nameClass(style)}`}
            style={{ fontSize: fitName(18 * heroGrow(f), data.name, 16), overflowWrap: "anywhere", minWidth: 0, textShadow: "0 1px 4px rgba(0,0,0,0.4)", color: style.textColor }}
          >
            {data.name}
          </h2>
          <p
            style={{ ...fitTitleFluid(8, data.title, { tracking: 0.14, f }), color: "rgba(221,214,254,0.9)", letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 2 }}
          >
            {data.title}
          </p>
        </div>
      </div>

      {/* ── Right: info panel — background follows bgColor ──────────── */}
      <div
        className="relative flex-1 flex flex-col justify-start"
        style={{ padding: "15px 17px 13px", background: infoBg,
          // Isolate so PanelVideo's z-index:-1 sits above this background
          // and below the panel's own content, instead of escaping upward.
          isolation: "isolate", borderLeft: `1px solid ${infoPalette.border}` }}
      >
        <PanelVideo style={style} />
        {/* Company header */}
        <div>
          <div className="flex items-center gap-2 mb-1.5 min-w-0">
            {data.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.logoUrl} alt="logo" className="rounded-md" style={cardLogoShape(data) === "circle"
                ? logoCircleStyle(f, 42)
                : logoStyle(f, 42, { maxWidth: data.company ? logoMaxPct : "88%" })} />
            )}
            <p className="font-extrabold min-w-0 leading-tight" style={{ color: companyColor, ...companyFit, overflowWrap: "anywhere" }}>
              {data.company}
            </p>
          </div>
          <div className="w-10 h-[2px] rounded-full" style={{ background: `linear-gradient(90deg, ${ACCENT}, #a78bfa)` }} />
        </div>

        {/* Details start directly under the company and fill DOWNWARD; the QR
            is pinned to the bottom by its own auto margin (see DetailsGap). */}
        <DetailsGap f={f} />
        {/* Contact rows — shared block, auto-fits to the amount of info */}
        <div className="flex flex-col min-h-0" style={{ gap: Math.round(5 * f), flex: "1 1 0" }}>
          {socials.length > 0 && (
            <div className="flex items-center gap-2.5 mt-0.5">
              {socials.map((s, i) => <span key={i} style={{ color: s.color }}>{s.icon}</span>)}
            </div>
          )}
          {/* The QR is the details block's bottom-right corner, so rows use the
              width beside it instead of stopping a whole QR-height short. */}
          <ContactRows
            data={data}
            palette={{ accent: ACCENT, ...rowPal }}
            qr={{ size: qrSize(f), node: <QR size={qrSize(f)} bg={infoPalette.qrBg} fg={darkInfo ? "#1e1b4b" : ACCENT} url={data.cardUrl} /> }}
          />
        </div>
      </div>
    </div>
  );
}
