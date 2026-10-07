import { PHRASE_MARK } from "@/lib/location-privacy";

// ── What may become a push notification, and when ───────────────────────────
//
// A push is the most expensive message we can send: it interrupts. The moment
// one arrives that did not need to, the switch goes off and every future
// notification is lost with it — including the one that was worth £5,000 of
// commission. So the list of things allowed to buzz a phone is short, closed,
// and lives here.
//
// ALLOWED, and nothing else:
//   new_lead        someone shared their details          — the whole product
//   lead_reply      a lead answered a follow-up           — a live conversation
//   contact_saved   someone saved their contact card      — high intent
//   card_view       one of their cards was opened         — batched, ≤1/hour
//   contact_return  a contact they already know re-opened their card
//                   — ≤1 per contact per day, ≤5 a day (its own caps, below)
//   meeting_booked  a meeting was booked from their card
//   billing_problem a payment failed and access is at risk
//   weekly_recap    once a week, Monday morning: THEIR OWN week in numbers
//                   (an Office admin gets their TEAM's week instead)
//   team_alert      Office admins only: team news worth acting on — leads
//                   waiting a day, a teammate's first lead, a team milestone,
//                   someone joining. ≤2 a day, its own cap. NEVER per-member
//                   views or leads: a 20-person team would bury the admin.
//
// THE WEEKLY RECAP IS THE ONE DIGEST (owner, 2026-09-22 — "rethink the whole
// notification system … weekly only"). It is the person's own numbers, once a
// week, on its own switch — not a tip, not a promotion. Everything below
// stays out: marketing, tips, product news, streaks, referral rewards, daily
// digests, "you're doing great". Those go to the bell and to email.
//
// EXPLICITLY NOT: marketing, tips, product news, streaks, referral rewards,
// daily digests, "you're doing great" — none of it.
//
// THE ONE EXCEPTION (owner, 2026-10-06): getting_started — ONCE EVER, in the
// first week, only if no card has been opened yet, and it says how to share
// (lib/activation-nudge.ts). A brand-new account whose card nobody has seen
// otherwise never hears from SwiftCard at all; this is activation, not a
// re-engagement drip. It never repeats and never mentions numbers.
//
// A VIEW MILESTONE IS NOT A SIXTH CATEGORY. It still cannot cause a push: no
// milestone has ever rung a phone and none may. What it now does is retitle the
// card_view push THAT WAS ALREADY GOING OUT for the view that crossed it — same
// buzz, same category, same switch, one better headline ("50 views — on fire!"
// instead of "Card viewed"). Zero extra interruptions; see the note in
// /api/card-events where the two are folded together.
//
// WHY card_view REPLACED first_view. The rule used to be "the first time a card
// is EVER opened", enforced by a count === 1 check in the events route. That
// made a view push fire once in a card's entire lifetime: someone could share
// their card at a conference, collect forty views, and their phone would stay
// silent for all of them. Silence is its own failure — a product that never
// tells you it is working reads as a product that isn't — and "someone just
// opened your card" is the single best proof SwiftCard is earning its keep.
//
// The throttle below was always the right answer to the volume worry, and it
// was already built: at most one view push an hour, inside a five-a-day cap,
// and at most one per visitor per visit (lib/visit-notify.ts). Under a
// once-per-lifetime producer none of that machinery could ever engage. Now it
// does the job it was written for.
//
// NO PLAN GATE ANYWHERE IN THIS FILE. A Free account's first lead is the most
// important notification SwiftCard will ever send them; withholding it to make
// upgrading attractive is both hostile and self-defeating.

export type PushCategory =
  | "new_lead"
  | "lead_reply"
  | "contact_saved"
  | "card_view"
  | "contact_return"
  | "meeting_booked"
  | "billing_problem"
  | "weekly_recap"
  | "team_alert"
  | "getting_started";

