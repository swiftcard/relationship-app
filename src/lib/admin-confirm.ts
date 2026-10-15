// ── What an admin button is about to do, said before it does it ─────────────
// Audit F-ADMIN-01/02: the Users list's plan dropdown and the user page's plan
// buttons, "Grant 1 month of Pro" and "Take offline" acted on the first click,
// so one mis-scroll could cancel a paying customer or dissolve an office. Every
// one of them now asks first, in words that name the consequence.

const LABEL: Record<string, string> = { free: "Free", pro: "Pro", enterprise: "Office" };

export function planLabel(plan: string): string {
  return LABEL[plan] ?? plan;
}

/** The confirmation for moving `who` from plan `from` to plan `to`. */
export function planChangeWarning(who: string, from: string, to: string): string {
  const head = `Move ${who} from ${planLabel(from)} to ${planLabel(to)}?`;
  const team = from === "enterprise" ? " Their Office team is released: every member loses Office access." : "";
  if (to === "free") {
    return `${head}\n\nIf they pay through Stripe, their subscription is cancelled now, with no refund.${team}`;
  }
  if (from === "enterprise") {
    return `${head}\n\n${team.trim()} (An Office paid through Stripe has to be switched in Billing or in Stripe instead.)`;
  }
  return `${head}\n\nNothing is charged. It stays until you change it back.`;
}

export function grantMonthWarning(who: string): string {
  return `Give ${who} one month of Pro, free?\n\nNothing is charged, and it ends by itself when the month is up.`;
}

export function takeOfflineWarning(username: string): string {
  return `Take ${username} offline?\n\nThe card and its Swift Links page stop loading for everyone (links, QR codes and NFC taps) until you bring it back online.`;
}

/** An admin API's refusal, as one readable line. */
export async function adminErrorText(res: Response): Promise<string> {
  const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return d.error || d.message || `That didn't work (error ${res.status}). Nothing was changed.`;
}
