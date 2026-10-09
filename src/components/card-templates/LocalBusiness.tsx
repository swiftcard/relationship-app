// LocalBusiness — Warm Amber
// Style: Amber header stripe, warm cream body, phone as hero contact
// Includes: Company logo/monogram, name, phone (prominent), email, website, QR
// Best for: Restaurants, retail, contractors, salons, home services, local shops

import { isDarkBg, panelBackground } from "@/lib/template-style";
import React from "react";
import { MiniQR as QR } from "./MiniQR";
import type { CardData } from "./types";
import { cardAspect, ContactRows, DetailsGap, fitFactor, fitCompany, fitTitleFluid, titleBox, fitName, heroGrow, logoStyle, logoCircleStyle, cardLogoShape, qrSize, templateStyle, CARD_BASE_FONT, infoPaletteFrom, nameClass, textWidthFactor, cardFontClass } from "./shared";
import PanelVideo from "./PanelVideo";

const AMBER_DEFAULT  = "#b45309";
const AMBER2_DEFAULT = "#d97706";
const CREAM  = "#fffbf0";
const WARM   = "#92400e";

// Logo height in design px (the 460-wide unit every card template is built in).
// The width cap below is DERIVED from it (×2.6, the widest banner shape that
// still sits inside the badge area) rather than written out separately — those
// were two independent numbers, so raising one without the other would either
// squeeze a wide logo or let it run into the text column beside it.
const LOGO_H = 64;

