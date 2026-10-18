import { getAccountEmail } from "@/lib/account-email";
import { isOptedOut } from "@/lib/messaging";

/**
 * Where mail TO the account holder goes — receipts, payment and trial notices,
 * lifecycle mail — or null when it must not go at all.
 *
 * The Resend webhook records every hard bounce and spam complaint in
 * message_opt_outs, the list the broadcast, lead, invite and follow-up senders
 * already consult. Mail to the account holder read only email_preferences, so
 * an address that bounced or pressed "Report spam" kept getting welcome, trial
 * and payment mail — against the domain every card share and team invite rides
 * on (audit N-09). isOptedOut fails closed: an unreadable list sends nothing,
 * and the bell row and push that accompany each of these still go.
 */
export async function ownerMailAddress(userId: string, fallbackEmail: string | null | undefined): Promise<string | null> {
  const to = await getAccountEmail(userId, fallbackEmail ?? null);
  if (!to) return null;
  return (await isOptedOut("email", to)) ? null : to;
}
