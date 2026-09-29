import { getAdminSupabase } from "@/lib/supabase-admin";

// ── What an OFFICE account's notification list may show ─────────────────────
//
// Rows are written once and live forever, so an account carries rows from
// every stage of its life: a referral link shared on Free, a payment that
// failed on a personal Pro subscription since cancelled. Once the person is on
// an Office team some of those are simply wrong to show them (owner,
// 2026-09-23: a team member must never get notifications meant for Free, Pro
// or the office admin):
//
//   • Referral progress ("One more to unlock Pro free for one month") — there
//     is no referral programme on any Office account, owner included; Settings
//     hides it for all of them. A link shared before joining still gets
//     signups, and each one wrote an upgrade pitch into the bell.
//   • Billing rows for a TEAM MEMBER with no subscription of their own left —
//     "Payment failed" or "You still have a personal Pro subscription" about a
//     subscription that no longer exists. A member who still pays for their own
//     (Stripe or Apple) keeps seeing them: that money is real.
//
// Free-state rows ("Your Pro plan has ended", "…paused until you upgrade") are
// hidden for every paid account by lib/notification-privacy (FREE_STATE_TYPES);
// an Office account is paid, so they are covered there, not repeated here.
//
// Nothing is deleted. The rows are only not handed to this reader.

export const REFERRAL_TYPES: ReadonlySet<string> = new Set(["referral_progress", "referral_claim"]);
export const PERSONAL_BILLING_TYPES: ReadonlySet<string> = new Set(["payment_failed", "personal_sub_reminder"]);

export type NotificationReader = {
  /** On an Office plan — owner or member. */
  officeAccount: boolean;
  /** A member of someone else's office (not its owner). */
  teamMember: boolean;
  /** Still pays for a subscription of their own (Stripe, or Pro bought in the iPhone app). */
  ownSubscription: boolean;
};

export const ORDINARY_READER: NotificationReader = { officeAccount: false, teamMember: false, ownSubscription: false };

export function hideForReader<T extends { type?: string | null }>(rows: T[], reader: NotificationReader): T[] {
  if (!reader.officeAccount && !reader.teamMember) return rows;
  return rows.filter((r) => {
    const type = r.type ?? "";
    if (REFERRAL_TYPES.has(type)) return false;
    if (reader.teamMember && !reader.ownSubscription && PERSONAL_BILLING_TYPES.has(type)) return false;
    return true;
  });
}

/**
 * Who is reading. One profile read; the office lookup only runs for an account
 * that has an office at all. Any failure reads as an ordinary account, which
 * shows everything exactly as before.
 */
export async function notificationReader(userId: string): Promise<NotificationReader> {
  try {
    const admin = getAdminSupabase();
    const { data: p } = await admin
      .from("profiles")
      .select("plan, office_id, stripe_subscription_id, customization")
      .eq("id", userId)
      .maybeSingle();
    if (!p) return ORDINARY_READER;
    const officeAccount = p.plan === "enterprise";
    const ownSubscription =
      !!p.stripe_subscription_id ||
      (p.customization as { _planSource?: unknown } | null)?._planSource === "apple";
    // A team member is someone ON an Office plan in someone else's office —
    // the same rule the dashboard applies to the bell's first render
    // (isEnterprise && office not owned && office_id). This used to skip the
    // plan check, so an account still attached to an office but no longer on
    // Office got referral / billing rows on first paint and lost them on the
    // bell's first poll a second later. It also skips a lookup per poll for
    // every account that isn't on Office.
    let teamMember = false;
    if (officeAccount && p.office_id) {
      const { data: office } = await admin.from("offices").select("owner_id").eq("id", p.office_id).maybeSingle();
      teamMember = !!office && office.owner_id !== userId;
    }
    return { officeAccount, teamMember, ownSubscription };
  } catch {
    return ORDINARY_READER;
  }
}

// ── When the admin changes the brand ────────────────────────────────────────
//
// A team member's card changes under them whenever their admin saves Branding:
// a new logo, a new company phone, a pinned link, or — the one that takes
// something away — "Keep every card matching" switched on, which replaces the
// look they chose. Nothing told them. One bell row per save that changes what
// their card shows, bell only (never a push: it is not urgent), and it
// replaces their previous unread one, so an admin tuning Branding for an hour
// leaves one accurate line, not twenty.

export const BRAND_NOTICE_TYPE = "office_brand_updated";

export function brandChangeNotice(c: {
  /** "Keep every card matching" [before, after]. */
  cardLock: [boolean, boolean];
  /** "Keep every Swift Links page matching" [before, after]. */
  linkLock: [boolean, boolean];
  /** Something the member's card or Swift Links page shows changed. */
  contentChanged: boolean;
}): { title: string; body: string } | null {
  const on: string[] = [];
  const off: string[] = [];
  if (!c.cardLock[0] && c.cardLock[1]) on.push("Card design");
  if (c.cardLock[0] && !c.cardLock[1]) off.push("Card design");
  if (!c.linkLock[0] && c.linkLock[1]) on.push("Social design");
  if (c.linkLock[0] && !c.linkLock[1]) off.push("Social design");
  const both = (a: string[]) => a.join(" and ");

  if (on.length) {
    const title = on.length === 2
      ? "Your company now sets your card's look"
      : on[0] === "Card design" ? "Your company now sets your card's design" : "Your company now sets your Swift Links look";
    const body =
      `Your team admin chose one look for everyone on the team, so ${both(on)} ${on.length === 2 ? "are" : "is"} managed for you now. ` +
      "Your name, title, headshot and your own links are still yours to edit." +
      (off.length ? ` ${off[0]} is yours to style again.` : "");
    return { title, body };
  }
  if (off.length) {
    const title = off.length === 2
      ? "You can style your card and Swift Links page yourself"
      : off[0] === "Card design" ? "You can style your card yourself" : "You can style your Swift Links page yourself";
    return {
      title,
      body: `Your team admin unlocked ${both(off)}, so you can choose your own look in Edit card. Your company details stay managed by your team.`,
    };
  }
  if (c.contentChanged) {
    return {
      title: "Your company updated your card",
      body: "Your team admin updated your company's branding, and your card and Swift Links page show it now. Your name, title, headshot and your own links are unchanged.",
    };
  }
  return null;
}

/**
 * Did this Branding save change anything a member's card shows? Compared on
 * the stored office row before and after. The look (template, colours, custom
 * layout) only reaches a member while "Keep every card matching" is on, and the
 * Swift Links look only while its lock is on — a change to either while
 * unlocked touches no member card, so it is not news to them.
 */
export function brandContentChanged(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  locks: { card: boolean; link: boolean },
): boolean {
  if (!before || !after) return false;
  const same = (k: string) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null);
  const always = [
    "brand_logo_url", "brand_company", "brand_website", "brand_phone", "brand_fax", "brand_address",
    "brand_link_bio", "brand_link_instagram", "brand_links",
  ];
  const whenCardLocked = ["brand_template", "brand_design", "brand_custom_layout"];
  const whenLinkLocked = ["brand_link_design"];
  return (
    always.some((k) => !same(k)) ||
    (locks.card && whenCardLocked.some((k) => !same(k))) ||
    (locks.link && whenLinkLocked.some((k) => !same(k)))
  );
}
