// ── What the Blog Writer knows about the market before it researches ───────
// The owner, 2026-10-29: the blog agent must be "well versed and know a lot
// about our competitors" and have "done a lot of research about our market".
// This is the standing brief: the category, who buys, each competitor's
// honest positioning (the same words the /compare pages use, so the blog and
// those pages never disagree), and where SwiftCard wins. On top of it, every
// Generate refreshes live research (writer.ts: market research every two
// weeks, the search results for each post's keyword every time). Competitor
// PRICES are deliberately not here: they change, and a wrong one is a
// credibility and a legal problem, so a price may only come from this run's
// research, with its source.

export type Competitor = { name: string; site: string; what: string; whySwitch: string; compare: string | null };

export const COMPETITORS: Competitor[] = [
  { name: "Linktree", site: "linktr.ee", compare: "/compare/linktree-alternative", what: "A link in bio page: a list of links, and that's the whole product.", whySwitch: "People switch when they need the page to do more: a business card visitors can save to their phone, a form that sends their details back, and follow up that runs itself." },
  { name: "Popl", site: "popl.co", compare: "/compare/popl-alternative", what: "A digital business card with a strong hardware line (branded NFC accessories).", whySwitch: "People switch for what happens after the tap: a built in CRM and automated email and text follow up, which Popl expects you to assemble from integrations." },
  { name: "Blinq", site: "blinq.me", compare: "/compare/blinq-alternative", what: "A well made digital business card with a generous free tier.", whySwitch: "People switch when they want the card to feed a pipeline: a CRM with notes and history, follow ups for any contact, and a full link in bio page, without a separate tool for each." },
  { name: "HiHello", site: "hihello.com", compare: "/compare/hihello-alternative", what: "Solid digital card fundamentals, email signatures and several cards per person.", whySwitch: "People switch for built in lead capture with a CRM, automated follow up, and a full link in bio page." },
  { name: "Mobilo", site: "mobilocard.com", compare: "/compare/mobilo-alternative", what: "Physical NFC cards, sold mainly to companies rolling cards out to teams, priced per user and billed yearly.", whySwitch: "People switch to start free without buying a card, pay month to month, and have the follow up run itself." },
  { name: "Linq", site: "linqapp.com", compare: "/compare/linq-alternative", what: "An established digital card company with a wide hardware line, aimed more and more at sales teams and enterprises.", whySwitch: "Solo professionals and small teams switch to start free, pay one simple price, and get lead capture and follow up without an enterprise rollout." },
  { name: "Dot", site: "dot.cards", compare: "/compare/dot-alternative", what: "Hardware first: you buy a dot card, band or tag, and the profile it opens is free.", whySwitch: "People switch when they don't want to buy a device to start, want their card in Apple Wallet and on Apple Watch, and want the share back form, CRM and follow up included." },
  { name: "Link.me", site: "link.me", compare: null, what: "A link in bio app popular with creators.", whySwitch: "Professionals want a real business card people can save, plus contact capture, not only a link list." },
  { name: "Beacons", site: "beacons.ai", compare: null, what: "A creator link in bio with a store and media kit.", whySwitch: "Built for creators selling to fans, not for professionals who need contacts saved and leads followed up." },
  { name: "Paper business cards", site: "", compare: null, what: "Still the default at events and open houses.", whySwitch: "They run out, get tossed, can't be updated, and tell you nothing: you never learn who kept yours or who to follow up with." },
];

/** Who reads these posts, and what they actually lose today. */
export const BUYERS = [
  "real estate agents and brokers (open houses, sign in sheets, buyers who never call back)",
  "loan officers and mortgage brokers (referral partners, quick follow up after a pre approval chat)",
  "insurance agents (local events, referrals, staying top of mind at renewal time)",
  "recruiters (career fairs, candidates and hiring managers in one place)",
  "sales reps and account executives (trade shows, conferences, handoffs to the CRM)",
  "contractors, plumbers, electricians, landscapers and window cleaners (job sites, door hangers, neighbors asking for your number)",
  "salons, barbers, stylists and photographers (booking links, portfolios, Instagram traffic)",
  "car salespeople (walk ins who leave and buy elsewhere)",
  "small business owners and founders (networking events, investor meetings, a link in bio that also works as a card)",
  "teams and offices that want every agent on the same branded card (SwiftCard Office)",
];

/** What a SwiftCard post argues, always in the reader's own terms. */
export const ANGLES = [
  "A card that captures the other person's details, so the conversation doesn't end when they walk away.",
  "Follow up that happens on its own, while the meeting is still fresh.",
  "One link that is both your business card and your link in bio page.",
  "Knowing who opened your card, saved your contact, and when, instead of guessing.",
  "Free to start, no app needed for the person you hand it to, and it updates everywhere when your details change.",
  "Share it the way the moment needs: QR code, a text, an NFC tap, Apple Wallet, an email signature.",
];

/** The site pages a post may link to (internal links matter for ranking). */
export const INTERNAL_LINKS = [
  { href: "/cards/new?src=blog", label: "create a free card" },
  { href: "/pricing", label: "pricing" },
  { href: "/compare", label: "how SwiftCard compares" },
  { href: "/products/digital-cards", label: "digital business cards" },
  { href: "/products/swiftlinks", label: "Swift Links (link in bio)" },
  { href: "/products/email-signatures", label: "email signatures" },
  { href: "/products/lead-capture", label: "lead capture" },
  { href: "/products/analytics", label: "card analytics" },
  { href: "/products/teams", label: "SwiftCard for teams" },
  { href: "/products/wallet", label: "Apple Wallet" },
  { href: "/business-card-view-tracking", label: "business card view tracking" },
  { href: "/link-in-bio-with-analytics", label: "link in bio with analytics" },
  { href: "/templates", label: "card templates" },
  ...COMPETITORS.filter((c) => c.compare).map((c) => ({ href: c.compare!, label: `${c.name} alternative` })),
];

/** The brief as one block for the writer's prompt. */
export function marketBrief(): string {
  return [
    "THE MARKET (standing brief):",
    "SwiftCard sells digital business cards with a built in link in bio page (Swift Links), contact capture, follow up and analytics, mostly to professionals who meet people in person and live on referrals.",
    "",
    "COMPETITORS, honestly:",
    ...COMPETITORS.map((c) => `- ${c.name}${c.site ? ` (${c.site})` : ""}: ${c.what} ${c.whySwitch}${c.compare ? ` Our page: ${c.compare}` : ""}`),
    "",
    "WHO READS THIS AND WHAT THEY LOSE TODAY:",
    ...BUYERS.map((b) => `- ${b}`),
    "",
    "WHERE SWIFTCARD WINS (argue these in the reader's terms):",
    ...ANGLES.map((a) => `- ${a}`),
    "",
    "Honesty: say what competitors do well. Never state a competitor's price, plan or feature unless this run's research found it, and then name where it came from. Never invent a customer, a statistic or a result.",
  ].join("\n");
}
