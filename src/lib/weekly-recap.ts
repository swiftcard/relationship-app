import { markPhrase, markPlace } from "@/lib/location-privacy";
import { localHour } from "@/lib/push-policy";

// ── The Monday recap — the one digest allowed on a phone ────────────────────
//
// Owner, 2026-09-22: office admins get their team's week, weekly only; a Free
// account's notifications should show what they are missing. So one recap a
// week, on its own switch (push-policy weekly_recap), Monday at 9am in the
// person's own zone (api/push/recap):
//
//   everyone      "Your week: 14 views · 2 contacts" / "Top spot in Austin, TX ·
//                 4 places in all." — on a Free lock screen the place is shaded
//                 ("Top spot in ▒▒▒▒▒, ▒▒ · 4 places in all.", teaseLocation)
//                 and blurred in the bell. The place is MARKED here, so every
//                 existing privacy rule applies with no new code.
//   Office admin  the TEAM's week instead of their own — never both, one
//                 Monday push each.
//
// Nothing is sent for a week with nothing in it: "0 views" is not news, it is
// a nudge, and nudges are not allowed on a phone.
//
// Pure, so the copy and the "is it Monday 9am for them" rule are testable.

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function personalRecapCopy(input: {
  views: number;
  contacts: number;
  /** Place labels, most views first. */
  places: string[];
}): { title: string; body: string } | null {
  if (input.views <= 0 && input.contacts <= 0) return null;
  const title = `Your week: ${plural(input.views, "view")}${input.contacts ? ` · ${plural(input.contacts, "contact")}` : ""}`;
  const top = input.places[0];
  const body = top
    // The place COUNT sits inside the location phrase: it is location data too,
    // and outside the phrase a Free account read "· 4 places in all" in the
    // bell and on the lock screen. Paid reads it exactly as before.
    ? `Top spot${markPhrase(` in ${markPlace(top)}${input.places.length > 1 ? ` · ${input.places.length} places in all` : ""}`)}.`
    : input.contacts
      ? `${plural(input.contacts, "person", "people")} shared their details with you.`
      : "Open SwiftCard to see the week.";
  return { title, body };
}

export function teamRecapCopy(input: {
  views: number;
  leads: number;
  /** Teammates whose cards had no views at all this week. */
  quiet: number;
}): { title: string; body: string } | null {
  if (input.views <= 0 && input.leads <= 0) return null;
  const title = `Team week: ${plural(input.views, "view")} · ${plural(input.leads, "lead")}`;
  // No "Dana led with 3 leads": the recap reports the team's week, it does not
  // rank teammates against each other (owner, 2026-10-06).
  const quiet = input.quiet > 0 ? `${plural(input.quiet, "teammate")} had no views.` : "";
  return { title, body: quiet || "See the full week in your Admin console." };
}

// ── WINDOWS, NOT HOURS ──────────────────────────────────────────────────────
// These used to be exact hours ("Monday 9 or 10am"), on the belief that the
// job runs hourly. It does not: .github/workflows/push-catchup.yml is a GitHub
// schedule, and GitHub drops most of them — on 2026-10-05 it ran at 01:42,
// 08:35 and 18:04 UTC, nothing near 9am Eastern. So the recap and the team
// check landed only when a run happened to fall inside a two-hour slot, and
// production had sent ZERO recaps in two weeks (2026-10-05 audit).
//
// Each is now due from its start time until the end of the local day, and the
// run that finds it due sends it ONCE: the recap is ledgered per person per
// week (push_log "recap"), and every team alert carries its own "announced"
// record (api/push/recap). Any run, however late, delivers; no run repeats.

/** Where an unknown zone falls back to, and from when: noon Eastern is 9am
 *  Pacific, so no US account is buzzed before 9am on a guess. */
const FALLBACK_ZONE = "America/New_York";
const FALLBACK_FROM_HOUR = 12;

function weekdayIn(now: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(now));
  } catch { return ""; }
}

/** The Monday recap is due from 9am Monday in their zone until Monday ends. */
export function isRecapHour(now: number, timezone: string | null | undefined): boolean {
  const zone = timezone || FALLBACK_ZONE;
  const from = timezone ? 9 : FALLBACK_FROM_HOUR;
  if (weekdayIn(now, zone) !== "Mon") return false;
  try { return localHour(now, zone) % 24 >= from; } catch { return false; } // % 24: some ICU builds say "24" at midnight
}

/** The daily team check is due from 9am in the owner's zone until midnight
 *  (US Eastern from noon when their zone is unknown). */
export function isTeamCheckHour(now: number, timezone: string | null | undefined): boolean {
  const zone = timezone || FALLBACK_ZONE;
  const from = timezone ? 9 : FALLBACK_FROM_HOUR;
  try { return localHour(now, zone) % 24 >= from; } catch { return false; } // % 24: some ICU builds say "24" at midnight
}

/**
 * Monday's team check: when the team's week goes into the ADMIN BELL, with or
 * without a phone. The same hour and fallback as the daily team check, on the
 * owner's Monday (US Eastern when their zone is unknown).
 */
export function isTeamRecapBellHour(now: number, timezone: string | null | undefined): boolean {
  if (!isTeamCheckHour(now, timezone)) return false;
  return weekdayIn(now, timezone || FALLBACK_ZONE) === "Mon";
}

/** Most frequent labels first. */
export function rankPlaces(labels: Array<string | null | undefined>): string[] {
  const counts = new Map<string, number>();
  for (const l of labels) {
    const k = (l ?? "").trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
