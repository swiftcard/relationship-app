import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Held, not lost ───────────────────────────────────────────────────────────
//
// Quiet hours were doing half a job. 10pm–8am nothing reaches the phone, which
// is right — and until 2026-09-11 that was the whole story: the push was logged
// "quiet_hours" and dropped. A contact who handed over their details at 10:30pm
// produced no banner that night and none in the morning either; the owner found
// out whenever they next opened the app.
//
// /api/push/catchup closes it: ONE push at 8am in the person's own timezone,
// built from the bell rows the held pushes left behind. One, not a replay — a
// busy night must not become five buzzes at breakfast.
//
// The thing that makes it safe is the timezone. 8am UTC is 4am in New York, so
// a catch-up for someone whose zone we have not learned would BE the 3am buzz
// quiet hours exist to prevent. Hence: no timezone, no catch-up — and
// TimezoneSync, which teaches the server the zone on any dashboard load.

type Row = Record<string, unknown>;

let subscriptions: Row[] = [];
let profile: Row = {};
let catchupMarks: Row[] = [];
let notifications: Row[] = [];
let leads: Row[] = [];
// Team news (office_notifications) and who it went to (teamAlertRecipients).
let teamRows: Row[] = [];
let teamRecipients: string[] = [];
const inserted: Row[] = [];
const pushes: Row[] = [];

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === "push_subscriptions") {
        // Paged (order + range): an unpaged select stops at 1,000 rows silently.
        const q = { order: () => q, range: async () => ({ data: subscriptions, error: null }) };
        return { select: () => q };
      }
      if (table === "profiles") {
        // Read in batches with .in(), not one round trip per subscriber: this
        // route wakes every hour and almost nobody in it is at 8am.
        return { select: () => ({ in: async () => ({ data: [{ id: "u1", ...profile }] }) }) };
      }
      if (table === "push_log") {
        const q = {
          eq: () => q,
          gte: () => q,
          limit: async () => ({ data: catchupMarks }),
        };
        return { select: () => q, insert: async (row: Row) => { inserted.push(row); return {}; } };
      }
      if (table === "notifications") {
        const q = {
          eq: () => q,
          gte: () => q,
          order: () => q,
          limit: async () => ({ data: notifications }),
        };
        return { select: () => q };
      }
      if (table === "office_notifications") {
        const q = { eq: () => q, in: () => q, gte: () => q, order: () => q, limit: async () => ({ data: teamRows }) };
        return { select: () => q };
      }
      if (table === "offices") {
        return { select: () => ({ in: async () => ({ data: [{ id: "office-1", name: "Harbor Realty" }] }) }) };
      }
      if (table === "leads") {
        // The contacts behind held return alerts: status decides whether
        // the morning may name them (2026-09-23 audit).
        return { select: () => ({ in: async () => ({ data: leads }) }) };
      }
      throw new Error("unexpected table " + table);
    },
  }),
}));

vi.mock("@/lib/team-alerts", async () => ({
  ...(await vi.importActual<typeof import("@/lib/team-alerts")>("@/lib/team-alerts")),
  teamAlertRecipients: async () => teamRecipients,
}));

vi.mock("@/lib/push", () => ({
  sendPushToUser: async (userId: string, payload: Row) => { pushes.push({ userId, ...payload }); },
}));


import { GET } from "@/app/api/push/catchup/route";
import { QUIET_END_HOUR, QUIET_WINDOW_MS, quietWindowStart } from "@/lib/push-policy";
import { buildApnsAlert } from "@/lib/apns";

// 12:00 UTC is exactly 8am in New York on this date (EDT, UTC-4).
const EIGHT_AM_NY = "2026-09-11T12:00:00.000Z";
const SECRET = "test-cron-secret";