export default function LocalBusiness({ data }: { data: CardData }) {
  const style = templateStyle(data);
  const AMBER  = style.accentColor ?? AMBER_DEFAULT;
  const AMBER2 = style.accentColor ?? AMBER2_DEFAULT;
  const stripeBg = panelBackground(style, `linear-gradient(100deg, ${AMBER} 0%, ${AMBER2} 60%, #f59e0b 100%)`);
  // The body below the stripe is restylable now and its presets include deep
  // shades, so the warm-brown ink has to flip or the details vanish into it.
  const bodySurface = style.surfaceColor ?? CREAM;
  const darkBody = isDarkBg(bodySurface);
  const bodyInk = darkBody
    ? { strong: "#ffffff", mid: "#f5f5f4", soft: "#e7e5e4", muted: "#d6d3d1" }
    : { strong: WARM, mid: "#78350f", soft: "#92400e", muted: "#a16207" };
  const initials = data.initials ?? (data.name ?? "").split(" ").map((n) => n[0]).join("").slice(0, 2);
  const f = fitFactor(data); // auto-fit: more info → everything sizes down together
  // Horizontal space the top-right badge occupies, so the name below can reserve
  // it. Mirrors the badge's own maxWidth exactly (logo) or its fixed box
  // (initials), plus the pr-5 it sits in and a small gap.
  const badgeW = data.logoUrl
    ? Math.round(LOGO_H * 2.6 * Math.min(Math.max(f, 0.85), 1.3))
    : 58;
  const badgeReserve = badgeW + 20 + 10;
  // The company sits in the cream BODY, with no logo beside it — the badge is
  // up in the stripe. So it gets the full body width: 460 minus 18px padding
  // either side, minus the QR column on its right.
  const companyFit = fitCompany(13, data.company, 22, 460 - 36 - 96, 0.02, false, f, textWidthFactor(cardFontClass(data), false));

  return (
    <div
      className="sc-card relative w-full flex flex-col rounded-2xl overflow-hidden"
      style={{
        aspectRatio: cardAspect(data, 6.5),
        // The card body below the stripe. Was a fixed cream — the owner could
        // colour the stripe and nothing else.
        background: bodySurface,
        fontFamily: style.fontFamily ?? CARD_BASE_FONT,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)",
      }}
    >
      {/* ── Amber top stripe — gives up a little height when the card is packed ── */}
      <div
        style={{
          height: `${36 - (1 - f) * 14}%`,
          background: stripeBg,
          // Isolate so PanelVideo's z-index:-1 sits above this background
          // and below the panel's own content, instead of escaping upward.
          isolation: "isolate",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <PanelVideo style={style} />
        {/* Subtle diagonal texture */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 14px)",
          }}
        />

        {/* Top-right: company badge */}
        <div className="absolute top-0 right-0 h-full flex items-center pr-5">
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.logoUrl}
              alt="logo"
              className="rounded-xl"
              style={cardLogoShape(data) === "circle"
                ? logoCircleStyle(f, Math.round(LOGO_H / 1.24), { background: "rgba(255,255,255,0.92)" })
                : logoStyle(f, LOGO_H, { background: "rgba(255,255,255,0.15)", padding: 5, maxWidth: Math.round(LOGO_H * 2.6 * Math.min(Math.max(f, 0.85), 1.3)) })}
            />
          ) : (
            <div
              className="rounded-xl flex items-center justify-center font-black text-amber-800"
              style={{
                width: 58, height: 58,
                background: "rgba(255,255,255,0.92)",
                fontSize: "clamp(18px, 4vw, 24px)",
              }}
            >
              {initials}
            </div>
          )}
        </div>

        {/* Bottom-left name area within stripe.
            `right` is load-bearing, not cosmetic. The badge above is positioned
            absolute top-0 right-0 h-FULL, so it owns the right edge for the
            whole stripe — including the bottom, where this sits. Without a right
            bound this block was free to run underneath it, and a long name did:
            measured 13px of overlap at the ORIGINAL badge size, growing with it.
            Reserving the badge's own width (+ its pr-5, + a gap) means the name
            stops before the badge instead of sliding under it, at any width. */}
        {/* titleBox: the job title sizes itself to THIS column (shared.tsx). */}
        <div className="absolute bottom-0 left-0 px-5 pb-3" style={{ right: badgeReserve, ...titleBox }}>
          <h2
            className={`font-extrabold leading-tight ${nameClass(style)}`}
            style={{ fontSize: fitName(20 * heroGrow(f), data.name, 18), overflowWrap: "anywhere", minWidth: 0, lineHeight: 1.15, textShadow: "0 1px 4px rgba(0,0,0,0.2)", color: style.textColor }}
          >
            {data.name}
          </h2>
          {data.title && (
            <p style={{ ...fitTitleFluid(8.5, data.title, { tracking: 0.12, f }), color: style.titleColor ?? "rgba(254,243,199,0.9)", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600, marginTop: 2 }}>
              {data.title}
            </p>
          )}
        </div>
      </div>

      {/* ── Cream body ─────────────────────────────────── */}
      <div
        className="flex-1 flex"
        // minHeight 0: without it this body grows to fit its content instead of
        // staying inside the card, so DetailsGap never collapses on a packed
        // card and the QR is pushed toward the bottom edge.
        style={{ padding: "10px 18px 12px", minHeight: 0 }}
      >
        {/* Left: company + contact info. Details start directly under the
            company and fill DOWNWARD (DetailsGap, shared.tsx) — this column
            used to be justify-between, which dropped a lone phone number to the
            very bottom of the card. */}
        <div className="flex-1 flex flex-col justify-start" style={{ minHeight: 0 }}>
          {/* Company name */}
          <div className="min-w-0">
            <p className="font-black leading-tight" style={{ ...companyFit, color: style.companyColor ?? bodyInk.strong, overflowWrap: "anywhere" }}>
              {data.company}
            </p>
            <div className="w-12 h-[2px] mt-1 rounded-full" style={{ background: `linear-gradient(90deg, ${AMBER2}, #fbbf24)` }} />
          </div>

          <DetailsGap f={f} />
          {/* Contact rows — shared block (address included), auto-fits to the amount of info */}
          <ContactRows data={data} palette={style.infoColor ? { accent: AMBER, ...infoPaletteFrom(style.infoColor) } : { accent: AMBER, ...bodyInk }} />
        </div>

        {/* Right: QR — always on the card; gives up a little room when dense */}
        <div className="flex flex-col items-end justify-end gap-1 pl-4 shrink-0">
          <QR size={qrSize(f)} bg="#fff8e6" fg={AMBER} url={data.cardUrl} />
        </div>
      </div>

      {/* Bottom gold accent bar */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: 3, background: `linear-gradient(90deg, ${AMBER}, #f59e0b, ${AMBER2})` }}
      />
    </div>
  );
}
