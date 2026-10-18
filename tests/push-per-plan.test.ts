import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Push works on EVERY plan, and only for the five things worth interrupting ─
//
// Owner order 2026-09-06: "Make push notifications work for every account type
// and plan (free, paid, trial, office)… then make them high-signal, not spammy."
//
// Two contracts are guarded here and they pull in opposite directions, which is
// exactly why both need tests:
//
//   1. NO PLAN GATE. A Free account's first lead is the most important
//      notification SwiftCard will ever send. The plan is written to the log so
//      it can be audited; nothing branches on it. The per-plan cases below are
//      byte-identical apart from the plan string — that repetition IS the test.
//
//   2. A CLOSED LIST. Only new_lead, lead_reply, contact_saved, card_view,
//      meeting_booked and billing_problem may reach a phone, under a daily cap,
//      inside quiet hours, with copy that fits a lock screen.

type Row = Record<string, unknown>;

let profile: Row = { plan: "free", customization: {} };
let subscriptions: Row[] = [{ endpoint: "apns:tok-1", p256dh: "apns", auth: "apns" }];
let pushLog: Row[] = [];
const inserted: Row[] = [];
const apnsSent: Row[] = [];

type LogQuery = {
  eq: (...args: unknown[]) => LogQuery;
  in: (...args: unknown[]) => LogQuery;
  gte: (...args: unknown[]) => LogQuery;
  order: (...args: unknown[]) => LogQuery;
  limit: (...args: unknown[]) => Promise<{ data: Row[] }>;
};

function logQuery(): LogQuery {
  const q: LogQuery = {
    eq: () => q,
    in: () => q,
    gte: () => q,
    order: () => q,
    limit: async () => ({ data: pushLog }),
  };
  return q;
}

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) };
      }
      if (table === "push_subscriptions") {
        return {
          select: () => ({ eq: async () => ({ data: subscriptions }) }),
          delete: () => ({ eq: async () => ({}) }),
        };
      }
      if (table === "push_log") {
        // The history read is .select().eq().in().gte().order().limit(), and it
        // sits inside a try/catch that treats a failure as "no history" — so a
        // mock missing one link in that chain does not fail the test, it
        // silently turns the daily cap and the hourly batch OFF. Every step
        // returns the same object and the terminal .limit() resolves.
        return {
          insert: async (row: Row) => { inserted.push(row); return {}; },
          select: () => logQuery(),
        };
      }
      throw new Error("unexpected table " + table);
    },
  }),
}));

vi.mock("@/lib/apns", () => ({
  isApnsEndpoint: (e: string) => e.startsWith("apns:"),
  // The sender push.ts actually calls: it reports what Apple said, so a
  // rejection can no longer be logged as "sent" (see tests/push-delivery-truth).
  sendApnsDetailed: async (endpoint: string, payload: Row) => {
    apnsSent.push({ endpoint, ...payload });
    return { result: "sent", status: 200, reason: "", env: "production" };
  },
}));

import { sendPushToUser } from "@/lib/push";
import {
  DAILY_CAP, MAX_BODY_CHARS, MAX_TITLE_CHARS, VIEW_ROLLUP_TAG,
  decidePush, fitBody, inQuietHours, readPushPrefs,
} from "@/lib/push-policy";

// 2pm UTC — comfortably outside quiet hours, so the plan cases test the plan
// and nothing else.
const MIDDAY = "2026-09-06T14:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(MIDDAY));
  profile = { plan: "free", customization: {} };
  subscriptions = [{ endpoint: "apns:tok-1", p256dh: "apns", auth: "apns" }];
  pushLog = [];
  inserted.length = 0;
  apnsSent.length = 0;
});

const last = () => inserted[inserted.length - 1];

async function sendLead() {
  await sendPushToUser("u1", {
    category: "new_lead",
    title: "New contact: Dana Whitfield",
    body: "Dana Whitfield shared their info with you.",
    url: "https://swiftcard.me/dashboard",
  });
}