function run(secret = SECRET) {
  return GET(new Request("https://swiftcard.me/api/push/catchup", {
    headers: { authorization: `Bearer ${secret}` },
  }) as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(EIGHT_AM_NY));
  process.env.CRON_SECRET = SECRET;
  subscriptions = [{ user_id: "u1" }];
  profile = { plan: "pro", customization: { _push: { timezone: "America/New_York" } } };
  catchupMarks = [];
  notifications = [
    { type: "new_lead", title: "New contact: Dana Whitfield", body: "Dana Whitfield shared their info with you.", card_owner: "dana-card", created_at: "2026-09-11T02:40:00.000Z" },
  ];
  leads = [];
  teamRows = [];
  teamRecipients = [];
  inserted.length = 0;
  pushes.length = 0;
});

afterEach(() => { vi.useRealTimers(); });

// ── The contacts the owner silenced stay silent in the morning too ──────────
//
// Muting a contact or closing them holds the alert
// from the phone by stripping its push category at produce time. The bell row
// carries no trace of that, and the catch-up is built from bell rows — so
// until 2026-09-23 the morning announced exactly the contact the owner had
// just silenced.
describe("a silenced contact is not announced at 8am", () => {
  const returned = (leadId: string) => ({
    type: "contact_returned", title: "Priya re-opened your card", body: "Priya re-opened your card.",
    card_owner: "dana-card", lead_id: leadId, created_at: "2026-09-11T03:00:00.000Z",
  });

  it("a contact marked Not interested or Closed", async () => {
    for (const status of ["not_interested", "dissolved"]) {
      pushes.length = 0;
      notifications = [returned("L1")];
      leads = [{ id: "L1", status, created_at: "2026-09-01T00:00:00.000Z" }];
      await run();
      expect(pushes).toHaveLength(0);
    }
  });

  it("an ordinary contact is announced as before, and the rest of the night with them", async () => {
    notifications = [
      returned("L1"),
      { type: "card_viewed", title: "Card viewed", body: "Someone viewed your card.", card_owner: "dana-card", created_at: "2026-09-11T05:00:00.000Z" },
    ];
    leads = [{ id: "L1", status: "new", created_at: "2026-09-01T00:00:00.000Z" }];
    await run();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ category: "contact_return", body: "Plus 1 more while you were away." });
  });

  it("a Closed contact drops out of the count too — the lead still goes, alone", async () => {
    notifications = [
      { type: "new_lead", title: "New contact: Dana Whitfield", body: "Dana Whitfield shared their info with you.", card_owner: "dana-card", created_at: "2026-09-11T02:40:00.000Z" },
      returned("L1"),
    ];
    leads = [{ id: "L1", status: "dissolved", created_at: "2026-09-01T00:00:00.000Z" }];
    await run();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ category: "new_lead", body: "Dana Whitfield shared their info with you." });
  });
});

