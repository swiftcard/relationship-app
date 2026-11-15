import { PLAN_PRICES } from "@/lib/plan";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// Kept in sync by hand with FOR_VERTICALS (same list as sitemap.ts).
const FOR_SLUGS = [
  "real-estate-agents",
  "contractors",
  "insurance-agents",
  "loan-officers",
  "lawyers",
  "photographers",
  "barbers-and-stylists",
  "car-salespeople",
];

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function buildLlmsTxt(base: string = APP_URL): string {
  const p = PLAN_PRICES;
  return `# SwiftCard

> SwiftCard is a digital business card and link-in-bio app for people who meet customers in person: real estate agents, contractors, insurance agents, loan officers, lawyers, photographers, stylists and car salespeople. Share your card with a QR code, a link or an NFC tap, capture leads from it, see who viewed it, and put a whole team on one brand.

## Pricing

- Free plan: try it out, with limits.
- Pro: ${usd(p.PRO_MONTHLY_CENTS)}/month or ${usd(p.PRO_ANNUAL_CENTS)}/year.
- Office (teams): ${usd(p.OFFICE_MONTHLY_PER_SEAT_CENTS)}/month or ${usd(p.OFFICE_ANNUAL_PER_SEAT_CENTS)}/year per seat.

## Pages

- [Pricing](${base}/pricing)
- [FAQ](${base}/faq)
- [Compare SwiftCard to alternatives](${base}/compare)

## Who it's for

${FOR_SLUGS.map((s) => `- [${s.replace(/-/g, " ")}](${base}/for/${s})`).join("\n")}
`;
}

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
