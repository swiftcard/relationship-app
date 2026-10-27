// ── What the finders search for, in rotation ────────────────────────────────
// A continuous agent runs every 15 minutes while it is on. Asking the same
// question every run would return the same posts, all already seen. So each
// agent walks an endless rotation (replies/engine.ts rotate()) through these
// lists: professions × problems for posts, professions × cities for people.
// SwiftCard's buyers first (spec §2): realtors, insurance agents, loan
// officers, contractors, local business owners, sales people. Never lawyers.

export const PROFESSIONS = [
  "realtors",
  "real estate agents",
  "insurance agents",
  "loan officers",
  "mortgage brokers",
  "contractors",
  "small business owners",
  "sales reps",
  "recruiters",
  "financial advisors",
  "consultants",
  "property managers",
  "home inspectors",
  "photographers",
  "personal trainers",
  "landscapers",
];

export const PROBLEMS = [
  "digital business cards or business card apps",
  "following up with people they met at a networking event",
  "losing leads or forgetting who they met",
  "sharing contact info with a QR code or NFC",
  "Linktree or link in bio alternatives for their business",
  "HiHello, Blinq or Popl being too expensive or missing something",
  "getting their number saved in a client's phone",
  "keeping track of contacts and follow ups without a big CRM",
  "what to hand out at open houses, trade shows or job fairs",
  "personal branding for local professionals",
];

export const US_METROS = [
  "New York",
  "Brooklyn",
  "Long Island",
  "New Jersey",
  "Miami",
  "Tampa",
  "Orlando",
  "Atlanta",
  "Charlotte",
  "Houston",
  "Dallas",
  "Austin",
  "San Antonio",
  "Phoenix",
  "Las Vegas",
  "Denver",
  "Chicago",
  "Nashville",
  "Los Angeles",
  "San Diego",
  "Seattle",
  "Boston",
  "Philadelphia",
  "Washington DC",
];