describe("who the 8am catch-up is for", () => {
  it("sends the news that was held, to the person whose local time is 8am", async () => {
    const res = await run();
    expect(await res.json()).toMatchObject({ atEight: 1, sent: 1 });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      userId: "u1",
      category: "new_lead",
      title: "New contact: Dana Whitfield",
      body: "Dana Whitfield shared their info with you.",
      tag: "catchup",
    });
    // The exact screen, same as the live lead push.
    expect(pushes[0].url).toMatch(/\/contacts\?card=dana-card$/);
  });

  it("stays quiet at every other hour of the day", async () => {
    vi.setSystemTime(new Date("2026-09-11T17:00:00.000Z")); // 1pm in New York
    await run();
    expect(pushes).toHaveLength(0);
  });

  it("still goes out at 9am when the scheduler ran late", async () => {
    // GitHub's cron is best-effort. Losing someone's whole morning to a
    // twenty-minute delay would be a worse bug than the one this fixes.
    vi.setSystemTime(new Date("2026-09-11T13:10:00.000Z")); // 9:10am in New York
    await run();
    expect(pushes).toHaveLength(1);
  });

  it("accepts the GitHub job's own secret as well as the Vercel cron's", async () => {
    process.env.PUSH_CATCHUP_SECRET = "github-side-secret";
    const res = await run("github-side-secret");
    expect(res.status).toBe(200);
    expect(pushes).toHaveLength(1);
    delete process.env.PUSH_CATCHUP_SECRET;
  });

  it("authorizes nobody when both secrets are unset", async () => {
    delete process.env.CRON_SECRET;
    delete process.env.PUSH_CATCHUP_SECRET;
    const res = await run("undefined");
    expect(res.status).toBe(401);
    expect(pushes).toHaveLength(0);
  });

  it("skips anyone whose timezone we have not learned — 8am UTC is 4am in New York", async () => {
    profile = { plan: "free", customization: {} };
    const res = await run();
    expect(await res.json()).toMatchObject({ atEight: 0, sent: 0 });
    expect(pushes).toHaveLength(0);
  });

  it("skips anyone who switched quiet hours off — nothing was ever held for them", async () => {
    profile = { plan: "pro", customization: { _push: { timezone: "America/New_York", quietHours: false } } };
    await run();
    expect(pushes).toHaveLength(0);
  });

  it("refuses without the cron secret", async () => {
    const res = await run("wrong");
    expect(res.status).toBe(401);
    expect(pushes).toHaveLength(0);
  });
});

describe("one notification, whatever kind of night it was", () => {
  it("puts the biggest news in the headline and the rest in a count", async () => {
    notifications = [
      { type: "card_viewed", title: "Card viewed", body: "Someone viewed your card.", card_owner: "dana-card", created_at: "2026-09-11T05:00:00.000Z" },
      { type: "new_lead", title: "New contact: Dana Whitfield", body: "Dana Whitfield shared their info with you.", card_owner: "dana-card", created_at: "2026-09-11T02:40:00.000Z" },
      { type: "contact_saved", title: "Contact downloaded", body: "Someone downloaded your contact card.", card_owner: "dana-card", created_at: "2026-09-11T01:10:00.000Z" },
    ];
    await run();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      category: "new_lead",
      title: "New contact: Dana Whitfield",
      body: "Plus 2 more while you were away.",
    });
  });

  it("ignores bell-only news — a milestone is not something that was held", async () => {
    notifications = [
      { type: "milestone_50", title: "50 views — on fire!", body: "Check Locations on your dashboard.", card_owner: "dana-card", created_at: "2026-09-11T03:00:00.000Z" },
      { type: "signature_stale", title: "Your signature is out of date", body: "Update it.", card_owner: null, created_at: "2026-09-11T03:10:00.000Z" },
    ];
    const res = await run();
    expect(await res.json()).toMatchObject({ nothingHeld: 1, sent: 0 });
    expect(pushes).toHaveLength(0);
  });

  it("respects a category the person switched off", async () => {
    profile = { plan: "pro", customization: { _push: { timezone: "America/New_York", card_view: false } } };
    notifications = [
      { type: "card_viewed", title: "Card viewed", body: "Someone viewed your card.", card_owner: "dana-card", created_at: "2026-09-11T05:00:00.000Z" },
    ];
    await run();
    expect(pushes).toHaveLength(0);
  });

  it("says nothing when the night was quiet", async () => {
    notifications = [];
    const res = await run();
    expect(await res.json()).toMatchObject({ nothingHeld: 1, sent: 0 });
    expect(pushes).toHaveLength(0);
  });
});

describe("it can only happen once", () => {
  it("does nothing if this morning's catch-up already went out", async () => {
    catchupMarks = [{ id: "already" }];
    const res = await run();
    expect(await res.json()).toMatchObject({ alreadyDone: 1, sent: 0 });
    expect(pushes).toHaveLength(0);
  });

  it("writes the mark BEFORE sending, so a crash costs a morning and not a duplicate", async () => {
    await run();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ user_id: "u1", outcome: "catchup", plan: "pro" });
    const src = readFileSync(join(process.cwd(), "src/app/api/push/catchup/route.ts"), "utf8");
    expect(src.indexOf('outcome: CATCHUP_OUTCOME')).toBeLessThan(src.indexOf("await sendPushToUser("));
  });
});

