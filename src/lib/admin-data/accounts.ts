import { getAdminSupabase } from "@/lib/supabase-admin";
import { paged } from "@/lib/crew/paged";
import { isAdminEmail } from "@/lib/admin";
import { isTestMailbox } from "@/lib/test-mailbox";
import { isFounderCardSlug, isInternalCardSlug } from "@/lib/seeded-views";
import { effectivePlan } from "@/lib/effective-plan";
import { isApplePaid } from "@/lib/iap-entitlement";
import { isPaidPlan } from "@/lib/plan";

// ── Every account, once, the way the admin needs it ─────────────────────────
// The admin's numbers were wrong for one reason more than any other: of 41
// accounts on 2026-10-28, 28 were QA's throwaway accounts and 6 were ours
// (demo, App Review, the owner) — so "customers" were 83% not customers. This
// is the one place an account is read for the admin: paged (PostgREST answers
// any select with at most 1,000 rows, silently), with its real sign-in email,
// its cards, its office role, a display name and a kind. Every admin number
// counts `kind === "customer"` only; the others are listed under
// Users › Internal & test so nothing is hidden.

export type AccountKind = "customer" | "internal" | "test";

/** Our own accounts that are not on ADMIN_EMAILS: the demo, sales and App Review logins. */
const INTERNAL_EMAILS = new Set([
  "demo@swiftcard.me",
  "demo-sales@swiftcard.me",
  "demo-realty@swiftcard.me",
  "applereview@swiftcard.me",
  "applereview-free@swiftcard.me",
  "iap-test@swiftcard.me",
]);

/**
 * customer, internal (ours) or test (QA's throwaways, reserved test domains,
 * or an account whose card is one of the internal test slugs).
 */
export function accountKind(email: string | null | undefined, cardSlugs: (string | null | undefined)[] = []): AccountKind {
  const e = (email ?? "").trim().toLowerCase();
  if (e && isTestMailbox(e)) return "test";
  if (e && (isAdminEmail(e) || INTERNAL_EMAILS.has(e) || e.endsWith("@swiftcard.me"))) return "internal";
  // The founders sign up with their own addresses like anyone else; their
  // cards are how the code already knows them (lib/seeded-views). Read on
  // 2026-10-28: the co-founder's Office subscription was "1 paying customer,
  // $7.98/mo" and the owner's own Pro was "moved by hand".
  if (cardSlugs.some((s) => isFounderCardSlug(s))) return "internal";
  if (cardSlugs.some((s) => isInternalCardSlug(s))) return "test";
  return "customer";
}

/**
 * accountKind for one account when only its id and email are at hand (the
 * website ingest, notifications): reads its card addresses, which is how a
 * founder's account is told apart. Fails towards what the email alone says.
 */
export async function accountKindOf(userId: string | null | undefined, email: string | null | undefined): Promise<AccountKind> {
  const byEmail = accountKind(email);
  if (byEmail !== "customer" || !userId) return byEmail;
  try {
    const { data } = await getAdminSupabase().from("cards").select("username").eq("user_id", userId);
    return accountKind(email, (data ?? []).map((c) => c.username as string));
  } catch {
    return byEmail;
  }
}

/**
 * The name to show for an account. Signup asks for "Full name *" in the card
 * builder, so the name lives on the CARD — profiles.name is empty for every
 * normal signup (all 7 customers on 2026-10-28), which is why the Users list
 * showed "—". Profile name, then the first card's name, then the name the
 * sign-in provider gave (Google / Apple), then nothing (the caller shows the
 * email). profiles.name is deliberately NOT backfilled: an un-migrated
 * profile with a name serves a public legacy card at its slug.
 */
export function displayName(a: {
  profileName?: string | null;
  cardNames?: (string | null | undefined)[];
  meta?: Record<string, unknown> | null;
}): string | null {
  const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fromCards = (a.cardNames ?? []).map(clean).find(Boolean);
  return (
    clean(a.profileName) ||
    fromCards ||
    clean(a.meta?.full_name) ||
    clean(a.meta?.name) ||
    null
  );
}

/**
 * Does this account have a legacy profile card — a public page served from the
 * PROFILE rather than a cards row? The same rule the public page uses
 * (app/[username]/page.tsx: not migrated AND has a name), and only when no
 * card already uses that slug. The admin used to skip "has a name", so every
 * customer showed a phantom "(primary)" card next to their one real card.
 */
