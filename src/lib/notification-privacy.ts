import { getAdminSupabase } from "@/lib/supabase-admin";
import { isPaidProfile, PLAN_COLUMNS } from "@/lib/effective-plan";
import { hasMarkedPlace, redactLegacyPlace, redactPlaces, stripLocationMarks } from "@/lib/location-privacy";
import { hasMarkedName, redactNames, stripNameMarks } from "@/lib/contact-privacy";

// The one place a notification row is prepared for a browser.
//
// A Free account never receives the place a view came from — it is blocked out
// HERE, on the server, not hidden with CSS in the app. A blur over real text is
// a tease anyone can defeat with devtools; this is the part that actually holds.
// The app then blurs the blocks, which is what makes the redaction look
// deliberate instead of broken (see components/NotificationBody).
//
// A paid account gets the sentence exactly as it was written, with the
// invisible marks taken out.

export type NotificationRow = { body?: string | null; title?: string | null; type?: string | null } & Record<string, unknown>;

/**
 * The notification types whose body can end in a place — the only ones the
 * legacy sweep below is allowed to touch. A lead's body ("Dana shared their
 * info with you from a QR code") has no location in it, and hunting for the
 * word "in" there would eventually eat a company name.
 */
function canCarryLocation(type: string | null | undefined): boolean {
  const t = type ?? "";
  return t === "card_viewed" || t === "contact_saved" || t.startsWith("milestone_");
}

/**
 * Rows that describe being ON FREE: "Your Pro plan has ended — Subscribe…",
 * "…paused until you upgrade", "Text follow-ups are part of Pro". Each was true
 * the day it was written; the moment the account is paid again it is both false
 * and an upgrade pitch to someone who is paying. A paid account is not shown
 * them. Nothing is deleted — the rows are simply not handed to a paid reader.
 */
// lead_cap_reached: "That's 5 of 5 … Pro opens every one of them" — once
// they pay, every one of them already is open.
export const FREE_STATE_TYPES: ReadonlySet<string> = new Set(["pro_ended", "plan_downgraded", "sequence_paused", "lead_cap_reached"]);

/** The locked-lead teaser (api/leads) — on a paid account the contact is open. */
const LOCKED_LEAD_TAIL = / shared their info — open to unlock\.$/;

/** A paid reader's version of a new-contact body: the Free teaser tail becomes the plain fact. */
export function unlockedLeadBody(body: string): string {
  return body.replace(LOCKED_LEAD_TAIL, " shared their info with you.");
}

export function redactForPlan<T extends NotificationRow>(rows: T[], paid: boolean): T[] {
  const readable = paid ? rows.filter((r) => !FREE_STATE_TYPES.has(r.type ?? "")) : rows;
  return readable.map((raw) => {
    // A known contact's name (lib/contact-privacy.ts) can sit in the TITLE as
    // well as the body: "Priya re-opened your card". Pro gets the name, Free
    // gets blocks the app blurs — decided here, on read, so an upgrade reveals
    // every name the account was already told about.
    const title = typeof raw.title === "string" ? (paid ? stripNameMarks(raw.title) : redactNames(raw.title)) : raw.title;
    let row = title === raw.title ? raw : { ...raw, title };
    // The contact's id goes with their name. A Free row whose name was blocked
    // out still carried `lead_id`, and tapping it opened THAT contact on the
    // Contacts page — the name the blur was hiding, one tap away. Without the
    // id the row opens the contacts list, like any row that names no one.
    if (!paid && "lead_id" in row && (
      (typeof raw.title === "string" && hasMarkedName(raw.title)) ||
      (typeof raw.body === "string" && hasMarkedName(raw.body))
    )) {
      const rest: Record<string, unknown> = { ...row };
      delete rest.lead_id;
      row = rest as T;
    }
    const rawBody = typeof row.body === "string" ? row.body : null;
    if (!rawBody) return row;
    const body = paid ? stripNameMarks(rawBody) : redactNames(rawBody);
    if (paid) {
      // A contact captured over the Free cap and unlocked by the upgrade: the
      // row still said "— open to unlock", Free copy on a paid account.
      const plain = stripLocationMarks(body);
      return { ...row, body: row.type === "new_lead" ? unlockedLeadBody(plain) : plain };
    }
    // Rows written before the marks existed say the place in plain text, and a
    // Free account would go on reading those forever.
    const marked = hasMarkedPlace(body) || !canCarryLocation(row.type)
      ? body
      : redactLegacyPlace(body);
    return { ...row, body: redactPlaces(marked) };
  });
}

/** Is this account paid? One indexed read; used by the notification endpoints. */
export async function isPaidUser(userId: string): Promise<boolean> {
  try {
    const { data } = await getAdminSupabase()
      .from("profiles").select(PLAN_COLUMNS).eq("id", userId).maybeSingle();
    // effectivePlan: an expired timed grant is Free now, not at the next cron.
    return isPaidProfile(data);
  } catch {
    // Unknown plan: assume FREE. Withholding a place name from a paying
    // customer for one poll is recoverable; handing it to a Free account is the
    // leak this exists to close.
    return false;
  }
}