describe("the window is exactly quiet hours", () => {
  it("is ten hours long, derived from the 10pm and 8am constants", () => {
    expect(QUIET_WINDOW_MS).toBe(10 * 60 * 60 * 1000);
    expect(QUIET_END_HOUR).toBe(8);
  });

  it("reads only rows written after quiet hours began, and only unread ones", () => {
    // A 9:30pm notification was pushed normally; re-announcing it at 8am would
    // be telling someone what they were already told. And someone who woke at
    // 3am and read it all does not need it again.
    const src = readFileSync(join(process.cwd(), "src/app/api/push/catchup/route.ts"), "utf8");
    expect(src).toMatch(/\.eq\("read", false\)/);
    expect(src).toMatch(/quietWindowStart\(now, prefs\.timezone\)/);
  });

  it("anchors on the real 10pm, so a cron that runs late still reads the whole night", () => {
    const tz = "America/New_York";
    const onTime = Date.parse("2026-09-11T12:00:00.000Z");   // 08:00 local
    const late = Date.parse("2026-09-11T12:40:00.000Z");     // 08:40 local
    // Both resolve to the SAME instant: 10pm the previous evening. A fixed
    // "now − 10 hours" would have started the late run at 22:40 and skipped
    // the first forty minutes of held news.
    expect(quietWindowStart(onTime, tz)).toBe(quietWindowStart(late, tz));
    expect(new Date(quietWindowStart(late, tz)).toISOString()).toBe("2026-09-11T02:00:00.000Z");
    // ...which is 10pm on the 10th, in New York.
    expect(onTime - quietWindowStart(onTime, tz)).toBe(QUIET_WINDOW_MS);
  });

  it("falls back to the fixed span when the zone is unusable", () => {
    const now = Date.parse("2026-09-11T12:00:00.000Z");
    expect(quietWindowStart(now, "Mars/Olympus_Mons")).toBe(now - QUIET_WINDOW_MS);
  });

  // ── The schedule lives on GitHub, and that is not a preference ────────────
  //
  // Vercel's Hobby plan allows two cron jobs per project, each at most once a
  // day. An hourly entry in vercel.json does not warn — it makes EVERY later
  // deployment fail validation with cron_jobs_limits_reached, so the whole
  // pipeline stops, for every session working in this repo. That happened on
  // 2026-09-11 and cost a deploy window; these two keep it from happening twice.
  it("runs hourly on GitHub's scheduler, because 8am local is a different hour everywhere", () => {
    const wf = readFileSync(join(process.cwd(), ".github/workflows/push-catchup.yml"), "utf8");
    expect(wf).toMatch(/- cron: "0 \* \* \* \*"/);
    expect(wf).toMatch(/\/api\/push\/catchup/);
    // The secret is read through env:, never interpolated into the shell.
    expect(wf).toMatch(/SECRET: \$\{\{ secrets\.PUSH_CATCHUP_SECRET \}\}/);
  });

  it("keeps vercel.json inside the Hobby plan's two daily cron jobs", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.crons.length).toBeLessThanOrEqual(2);
    for (const c of vercel.crons as { path: string; schedule: string }[]) {
      // A daily schedule pins the hour and the minute: "0 18 * * *" is fine,
      // anything with a "*" in those two fields runs more than once a day.
      const [minute, hour] = c.schedule.split(" ");
      expect(minute, c.path).not.toContain("*");
      expect(hour, c.path).not.toContain("*");
    }
  });
});

