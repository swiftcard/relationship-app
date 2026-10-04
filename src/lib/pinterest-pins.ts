// ── Pinterest: every pin is a real SwiftCard design, and every pin links back ─
// Owner's plan (2026-10-04): long-term traffic from people searching for
// business card ideas — "realtor business card ideas", "luxury business
// cards", "modern business cards", "QR business cards", "digital business
// card designs", SwiftCard templates. Each pin is a 1000×1500 picture of a
// design the homepage already shows (a persona wearing a template), rendered
// by the site itself at /pin/<slug>, and its link is swiftcard.me/go/pin_<slug>,
// so a signup from Pinterest is counted under the pin that brought it.
//
// This file is the catalog. Nothing here talks to Pinterest; the posting is
// scripts/pinterest-pins.mjs (renders + uploads) and
// /api/agents/pinterest/pin (creates the pin with the stored connection).

export type PinIdea = {
  /** URL-safe, also the signup code's tail (pin_<slug> with - → _). */
  slug: string;
  /** Pinterest board the pin goes on (created if missing). */
  board: string;
  /** What people type into Pinterest — the pin's title and the page's headline. */
  headline: string;
  /** One line under the headline on the picture. */
  sub: string;
  /** Pin description (searchable; 2–3 sentences, no hashtag walls). */
  description: string;
  /** Homepage persona whose card is shown (ALL_PERSONAS key in HeroShowcase). */
  persona: string;
  /** /for/ slug whose design the builder opens on when the pin is tapped. */
  profession?: string;
};

const FREE = "Free to start at swiftcard.me — a digital business card people save to their phone in one tap, with a QR code, your links and lead capture built in.";

export const PIN_IDEAS: PinIdea[] = [
  { slug: "realtor-business-card-ideas", board: "Realtor business card ideas", headline: "Realtor business card ideas", sub: "A card buyers can save at the open house", description: `Realtor business card idea: a digital card with your photo, listings link and a QR code for the open house sign. ${FREE}`, persona: "realtor", profession: "real-estate-agents" },
  { slug: "real-estate-agent-digital-card", board: "Realtor business card ideas", headline: "Real estate agent business card", sub: "Photo first, so they remember who you are", description: `A photo-first business card design for real estate agents — share it by QR or tap, and every buyer's details come back to you. ${FREE}`, persona: "realtor", profession: "real-estate-agents" },
  { slug: "loan-officer-business-card", board: "Realtor business card ideas", headline: "Loan officer business card ideas", sub: "Clean, trusted, saved in one tap", description: `A classic business card design for loan officers and mortgage pros, with your NMLS line, links and a QR code. ${FREE}`, persona: "loan-officer", profession: "loan-officers" },
  { slug: "luxury-business-cards", board: "Luxury business cards", headline: "Luxury business card design", sub: "Serif type, gold accent, nothing loud", description: `Luxury business card design: cream card, serif type and a gilt accent — as a digital card you share with a tap. ${FREE}`, persona: "banker" },
  { slug: "luxury-minimal-business-card", board: "Luxury business cards", headline: "Minimal luxury business card", sub: "For private bankers, advisors and consultants", description: `A minimal, luxury business card for advisors and consultants — digital, so it is never out of date and never runs out. ${FREE}`, persona: "banker" },
  { slug: "modern-business-cards", board: "Modern business cards", headline: "Modern business card design", sub: "Bold type on a dark gradient", description: `Modern business card design with bold type on a dark gradient — a digital card that opens on any phone, no app needed. ${FREE}`, persona: "lawyer", profession: "lawyers" },
  { slug: "modern-barber-business-card", board: "Modern business cards", headline: "Barber business card ideas", sub: "Bold, dark, built for Instagram", description: `A modern business card for barbers and stylists: your booking link, Instagram and a QR code for the mirror. ${FREE}`, persona: "barber", profession: "barbers-and-stylists" },
  { slug: "qr-code-business-card", board: "QR code business cards", headline: "QR code business card", sub: "Scan it and the contact is saved", description: `QR code business card: print the QR on anything, and a scan opens your card with a one-tap Save Contact. ${FREE}`, persona: "electrician", profession: "contractors" },
  { slug: "qr-business-card-for-contractors", board: "QR code business cards", headline: "Contractor business card with QR code", sub: "On the truck, the estimate and the invoice", description: `A QR code business card for contractors and trades — on the truck, the estimate and the invoice, and the lead comes to your phone. ${FREE}`, persona: "electrician", profession: "contractors" },
  { slug: "digital-business-card-designs", board: "Digital business card designs", headline: "Digital business card designs", sub: "Six templates, every color, your logo", description: `Digital business card designs you can make in a minute: six templates, any color, your logo and headshot. ${FREE}`, persona: "insurance", profession: "insurance-agents" },
  { slug: "insurance-agent-business-card", board: "Digital business card designs", headline: "Insurance agent business card", sub: "Classic layout, clear contact details", description: `A classic digital business card design for insurance agents — every number and link in one place, saved in one tap. ${FREE}`, persona: "insurance", profession: "insurance-agents" },
  { slug: "car-salesperson-business-card", board: "Digital business card designs", headline: "Car salesperson business card", sub: "Logo first, dealership colors", description: `A logo-first business card design for car sales — dealership colors, your number and a QR for the showroom. ${FREE}`, persona: "cars", profession: "car-salespeople" },
  { slug: "photographer-business-card", board: "Digital business card designs", headline: "Photographer business card ideas", sub: "Your photo is the card", description: `A photo-first business card for photographers — your portfolio link, Instagram and booking in one tap. ${FREE}`, persona: "photographer", profession: "photographers" },
  { slug: "swiftcard-templates", board: "SwiftCard templates", headline: "SwiftCard templates", sub: "Pick one, add your details, done", description: `The SwiftCard templates: Classic Pro, Modern Bold, Photo First, Local Business, Luxury Minimal and Logo First. ${FREE}`, persona: "realtor" },
];

export const PIN_W = 1000;
export const PIN_H = 1500;

export function pinIdea(slug: string): PinIdea | undefined {
  return PIN_IDEAS.find((p) => p.slug === slug);
}

/** The signup source a tap on this pin is recorded under. */
export function pinCode(slug: string): string {
  return `pin_${slug.replace(/-/g, "_")}`.slice(0, 52);
}