export function hasLegacyProfileCard(p: {
  username?: string | null;
  profileName?: string | null;
  customization?: unknown;
  cardSlugs: string[];
}): boolean {
  const migrated = !!(p.customization as { _migrated?: boolean } | null)?._migrated;
  return !migrated && !!p.username && !!(p.profileName ?? "").trim() && !p.cardSlugs.includes(p.username);
}

export type BillingSource = "stripe" | "apple" | "grant" | "office_member" | "none";

export type AccountCard = { id: string; username: string; name: string | null; label: string | null; created_at: string; is_offline: boolean };

export type Account = {
  id: string;
  kind: AccountKind;
  /** The sign-in email (profiles.email drifts to the card's public email). */
  email: string | null;
  name: string | null;
  profileName: string | null;
  username: string | null;
  plan: string;
  /** Plan right now, with an expired gift month counted as Free. */
  effectivePlan: string;
  planExpiresAt: string | null;
  createdAt: string;
  signupSource: string | null;
  referralCode: string | null;
  company: string | null;
  title: string | null;
  customization: Record<string, unknown>;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  deleted: boolean;
  cards: AccountCard[];
  officeRole: "owner" | "member" | null;
  billing: {
    source: BillingSource;
    trialEndsAt: string | null;
    pastDue: boolean;
    cancelling: boolean;
    everPaid: boolean;
  };
};

type ProfileRow = {
  id: string; username: string | null; name: string | null; email: string | null; plan: string | null;
  plan_expires_at: string | null; created_at: string; company: string | null; title: string | null;
  customization: Record<string, unknown> | null; signup_source: string | null; referral_code: string | null;
  stripe_subscription_id: string | null; stripe_customer_id: string | null;
};

/** How this account's plan is paid for, from what the webhooks mirror onto the profile. */
export function billingOf(p: {
  plan: string; effectivePlan: string; planExpiresAt: string | null;
  stripeSubscriptionId: string | null; customization: Record<string, unknown>;
  officeRole: "owner" | "member" | null;
}): Account["billing"] {
  const c = p.customization;
  const trialEnds = typeof c._trialEndsAt === "string" && Date.parse(c._trialEndsAt) > Date.now() ? (c._trialEndsAt as string) : null;
  const paid = isPaidPlan(p.effectivePlan);
  let source: BillingSource = "none";
  if (paid) {
    if (isApplePaid(c)) source = "apple";
    else if (p.stripeSubscriptionId) source = "stripe";
    else if (p.officeRole === "member" && p.plan === "enterprise") source = "office_member";
    else if (p.planExpiresAt) source = "grant";
  }
  return {
    source,
    trialEndsAt: source === "stripe" ? trialEnds : null,
    pastDue: typeof c._paymentFailedAt === "string",
    cancelling: c._cancelAtPeriodEnd === true,
    everPaid: c._everPaid === true,
  };
}

async function authUsers(): Promise<Map<string, { email: string | null; meta: Record<string, unknown> }>> {
  const map = new Map<string, { email: string | null; meta: Record<string, unknown> }>();
  const admin = getAdminSupabase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    for (const u of data.users) map.set(u.id, { email: u.email ?? null, meta: (u.user_metadata ?? {}) as Record<string, unknown> });
    if (data.users.length < 1000) break;
  }
  return map;
}

