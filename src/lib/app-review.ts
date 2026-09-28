import { detectNativeApp } from "@/lib/platform";

// ── When to show Apple's in-app rating sheet ─────────────────────────────────
//
// The sheet itself is Apple's (ios/App/App/AppReview.swift → AppStore.request-
// Review). iOS caps it at three showings per 365 days and may show nothing at
// all, so this file's only job is to spend the ask on a good moment.
//
// THE RULES, and why each exists:
//
//  1. iOS app only. On the web there is no plugin and no sheet; every export
//     here is a no-op.
//  2. Only after a real win: a lead has landed, or the person has shared their
//     own card SHARES_NEEDED times. Opening the app is not a win.
//  3. Only someone who has really used the app. A new user doesn't know it
//     yet and has nothing to say about it (owner, 2026-09-28: "a user who's
//     been using it for maybe a week or so knows something about it"). So the
//     install clock starts the first time the app runs this code, nothing is
//     asked until MIN_DAYS_INSTALLED later, AND the app has to have been opened
//     on ACTIVE_DAYS_NEEDED different days — a week-old install opened once is
//     still a new user.
//  4. At most once every REASK_DAYS. The timestamp is written BEFORE the request
//     — iOS never says whether the sheet appeared, so a call that silently
//     failed must not re-arm on the next load.
//  5. Never from a button tap. Wins are RECORDED where they happen (a share
//     button, a lead arriving) but the sheet is only ever requested from a
//     passive moment — ReviewPromptTrigger, a few seconds after the dashboard
//     has settled — so it never lands on top of a share sheet or answers a tap.
//  6. Never gated on how someone feels about us, never a follow-up asking for a
//     rating, never tied to a feature. It counts what someone DID. The "Rate us"
//     button on /grow is separate: a plain link to the write-review page.
//
// Storage is @capacitor/preferences (the app's UserDefaults) so the timestamps
// survive the webview clearing its site data; localStorage is the fallback.

export const SHARES_NEEDED = 3;
export const MIN_DAYS_INSTALLED = 7;
export const ACTIVE_DAYS_NEEDED = 4;
export const REASK_DAYS = 90;
const DAY_MS = 86_400_000;

const KEYS = {
  firstSeen: "sc_review_first_seen",       // ISO time the app first ran this code
  lastPrompted: "sc_review_last_prompted", // ISO time we last asked iOS for the sheet
  shares: "sc_review_shares",              // completed shares of the owner's own card
  hadLead: "sc_review_had_lead",           // "1" once any lead has landed
  activeDays: "sc_review_active_days",     // how many different days the app was opened
  lastActiveDay: "sc_review_last_active_day", // local YYYY-MM-DD of the last one counted
} as const;

/** A win worth recording. Deliberately a closed set. */
export type ReviewMoment = "card_shared" | "lead_captured";

export type ReviewState = {
  firstSeen: number | null;
  lastPrompted: number | null;
  shares: number;
  hadLead: boolean;
  /** Different days the app has been opened (rule 3). */
  activeDays: number;
};

/** Every rule in one pure function, so the tests can walk the calendar. */
export function shouldAskForReview(s: ReviewState, now: number): boolean {
  if (s.firstSeen === null) return false;
  if (now - s.firstSeen < MIN_DAYS_INSTALLED * DAY_MS) return false;
  if (s.activeDays < ACTIVE_DAYS_NEEDED) return false;
  if (!s.hadLead && s.shares < SHARES_NEEDED) return false;
  if (s.lastPrompted !== null && now - s.lastPrompted < REASK_DAYS * DAY_MS) return false;
  return true;
}

type Store = { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };

async function store(): Promise<Store> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.get({ key: KEYS.firstSeen }); // throws if the native half is missing
    return {
      get: async (key) => (await Preferences.get({ key })).value,
      set: async (key, value) => { await Preferences.set({ key, value }); },
    };
  } catch {
    return {
      get: async (k) => { try { return localStorage.getItem(k); } catch { return null; } },
      set: async (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode — just don't ask */ } },
    };
  }
}

const toTime = (v: string | null): number | null => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
};

/**
 * Record a win. Never shows anything — safe to call straight from a tap handler.
 * Only count shares of the person's OWN card that actually completed.
 */
export async function noteReviewMoment(moment: ReviewMoment): Promise<void> {
  if (typeof window === "undefined" || !detectNativeApp()) return;
  const s = await store();
  if (moment === "lead_captured") {
    await s.set(KEYS.hadLead, "1");
  } else {
    const n = Number.parseInt((await s.get(KEYS.shares)) ?? "0", 10) || 0;
    await s.set(KEYS.shares, String(n + 1));
  }
}

let inFlight: Promise<boolean> | null = null;

/**
 * The only path to the sheet. Call from a passive moment (never a tap handler):
 * it starts the install clock on first run and asks iOS only if every rule in
 * shouldAskForReview passes. Resolves true when it asked.
 */
export function maybeAskForReview(opts: { hasLead?: boolean } = {}): Promise<boolean> {
  // One check at a time: two overlapping calls would both read "never asked"
  // before either wrote the timestamp, and both would ask.
  if (!inFlight) inFlight = check(opts).finally(() => { inFlight = null; });
  return inFlight;
}

async function check(opts: { hasLead?: boolean }): Promise<boolean> {
  if (typeof window === "undefined" || !detectNativeApp()) return false;
  const s = await store();
  const now = Date.now();

  const firstSeen = toTime(await s.get(KEYS.firstSeen));
  // No clock yet means this IS the first launch: start it, and the null below
  // makes shouldAskForReview say no — rule 3.
  if (firstSeen === null) await s.set(KEYS.firstSeen, new Date(now).toISOString());
  if (opts.hasLead) await s.set(KEYS.hadLead, "1");

  // Count this day once, by the phone's own calendar — opening the app five
  // times this afternoon is one day of use, not five.
  const d = new Date(now);
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let activeDays = Number.parseInt((await s.get(KEYS.activeDays)) ?? "0", 10) || 0;
  if ((await s.get(KEYS.lastActiveDay)) !== today) {
    activeDays += 1;
    await s.set(KEYS.activeDays, String(activeDays));
    await s.set(KEYS.lastActiveDay, today);
  }

  const state: ReviewState = {
    firstSeen,
    lastPrompted: toTime(await s.get(KEYS.lastPrompted)),
    shares: Number.parseInt((await s.get(KEYS.shares)) ?? "0", 10) || 0,
    hadLead: opts.hasLead === true || (await s.get(KEYS.hadLead)) === "1",
    activeDays,
  };
  if (!shouldAskForReview(state, now)) return false;

  // Mark BEFORE requesting — rule 4.
  await s.set(KEYS.lastPrompted, new Date(now).toISOString());
  try {
    const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, { requestReview?: () => Promise<unknown> }> } }).Capacitor;
    await cap?.Plugins?.AppReview?.requestReview?.();
  } catch {
    /* Fails closed: a build without the plugin simply never shows the sheet. */
  }
  return true;
}
