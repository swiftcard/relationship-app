import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decidePush, readPushPrefs, DAILY_CAP, TEAM_ALERT_DAILY_CAP, LIVE_CATEGORIES, TEAM_ONLY_CATEGORIES, MAX_TITLE_CHARS,
} from "@/lib/push-policy";
import { nextTeamMilestone, formatCount, TEAM_VIEW_MILESTONES, TEAM_LEAD_MILESTONES } from "@/lib/team-alerts";
import { personalRecapCopy, teamRecapCopy, isRecapHour, rankPlaces } from "@/lib/weekly-recap";
import { teaseLocation, stripLocationMarks } from "@/lib/location-privacy";

// ── Office admins hear about the TEAM, not about every teammate ─────────────
//
// Owner, 2026-09-22: "in their admin account do they get any notifications to
// their phones if their team hits any certain milestones … We obviously don't
// want their account to get spammed because they're going to have multiple
// subusers under them." And: weekly recap only.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const prefs = readPushPrefs({ _push: { quietHours: false } });
const NOON_NY = Date.parse("2026-09-21T16:00:00Z"); // Monday 12pm New York

describe("the phone rules", () => {
  it("team alerts: two a day, whatever the team size", () => {
    expect(TEAM_ALERT_DAILY_CAP).toBe(2);
    expect(decidePush({ category: "team_alert", prefs, cappedSentToday: 0, teamAlertSentToday: 1 }).send).toBe(true);
    expect(decidePush({ category: "team_alert", prefs, cappedSentToday: 0, teamAlertSentToday: 2 }))
      .toEqual({ send: false, reason: "team_cap" });
  });

  it("team alerts never eat the admin's own five, and a full day of their own never blocks a team alert", () => {
    expect(decidePush({ category: "team_alert", prefs, cappedSentToday: DAILY_CAP, teamAlertSentToday: 0 }).send).toBe(true);
    const push = read("src/lib/push.ts");
    expect(push).toMatch(/!OWN_CAP\.includes\(cat\)/);
    expect(read("src/lib/push-policy.ts")).toMatch(/OWN_CAP: PushCategory\[\] = \["contact_return", "team_alert", "weekly_recap"\]/);
  });

  it("the weekly recap is not eaten by a busy Sunday", () => {
    expect(decidePush({ category: "weekly_recap", prefs, cappedSentToday: DAILY_CAP }).send).toBe(true);
  });

  it("both have a switch that wins, and both respect quiet hours", () => {
    const off = readPushPrefs({ _push: { team_alert: false, weekly_recap: false, quietHours: false } });
    expect(decidePush({ category: "team_alert", prefs: off, cappedSentToday: 0 }).send).toBe(false);
    expect(decidePush({ category: "weekly_recap", prefs: off, cappedSentToday: 0 }).send).toBe(false);
    const quiet = readPushPrefs({ _push: { timezone: "America/New_York" } });
    const threeAm = Date.parse("2026-09-21T07:00:00Z");
    expect(decidePush({ category: "team_alert", prefs: quiet, cappedSentToday: 0, now: threeAm })).toEqual({ send: false, reason: "quiet_hours" });
  });

  it("only admins are shown the Team alerts switch", () => {
    expect(LIVE_CATEGORIES).toContain("team_alert");
    expect(TEAM_ONLY_CATEGORIES).toEqual(["team_alert"]);
    const form = read("src/components/PushPreferencesForm.tsx");
    expect(form).toMatch(/teamAlerts \|\| !TEAM_ONLY_CATEGORIES\.includes\(cat\)/);
    expect(read("src/app/api/push/preferences/route.ts")).toMatch(/isTeamAlertRecipient\(user\.id\)/);
    // The promise on that screen no longer says "no weekly stats" — there is one, on its own switch.
    expect(form).not.toMatch(/no weekly stats/i);
  });
});

