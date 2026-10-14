// ── Which product and industry pages a blog post should point at ────────────
//
// Posts are written by the Blog Writer agent and published from the Agent Flow
// queue; none of the first four linked to a single /for or /products page (SEO
// audit, 2026-10-14), so the pages that are supposed to rank for what the
// post ranks for got nothing from it. The page adds a "Related" row from this
// list: the post's own words (slug, title, keyword) pick the pages, and every
// post gets at least two, so a post about nothing in particular still points
// at the card and lead capture.
//
// Every href here is a real route — tests/blog-related.test.ts checks them
// against the sitemap's slug lists.

export type RelatedPage = { label: string; href: string; desc: string };

type Rule = { match: RegExp; pages: RelatedPage[] };

const P = {
  cards: { label: "Digital business cards", href: "/products/digital-cards", desc: "Your tap-to-share card" },
  leads: { label: "Lead capture", href: "/products/lead-capture", desc: "Turn every scan into a contact" },
  analytics: { label: "Dashboard & analytics", href: "/products/analytics", desc: "See who's viewing and reaching out" },
  integrations: { label: "Integrations", href: "/products/integrations", desc: "Salesforce, GoHighLevel, Pipedrive & more" },
  teams: { label: "Teams & Offices", href: "/products/teams", desc: "One brand across everyone" },
  links: { label: "SwiftLinks", href: "/products/swiftlinks", desc: "One link for everything you are" },
  signature: { label: "Swift Signature", href: "/products/email-signatures", desc: "A live card in every email" },
  wallet: { label: "Ways to share", href: "/products/wallet", desc: "Wallet, QR, NFC and the share sheet" },
  compare: { label: "Compare", href: "/compare", desc: "SwiftCard vs Linktree, Popl & Blinq" },
  blinq: { label: "Blinq alternative", href: "/compare/blinq-alternative", desc: "SwiftCard vs Blinq, side by side" },
  hihello: { label: "HiHello alternative", href: "/compare/hihello-alternative", desc: "SwiftCard vs HiHello, side by side" },
  popl: { label: "Popl alternative", href: "/compare/popl-alternative", desc: "SwiftCard vs Popl, side by side" },
  linktree: { label: "Linktree alternative", href: "/compare/linktree-alternative", desc: "SwiftCard vs Linktree, side by side" },
  realtors: { label: "For real estate agents", href: "/for/real-estate-agents", desc: "The card that works the open house" },
  contractors: { label: "For contractors", href: "/for/contractors", desc: "Share on site, capture the job" },
  insurance: { label: "For insurance agents", href: "/for/insurance-agents", desc: "Every quote starts with a contact" },
  loans: { label: "For loan officers", href: "/for/loan-officers", desc: "Pre-approval to close, one card" },
  lawyers: { label: "For lawyers", href: "/for/lawyers", desc: "A card that reads like your letterhead" },
  photographers: { label: "For photographers", href: "/for/photographers", desc: "Portfolio, booking and your card in one" },
  barbers: { label: "For barbers & stylists", href: "/for/barbers-and-stylists", desc: "Bookings from the chair" },
  cars: { label: "For car salespeople", href: "/for/car-salespeople", desc: "From test drive to follow-up" },
  company: { label: "About SwiftCard", href: "/company", desc: "Who makes SwiftCard" },
  pricing: { label: "Pricing", href: "/pricing", desc: "Free to start, Pro when you need it" },
} as const satisfies Record<string, RelatedPage>;

const RULES: Rule[] = [
  { match: /lead capture|capture lead|leads?\b/i, pages: [P.leads, P.analytics] },
  { match: /follow[- ]?up|trade ?show|conference|networking event|go cold/i, pages: [P.leads, P.integrations, P.wallet] },
  { match: /\bcrm\b|salesforce|hubspot|pipedrive|gohighlevel|zapier/i, pages: [P.integrations, P.leads] },
  { match: /\bteams?\b|office|brokerage|sales team|reps?\b/i, pages: [P.teams] },
  { match: /link[- ]in[- ]bio|linktree/i, pages: [P.links, P.linktree] },
  { match: /email signature|signature/i, pages: [P.signature] },
  { match: /apple wallet|\bnfc\b|qr code|tap[- ]to[- ]share/i, pages: [P.wallet] },
  { match: /analytics|view tracking|who viewed/i, pages: [P.analytics] },
  { match: /\bblinq\b/i, pages: [P.blinq] },
  { match: /\bhihello\b/i, pages: [P.hihello] },
  { match: /\bpopl\b/i, pages: [P.popl] },
  { match: /\bvs\.?\b|versus|comparison|compare|alternative|worth it|best digital business card/i, pages: [P.compare, P.cards] },
  { match: /real estate|realtor|open house/i, pages: [P.realtors] },
  { match: /contractor|plumber|electrician|roofer|hvac/i, pages: [P.contractors] },
  { match: /insurance/i, pages: [P.insurance] },
  { match: /loan officer|mortgage/i, pages: [P.loans] },
  { match: /lawyer|attorney|law firm/i, pages: [P.lawyers] },
  { match: /photographer/i, pages: [P.photographers] },
  { match: /barber|stylist|salon/i, pages: [P.barbers] },
  { match: /car sales|dealership|auto sales/i, pages: [P.cars] },
  { match: /funding|raises|angel|investor|press release|announc/i, pages: [P.company, P.cards] },
  { match: /pric|cost|free plan|how much/i, pages: [P.pricing] },
];

const MAX = 4;
const FALLBACK: RelatedPage[] = [P.cards, P.leads];

/** Up to four pages for a post, at least two, deduplicated, most specific first. */
export function relatedPages(post: { slug: string; title: string; keyword?: string | null }): RelatedPage[] {
  const text = `${post.slug.replace(/-/g, " ")} ${post.title} ${post.keyword ?? ""}`;
  const out: RelatedPage[] = [];
  const add = (p: RelatedPage) => {
    if (out.length < MAX && !out.some((o) => o.href === p.href)) out.push(p);
  };
  for (const rule of RULES) if (rule.match.test(text)) rule.pages.forEach(add);
  for (const p of FALLBACK) if (out.length < 2) add(p);
  return out;
}