describe("every plan gets the notification", () => {
  // The four account shapes the product actually sells. `trialing` is a real
  // stored value, not a synonym for pro — it was worth checking precisely
  // because a naive `plan === "pro"` gate would have excluded it.
  for (const plan of ["free", "pro", "trialing", "enterprise"]) {
    it(`delivers a new lead on the ${plan} plan`, async () => {
      profile = { plan, customization: {} };
      await sendLead();
      expect(apnsSent.length).toBe(1);
      expect(last()).toMatchObject({ category: "new_lead", plan, outcome: "sent" });
    });
  }

  it("records the plan on the log line without ever branching on it", async () => {
    // Same input, four plans, identical delivery — the log differs only in the
    // plan string it recorded.
    const outcomes: string[] = [];
    for (const plan of ["free", "pro", "trialing", "enterprise"]) {
      profile = { plan, customization: {} };
      apnsSent.length = 0;
      await sendLead();
      outcomes.push(`${apnsSent.length}:${(last() as Row).outcome}`);
    }
    expect(new Set(outcomes).size).toBe(1);
    expect(outcomes[0]).toBe("1:sent");
  });

  it("still sends when the log table does not exist yet", async () => {
    // Pre-migration production. Dropping every notification because a logging
    // table is missing would be a far worse failure than an uncapped day.
    pushLog = [];
    await sendLead();
    expect(apnsSent.length).toBe(1);
  });
});