describe("no per-member flood can reach an admin", () => {
  it("views never go to admins — the view route knows nothing about teams", () => {
    expect(read("src/app/api/card-events/route.ts")).not.toMatch(/team-alerts|alertTeam|team_alert/);
  });

  it("a teammate's lead reaches the admin only if it is their FIRST, once", () => {
    const leads = read("src/app/api/leads/route.ts");
    const calls = leads.match(/alertTeam|announceFirstLeadIfTeammate\(/g) ?? [];
    expect(calls).toEqual(["announceFirstLeadIfTeammate("]);
    const lib = read("src/lib/team-alerts.ts");
    expect(lib).toMatch(/if \(count !== 1\) return;/);
    expect(lib).toMatch(/\.eq\("type", "member_first_lead"\)\.contains\("meta", \{ userId \}\)/);
  });

  it("every team push goes through sendPushToUser as team_alert (switch, quiet hours, cap)", () => {
    const lib = read("src/lib/team-alerts.ts");
    expect(lib).toMatch(/category: "team_alert"/);
    expect(lib).not.toMatch(/sendApns|webpush/);
  });
});

describe("the Monday recap", () => {
  it("is marked before it is sent, so a duplicate run cannot buzz twice", () => {
    const route = read("src/app/api/push/recap/route.ts");
    const teamBlock = route.slice(route.indexOf("if (team) {"), route.indexOf("counts.recapsTeam++"));
    expect(teamBlock.indexOf("markRecap(")).toBeGreaterThan(-1);
    expect(teamBlock.indexOf("markRecap(")).toBeLessThan(teamBlock.indexOf("sendPushToUser("));
    const personal = route.slice(route.indexOf("const slugs = (await slugsFor(admin, [userId]))"));
    expect(personal.indexOf("markRecap(")).toBeLessThan(personal.indexOf("sendPushToUser("));
    expect(route).toMatch(/alreadyRecapped\(admin, userId, now\)/);
  });

  it("runs from the hourly workflow", () => {
    expect(read(".github/workflows/push-catchup.yml")).toContain("https://swiftcard.me/api/push/recap");
  });

  it("personal: the week in the title, the top place marked so Free sees it shaded", () => {
    const c = personalRecapCopy({ views: 14, contacts: 2, places: rankPlaces(["Austin, TX", "Dallas, TX", "Austin, TX", "Waco, TX", null]) })!;
    expect(c.title).toBe("Your week: 14 views · 2 contacts");
    expect(c.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(stripLocationMarks(c.body)).toBe("Top spot in Austin, TX · 3 places in all.");
    // The count is location data too: a Free lock screen sees neither.
    expect(teaseLocation(c.body)).toBe("Top spot in ▒▒▒▒▒, ▒▒.");
  });

  it("an empty week sends nothing", () => {
    expect(personalRecapCopy({ views: 0, contacts: 0, places: [] })).toBeNull();
    expect(teamRecapCopy({ views: 0, leads: 0, top: null, quiet: 3 })).toBeNull();
  });

  it("team: totals, who led, who was quiet — and no plan or price words anywhere", () => {
    const c = teamRecapCopy({ views: 42, leads: 5, top: { name: "Dana Lee", leads: 3, views: 20 }, quiet: 2 })!;
    expect(c.title).toBe("Team week: 42 views · 5 leads");
    expect(c.body).toBe("Dana led with 3 leads. 2 teammates had no views.");
    expect(`${c.title} ${c.body}`).not.toMatch(/pro\b|upgrade|price|plan/i);
  });

  // A WINDOW, not an hour (2026-10-05): the scheduler runs a few times a day,
  // so "Monday 9–10am" was usually missed and production sent zero recaps in
  // two weeks. Due from 9am Monday until Monday ends; the push_log "recap"
  // ledger makes it once. An unknown zone gets Eastern from noon (9am Pacific).
  it("is due all Monday from 9am in the person's own zone", () => {
    expect(isRecapHour(Date.parse("2026-09-21T12:59:00Z"), "America/New_York")).toBe(false); // Mon 8:59
    expect(isRecapHour(Date.parse("2026-09-21T13:15:00Z"), "America/New_York")).toBe(true);  // Mon 9:15
    expect(isRecapHour(Date.parse("2026-09-21T22:00:00Z"), "America/New_York")).toBe(true);  // Mon 6pm
    expect(isRecapHour(Date.parse("2026-09-22T03:30:00Z"), "America/New_York")).toBe(true);  // Mon 11:30pm
    expect(isRecapHour(Date.parse("2026-09-22T04:30:00Z"), "America/New_York")).toBe(false); // Tue 12:30am
    expect(isRecapHour(Date.parse("2026-09-22T13:15:00Z"), "America/New_York")).toBe(false); // Tue
  });

  it("an unknown zone is Eastern from noon — never a 6am buzz on the west coast", () => {
    expect(isRecapHour(Date.parse("2026-09-21T15:00:00Z"), null)).toBe(false); // Mon 11am ET
    expect(isRecapHour(NOON_NY, null)).toBe(true);
    expect(isRecapHour(Date.parse("2026-09-22T16:00:00Z"), null)).toBe(false); // Tue
  });
});

describe("team milestones", () => {
  it("announces the highest rung reached, once", () => {
    expect(nextTeamMilestone(99, TEAM_VIEW_MILESTONES, [])).toBeNull();
    expect(nextTeamMilestone(260, TEAM_VIEW_MILESTONES, [])).toBe(250);
    expect(nextTeamMilestone(260, TEAM_VIEW_MILESTONES, [100, 250])).toBeNull();
    expect(nextTeamMilestone(12, TEAM_LEAD_MILESTONES, [])).toBe(10);
  });

  it("a jump past several rungs records the lower ones too, so they never arrive later", () => {
    const route = read("src/app/api/push/recap/route.ts");
    expect(route).toMatch(/meta: \{ kind, n: hit, also: ladder\.filter\(\(x\) => x < hit\) \}/);
    expect(route).toMatch(/flatMap\(\(m\) => \[m!\.n as number, \.\.\.\(m!\.also \?\? \[\]\)\]\)/);
  });

  it("reads like a number a person says", () => {
    expect(formatCount(1000)).toBe("1k");
    expect(formatCount(250)).toBe("250");
    expect(formatCount(2500)).toBe("2,500");
  });
});