// ── The bytes Apple actually receives ────────────────────────────────────────
//
// A payload APNs rejects looks, from the server, exactly like a phone that is
// switched off: the log says "failed" and nobody investigates. The silent
// update adds a new shape to this file, so both shapes are asserted here — and
// the point of the first test is that the ORDINARY alert is untouched.
describe("the APNs payload", () => {
  const alert = { title: "New contact: Dana Whitfield", body: "(512) 555-0147 · Northbeam", url: "https://swiftcard.me/contacts", tag: "visit-abc" };

  it("an ordinary alert is exactly what it always was: a sound, priority 10", () => {
    const { headers, body } = buildApnsAlert(alert, "me.swiftcard.app");
    expect(JSON.parse(body)).toEqual({
      aps: {
        alert: { title: alert.title, body: alert.body },
        sound: "default",
        "thread-id": "visit-abc",
      },
      url: alert.url,
    });
    expect(headers).toEqual({
      "apns-topic": "me.swiftcard.app",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": "visit-abc",
    });
  });

  it("a silent update has no sound, goes passive, and drops to priority 5", () => {
    const { headers, body } = buildApnsAlert({ ...alert, title: "6 views in the last hour", tag: "views-hour", silent: true }, "me.swiftcard.app");
    const parsed = JSON.parse(body);
    // "passive" is the interruption level that adds a notification to the list
    // WITHOUT lighting the screen — and unlike "time-sensitive" it needs no
    // entitlement, so it works on the build already on the App Store.
    expect(parsed.aps["interruption-level"]).toBe("passive");
    expect(parsed.aps.sound).toBeUndefined();
    expect(headers["apns-priority"]).toBe("5");
    // Still an alert push, not a background one: background pushes are
    // throttled for hours, which a live counter cannot survive.
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-collapse-id"]).toBe("views-hour");
  });

  it("truncates a collapse id rather than letting Apple reject the send", () => {
    const { headers } = buildApnsAlert({ ...alert, tag: "x".repeat(120) }, "me.swiftcard.app");
    expect(headers["apns-collapse-id"]).toHaveLength(64);
  });
});