export const PUSH_CATEGORIES: PushCategory[] = [
  "new_lead",
  "lead_reply",
  "contact_saved",
  "card_view",
  "contact_return",
  "meeting_booked",
  "billing_problem",
  "weekly_recap",
  "team_alert",
  "getting_started",
];

/**
 * Categories that something in the product can actually FIRE today.
 *
 * `meeting_booked` is deliberately absent. SwiftCard has no booking feature —
 * a card can carry a Calendly link, but the booking happens on Calendly and
 * nothing tells us about it. The rule is written, tested and ready, and the
 * category is left out of Settings until there is a producer: a switch that can
 * never change anything is worse than no switch, because it implies a feature.
 */
export const LIVE_CATEGORIES: PushCategory[] = [
  "new_lead",
  "lead_reply",
  "contact_saved",
  "card_view",
  "contact_return",
  "billing_problem",
  "weekly_recap",
  "team_alert",
  // getting_started is NOT listed: it fires once ever, in the first week, so a
  // switch for it would be one nobody could ever see do anything.
];

/** Only an Office admin (owner, or a role that sees team analytics) is shown this switch — nobody else can receive it. */
export const TEAM_ONLY_CATEGORIES: PushCategory[] = ["team_alert"];

/** Copy shown in Settings. The label is what the person is agreeing to receive. */
export const PUSH_CATEGORY_COPY: Record<PushCategory, { label: string; hint: string }> = {
  new_lead: { label: "New contacts", hint: "Someone shares their details with you" },
  lead_reply: { label: "Replies", hint: "A contact answers one of your follow-ups" },
  // "downloaded", not "saved" — we hand the .vcf to the device and never learn
  // whether they tapped Add. Same honesty rule as the notification copy itself
  // (lib/card-event-notify.ts); the settings label must not claim more.
  contact_saved: { label: "Contact downloads", hint: "Someone downloads your contact card" },
  card_view: { label: "Card views", hint: "Someone opens one of your cards — at most one an hour" },
  contact_return: { label: "Returning contacts", hint: "A contact you've met opens your card again" },
  meeting_booked: { label: "Meetings booked", hint: "Someone books time with you from your card" },
  billing_problem: { label: "Billing problems", hint: "A payment failed and your plan is at risk" },
  weekly_recap: { label: "Weekly recap", hint: "Your week in numbers, once, on Monday morning" },
  team_alert: { label: "Team alerts", hint: "Leads waiting a day, a teammate's first lead, team milestones — at most two a day" },
  getting_started: { label: "Getting started", hint: "Once, in your first week, if your card hasn't been opened yet" },
  // NOTE: quiet hours apply to this one too — see decidePush().
};

/**
 * Categories that ignore the daily cap.
 *
 * A lead and a failed payment are the two things a person would be angry to
 * have withheld. Everything else is capped, so a busy day can never turn into
 * a stream of interruptions.
 */
export const UNCAPPED: PushCategory[] = ["new_lead", "lead_reply", "billing_problem"];

/** Everything on by default. Switching one off is a decision the person makes. */
export const DEFAULT_PUSH_PREFS: Record<PushCategory, boolean> = {
  new_lead: true,
  lead_reply: true,
  contact_saved: true,
  card_view: true,
  contact_return: true,
  meeting_booked: true,
  billing_problem: true,
  weekly_recap: true,
  team_alert: true,
  getting_started: true,
};

export const DAILY_CAP = 5;          // excludes UNCAPPED and OWN_CAP categories

/**
 * Categories with caps of their own, counted apart from DAILY_CAP.
 *
 * A known contact coming back is the news the warm-lead feature exists for
 * (docs/plans/warm-lead-alerts.md), so it must not be crowded out by five card
 * views earlier in the day, and five card views must not be crowded out by it.
 * Owner decision D4 (2026-09-18): one push per contact per day, five a day in
 * all. Everything past that still reaches the bell.
 */
