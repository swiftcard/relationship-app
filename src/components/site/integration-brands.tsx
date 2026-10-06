import type { ReactNode } from "react";

// ── The integrations the marketing site is allowed to claim ──────────────────
//
// ONE list, consumed by every public surface: the homepage logo band, the
// /products/integrations hero grid and feature list, and its meta description.
//
// It exists because the copy drifted. GoHighLevel and Pipedrive shipped, and the
// site went on advertising "Zapier, Google Contacts and HubSpot" in five
// separate hand-maintained places — a logo strip, a hero grid, a feature list, a
// nav description and a plan bullet — none of which knew about the other four.
// Adding the next integration should mean editing this array and nothing else.
//
// ORDER IS DELIBERATE: GoHighLevel and Pipedrive lead because they're the CRMs
// our users actually run on. Keep the two of them first.
//
// Every entry here must correspond to something a user can really connect in
// Settings → Integrations (see IntegrationsSettings.tsx). Do not add a logo we
// merely intend to support — tests/integrations-marketing-truth.test.ts fails
// the build if this list and the product drift apart.

export type IntegrationBrand = {
  /** Display name. Must match the title used on the in-app card. */
  name: string;
  /** Compact label for tight grids — a few words, no sentence. */
  short: string;
  /** Full sentence for the product page feature list. */
  blurb: string;
  logo: ReactNode;
};

export const INTEGRATIONS: IntegrationBrand[] = [
  {
    name: "GoHighLevel",
    short: "Sub-account sync",
    blurb:
      "New leads land straight in your sub-account and arrive tagged, so the workflows and pipelines you have already built start running without you touching anything.",
    logo: (
      <svg viewBox="0 0 24 24" className="w-full h-full" fill="#2a9d8f" aria-hidden="true">
        <path d="M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.9 3.8-6.9 3.8-6.9-3.8L12 4.3zM5 9.4l6 3.3v6.6l-6-3.3V9.4zm8 9.9v-6.6l6-3.3v6.6l-6 3.3z" />
      </svg>
    ),
  },
  {
    name: "Pipedrive",
    short: "Person + note",
    blurb:
      "Every lead becomes a Pipedrive person automatically, complete with a note recording where you met them — and meeting someone again updates the person you already have (matched by email) instead of adding a duplicate.",
    logo: (
      <svg viewBox="0 0 24 24" className="w-full h-full" fill="#017737" aria-hidden="true">
        <path d="M13.1 3.2c-1.79 0-3.02.79-3.71 1.68-.04-.5-.36-1.44-1.93-1.44H5.09v3.02h1.1c.24 0 .32.08.32.32v14.02h3.36v-6.06c0-.29-.02-.53-.03-.63.63.75 1.79 1.52 3.45 1.52 3.13 0 5.35-2.45 5.35-6.26 0-3.86-2.09-6.17-5.54-6.17zm-.72 9.6c-1.9 0-2.79-1.78-2.79-3.4 0-2.55 1.4-3.44 2.72-3.44 1.63 0 2.75 1.36 2.75 3.42 0 2.15-1.27 3.42-2.68 3.42z" />
      </svg>
    ),
  },
  {
    name: "Salesforce",
    short: "Lead sync",
    blurb:
      "Every contact becomes a Salesforce Lead the moment it's captured — name, company, email, phone, tags, and a note recording where you met, all in the record.",
    logo: (
      <svg viewBox="0 0 24 24" className="w-full h-full" fill="#00A1E0" aria-hidden="true">
        <path d="M10.06 5.48c.77-.8 1.85-1.3 3.04-1.3 1.58 0 2.96.88 3.7 2.19a5.1 5.1 0 012.09-.44 5.18 5.18 0 010 10.36c-.35 0-.7-.04-1.03-.1a3.77 3.77 0 01-4.93 1.55 4.3 4.3 0 01-7.98-.19 3.98 3.98 0 01-.83.09 4.03 4.03 0 01-1.99-7.52 4.63 4.63 0 017.93-4.64z" />
      </svg>
    ),
  },
  {
    name: "HubSpot",
    short: "CRM record",
    blurb:
      "Every contact lands in HubSpot, tagged with which card they scanned and the context of where you met — someone you meet again updates their existing record instead of becoming a duplicate.",
    logo: (
      <svg viewBox="0 0 24 24" className="w-full h-full" fill="#FF7A59" aria-hidden="true">
        <path d="M18.5 7.3V4.9a1.85 1.85 0 10-1.1 0v2.4a5.6 5.6 0 00-2.66 1.17L8.2 4.02a2.1 2.1 0 10-1 1.72l6.42 4.42a5.6 5.6 0 00.02 6.06l-1.95 1.95a1.8 1.8 0 101.06 1.06l1.93-1.93A5.62 5.62 0 1018.5 7.3zm-2.16 8.42a2.9 2.9 0 112.9-2.9 2.9 2.9 0 01-2.9 2.9z" />
      </svg>
    ),
  },
  {
    name: "Google Contacts",
    short: "Contacts sync",
    blurb:
      "New leads sync into your Google account automatically, so their name, email and phone are on every device you own — no manual entry.",
    logo: (
      <svg viewBox="0 0 48 48" className="w-full h-full" aria-hidden="true">
        <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
        <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0024 46z" />
        <path fill="#FBBC05" d="M11.69 28.18A13.2 13.2 0 0111 24c0-1.45.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 002 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
        <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2A21.99 21.99 0 004.34 14.12l7.35 5.7C13.42 14.62 18.27 10.75 24 10.75z" />
      </svg>
    ),
  },
  {
    name: "Zapier",
    short: "6,000+ apps",
    blurb:
      "Connect SwiftCard to 6,000+ apps with a no-code Zap — fire a Slack ping, add a Notion row, or kick off an email sequence the moment a lead comes in.",
    logo: (
      <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="#FF4F00" strokeWidth={3.2} strokeLinecap="round" aria-hidden="true">
        <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
      </svg>
    ),
  },
  {
    name: "CSV export",
    short: "Export anytime",
    blurb:
      "Download all your contacts as a clean spreadsheet any time. Your data is yours to keep, move, or import anywhere you like.",
    logo: (
      <svg viewBox="0 0 24 24" className="w-full h-full" fill="none" stroke="#5D6BFF" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M13 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V9z" />
        <path d="M13 3v6h6" />
        <path d="M8.5 13.5h7M8.5 16.5h7" />
      </svg>
    ),
  },
];

/** Prose list for running copy: "GoHighLevel, Pipedrive, HubSpot, … and CSV export". */
export function integrationNames(): string {
  const names = INTEGRATIONS.map((i) => i.name);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