/** Every account (deleted ones included, flagged), classified. */
export async function loadAccounts(): Promise<Account[]> {
  const admin = getAdminSupabase();
  const [profiles, cards, offices, members, auth] = await Promise.all([
    paged<ProfileRow>(
      (from, to) => admin.from("profiles")
        .select(PROFILE_COLUMNS)
        .order("created_at", { ascending: false }).order("id").range(from, to),
      200_000, "admin profiles"),
    paged<{ id: string; user_id: string; username: string; name: string | null; label: string | null; created_at: string; is_offline: boolean | null; is_office_card: boolean | null }>(
      (from, to) => admin.from("cards").select("id, user_id, username, name, label, created_at, is_offline, is_office_card")
        .order("created_at", { ascending: true }).order("id").range(from, to),
      200_000, "admin cards"),
    paged<{ id: string; owner_id: string }>(
      (from, to) => admin.from("offices").select("id, owner_id").order("id").range(from, to), 50_000, "admin offices"),
    paged<{ user_id: string | null; status: string | null }>(
      (from, to) => admin.from("office_members").select("user_id, status").eq("status", "active").order("user_id").range(from, to), 200_000, "admin office members"),
    authUsers(),
  ]);

  const cardsByUser = new Map<string, AccountCard[]>();
  // Same order as the customer's own pages (lib/office-analytics): the office
  // card first, then oldest first — so "their first card" means the same card.
  const sorted = [...cards].sort((a, b) => Number(!!b.is_office_card) - Number(!!a.is_office_card) || a.created_at.localeCompare(b.created_at));
  for (const c of sorted) {
    const list = cardsByUser.get(c.user_id) ?? [];
    list.push({ id: c.id, username: c.username, name: c.name, label: c.label, created_at: c.created_at, is_offline: c.is_offline === true });
    cardsByUser.set(c.user_id, list);
  }
  const owners = new Set(offices.map((o) => o.owner_id));
  const memberIds = new Set(members.map((m) => m.user_id).filter(Boolean) as string[]);

  return profiles.map((p) => toAccount(p, cardsByUser.get(p.id) ?? [], auth.get(p.id), owners.has(p.id) ? "owner" : memberIds.has(p.id) ? "member" : null));
}

function toAccount(p: ProfileRow, myCards: AccountCard[], au: { email: string | null; meta: Record<string, unknown> } | undefined, officeRole: Account["officeRole"]): Account {
    const cust = (p.customization ?? {}) as Record<string, unknown>;
    const email = au?.email ?? p.email ?? null;
    const plan = p.plan ?? "free";
    const eff = effectivePlan({ plan, plan_expires_at: p.plan_expires_at, stripe_subscription_id: p.stripe_subscription_id, customization: cust }) ?? "free";
    return {
      id: p.id,
      kind: accountKind(email, myCards.map((c) => c.username)),
      email,
      name: displayName({ profileName: p.name, cardNames: myCards.map((c) => c.name), meta: au?.meta }),
      profileName: p.name,
      username: p.username,
      plan,
      effectivePlan: eff,
      planExpiresAt: p.plan_expires_at,
      createdAt: p.created_at,
      signupSource: p.signup_source,
      referralCode: p.referral_code,
      company: p.company,
      title: p.title,
      customization: cust,
      stripeSubscriptionId: p.stripe_subscription_id,
      stripeCustomerId: p.stripe_customer_id,
      deleted: cust._deleted === true,
      cards: myCards,
      officeRole,
      billing: billingOf({ plan, effectivePlan: eff, planExpiresAt: p.plan_expires_at, stripeSubscriptionId: p.stripe_subscription_id, customization: cust, officeRole }),
    };
}

const PROFILE_COLUMNS = "id, username, name, email, plan, plan_expires_at, created_at, company, title, customization, signup_source, referral_code, stripe_subscription_id, stripe_customer_id";

/** One account, read the same way as loadAccounts (for a customer's page). */
export async function loadAccount(id: string): Promise<Account | null> {
  const admin = getAdminSupabase();
  const [{ data: p }, { data: cards }, { data: owned }, { data: member }, auth] = await Promise.all([
    admin.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle(),
    admin.from("cards").select("id, user_id, username, name, label, created_at, is_offline, is_office_card").eq("user_id", id)
      .order("is_office_card", { ascending: false, nullsFirst: false }).order("created_at", { ascending: true }),
    admin.from("offices").select("id").eq("owner_id", id).limit(1),
    admin.from("office_members").select("user_id").eq("user_id", id).eq("status", "active").limit(1),
    admin.auth.admin.getUserById(id).then((r) => r.data?.user ?? null, () => null),
  ]);
  if (!p) return null;
  const myCards: AccountCard[] = (cards ?? []).map((c) => ({ id: c.id as string, username: c.username as string, name: (c.name as string | null) ?? null, label: (c.label as string | null) ?? null, created_at: c.created_at as string, is_offline: c.is_offline === true }));
  const au = auth ? { email: auth.email ?? null, meta: (auth.user_metadata ?? {}) as Record<string, unknown> } : undefined;
  return toAccount(p as ProfileRow, myCards, au, (owned ?? []).length ? "owner" : (member ?? []).length ? "member" : null);
}

/** Live customers only: not internal, not test, not closed. */
export function customersOf(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.kind === "customer" && !a.deleted);
}