export const OWN_CAP: PushCategory[] = ["contact_return", "team_alert", "weekly_recap", "getting_started"];
/**
 * Team alerts: at most two a day per admin, whatever the team size. A team of
 * twenty must never mean twenty interruptions (owner, 2026-09-22: "we don't
 * want their account to get spammed"). Past two, the admin bell still has it.
 */
export const TEAM_ALERT_DAILY_CAP = 2;
/**
 * ONE CEILING OVER THE SEPARATE CAPS (2026-10-06 notification audit). Each
 * cap above only limits itself, so a busy day could stack 5 views/downloads +
 * 5 returning contacts + 2 team alerts = 12 buzzes before a single lead. These
 * are the "nice to know" interruptions; past eight in 24h they go to the bell
 * only. Leads, replies, billing, the 8am catch-up and the Monday recap are the
 * earned moments and stay outside it; a silent count update is not an
 * interruption and never counts.
 */
export const SOFT_CAP_CATEGORIES: PushCategory[] = ["card_view", "contact_saved", "contact_return", "team_alert"];
export const SOFT_DAILY_CEILING = 8;
export const CONTACT_RETURN_DAILY_CAP = 5;
export const CONTACT_RETURN_PER_CONTACT_DAILY_CAP = 1;
export const QUIET_START_HOUR = 22;  // 10pm local
export const QUIET_END_HOUR = 8;     // 8am local
/** How long quiet hours last, and therefore how far back the 8am catch-up looks. */
export const QUIET_WINDOW_MS = (24 - QUIET_START_HOUR + QUIET_END_HOUR) * 60 * 60 * 1000;
export const MAX_BODY_CHARS = 60;
// A lock-screen title truncates far earlier than the body — around 40
// characters on an iPhone, less with a long app name beside it. "New contact:
// Christopher Fairweather-Blenkinsop" is cut by the OS mid-surname; cutting it
// ourselves on a word boundary is the difference between a name and a stump.
export const MAX_TITLE_CHARS = 40;
export const VIEW_BATCH_MS = 60 * 60 * 1000; // ≤ 1 view ALERT an hour
// Inside that hour the extra views are not thrown away any more — they update
// the count on the banner already showing (mode "update" below), and this is how
// often that silent update is allowed to go out. Five minutes: fast enough that
// a card going off at an event feels live, slow enough that forty views in an
// hour cost APNs a dozen requests rather than forty.
export const VIEW_UPDATE_MIN_GAP_MS = 5 * 60 * 1000;
/** The collapse id every view-count update shares: ONE running counter, replaced in place. */
export const VIEW_ROLLUP_TAG = "views-hour";

export type PushPrefs = Record<PushCategory, boolean> & {
  quietHours?: boolean;
  timezone?: string | null;
};

/** Read the per-category switches out of profiles.customization. */
export function readPushPrefs(customization: unknown): PushPrefs {
  const c = (customization ?? {}) as Record<string, unknown>;
  const stored = (c._push ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PUSH_PREFS } as PushPrefs;
  for (const cat of PUSH_CATEGORIES) {
    if (typeof stored[cat] === "boolean") out[cat] = stored[cat] as boolean;
  }
  // Quiet hours are ON unless deliberately switched off.
  out.quietHours = stored.quietHours !== false;
  out.timezone = typeof stored.timezone === "string" ? stored.timezone : null;
  return out;
}

/**
 * The local hour for a person, from an IANA timezone.
 *
 * Falls back to DEFAULT_TIMEZONE when we have not learned their zone yet. The
 * browser reports the real zone the first time they open the app.
 */
export function localHour(now: number, timezone: string | null | undefined): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || DEFAULT_TIMEZONE,
      hour: "numeric",
      hour12: false,
    });
    return Number(fmt.format(new Date(now)));
  } catch {
    return new Date(now).getUTCHours();
  }
}

