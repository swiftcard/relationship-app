import type { PhoneKind } from "./types";

// ── Card Builder: is this number a mobile? ──────────────────────────────────
// An opener goes over iMessage, and only a mobile number can get one. A
// brokerage's main line, a desk phone or a fixed VoIP switchboard never will,
// so a prospect whose only number is one of those is FLAGGED on the review
// screen and never queued for the Mac, instead of failing silently there.
//
// Twilio Lookup v2, Line Type Intelligence: about a cent a number, and only
// ever asked for a number we are about to text. The answer is kept on the
// preview (phone_kind), so it is asked once.

/** Twilio's line types → what they mean for a text. Google Voice and the like are "nonFixedVoip": they may or may not take one. */
export function kindOfLineType(type: unknown): PhoneKind {
  if (type === "mobile" || type === "personal") return "mobile";
  if (type === "landline" || type === "fixedVoip" || type === "tollFree" || type === "uan" || type === "voicemail" || type === "pager" || type === "sharedCost") return "office";
  return "unknown";
}

/** +1XXXXXXXXXX for a North American number; null for anything else. */
export function nanp(phone: string): string | null {
  const d = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `+1${d}` : null;
}

/**
 * The line type of `phone`, or null when it can't be found out (Twilio not
 * configured here, the request failed). Null never blocks anything: the
 * prospect is then shown as "not checked".
 */
export async function lookupPhoneKind(phone: string, opts: { fetchImpl?: typeof fetch; sid?: string; token?: string } = {}): Promise<PhoneKind | null> {
  const sid = opts.sid ?? process.env.TWILIO_ACCOUNT_SID, token = opts.token ?? process.env.TWILIO_AUTH_TOKEN;
  const e164 = nanp(phone);
  if (!sid || !token || !e164) return null;
  try {
    const res = await (opts.fetchImpl ?? fetch)(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { valid?: boolean; line_type_intelligence?: { type?: string } | null };
    if (body.valid === false) return "office";
    return kindOfLineType(body.line_type_intelligence?.type);
  } catch {
    return null;
  }
}
