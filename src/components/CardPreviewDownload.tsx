"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { CardData } from "@/components/card-templates/types";
import { withoutSocials } from "@/components/card-templates/types";
import CardFullscreen from "@/components/CardFullscreen";
import { useRegisterCardCapture } from "@/components/CardCaptureContext";
import { qrScanUrl } from "@/lib/share-source";

const ClassicPro    = dynamic(() => import("@/components/card-templates/ClassicPro"),    { ssr: false });
const ModernBold    = dynamic(() => import("@/components/card-templates/ModernBold"),    { ssr: false });
const PhotoFirst    = dynamic(() => import("@/components/card-templates/PhotoFirst"),    { ssr: false });
const LocalBusiness = dynamic(() => import("@/components/card-templates/LocalBusiness"), { ssr: false });
const LuxuryMinimal = dynamic(() => import("@/components/card-templates/LuxuryMinimal"), { ssr: false });
const LogoFirst     = dynamic(() => import("@/components/card-templates/LogoFirst"),     { ssr: false });
const CustomCard    = dynamic(() => import("@/components/card-templates/CustomCard"),    { ssr: false });

const TEMPLATE_MAP: Record<string, React.ComponentType<{ data: CardData }>> = {
  "classic-pro":    ClassicPro,
  "modern-bold":    ModernBold,
  "photo-first":    PhotoFirst,
  "local-business": LocalBusiness,
  "luxury-minimal": LuxuryMinimal,
  "logo-first":     LogoFirst,
  "custom":         CustomCard,
};

// Templates are laid out for roughly this width; we render at it and scale to fit
// the container so nothing (text, QR) gets clipped in narrow columns. Kept a touch
// wider than the public card (max-w-sm ≈ 384px) so the fixed-height card has enough
// vertical room for the QR + all contact rows.
const NATURAL = 460;

interface Props {
  data: CardData;
  template: string;
  username: string;
}

export default function CardPreviewDownload({ data, template, username }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [height, setHeight] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const Template = TEMPLATE_MAP[template] ?? ClassicPro;
  const filename = `swiftcard-${username}.png`;
  const shown = template === "custom" ? data : withoutSocials(data);

  // Hand the live card node to sibling panels — "Other ways to share" offers a
  // PNG of it (the only card download, on every device) and cannot reach
  // across boxes on its own. No-op when rendered outside a CardCaptureProvider.
  useRegisterCardCapture({ cardRef, filename, name: data.name });

  useEffect(() => {
    function recompute() {
      const w = outerRef.current?.clientWidth ?? NATURAL;
      const s = w / NATURAL;
      const naturalH = cardRef.current?.offsetHeight ?? Math.round(NATURAL / 1.75);
      setScale(s);
      setHeight(naturalH * s);
    }
    recompute();
    const ro = new ResizeObserver(recompute);
    if (outerRef.current) ro.observe(outerRef.current);
    if (cardRef.current) ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [data, template]);

  return (
    <div>
      <div
        ref={outerRef}
        className="relative w-full rounded-xl overflow-hidden"
        // RESERVE THE SPACE BEFORE THE CARD EXISTS. The templates are
        // dynamic(ssr:false), so on the server and until that chunk downloads
        // this box has no content — height resolved to 0 and everything below
        // it (Share, Traffic) sat high, then jumped ~250–300px
        // the moment the card popped in. On the dashboard, the first screen of
        // the app, after the skeleton had already handed off.
        //
        // 1.75 is the card's own aspect — the same constant the measurement
        // below falls back to — so the reserved box is the right size, not a
        // guess. Once measured, the exact height takes over (templates vary
        // slightly), and aspect-ratio steps aside.
        style={{
          height: height || undefined,
          aspectRatio: height ? undefined : "1.75",
        }}
      >
        {/* inert: this is a PICTURE of the card. Its phone/email/links were
            never tappable here (pointer-events-none), but they could still take
            keyboard focus — and nightly QA (issue #47) rightly reported them as
            controls buried under the full-screen tap target below. inert takes
            them out of tap AND tab order; it changes nothing about how the card
            looks or how its PNG is captured. */}
        <div
          ref={cardRef}
          inert
          className="pointer-events-none"
          style={{
            width: NATURAL,
            transform: scale ? `scale(${scale})` : undefined,
            transformOrigin: "top left",
            opacity: scale ? 1 : 0,
          }}
        >
          <Template data={shown} />
        </div>
        {/* PHONE: the card itself is the button — tap it and it opens full
            screen and sideways to hold up (CardFullscreen). This replaced the
            "Scan to connect (QR)" button that sat under the card (owner,
            2026-09-29): the QR every template prints on the card is what gets
            scanned. lg:hidden, the width at which this whole panel moves to
            the desktop column, where you can't hold a monitor up to a camera. */}
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          aria-label="Show your card full screen"
          className="lg:hidden absolute inset-0 w-full h-full rounded-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
      </div>

      {/* JUST THE CARD, on every device. Nothing follows it: no "Preview"
          link (removed 2026-07-10 — the My Cards box's "View Live Link" opens
          the card) and no Download button (removed 2026-10-07). The desktop
          kept a Download here after "Other ways to share → Download card
          (PNG)" reached every width, so a computer showed two card downloads
          and a phone one (owner: "we already have other ways to share"). The
          picture is now saved from that one place everywhere; this component
          still hands it the card node (useRegisterCardCapture above). There
          is no "tap to show it full screen" hint (owner, 2026-09-30) — the
          tour teaches it. */}
      {/* The QR printed on the card encodes data.cardUrl. Full screen it is
          there to be SCANNED, so it carries the same "QR code scan" tag every
          other QR we show carries (lib/share-source) — otherwise each scan
          lands in Traffic as "Card link". */}
      {fullscreen && (
        <CardFullscreen width={NATURAL} onClose={() => setFullscreen(false)}>
          <Template data={shown.cardUrl ? { ...shown, cardUrl: qrScanUrl(shown.cardUrl) } : shown} />
        </CardFullscreen>
      )}
    </div>
  );
}
