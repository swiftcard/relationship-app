"use client";

import { drawQr, isHexColor, qrImageUrl, qrTarget } from "@/lib/qr-svg";
import { useQrRenderMode } from "./qr-render-mode";

// Split out of types.tsx: that module is value-imported (withoutSocials,
// SAMPLE_DATA) by ~30 files including several client homepage components, so
// co-locating the `qrcode` encoder there risked dragging it into bundles that
// never render a QR code at all (performance audit).
//
// The one QR SwiftCard draws — on every card template, in the Show QR popup
// and in the "Download QR (PNG)" picture — so a person's code looks the same
// everywhere they meet it. The drawing itself (the rounded modules, the soft
// finder eyes, error-correction level M) lives in lib/qr-svg.ts, shared with
// the /api/qr image route; this component only decides how it reaches the
// page: inline <svg> by default, or a cached <img> inside QrAsImages (the
// marketing pages) — see ./qr-render-mode.tsx.

export function MiniQR({ size = 52, bg = "#ffffff", fg = "#111827", url, payload }: {
  size?: number; bg?: string; fg?: string; url?: string;
  /** Encode this text exactly as given, not as a link. This is the Contact QR's
      vCard (lib/contact-qr.ts), which an https:// prefix would ruin. */
  payload?: string;
}) {
  const mode = useQrRenderMode();
  const p = size * 0.055;
  const target = qrTarget(url, payload);

  // A vCard stays inline: it is personal data and belongs in no URL or cache.
  const asImage = mode === "img" && !payload && isHexColor(fg);
  const drawing = asImage ? null : drawQr(target);

  return (
    <div
      data-qr="1"
      data-qr-bg={bg}
      data-qr-fg={fg}
      style={{ width: size, height: size, background: bg, padding: p, borderRadius: size * 0.1, flexShrink: 0 }}
    >
      {asImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- an SVG file of our own, no resizing to do
        <img
          src={qrImageUrl(target, fg)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ width: "100%", height: "100%", display: "block" }}
          aria-hidden="true"
        />
      ) : drawing ? (
        <svg viewBox={`0 0 ${drawing.count} ${drawing.count}`} style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true">
          {drawing.eyes.map((e) => (
            <g key={e.key}>
              <path fillRule="evenodd" d={e.ring} fill={fg} />
              <path d={e.pupil} fill={fg} />
            </g>
          ))}
          <path d={drawing.modules} fill={fg} />
        </svg>
      ) : null}
    </div>
  );
}
