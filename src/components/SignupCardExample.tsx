"use client";

import CardScaler from "@/components/CardScaler";
import PhotoFirst from "@/components/card-templates/PhotoFirst";
import type { CardData } from "@/components/card-templates/types";
import { CARD_FONT_OPTIONS, type TemplateStyle } from "@/lib/template-style";

// ── The example card on the "create your free card" invite ──────────────────
//
// Owner, 2026-09-23: "make the design example card on that pop-up much nicer
// and more realistic." It was a hand-drawn stand-in — a "YOU" circle, "Your
// Name", grey bars. Now it IS a SwiftCard: the real Portrait Pro template
// (PhotoFirst), rendered by the same code a customer's card uses. A visitor
// who taps "See how yours looks" is looking at exactly what they will get.
//
// Owner, 2026-10-19: "make that example gorgeous … make the headshot
// circular." Chosen from three in-popup mockups: Champagne — the template's
// own Circle photo on an espresso-to-gold panel, an ivory details panel (it
// used to repeat the violet gradient, violet on violet on the indigo popup)
// and the editor's Serif font. The persona is the homepage showcase's
// (components/site/HeroShowcase), so one photo is one person site-wide.
//
// Its own module so SignupNudgeHost can load it lazily: a Swift Links page
// never shows the card invite (it shows the Swift Links sheet), so it never
// pays for the template code.

const SERIF = CARD_FONT_OPTIONS.find((o) => o.label === "Serif")!.value;

// Typed as what the template reads (templateStyle): CardCustomization does not
// list the per-line colours, though every Look saves them.
const CHAMPAGNE: TemplateStyle = {
  photoShape: "circle",
  surfaceColor: "linear-gradient(160deg, #1c1612 0%, #3f2d1a 55%, #7a5c2c 100%)",
  bgColor: "#fdfaf3",
  textColor: "#fdf6e3",
  titleColor: "#e9d3a6",
  companyColor: "#1c1612",
  infoColor: "#2b2018",
  accentColor: "#a07a3c",
  fontFamily: SERIF,
};

const EXAMPLE: CardData = {
  name: "Simone Adler",
  // The homepage's job label for her: "Managing Partner" wrapped to two lines
  // in the circle panel's narrow column and crowded the name.
  title: "Attorney",
  company: "Adler & Grant LLP",
  phone: "(646) 555-0121",
  email: "sadler@adlergrant.law",
  website: "adlergrant.law",
  cardUrl: "swiftcard.me/simoneadler",
  photoUrl: "/showcase/simone.jpg",
  logoUrl: null,
  initials: "SA",
  customization: CHAMPAGNE,
};

export default function SignupCardExample() {
  // `inert`: the template is a real card, so its phone, email and website are
  // real links. In a picture of a card they must not be tappable, reachable
  // with Tab, or read out — the invite's own button is the only action here.
  return (
    <div inert className="pointer-events-none select-none">
      <CardScaler>
        <PhotoFirst data={EXAMPLE} />
      </CardScaler>
    </div>
  );
}