/**
 * The zone assumed until the app reports a real one. It used to be UTC, which
 * for the (US) user base silenced 6pm–4am Eastern and — because the morning
 * catch-up refused to guess — dropped that evening's news for good
 * (2026-10-06 notification audit). New York matches the weekly recap's
 * fallback (lib/weekly-recap.ts) and is right or an hour or three off for
 * nearly everyone; TimezoneSync corrects it on the next dashboard load.
 * An unparseable zone still falls back to UTC (the catch branches).
 */
export const DEFAULT_TIMEZONE = "America/New_York";

/** 10pm–8am in the person's own timezone. */
export function inQuietHours(now: number, timezone: string | null | undefined): boolean {
  const h = localHour(now, timezone);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/**
 * When quiet hours began for this person — the last 10pm in their own zone.
 *
 * The 8am catch-up looks back over exactly this span, and it has to be the real
 * boundary rather than `now − 10 hours`: a cron that fires at 8:00 and one that
 * is delayed to 8:40 must read the same night. Subtracting a fixed ten hours
 * would have made the late run silently skip the first forty minutes of it —
 * which, for a job that exists to rescue the 10:30pm lead, is the one part of
 * the night it cannot afford to miss.
 */
export function quietWindowStart(now: number, timezone: string | null | undefined): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || DEFAULT_TIMEZONE,
      hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
    }).formatToParts(new Date(now));
    const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    // formatToParts renders midnight as hour "24" in some ICU versions.
    const hour = at("hour") % 24;
    const sinceStart = ((hour - QUIET_START_HOUR + 24) % 24) * 3600 + at("minute") * 60 + at("second");
    return now - sinceStart * 1000;
  } catch {
    return now - QUIET_WINDOW_MS;
  }
}

export type PolicyInput = {
  category: PushCategory;
  prefs: PushPrefs;
  /** Pushes already sent today in CAPPED categories. */
  cappedSentToday: number;
  /** When the last card_view ALERT went out, for the hourly batch. */
  lastViewPushAt?: number | null;
  /** When the last silent view-count update went out, for its own throttle. */
  lastViewUpdateAt?: number | null;
  /** contact_return pushes sent in the last 24h, all contacts. */
  contactReturnSentToday?: number;
  /** contact_return pushes sent in the last 24h about THIS contact. */
  sameContactSentToday?: number;
  /** team_alert pushes sent in the last 24h. */
  teamAlertSentToday?: number;
  /** Alerts sent in the last 24h across SOFT_CAP_CATEGORIES. */
  softSentToday?: number;
  /**
   * THE 8AM CATCH-UP, and nothing else. It is one notification a morning,
   * already rationed by its own once-per-12h mark (api/push/catchup) — which it
   * writes BEFORE sending. Run it through the rolling-24h cap and the hourly
   * view batch as well and yesterday's busy afternoon silently eats this
   * morning's news, with the mark already spent and no retry until tomorrow.
   * The switches and quiet hours still apply.
   */
  catchup?: boolean;
  now?: number;
};

/**
 * How a push arrives.
 *
 *   alert  — the normal thing: a banner, a sound, the screen lights up.
 *   update — SILENT. Same notification, new text: it replaces the running
 *            view-count banner (VIEW_ROLLUP_TAG) with no sound and, on iOS, at
 *            interruption-level "passive", so the number climbs without the
 *            phone ever buzzing again. This is what "batched" used to throw
 *            away: at an event the owner got one alert an hour and no sense at
 *            all that their card was going off.
 */
export type PushMode = "alert" | "update";

export type PolicyResult =
  | { send: true; mode: PushMode }
  | { send: false; reason: "category_off" | "quiet_hours" | "daily_cap" | "batched" | "contact_cap" | "team_cap" };

/**
 * The whole decision, pure so every rule is testable without a database.
 *
 * Order matters and is deliberate: an explicit switch-off beats everything, and
 * a billing problem still respects it — if someone turned billing pushes off,
 * that was their call and the email still goes.
 */
