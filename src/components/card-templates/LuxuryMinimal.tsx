// LuxuryMinimal — Ivory & Gold
// Style: Cream/ivory background, gold left strip, faded decorative initials, ultra-premium editorial feel
// Includes: Name, title, phone, email, website, QR — stripped back, refined
// Best for: Luxury real estate, wealth management, executives, high-end services, attorneys

import { panelBackground } from "@/lib/template-style";
import React from "react";
import { MiniQR as QR } from "./MiniQR";
import type { CardData } from "./types";
import { cardAspect, ContactRows, DetailsGap, fitFactor, fitCompany, splitLogoRow, fitTitleFluid, titleBox, fitName, heroGrow, logoStyle, logoCircleStyle, cardLogoShape, qrSize, templateStyle, CARD_BASE_FONT, isDarkBg, infoPaletteFrom, textWidthFactor, cardFontClass } from "./shared";
import PanelVideo from "./PanelVideo";

const GOLD_DEFAULT  = "#b08d57";
const GOLD2_DEFAULT = "#c9a96e";
const IVORY  = "#fafaf6";
const TEXT   = "#1c1612";
const MUTED  = "#8c7b60";

export default function LuxuryMinimal({ data }: { data: CardData }) {
  const style = templateStyle(data);
  const GOLD  = style.accentColor ?? GOLD_DEFAULT;
  const GOLD2 = style.accentColor ?? GOLD2_DEFAULT;
  const bg = panelBackground(style, IVORY);
  const nameColor = style.textColor ?? TEXT;
  // Info text sits on the card, so on a dark canvas (e.g. Charcoal Luxe) it
  // defaults to a soft light tone; an explicit infoColor overrides it.
  const darkCard = isDarkBg(bg);
  const infoPal = style.infoColor
    ? infoPaletteFrom(style.infoColor)
    : darkCard
      ? { strong: "#f2ead9", mid: "#e7dcc8", soft: "#c9bda6", muted: "#a89a86" }
      : { strong: TEXT, mid: TEXT, soft: MUTED, muted: MUTED };
  const initials = data.initials ?? (data.name ?? "").split(" ").map((n) => n[0]).join("").slice(0, 2);
  const f = fitFactor(data); // auto-fit: more info → everything sizes down together
  // Row is 170.4 design px: panel 44% of 460 = 202.4, less 16px padding either
  // side. 0.22em of tracking is the most of any template, so the most here to
  // reclaim before anything has to get smaller.
  const { logoMaxPct, companyPx } = splitLogoRow({
    row: 170.4, gap: 8, hasLogo: !!data.logoUrl, defaultLogoFrac: 0.48, minLogo: 46,
    company: data.company, targetPx: 9, trackingEm: 0.22, uppercase: true,
    widthFactor: textWidthFactor(cardFontClass(data), true),
  });
  const companyFit = fitCompany(10.5, data.company, 18, companyPx, 0.22, true, f, textWidthFactor(cardFontClass(data), true));

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
        boxShadow: "0 4px 20px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)",
      }}
    >
        <PanelVideo style={style} />
      {/* ── Gold left strip ────────────────────────────── */}
      <div
        style={{
          width: 5,
          background: `linear-gradient(to bottom, ${GOLD2}, ${GOLD}, #8c6c34)`,
          flexShrink: 0,
        }}
      />

      {/* ── Decorative faded initials ──────────────────── */}
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center pointer-events-none select-none"
        style={{ paddingLeft: 22 }}
      >
        <span
          className="font-black"
          style={{
            fontSize: "clamp(55px, 15vw, 100px)",
            color: "rgba(176,141,87,0.07)",
            letterSpacing: "-0.04em",
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          {initials}
        </span>
      </div>

      {/* ── Left panel: company + name identity ────────── */}
      <div
        className="relative flex flex-col justify-between"
        style={{ width: "44%", padding: "18px 16px 17px 16px" }}
      >
        {/* Company + optional logo */}
        <div className="flex items-center gap-2 min-w-0">
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt="logo" className="rounded" style={cardLogoShape(data) === "circle"
            ? logoCircleStyle(f, 38)
            : logoStyle(f, 38, { maxWidth: data.company ? logoMaxPct : "88%" })} />
          ) : null}
          <p
            className="min-w-0 leading-tight"
            style={{ ...companyFit, color: GOLD, fontWeight: 700, textTransform: "uppercase", overflowWrap: "anywhere" }}
          >
            {data.company}
          </p>
        </div>

        {/* Name — refined, light weight */}
        <div>
          <h2
            className="text-gray-900 leading-tight"
            style={{
              fontSize: fitName(23 * heroGrow(f), data.name, 17), overflowWrap: "anywhere", minWidth: 0,
              fontWeight: 400,
              letterSpacing: "0.01em",
              color: nameColor,
              lineHeight: 1.18,
            }}
          >
            {data.name}
          </h2>
        {/* titleBox: the job title sizes itself to THIS column (shared.tsx). */}
          <div className="flex items-center gap-1.5 mt-2" style={titleBox}>
            <div className="h-px flex-1" style={{ maxWidth: 20, background: GOLD }} />
            <p
              style={{ ...fitTitleFluid(8.5, data.title, { tracking: 0.2, f }), letterSpacing: "0.2em", color: GOLD, fontWeight: 600, textTransform: "uppercase" }}
            >
              {data.title}
            </p>
          </div>
        </div>

        {/* Subtle bottom detail */}
        <div className="h-px w-10" style={{ background: `linear-gradient(90deg, ${GOLD}, transparent)` }} />
      </div>

      {/* ── Thin center divider ────────────────────────── */}
      <div
        className="self-stretch"
        style={{ width: 1, margin: "16px 0", background: `linear-gradient(to bottom, transparent, ${GOLD}40, transparent)` }}
      />

      {/* ── Right panel: contact details ───────────────── */}
      <div
        className="flex-1 flex flex-col justify-start"
        style={{ padding: "18px 18px 17px 16px" }}
      >
        {/* Tagline */}
        <p style={{ fontSize: 7.5, letterSpacing: "0.28em", color: MUTED, textTransform: "uppercase" }}>
          — Private Contact —
        </p>

        {/* Details start directly under the tagline and fill DOWNWARD; the QR
            is pinned to the bottom by its own auto margin (see DetailsGap). */}
        <DetailsGap f={f} />
        {/* Contact rows — shared block, auto-fits; lighter phone weight keeps the refined feel */}
        {/* The QR is the block's bottom-right corner, so a packed card's rows use
            the width beside it instead of running onto it. */}
        <ContactRows
          data={data}
          palette={{ accent: GOLD, ...infoPal, phoneWeight: 600 }}
          qr={{ size: qrSize(f), node: <QR size={qrSize(f)} bg="#f5f0e8" fg={GOLD} url={data.cardUrl} /> }}
        />
      </div>
    </div>
  );
}