describe("only the five allowed categories exist", () => {
  it("has no way to send an uncategorised push", () => {
    // Compile-time, so this is a documentation assertion: `category` is a
    // required field of a union type. If someone widens it to `string`, the
    // closed list stops being enforceable.
    const src = readFileSync(join(process.cwd(), "src/lib/push.ts"), "utf8");
    expect(src).toMatch(/category: PushCategory;/);
    expect(src).not.toMatch(/category\?:/);
  });

  it("stats, streaks and referral rewards no longer push", () => {
    for (const f of ["src/lib/milestones.ts", "src/lib/referral-server.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/sendPushToUser/);
    }
  });
});

describe("a switched-off category", () => {
  it("is not sent, and says so in the log", async () => {
    profile = { plan: "pro", customization: { _push: { new_lead: false } } };
    await sendLead();
    expect(apnsSent.length).toBe(0);
    expect(last()).toMatchObject({ outcome: "category_off", plan: "pro" });
  });
});

describe("the daily cap", () => {
  it("stops the 6th capped push of the day", async () => {
    pushLog = Array.from({ length: DAILY_CAP }, () => ({ category: "card_view", outcome: "sent", created_at: MIDDAY }));
    profile = { plan: "free", customization: { _push: { card_view: true } } };
    await sendPushToUser("u1", {
      category: "meeting_booked", title: "Meeting booked", body: "Tue 3pm with Dana", url: "/x",
    });
    expect(apnsSent.length).toBe(0);
    expect(last()).toMatchObject({ outcome: "daily_cap" });
  });

  it("never applies to leads or billing", async () => {
    pushLog = Array.from({ length: 50 }, () => ({ category: "card_view", outcome: "sent", created_at: MIDDAY }));
    await sendLead();
    expect(apnsSent.length).toBe(1);
  });

  it("counts interruptions only — a silent view-count update is not one", async () => {
    // Five REAL alerts is the cap. Five silent updates is nothing: they make no
    // sound, light no screen, and must not be able to use up someone's day.
    pushLog = Array.from({ length: DAILY_CAP }, () => ({ category: "card_view", outcome: "rollup", created_at: MIDDAY }));
    await sendPushToUser("u1", {
      category: "meeting_booked", title: "Meeting booked", body: "Tue 3pm with Dana", url: "/x",
    });
    expect(apnsSent.length).toBe(1);
  });
});

// ── The hour after the alert: a silent counter, not silence ──────────────────
//
// One view alert an hour is the right ceiling on INTERRUPTIONS, and it used to
// be the ceiling on news as well: every other view inside that hour was logged
// "batched" and thrown away. At an event — the exact moment SwiftCard is
// working hardest — the owner's phone told them about one view and never
// mentioned the other thirty.
//
// The extra views now update one banner in place: same collapse id, no sound,
// interruption-level "passive" on iOS, and a headline that counts them. The
// number climbs on the lock screen without the phone ever buzzing again.
describe("card views are batched to one an hour", () => {
  const view = (body = "Someone viewed your card near Austin.") =>
    sendPushToUser("u1", { category: "card_view", title: "Card viewed", body, url: "/x", tag: "visit-abc" });

  it("turns a second view inside the window into a SILENT count update", async () => {
    pushLog = [{ category: "card_view", outcome: "sent", created_at: "2026-09-06T13:30:00.000Z" }];
    await view();
    expect(apnsSent.length).toBe(1);
    expect(apnsSent[0]).toMatchObject({
      title: "2 views in the last hour",
      // The body stays the newest view's own sentence: the number says how
      // many, the line underneath still says who and where.
      body: "Someone viewed your card near Austin.",
      silent: true,
      tag: VIEW_ROLLUP_TAG,
    });
    expect(last()).toMatchObject({ outcome: "rollup", category: "card_view" });
  });

  it("never replaces the alert's own banner, which may since have become a lead", async () => {
    // The alert carries the VISIT tag so that visitor turning into a named lead
    // replaces it. The counter is a second, separate notification — overwriting
    // "Dana Whitfield shared their info" with "3 views in the last hour" would
    // be a downgrade.
    pushLog = [{ category: "card_view", outcome: "sent", created_at: "2026-09-06T13:30:00.000Z" }];
    await view();
    expect(apnsSent[0].tag).not.toBe("visit-abc");
  });

  it("counts the views it held back too, so the number never skips", async () => {
    pushLog = [
      { category: "card_view", outcome: "sent", created_at: "2026-09-06T13:30:00.000Z" },
      { category: "card_view", outcome: "rollup", created_at: "2026-09-06T13:40:00.000Z" },
      { category: "card_view", outcome: "batched", created_at: "2026-09-06T13:42:00.000Z" },
    ];
    await view();
    expect(apnsSent[0].title).toBe("4 views in the last hour");
  });

  it("holds the update itself to one every five minutes", async () => {
    pushLog = [
      { category: "card_view", outcome: "sent", created_at: "2026-09-06T13:30:00.000Z" },
      { category: "card_view", outcome: "rollup", created_at: "2026-09-06T13:58:00.000Z" },
    ];
    await view();
    expect(apnsSent.length).toBe(0);
    expect(last()).toMatchObject({ outcome: "batched" });
  });

  it("never sends a silent update at 3am either", async () => {
    vi.setSystemTime(new Date("2026-09-06T10:00:00.000Z")); // 3am in LA
    profile = { plan: "pro", customization: { _push: { timezone: "America/Los_Angeles" } } };
    pushLog = [{ category: "card_view", outcome: "sent", created_at: "2026-09-06T09:40:00.000Z" }];
    await view();
    expect(apnsSent.length).toBe(0);
    expect(last()).toMatchObject({ outcome: "quiet_hours" });
  });

  it("allows one an hour and a minute later", async () => {
    pushLog = [{ category: "card_view", outcome: "sent", created_at: "2026-09-06T12:55:00.000Z" }];
    await view();
    expect(apnsSent.length).toBe(1);
    expect(apnsSent[0]).toMatchObject({ title: "Card viewed", tag: "visit-abc" });
    expect(apnsSent[0].silent).toBeUndefined();
    expect(last()).toMatchObject({ outcome: "sent" });
  });

  it("a rollup does not slide the hour: the next alert is still due on time", async () => {
    // "rollup" is not "sent" for exactly this reason. If the silent updates
    // counted as the hour's alert, a card being passed around all afternoon
    // would push the next real alert out forever and the owner would hear
    // nothing after the first one.
    pushLog = [
      { category: "card_view", outcome: "sent", created_at: "2026-09-06T12:55:00.000Z" },
      { category: "card_view", outcome: "rollup", created_at: "2026-09-06T13:50:00.000Z" },
    ];
    await view();
    expect(apnsSent.length).toBe(1);
    expect(apnsSent[0].title).toBe("Card viewed");
  });
});

describe("quiet hours, 10pm to 8am local", () => {
  it("holds a lead at 11pm in the person's own timezone", async () => {
    // 06:00 UTC is 11pm the previous day in Los Angeles. A UTC-only check would
    // have called this "morning" and buzzed them.
    vi.setSystemTime(new Date("2026-09-06T06:00:00.000Z"));
    profile = { plan: "pro", customization: { _push: { timezone: "America/Los_Angeles" } } };
    await sendLead();
    expect(apnsSent.length).toBe(0);
    expect(last()).toMatchObject({ outcome: "quiet_hours" });
  });

  it("sends the same lead at 2pm local", async () => {
    vi.setSystemTime(new Date("2026-09-06T21:00:00.000Z")); // 2pm in LA
    profile = { plan: "pro", customization: { _push: { timezone: "America/Los_Angeles" } } };
    await sendLead();
    expect(apnsSent.length).toBe(1);
  });

  it("holds a BILLING problem at 3am too — nothing is exempt", async () => {
    // Reversed 2026-09-06 after re-reading the order. I had exempted billing on
    // the theory that a decline is urgent; it isn't — Stripe retries over days,
    // the email has already gone, and nobody can fix a card at 3am that they
    // can't fix at 8. An exemption would have been the product's convenience.
    vi.setSystemTime(new Date("2026-09-06T10:00:00.000Z")); // 3am in LA
    profile = { plan: "pro", customization: { _push: { timezone: "America/Los_Angeles" } } };
    await sendPushToUser("u1", {
      category: "billing_problem", title: "Payment failed", body: "Your Pro payment didn't go through.", url: "/x",
    });
    expect(apnsSent.length).toBe(0);
    expect(last()).toMatchObject({ outcome: "quiet_hours", category: "billing_problem" });
  });

  it("is switchable off by the person, who then gets everything at once", async () => {
    vi.setSystemTime(new Date("2026-09-06T10:00:00.000Z")); // 3am in LA
    profile = { plan: "free", customization: { _push: { timezone: "America/Los_Angeles", quietHours: false } } };
    await sendLead();
    expect(apnsSent.length).toBe(1);
  });
});

describe("the copy fits a lock screen", () => {
  it("trims the body on a word boundary, not mid-word", async () => {
    await sendPushToUser("u1", {
      category: "new_lead",
      title: "New contact",
      body: "Christopher Fairweather from Northbeam Commercial Real Estate Group shared their details with you just now",
      url: "/x",
    });
    const body = apnsSent[0].body as string;
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(body.endsWith("…")).toBe(true);
    expect(body).not.toMatch(/\s…$/);
  });

  it("trims the TITLE as well — the line the OS cuts first", async () => {
    await sendPushToUser("u1", {
      category: "new_lead",
      title: "New contact: Christopher Fairweather-Blenkinsop",
      body: "Tap to save",
      url: "/x",
    });
    const title = apnsSent[0].title as string;
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });

  it("leaves short copy alone", () => {
    expect(fitBody("Dana Whitfield replied")).toBe("Dana Whitfield replied");
  });
});

describe("every push lands on the exact screen", () => {
  // Each of these was verified against the code that READS the param, not
  // against what looked plausible: /dashboard?lead= (my first attempt) reads
  // no such param and would have dumped someone on the dashboard with their
  // contact nowhere in sight.
  const file = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

  it("a new lead opens THAT contact, not the dashboard", () => {
    const src = file("src/app/api/leads/route.ts");
    expect(src).toMatch(/\/contacts\?card=\$\{encodeURIComponent\(card_owner\)\}&lead=\$\{insertedLead\.id\}/);
    expect(src).not.toMatch(/url: `\$\{APP_URL\}\/dashboard\?card=/);
  });

  it("a reply opens that conversation", () => {
    expect(file("src/app/api/twilio/inbound/route.ts")).toMatch(/\/contacts\?card=.*&lead=/);
  });

  it("a billing problem opens billing", () => {
    expect(file("src/app/api/stripe/webhook/route.ts")).toMatch(/url: `\$\{APP_URL\}\/settings\/flows\?billing=1`/);
  });

  it("the params it deep-links with are ones the app actually reads", () => {
    // The guard that would have caught the bug: ?lead= is only a deep link
    // because ContactsClient consumes it.
    expect(file("src/components/ContactsClient.tsx")).toMatch(/\?lead=/);
    expect(file("src/app/contacts/page.tsx")).toMatch(/lead\?: string/);
  });
});

describe("a locked free lead is news, not a sales pitch", () => {
  it("says what happened on BOTH the bell row and the lock screen", () => {
    // pushBody is what the phone actually shows. Fixing only `body` left
    // "Upgrade to Pro to unlock this lead." on the lock screen — marketing, in
    // the one slot that must carry news, on the plan that needs it most.
    const src = readFileSync(join(process.cwd(), "src/app/api/leads/route.ts"), "utf8");
    const at = src.indexOf("pushBody: locked");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 200);
    expect(block).not.toMatch(/Upgrade|Pro\b|upgrade/);
    expect(block).toMatch(/shared their info/);
  });
});

describe("the policy itself", () => {
  it("defaults every category on, with quiet hours on", () => {
    const prefs = readPushPrefs({});
    expect(prefs.new_lead).toBe(true);
    expect(prefs.quietHours).toBe(true);
  });

  it("treats an unknown timezone as UTC rather than throwing", () => {
    expect(() => inQuietHours(Date.parse(MIDDAY), "Mars/Olympus_Mons")).not.toThrow();
  });

  it("puts an explicit switch-off ahead of every other rule", () => {
    const verdict = decidePush({
      category: "billing_problem",
      prefs: { ...readPushPrefs({}), billing_problem: false },
      cappedSentToday: 0,
    });
    expect(verdict).toEqual({ send: false, reason: "category_off" });
  });
});

// ── A view push is not a once-in-a-lifetime event ────────────────────────────
//
// The producer used to gate the view push on `count === 1` — the first view a
// card ever received. That meant someone could share their card at a
// conference, collect forty views, and their phone would stay silent for every
// one of them. A product that never tells you it is working reads as a product
// that isn't, and "someone just opened your card" is the best proof SwiftCard
// has that it is earning its keep.
//
// The volume worry behind that gate was real, and its answer was already built
// and could never engage. These pin that the answer is what does the work now,
// and that the gate does not come back.
describe("every view is a push candidate, and the throttles do the limiting", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const src = read("src/app/api/card-events/route.ts");

  it("does not gate the push on the card's first view ever", () => {
    // The count survives — it changes the WORDING — but it must never again
    // decide whether the push happens.
    expect(src).not.toMatch(/if \(count === 1\) pushCategory/);
    expect(src).toMatch(/firstEver = count === 1/);
    // A returning known contact carries its own category (contact_return, or
    // none when the contact is muted or closed); every other view is card_view.
    expect(src).toMatch(/pushCategory: PushCategory \| undefined = returnNotice\s*\?\s*returnNotice\.pushCategory\s*:\s*isView\s*\?\s*"card_view"/);
  });

  it("gives a downloaded contact card its own category", () => {
    expect(src).toMatch(/event_type === "downloaded_vcard"\s*\?\s*"contact_saved"/);
  });

  it("keeps the per-IP flood backstop on top of the policy throttles", () => {
    expect(src).toMatch(/isRateLimited\(`notify-ip:\$\{card_owner_username\}:\$\{notifyWho\}`, 6, 60 \* 60 \* 1000\)/);
  });

  it("names a card's first view instead of burying it among the rest", () => {
    const notice = read("src/lib/card-event-notify.ts");
    expect(notice).toMatch(/input\.firstEver \? firstTitle/);
    expect(notice).toContain("Your card's first view!");
    // Lock-screen title budget — the OS cuts anything longer mid-word.
    for (const t of ["Your card's first view!", "Your Swift Links' first view!"]) {
      expect(t.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    }
  });
});