export function decidePush(input: PolicyInput): PolicyResult {
  const { category, prefs, cappedSentToday, lastViewPushAt, lastViewUpdateAt } = input;
  const now = input.now ?? Date.now();

  if (prefs[category] === false) return { send: false, reason: "category_off" };

  // NOTHING is exempt, billing included — and a silent count update is still
  // something arriving on a phone at 3am, so quiet hours are checked before the
  // view batch below rather than after it.
  //
  // I had carved out billing_problem on the theory that a failed payment is
  // urgent enough to wake someone. It isn't: Stripe retries a declined card
  // over several days, nobody loses access overnight, the email goes out
  // immediately either way, and at 3am there is nothing they can do that
  // 8am does not do just as well. A 3am banner would be the product's
  // convenience, not theirs.
  //
  // Nothing held here is LOST any more: /api/push/catchup announces it once, at
  // 8am in the person's own timezone, from the bell rows it left behind.
  if (prefs.quietHours !== false && inQuietHours(now, prefs.timezone)) {
    return { send: false, reason: "quiet_hours" };
  }

  // Batch the view notification: several people can open a card in the same
  // minute after one QR is printed on a sign, and that is one piece of news,
  // not eight. This is the throttle that lets every view be a candidate for a
  // push without a busy afternoon turning into a stream of interruptions.
  //
  // The extra views inside the hour used to be DROPPED. They now come back as a
  // silent update to the one running-count banner — no sound, no second buzz,
  // just a number that climbs while the card is being passed around. Held to
  // one update every VIEW_UPDATE_MIN_GAP_MS; past that it really is batched.
  if (input.catchup) return { send: true, mode: "alert" };

  if (category === "card_view" && lastViewPushAt && now - lastViewPushAt < VIEW_BATCH_MS) {
    if (lastViewUpdateAt && now - lastViewUpdateAt < VIEW_UPDATE_MIN_GAP_MS) {
      return { send: false, reason: "batched" };
    }
    // Deliberately ahead of the daily cap: the cap counts INTERRUPTIONS, and
    // this one cannot interrupt. It makes no sound and lights no screen.
    return { send: true, mode: "update" };
  }

  if (SOFT_CAP_CATEGORIES.includes(category) && (input.softSentToday ?? 0) >= SOFT_DAILY_CEILING) {
    return { send: false, reason: "daily_cap" };
  }

  // A returning contact has its own caps and never counts against DAILY_CAP.
  if (category === "contact_return") {
    if ((input.sameContactSentToday ?? 0) >= CONTACT_RETURN_PER_CONTACT_DAILY_CAP) {
      return { send: false, reason: "contact_cap" };
    }
    if ((input.contactReturnSentToday ?? 0) >= CONTACT_RETURN_DAILY_CAP) {
      return { send: false, reason: "daily_cap" };
    }
    return { send: true, mode: "alert" };
  }

  // Team news for an admin: two a day, apart from their own five.
  if (category === "team_alert") {
    if ((input.teamAlertSentToday ?? 0) >= TEAM_ALERT_DAILY_CAP) return { send: false, reason: "team_cap" };
    return { send: true, mode: "alert" };
  }

  // Once a week by construction (api/push/recap marks it before sending); it
  // must not be eaten by a busy Sunday, and must not eat Monday's leads.
  if (category === "weekly_recap") return { send: true, mode: "alert" };
  // Once EVER by construction (api/push/activation marks it before sending).
  if (category === "getting_started") return { send: true, mode: "alert" };

  if (!UNCAPPED.includes(category) && cappedSentToday >= DAILY_CAP) {
    return { send: false, reason: "daily_cap" };
  }

  return { send: true, mode: "alert" };
}

// ── Which card is this about? ────────────────────────────────────────────────
//
// Owner, 2026-09-18: "Let's say I have a few cards and I get a notification on
// my phone that someone saved my contact. How do I know which card that's from?
// You have to put a little tag on those notifications that says which card."
//
// Resolved in ONE place — sendPushToUser — from the card's slug, so no producer
// can forget it and none of them has to load the card to say it.

export type PushCardRow = { username?: string | null; label?: string | null; name?: string | null; company?: string | null };

