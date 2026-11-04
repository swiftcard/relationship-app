import { safeTimeZone } from "@/lib/tz-days";
import { CRM_OPTIONS, DEMO_LIMITS, DEMO_TIME_ZONE, TEAM_SIZES, isValidEmail, phoneDigitCount } from "./config";

// ── What a booking request must look like ───────────────────────────────────
// Pure and browser-safe: the popup shows the same messages the API returns.

export type DemoDetails = {
  name: string;
  email: string;
  phone: string;
  company: string;
  teamSize: string;
  role: string;
  crm: string;
  notes: string;
  smsOptIn: boolean;
};

export type DetailErrors = Partial<Record<"name" | "email" | "phone" | "company" | "teamSize", string>>;

/** One line of text: no control characters, single spaces, capped. */
export function cleanLine(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A paragraph: keeps line breaks, drops other control characters. */
export function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";
}

export function checkDetails(d: Pick<DemoDetails, "name" | "email" | "phone" | "company" | "teamSize">): DetailErrors {
  const errors: DetailErrors = {};
  if (!d.name.trim()) errors.name = "Enter your name.";
  if (!d.email.trim()) errors.email = "Enter your email.";
  else if (!isValidEmail(d.email)) errors.email = "That email doesn't look right.";
  if (!d.phone.trim()) errors.phone = "Enter your phone number.";
  else if (phoneDigitCount(d.phone) < 7 || phoneDigitCount(d.phone) > 15) errors.phone = "That phone number doesn't look right.";
  if (!d.company.trim()) errors.company = "Enter your company.";
  if (!(TEAM_SIZES as readonly string[]).includes(d.teamSize)) errors.teamSize = "Pick your team size.";
  return errors;
}

export type ParsedBooking = {
  id: string;
  details: DemoDetails;
  start: Date;
  timezone: string;
  /** The honeypot field a person never sees. */
  trap: string;
  elapsedMs: number;
  source: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBookingBody(body: unknown): { ok: true; value: ParsedBooking } | { ok: false; error: "invalid"; fields: DetailErrors | { form: string } } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const details: DemoDetails = {
    name: cleanLine(b.name, DEMO_LIMITS.name),
    email: cleanLine(b.email, DEMO_LIMITS.email).toLowerCase(),
    phone: cleanLine(b.phone, DEMO_LIMITS.phone),
    company: cleanLine(b.company, DEMO_LIMITS.company),
    teamSize: cleanLine(b.teamSize, 10),
    role: cleanLine(b.role, DEMO_LIMITS.role),
    crm: (CRM_OPTIONS as readonly string[]).includes(String(b.crm)) ? String(b.crm) : "",
    notes: cleanText(b.notes, DEMO_LIMITS.notes),
    smsOptIn: b.smsOptIn === true,
  };
  const errors = checkDetails(details);
  if (Object.keys(errors).length) return { ok: false, error: "invalid", fields: errors };
  if (typeof b.id !== "string" || !UUID_RE.test(b.id)) return { ok: false, error: "invalid", fields: { form: "Please reload the page and try again." } };
  const start = new Date(typeof b.start === "string" ? b.start : "");
  if (!Number.isFinite(start.getTime())) return { ok: false, error: "invalid", fields: { form: "Pick a time." } };
  const rawTz = cleanLine(b.timezone, 64);
  const tz = safeTimeZone(rawTz);
  return {
    ok: true,
    value: {
      id: b.id.toLowerCase(),
      details,
      start,
      // An unknown zone reads as New York, where the demos are, not as UTC.
      timezone: tz === "UTC" && rawTz !== "UTC" ? DEMO_TIME_ZONE : tz,
      trap: cleanLine(b.website, 200),
      elapsedMs: Number(b.elapsedMs) || 0,
      source: cleanLine(b.source, 20) === "page" ? "page" : "pricing",
    },
  };
}