describe("the timezone the whole thing depends on", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("is reported from the browser on any dashboard load, not only from Settings", () => {
    const src = read("src/components/TimezoneSync.tsx");
    expect(src).toMatch(/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
    expect(src).toMatch(/"\/api\/push\/preferences"/);
    expect(read("src/app/dashboard/layout.tsx")).toMatch(/<TimezoneSync \/>/);
  });

  it("costs nothing when it has not changed", () => {
    const src = read("src/components/TimezoneSync.tsx");
    expect(src).toMatch(/if \(known === timezone\) return;/);
    // ...and the server does not rewrite the shared profile column for a no-op.
    expect(read("src/lib/profile-customization.ts")).toMatch(/if \(wanted === before\) return \{ ok: true/);
  });

  // Found by running this against a real production build, not by reading it:
  // the PATCH returned 200, the browser recorded "already reported", and _push
  // was not in the database. Two one-time migrations rewrite the same shared
  // JSONB column on the first dashboard load, from the snapshot the page
  // rendered with — and the last writer wins.
  it("survives another writer rewriting the shared customization column", () => {
    const writer = read("src/lib/profile-customization.ts");
    // Reads back what it wrote, and goes again against the fresh object.
    // Compared key-order-insensitively (2026-09-23): jsonb reorders keys, and a
    // plain JSON.stringify comparison saw every object write as lost.
    expect(writer).toMatch(/canonicalJson\(stored\[key\]\) === wanted/);
    expect(writer).toMatch(/for \(let attempt = 0; attempt < MAX_ATTEMPTS; attempt\+\+\)/);
    // The push prefs and the free monthly meters are both written through it —
    // an open-coded read-modify-write next door would reintroduce the bug.
    expect(read("src/lib/push-prefs.ts")).toMatch(/mutateCustomization/);
    expect(read("src/lib/usage.ts")).toMatch(/mutateCustomization/);
    // Both routes that touch _push go through it — a second read-modify-write
    // open-coded next door would reintroduce exactly this.
    for (const route of ["src/app/api/push/preferences/route.ts", "src/app/api/push/subscribe/route.ts"]) {
      expect(read(route)).toMatch(/writePushPrefs\(/);
      expect(read(route)).not.toMatch(/_push: push/);
    }
    // ...and the migrations no longer write a stale snapshot back.
    for (const lib of ["src/lib/ensure-cards.ts", "src/lib/card-media.ts"]) {
      expect(read(lib), lib).toMatch(/\.select\("customization"\)\.eq\("id", userId\)\.maybeSingle\(\)/);
    }
  });

  it("is person-scoped, so a second account on the same phone reports for itself", () => {
    const state = read("src/lib/account-state.ts");
    const list = state.slice(state.indexOf("PERSON_SCOPED_STORAGE_KEYS"), state.indexOf("GUEST_FLOW_STORAGE_KEYS"));
    expect(list).toContain('"swiftcard_push_tz"');
  });

  it("only remembers the zone once the server confirms it stored it", () => {
    const src = read("src/components/TimezoneSync.tsx");
    const then = src.slice(src.indexOf(".then("));
    expect(then).toMatch(/if \(!alive \|\| !res\.ok\) return;/);
  });
});

// ── 2026-10-02 notification audit ────────────────────────────────────────────
describe("the morning carries what the night would have said", () => {
  it("team news held overnight reaches the admin at 8am, as team news", async () => {
    notifications = [];
    teamRecipients = ["u1"];
    teamRows = [{ office_id: "office-1", type: "member_joined", title: "Sam joined your team", body: "Sam accepted your invitation.", created_at: "2026-09-11T03:10:00.000Z" }];
    await run();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ category: "team_alert", title: "Sam joined your team", context: "Team · Harbor Realty", thread: "team-office-1" });
    expect(String(pushes[0].url)).toContain("/office/admin");
  });

  it("…but not to someone who switched Team alerts off", async () => {
    notifications = [];
    teamRecipients = ["u1"];
    profile = { plan: "enterprise", customization: { _push: { timezone: "America/New_York", team_alert: false } } };
    teamRows = [{ office_id: "office-1", type: "member_joined", title: "Sam joined your team", body: null, created_at: "2026-09-11T03:10:00.000Z" }];
    await run();
    expect(pushes).toHaveLength(0);
  });

  it("…and not to an admin it was never sent to", async () => {
    notifications = [];
    teamRecipients = ["someone-else"];
    teamRows = [{ office_id: "office-1", type: "member_joined", title: "Sam joined your team", body: null, created_at: "2026-09-11T03:10:00.000Z" }];
    await run();
    expect(pushes).toHaveLength(0);
  });

  it("a locked Free lead says 'New contact', never 'New contact: a contact'", async () => {
    profile = { plan: "free", customization: { _push: { timezone: "America/New_York" } } };
    // The marked name api/leads writes for a lead over the Free cap.
    const { markName } = await import("@/lib/contact-privacy");
    notifications = [{ type: "new_lead", title: `New contact: ${markName("Dana Whitfield")}`, body: `${markName("Dana Whitfield")} shared their info — open to unlock.`, card_owner: "dana-card", lead_id: "lead-9", created_at: "2026-09-11T02:40:00.000Z" }];
    await run();
    expect(pushes[0]).toMatchObject({ title: "New contact", body: "Someone shared their info — open to unlock." });
  });

  it("one new contact opens THAT contact, like the live push", async () => {
    notifications = [{ type: "new_lead", title: "New contact: Dana Whitfield", body: "Dana Whitfield shared their info with you.", card_owner: "dana-card", lead_id: "lead-9", created_at: "2026-09-11T02:40:00.000Z" }];
    await run();
    expect(pushes[0].url).toBe("https://swiftcard.me/contacts?card=dana-card&lead=lead-9");
  });
});