/** Longest tag the lock screen shows whole beside "Card: ". */
export const MAX_CARD_TAG_CHARS = 28;

/**
 * The words that tell this card apart from the account's others, or null when
 * no tag is needed.
 *
 *   • ONE card → null. "Card: Alex Morgan" on every notification an account
 *     with a single card receives is noise, not information.
 *   • The card's nickname (cards.label, "Card nickname" in the editor) when it
 *     has one — it is the name the owner chose for exactly this purpose, and
 *     the one the dashboard's card switcher and the bell's chip already show.
 *   • Otherwise the first of company / name that NO OTHER card of theirs
 *     shares. Someone with two cards is usually the same person twice, so their
 *     name tells them nothing; the company usually does.
 *   • Otherwise the link itself, which is always unique.
 *
 * A Swift Links view is stored under "<slug>__links"; it belongs to that card.
 */
export function pushCardTag(cards: PushCardRow[], cardOwner: string | null | undefined): string | null {
  if (!cardOwner || cards.length < 2) return null;
  const slug = cardOwner.toLowerCase().replace(/__links$/, "");
  const card = cards.find((c) => (c.username ?? "").toLowerCase() === slug);
  if (!card) return null;
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const fit = (s: string) => fitBody(s, MAX_CARD_TAG_CHARS);
  const label = clean(card.label);
  if (label) return fit(label);
  for (const key of ["company", "name"] as const) {
    const v = clean(card[key]);
    if (v && !cards.some((o) => o !== card && clean(o[key]).toLowerCase() === v.toLowerCase())) return fit(v);
  }
  return fit(clean(card.username) || slug);
}

/** The tag as the notification shows it. */
export function cardTagLine(tag: string): string {
  return `Card: ${tag}`;
}

/**
 * Trim a body to the notification budget.
 *
 * iOS shows roughly this much on a lock screen before truncating mid-word, and
 * a sentence cut by the OS reads as broken software. Cutting on a word boundary
 * ourselves is the difference between "Dana Whitfield shared their…" and
 * "Dana Whitfield shared their in".
 */
/**
 * The room a body gets when it ENDS IN A PLACE ("…viewed your Swift Links in
 * the New York area."). The place is the last thing in those sentences and the
 * thing Pro pays for, so the plain 60-character cut took it off first:
 * "Someone downloaded your contact card from a QR code in the…". Ninety is
 * still three short lines on an iPhone lock screen.
 */
export const MAX_PLACE_BODY_CHARS = 90;

/**
 * Fit a push body without ever cutting off its place.
 *
 * `marked` still carries the invisible PHRASE marks (lib/location-privacy);
 * `render` is what the plan turns it into — the real place on a paid account,
 * the shaded "in ▒▒▒▒▒, ▒▒" on Free. A body with no place (or more than one)
 * keeps the plain 60-character rule. One with a place gets
 * MAX_PLACE_BODY_CHARS, and if it is longer still, the words BEFORE the place
 * are shortened and the place is kept whole.
 */
export function fitBodyKeepingPlace(marked: string, render: (s: string) => string): string {
  const full = render(marked).replace(/\s+/g, " ").trim();
  const parts = marked.split(PHRASE_MARK);
  if (parts.length !== 3) return fitBody(full);
  if (full.length <= MAX_PLACE_BODY_CHARS) return full;
  const [before, phrase, after] = parts;
  const tail = render(`${PHRASE_MARK}${phrase}${PHRASE_MARK}${after}`).replace(/\s+/g, " ").trim();
  const room = MAX_PLACE_BODY_CHARS - tail.length - 1;
  // A place so long it leaves no room for the sentence: the plain rule.
  if (room < 20) return fitBody(full, MAX_PLACE_BODY_CHARS);
  return `${fitBody(render(before), room)} ${tail}`;
}

export function fitBody(body: string, max: number = MAX_BODY_CHARS): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.\s]+$/, "")}…`;
}
