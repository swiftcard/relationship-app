// ModernBold — Electric Dark
// Style: Near-black full-bleed background, massive name, electric blue accents
// Includes: Name (hero), title, company, phone, email, website, social, QR
// Best for: Tech, agencies, startups, creatives, personal brands

import { accentGlow, brightness, mixHex, panelBackground } from "@/lib/template-style";
import React from "react";
import { MiniQR as QR } from "./MiniQR";
import type { CardData } from "./types";
import { cardAspect, ContactRows, fitFactor, fitCompanyFluid, splitLogoRow, logoRowStyle, companyCell, fitTitleFluid, titleBox, fitName, heroGrow, logoStyle, logoCircleStyle, cardLogoShape, qrSize, templateStyle, CARD_BASE_FONT, isDarkBg, infoPaletteFrom, IcoLinkedIn, IcoInsta, IcoX, IcoTikTok, nameClass, textWidthFactor, cardFontClass } from "./shared";
import CircleLogo from "./CircleLogo";
import PanelVideo from "./PanelVideo";

const BG           = "#070d1c";
const BLUE_DEFAULT = "#3b82f6";
const DIM          = "#1e3a5f";

export default function ModernBold({ data }: { data: CardData }) {
  const style = templateStyle(data);
  const BLUE = style.accentColor ?? BLUE_DEFAULT;
  const bg = panelBackground(style, BG);
  // Info text sits on the card background, so it defaults to light on a dark
  // card and dark on a light one; an explicit infoColor overrides either way.
  const darkCard = isDarkBg(bg);
  const infoPal = style.infoColor
    ? infoPaletteFrom(style.infoColor)
    : darkCard
      ? { strong: "#f1f5f9", mid: "#e2e8f0", soft: "#94a3b8", muted: "#94a3b8" }
      : { strong: "#0f172a", mid: "#1e293b", soft: "#475569", muted: "#64748b" };
  const companyColor = style.companyColor ?? style.infoColor ?? (darkCard ? "#cbd5e1" : "#475569");
  const titleColor = style.titleColor ?? BLUE;
  // The QR plate is a deep shade of the accent, so a Look's emerald or amber
  // code sits on its own colour rather than the template's navy. A DARK accent
  // gets a pale plate instead: dark on dark is a code no phone can read.
  const qrPlate = !style.accentColor || !/^#[0-9a-f]{6}$/i.test(BLUE) ? DIM : brightness(BLUE) < 90 ? mixHex(BLUE, "#ffffff", 0.85) : mixHex(BLUE, "#0b0f16", 0.72);
  const f = fitFactor(data); // auto-fit: more info → everything sizes down together
  // Row is 170.4 design px: panel 44% of 460 = 202.4, less 16px padding either
  // side. Uppercase with 0.16em of tracking — about a fifth of the rendered
  // width, and the first thing given back before either box resizes.
  const { companyPx, companyMinPct } = splitLogoRow({
    row: 170.4, gap: 8, hasLogo: !!data.logoUrl, defaultLogoFrac: 0.48, minLogo: 46,
    company: data.company, targetPx: 10, trackingEm: 0.16, uppercase: true,
    widthFactor: textWidthFactor(cardFontClass(data), true),
  });
  const companyFit = fitCompanyFluid(12, data.company, 18, companyPx, 0.16, true, f, textWidthFactor(cardFontClass(data), true));
  const socials = [
    data.instagram && { icon: <IcoInsta />,    color: "#a78bfa" },
    data.twitter   && { icon: <IcoX />,        color: "#94a3b8" },
    data.tiktok    && { icon: <IcoTikTok />,   color: "#94a3b8" },
    data.linkedin  && { icon: <IcoLinkedIn />, color: "#60a5fa" },
  ].filter(Boolean) as { icon: React.ReactNode; color: string }[];

  return (
    <div
      className="sc-card relative w-full flex rounded-2xl overflow-hidden"
      style={{
        aspectRatio: cardAspect(data),
        background: bg,
          // Isolate so PanelVideo's z-index:-1 sits above this background
          // and below the panel's own content, instead of escaping upward.
          isolation: "isolate",
        fontFamily: style.fontFamily ?? CARD_BASE_FONT,
        boxShadow: "0 4px 20px rgba(0,0,0,0.40), 0 1px 3px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.04)",
      }}
    >
        <PanelVideo style={style} />
      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Blue glow blob top-right */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 120, height: 120,
          top: -30, right: -20,
          background: `radial-gradient(circle, ${accentGlow(style.accentColor, BLUE)} 0%, transparent 70%)`,
        }}
      />

      {/* ── Left content area ──────────────────────────── */}
      <div
        className="relative flex flex-col justify-between"
        style={{ width: "44%", padding: "18px 16px 16px" }}
      >
        {/* Company */}
        {/* Wraps: a logo too wide to share its line takes the line, and the
            name goes underneath (logoRowStyle, shared.tsx). */}
        <div className="min-w-0" style={logoRowStyle(8)}>
          {data.logoUrl && (cardLogoShape(data) === "circle"
            ? <CircleLogo src={data.logoUrl} className="rounded-md" style={logoCircleStyle(f, 38)} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={data.logoUrl} alt="logo" className="rounded-md" style={logoStyle(f, 38, { maxWidth: data.company ? "100%" : "88%" })} />
          )}
          <div style={companyCell(companyMinPct)}>
            <p
              className="leading-tight"
              style={{ ...companyFit, color: companyColor, fontWeight: 700, textTransform: "uppercase", overflowWrap: "anywhere" }}
            >
              {data.company}
            </p>
          </div>
        </div>

        {/* Name — the hero */}
        {/* titleBox: the job title sizes itself to THIS column (shared.tsx). */}
        <div style={titleBox}>
          <div className="w-5 h-[2px] mb-2" style={{ background: BLUE }} />
          <h2
            className={`font-black leading-tight ${nameClass(style)}`}
            style={{ fontSize: fitName(28 * heroGrow(f), data.name, 15), overflowWrap: "anywhere", minWidth: 0, lineHeight: 1.08, letterSpacing: "-0.01em", color: style.textColor }}
          >
            {data.name}
          </h2>
          <p
            style={{ ...fitTitleFluid(9.5, data.title, { tracking: 0.18, f }), color: titleColor, letterSpacing: "0.18em", fontWeight: 700, marginTop: 6, textTransform: "uppercase" }}
          >
            {data.title}
          </p>
        </div>

        {/* Social icons */}
        {socials.length > 0 ? (
          <div className="flex items-center gap-2.5">
            {socials.map((s, i) => (
              <span key={i} style={{ color: s.color }}>{s.icon}</span>
            ))}
          </div>
        ) : <div />}
      </div>

      {/* Vertical divider with glow */}
      <div className="relative flex items-stretch" style={{ width: 1 }}>
        <div
          className="w-full"
          style={{ background: `linear-gradient(to bottom, transparent, ${BLUE}, transparent)`, opacity: 0.4 }}
        />
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at center, ${BLUE}40 0%, transparent 80%)`, width: 12, left: -6 }}
        />
      </div>

      {/* ── Right contact panel ────────────────────────── */}
      <div
        className="flex-1 flex flex-col justify-between"
        style={{ padding: "16px 18px 14px", color: "#94a3b8" }}
      >
        {/* Contact rows — shared block, auto-fits to the amount of info. The QR
            is the block's bottom-right corner, so a packed card's rows use the
            width beside it instead of running onto it. */}
        <div className="mt-1 flex flex-col min-h-0" style={{ flex: "1 1 0" }}>
          <ContactRows
            data={data}
            palette={{ accent: BLUE, ...infoPal }}
            qr={{ size: qrSize(f), node: <QR size={qrSize(f)} bg={qrPlate} fg={BLUE} url={data.cardUrl} /> }}
          />
        </div>
      </div>
    </div>
  );
}
