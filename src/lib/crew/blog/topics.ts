// ── What the Blog Writer writes about ───────────────────────────────────────
// Searches people actually type when they are about to choose a card, a link
// in bio page or a way to follow up, each with the reader and the angle. The
// writer takes the first two nobody has written about yet (by keyword, slug
// and title), so a topic is never written twice; when the list runs out it
// asks the model for new ones in the same spirit.

export type BlogTopic = { keyword: string; reader: string; angle: string };

export const TOPIC_PLAN: BlogTopic[] = [
  { keyword: "best digital business card app", reader: "anyone choosing a card app", angle: "what actually matters when you pick one, and why SwiftCard ends up the obvious choice" },
  { keyword: "digital business card for real estate agents", reader: "real estate agents", angle: "open houses, sign in sheets and the buyers who never call back" },
  { keyword: "linktree alternative", reader: "professionals using a link in bio", angle: "a link page that is also your business card and captures who's looking" },
  { keyword: "free digital business card", reader: "people who want to start without paying", angle: "what you really get free, and where it pays to upgrade" },
  { keyword: "qr code business card", reader: "people printing or showing a QR code", angle: "a QR code that opens a card people can save, not a dead page" },
  { keyword: "nfc business card", reader: "people looking at tap cards", angle: "you don't need to buy hardware to get the tap, and what happens after the tap matters more" },
  { keyword: "how to follow up after a networking event", reader: "people who collect cards and never follow up", angle: "the 48 hours after the event, and making follow up automatic" },
  { keyword: "digital business card for loan officers", reader: "loan officers and mortgage brokers", angle: "referral partners, realtor relationships and fast follow up" },
  { keyword: "digital business card for insurance agents", reader: "insurance agents", angle: "local events, referrals and staying top of mind" },
  { keyword: "digital business card for recruiters", reader: "recruiters", angle: "career fairs and keeping candidates and hiring managers straight" },
  { keyword: "business card for contractors", reader: "contractors, plumbers, electricians", angle: "job sites, neighbors asking for your number, and reviews" },
  { keyword: "digital business card for hair stylists", reader: "salons, barbers and stylists", angle: "booking links, portfolios and Instagram traffic in one place" },
  { keyword: "digital business card for photographers", reader: "photographers", angle: "portfolio, booking and contact in one link people save" },
  { keyword: "business card for car salesman", reader: "car salespeople", angle: "the walk in who leaves and buys somewhere else" },
  { keyword: "how to share contact info at a trade show", reader: "sales reps at trade shows", angle: "badge scans versus a card that sends their details back to you" },
  { keyword: "email signature with business card", reader: "people sending lots of email", angle: "every email as a way to save your contact" },
  { keyword: "add business card to apple wallet", reader: "iPhone users", angle: "your card one double tap away, even offline" },
  { keyword: "digital business card for teams", reader: "team leads and office managers", angle: "every agent on the same branded card, and seeing the team's results" },
  { keyword: "track who viewed my business card", reader: "people who wonder if anyone kept their card", angle: "knowing who opened, saved and came back" },
  { keyword: "link in bio for realtors", reader: "realtors on Instagram", angle: "turning Instagram visits into saved contacts and booked showings" },
  { keyword: "popl alternative", reader: "people comparing tap card brands", angle: "what happens after the tap" },
  { keyword: "hihello alternative", reader: "HiHello users", angle: "turning a card into new business with capture and follow up" },
  { keyword: "blinq alternative", reader: "Blinq users", angle: "a card that feeds a pipeline" },
  { keyword: "are paper business cards still worth it", reader: "people still printing cards", angle: "what paper costs you that you never see" },
  { keyword: "how to make a digital business card", reader: "first timers", angle: "a two minute walkthrough that ends with a card worth sharing" },
  { keyword: "virtual business card for small business", reader: "small business owners", angle: "one link for the card, the website, the reviews and the booking page" },
  { keyword: "business card ideas that stand out", reader: "people who want to be remembered", angle: "standing out by being easy to save and easy to reach" },
  { keyword: "how to get more referrals", reader: "people who live on referrals", angle: "making yourself easy to pass along" },
  { keyword: "open house sign in sheet alternative", reader: "real estate agents", angle: "visitors who tap and save you, and leave their details without a clipboard" },
  { keyword: "digital business card for students", reader: "students and new grads at career fairs", angle: "looking prepared without printing anything" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** True when this topic (or one too close to it) has been written. */
export function alreadyWritten(t: BlogTopic, used: { keywords: string[]; titles: string[]; slugs: string[] }): boolean {
  const k = norm(t.keyword);
  if (used.keywords.some((u) => norm(u) === k)) return true;
  if (used.slugs.some((s) => norm(s).includes(k) || k.includes(norm(s)))) return true;
  return used.titles.some((title) => norm(title).includes(k));
}

/** The next topics nobody has written, in plan order. */
export function nextTopics(used: { keywords: string[]; titles: string[]; slugs: string[] }, n = 2, plan: BlogTopic[] = TOPIC_PLAN): BlogTopic[] {
  return plan.filter((t) => !alreadyWritten(t, used)).slice(0, n);
}
