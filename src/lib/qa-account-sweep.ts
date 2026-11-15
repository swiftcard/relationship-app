import { getAdminSupabase } from "@/lib/supabase-admin";
import { purgeUserData } from "@/lib/account-purge";

// ── QA throwaway accounts nobody finished deleting (audit F-AUTH-01) ────────
//
// Every QA script (scripts/qa-*.mjs, nightly-qa) seeds accounts on the
// reserved .invalid domain and deletes them in a `finally` block. That block
// is a row of admin DELETEs that never check their answers, and a job killed
// on a timeout never reaches it: 253 profile-less sign-ins had piled up in
// production, pushing real accounts out of the first page the duplicate-
// account alert reads. The daily cron removes whatever a run left behind.
//
// Only addresses on QA_EMAIL_DOMAIN, which no real person can own (RFC 2606),
// and only once they are a day old, so a QA run in progress is never touched.

export const QA_EMAIL_DOMAIN = "@swiftcard-test.invalid";
export const QA_ACCOUNT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Accounts and time per run, so the sweep never crowds out the cron's sends. */
export const QA_SWEEP_LIMIT = 100;
export const QA_SWEEP_BUDGET_MS = 45_000;
const QA_SWEEP_PARALLEL = 5;
const PER_PAGE = 1000;
const MAX_PAGES = 50;
const LIST_ATTEMPTS = 3;
const LIST_RETRY_DELAY_MS = 500;

type Admin = ReturnType<typeof getAdminSupabase>;

export function isLeftoverQaAccount(u: { email?: string | null; created_at?: string | null }, nowMs: number): boolean {
  const email = (u.email ?? "").toLowerCase();
  if (!email.endsWith(QA_EMAIL_DOMAIN)) return false;
  const created = u.created_at ? Date.parse(u.created_at) : NaN;
  return Number.isFinite(created) && nowMs - created >= QA_ACCOUNT_MAX_AGE_MS;
}

/** Removes leftover QA accounts and everything they own. Returns the count. */
export async function purgeLeftoverQaAccounts(admin: Admin, nowMs: number = Date.now()): Promise<number> {
  const due: string[] = [];
  for (let page = 1; page <= MAX_PAGES && due.length < QA_SWEEP_LIMIT; page++) {
    // A listing can fail once on a blip (the 2026-10-20 error had an empty
    // message), so ask again before giving up on the day's sweep.
    let res = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    for (let attempt = 1; res.error && attempt < LIST_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, LIST_RETRY_DELAY_MS * attempt));
      res = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    }
    const { data, error } = res;
    if (error) {
      const why = error.message || [error.name, (error as { status?: number }).status].filter(Boolean).join(" ") || JSON.stringify(error);
      throw new Error(`listUsers page ${page}: ${why}`);
    }
    const users = data?.users ?? [];
    for (const u of users) if (isLeftoverQaAccount(u, nowMs)) due.push(u.id);
    if (users.length < PER_PAGE) break;
  }
  let removed = 0;
  // purgeUserData deletes the account's rows and files, then the sign-in, and
  // stops (to be retried tomorrow) at the first step that fails.
  // A few at a time: each purge is ~30 small round trips, so one by one the
  // 2026-10 backlog (253 accounts) would have taken weeks inside the budget.
  const stopAt = Date.now() + QA_SWEEP_BUDGET_MS;
  const batch = due.slice(0, QA_SWEEP_LIMIT);
  for (let i = 0; i < batch.length; i += QA_SWEEP_PARALLEL) {
    if (Date.now() > stopAt) break;
    const done = await Promise.all(batch.slice(i, i + QA_SWEEP_PARALLEL).map((id) => purgeUserData(admin, id).catch(() => false)));
    removed += done.filter(Boolean).length;
  }
  return removed;
}
