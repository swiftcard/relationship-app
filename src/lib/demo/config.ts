// ── Office demo booking: the rules ──────────────────────────────────────────
//
// Owner, 2026-11-03: a "Book a demo" button on the pricing page's Office card
// only. Demos are Monday to Friday, 10 AM to 5 PM New York time, 30 minutes
// each, on Google Meet. The owner blocks any other time by putting a busy event
// on the hello@swiftcard.me Google Calendar, which the slot list reads.
//
// Browser-safe: no server imports. The popup, the /demo page, the booking API
// and the clock all read the same numbers from here.

export const DEMO_TIME_ZONE = "America/New_York";

export const DEMO_RULES = {
  /** Length of one demo, and the gap between start times. */
  durationMin: 30,
  /** Days a demo can be on (0 = Sunday … 6 = Saturday). */
  weekdays: [1, 2, 3, 4, 5] as readonly number[],
  /** First start, New York time. */
  startHour: 10,
  /** Every demo is over by this hour, New York time (the last one starts 4:30). */
  endHour: 17,
  /** Owner, 2026-11-04: never the same day. The first bookable day is this
   *  many days after today's New York date, so the earliest demo is 10 AM
   *  tomorrow (a Friday or weekend booking starts Monday). It gives the owner a
   *  night to prepare and lets the night-before and morning-of reminders run. */
  minDaysAhead: 1,
  /** How far ahead the calendar opens. */
  horizonDays: 30,
} as const;

export const DEMO_DURATION_MS = DEMO_RULES.durationMin * 60 * 1000;

/** What the owner's calendar and inbox are: the one Workspace mailbox. */
export const DEMO_CALENDAR_EMAIL_DEFAULT = "hello@swiftcard.me";

export const TEAM_SIZES = ["2–5", "6–15", "16–50", "51+"] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

/** The team-size chip that holds `seats` (the Office seat picker's number). */
export function teamSizeFor(seats: number | null | undefined): TeamSize {
  const n = Number(seats) || 0;
  if (n <= 5) return "2–5";
  if (n <= 15) return "6–15";
  if (n <= 50) return "16–50";
  return "51+";
}

export const CRM_OPTIONS = [
  "None yet", "HubSpot", "Salesforce", "Pipedrive", "GoHighLevel", "Zoho", "Google Contacts", "Other",
] as const;

/** Field limits, shared by the form (maxLength) and the API (the real check). */
export const DEMO_LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  company: 160,
  role: 120,
  notes: 2000,
} as const;

/** The minimum time between the details form opening and Confirm. A person
 *  cannot type a name, an email, a phone and a company faster than this. */
export const DEMO_MIN_FILL_MS = 4000;

export function isValidEmail(v: string): boolean {
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(v.trim());
}

export function phoneDigitCount(v: string): number {
  return (v.match(/\d/g) ?? []).length;
}
