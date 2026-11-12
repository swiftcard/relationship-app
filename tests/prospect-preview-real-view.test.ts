import { describe, it, expect } from "vitest";
import {
  NEW_DEVICE_ALERTS_PER_DAY, alertText, decideRealView, deviceTypeOf, previewState, shouldAlert,
  type RealViewInput,
} from "@/lib/prospect-preview/real-view";
import { decidePush, readPushPrefs, MAX_BODY_CHARS, MAX_TITLE_CHARS, fitBody, LIVE_CATEGORIES, QUIET_EXEMPT, UNCAPPED } from "@/lib/push-policy";
import { sortByLastViewed, withViews } from "@/lib/prospect-preview/store";
import { newSlug, parsePreviewForm, parseTeam, slugify, telHref } from "@/lib/prospect-preview/input";
import type { ProspectPreview } from "@/lib/prospect-preview/types";

// ── Card Builder: what counts as a real view, and what rings the phone ──────
//
// The alert says "[Owner] is viewing their card. Call [phone]." and a person
// picks up the phone because of it. So the rule under test is: a view is a
// PERSON looking, never a page request. Everything that fetches a link without
// a person behind it (the preview a messenger draws, a mail scanner, a
// crawler, our own staff checking their work) must be refused, and the people
// who really open links from inside apps must not be.

const NOW = Date.parse("2026-11-11T15:00:00Z");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const LIVE = { status: "live", expires_at: "2026-11-25T15:00:00Z" };

const input = (over: Partial<RealViewInput> = {}): RealViewInput => ({
  userAgent: IPHONE, purposeHeader: null, internalCookie: false, adminSession: false, isHosting: false, preview: LIVE, now: NOW, ...over,
});

describe("the bot filter: nothing that fetches a link without a person counts", () => {
  it("a person on a phone or a computer is a real view", () => {
    expect(decideRealView(input())).toBe("record");
    expect(decideRealView(input({ userAgent: CHROME_MAC }))).toBe("record");
  });

  it.each([
    // The moment a link is pasted into a chat, each of these fetches it.
    ["iMessage's link preview", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0"],
    ["WhatsApp", "WhatsApp/2.23.20.0 A"],
    ["Slack", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
    ["Facebook / Messenger", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
    ["X / Twitter", "Twitterbot/1.0"],
    ["LinkedIn", "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)"],
    ["Discord", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
    ["Telegram", "TelegramBot (like TwitterBot)"],
    ["Skype / Teams", "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5"],
    // Search and AI crawlers.
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["GPTBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot"],
    // Automation and scripts.
    ["headless Chrome", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36"],
    ["curl", "curl/8.4.0"],
    ["a Python script", "python-requests/2.31.0"],
    ["an uptime monitor", "Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)"],
  ])("%s is refused", (_who, ua) => {
    expect(decideRealView(input({ userAgent: ua }))).toBe("bot");
  });

  it("a request that names no browser at all is a script", () => {
    expect(decideRealView(input({ userAgent: null }))).toBe("bot");
    expect(decideRealView(input({ userAgent: "   " }))).toBe("bot");
  });

  it.each([
    // People really do open a texted link inside these apps. They are not bots.
    ["Instagram's in-app browser", `${IPHONE} Instagram 350.0.0.0.0 (iPhone16,2; iOS 18_5; en_US)`],
    ["Facebook's in-app browser", `${IPHONE} [FBAN/FBIOS;FBAV/480.0.0;FBDV/iPhone16,2]`],
    ["LinkedIn's app", `${IPHONE} LinkedInApp/9.30.1`],
    ["Gmail's app on Android", "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 GSA/15.40"],
  ])("%s is a person and counts", (_who, ua) => {
    expect(decideRealView(input({ userAgent: ua }))).toBe("record");
  });

  it("a speculative load the browser made on its own is refused", () => {
    for (const purpose of ["prefetch", "prefetch;prerender", "preview"]) {
      expect(decideRealView(input({ purposeHeader: purpose }))).toBe("prefetch");
    }
  });

  it("a datacenter address is refused: nobody is on the other end", () => {
    expect(decideRealView(input({ isHosting: true }))).toBe("hosting");
  });
});

describe("staff never count as a view of their own preview", () => {
  it("a device marked internal (the sc_internal cookie) is ignored", () => {
    expect(decideRealView(input({ internalCookie: true }))).toBe("internal");
  });

  it("a browser signed in as an admin is ignored, cookie or not", () => {
    expect(decideRealView(input({ adminSession: true }))).toBe("internal");
  });

  it("the view route reads both, from the request itself", () => {
    const route = read("src/app/api/p/view/route.ts");
    expect(route).toContain('req.cookies.get("sc_internal")?.value === "1"');
    expect(route).toContain("adminSession: !!(await requireAdmin()");
    // The real request header, never a field the page could send.
    expect(route).toContain('const ua = req.headers.get("user-agent");');
    expect(route).not.toMatch(/body\?\.(ua|user_agent|userAgent)/);
  });
});

describe("a preview that is gone records nothing", () => {
  it("missing, paused and expired previews are refused before anything else", () => {
    expect(decideRealView(input({ preview: null }))).toBe("missing");
    expect(decideRealView(input({ preview: { ...LIVE, status: "paused" } }))).toBe("missing");
    expect(decideRealView(input({ preview: { status: "live", expires_at: "2026-11-11T14:59:59Z" } }))).toBe("expired");
  });

  it("expiry is exact: live until the second it ends", () => {
    expect(previewState({ status: "live", expires_at: new Date(NOW + 1000).toISOString() }, NOW)).toBe("live");
    expect(previewState({ status: "live", expires_at: new Date(NOW).toISOString() }, NOW)).toBe("expired");
    expect(previewState({ status: "live", expires_at: "not a date" }, NOW)).toBe("expired");
  });
});

describe("when a real view rings the phone", () => {
  it("the first view from a device rings; the same device again does not", () => {
    expect(shouldAlert({ firstFromDevice: true, alertsToday: 0 })).toBe(true);
    expect(shouldAlert({ firstFromDevice: false, alertsToday: 0 })).toBe(false);
  });

  it("a second, new device rings again", () => {
    expect(shouldAlert({ firstFromDevice: true, alertsToday: 1 })).toBe(true);
  });

  it("one preview can't ring without limit (a device is only a cookie)", () => {
    expect(shouldAlert({ firstFromDevice: true, alertsToday: NEW_DEVICE_ALERTS_PER_DAY - 1 })).toBe(true);
    expect(shouldAlert({ firstFromDevice: true, alertsToday: NEW_DEVICE_ALERTS_PER_DAY })).toBe(false);
  });

  it("'first from this device' is decided by the database, so two requests can't both win", () => {
    const sql = read("supabase/prospect-previews.sql");
    expect(sql).toMatch(/create unique index if not exists prospect_preview_views_first_device\s+on public\.prospect_preview_views \(preview_id, device_id\) where first_from_device;/);
    const store = read("src/lib/prospect-preview/store.ts");
    expect(store).toContain('if (first.error?.code !== "23505") return null;');
    // One row per device per visit: the same 30 minutes a card view uses.
    expect(store).toContain("VIEW_VISIT_WINDOW_MS");
  });

  it("the route marks the view as alerted BEFORE it sends, and never alerts a repeat", () => {
    const route = read("src/app/api/p/view/route.ts");
    expect(route).toContain("if (!view || view.repeat) return res;");
    expect(route.indexOf("await markAlerted(view.viewId);")).toBeGreaterThan(-1);
    expect(route.indexOf("await markAlerted(view.viewId);")).toBeLessThan(route.indexOf("await alertAdminsOfView("));
  });
});

describe("the alert's words", () => {
  const p = { owner_name: "Dana Whitfield", office_name: "Harbor Realty Group", phone: "(212) 555-0199" };

  it("says who is looking and what number to call", () => {
    expect(alertText(p)).toEqual({ title: "Dana Whitfield is viewing their card", body: "Call (212) 555-0199 · Harbor Realty Group" });
  });

  it("the phone number survives the lock screen's trimming, whatever the names are", () => {
    const long = { owner_name: "Bartholomew Featherstonehaugh-Montgomery", office_name: "The Featherstonehaugh-Montgomery International Property Partnership", phone: "+1 (212) 555-0199 ext. 4410" };
    for (const who of [p, long]) {
      const { title, body } = alertText(who);
      expect(title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
      expect(title).toMatch(/ is viewing their card$/);
      // push.ts trims the body to MAX_BODY_CHARS on a word boundary.
      expect(fitBody(body, MAX_BODY_CHARS)).toContain(`Call ${who.phone}`);
    }
    // A name too long for the line gives way to the first name, not to "…".
    expect(alertText(long).title).toBe("Bartholomew is viewing their card");
  });
});

describe("the push: any hour, never capped, never a customer's", () => {
  // Owner, 2026-11-11: "Always alert, any hour."
  const prefs = { ...readPushPrefs({ _push: { timezone: "America/New_York" } }) };
  const THREE_AM = Date.parse("2026-11-11T08:00:00Z"); // 3am in New York

  it("goes out in quiet hours, when every customer notification is held", () => {
    expect(decidePush({ category: "card_view", prefs, cappedSentToday: 0, now: THREE_AM })).toEqual({ send: false, reason: "quiet_hours" });
    expect(decidePush({ category: "billing_problem", prefs, cappedSentToday: 0, now: THREE_AM })).toEqual({ send: false, reason: "quiet_hours" });
    expect(decidePush({ category: "prospect_view", prefs, cappedSentToday: 0, now: THREE_AM })).toEqual({ send: true, mode: "alert" });
  });

  it("is the ONLY category quiet hours don't hold", () => {
    expect(QUIET_EXEMPT).toEqual(["prospect_view"]);
  });

  it("is not counted against the daily cap", () => {
    expect(UNCAPPED).toContain("prospect_view");
    expect(decidePush({ category: "prospect_view", prefs, cappedSentToday: 99, softSentToday: 99, now: THREE_AM })).toEqual({ send: true, mode: "alert" });
  });

  it("has no switch in a customer's Settings", () => {
    expect(LIVE_CATEGORIES).not.toContain("prospect_view");
  });

  it("is sent sticky, tagged per preview, and opens the Call screen in the app", () => {
    const alert = read("src/lib/prospect-preview/alert.ts");
    expect(alert).toContain('category: "prospect_view"');
    expect(alert).toContain("sticky: true");
    expect(alert).toContain("tag: `prospect-${v.preview.id}`");
    expect(alert).toContain("`/admin/card-builder/call/${previewId}`");
    // Never a tel: link: the native apps drop any notification link that isn't ours.
    expect(alert).not.toMatch(/url:\s*[`"']tel:/);
    // A computer keeps it on screen until it is clicked.
    expect(read("public/sw.js")).toContain("requireInteraction: data.sticky === true,");
  });
});

describe("device type", () => {
  it.each([
    [IPHONE, "phone"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36", "phone"],
    ["Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1", "tablet"],
    ["Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36", "tablet"],
    [CHROME_MAC, "desktop"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36", "desktop"],
  ])("%s → %s", (ua, type) => {
    expect(deviceTypeOf(ua)).toBe(type);
  });

  it("an iPad pretending to be a Mac (desktop-mode Safari) is still a tablet", () => {
    expect(deviceTypeOf(CHROME_MAC, true)).toBe("tablet");
  });
});

describe("the list: most recently viewed first", () => {
  const p = (id: string, created: string) => ({ id, created_at: created } as unknown as ProspectPreview);

  it("counts views, devices and the last time, per preview", () => {
    const row = withViews(p("a", "2026-11-01T00:00:00Z"), [
      { viewed_at: "2026-11-10T10:00:00Z", device_id: "d1", team_strip_scrolled: false },
      { viewed_at: "2026-11-11T09:00:00Z", device_id: "d2", team_strip_scrolled: true },
      { viewed_at: "2026-11-09T10:00:00Z", device_id: "d1", team_strip_scrolled: false },
    ]);
    expect(row).toMatchObject({ views: 3, devices: 2, last_viewed_at: "2026-11-11T09:00:00Z", team_strip_scrolled: true });
    expect(withViews(p("b", "2026-11-01T00:00:00Z"), [])).toMatchObject({ views: 0, devices: 0, last_viewed_at: null, team_strip_scrolled: false });
  });

  it("sorts by last view, and puts never-opened previews after them, newest first", () => {
    const rows = [
      { id: "never-old", created_at: "2026-11-01T00:00:00Z", last_viewed_at: null },
      { id: "viewed-yesterday", created_at: "2026-10-01T00:00:00Z", last_viewed_at: "2026-11-10T12:00:00Z" },
      { id: "never-new", created_at: "2026-11-09T00:00:00Z", last_viewed_at: null },
      { id: "viewed-now", created_at: "2026-10-05T00:00:00Z", last_viewed_at: "2026-11-11T14:59:00Z" },
    ];
    expect(sortByLastViewed(rows).map((r) => r.id)).toEqual(["viewed-now", "viewed-yesterday", "never-new", "never-old"]);
  });
});

describe("the create form", () => {
  const form = (o: Record<string, string>) => (k: string) => o[k];
  const base = { office_name: "Harbor Realty Group", owner_name: "Dana Whitfield", phone: "(212) 555-0199", buyer_role: "broker_owner" };

  it("makes an unguessable link from the office name, and expires in 14 days by default", () => {
    const r = parsePreviewForm(form(base), new Date(NOW));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.slug).toMatch(/^harbor-realty-group-[a-z2-9]{6}$/);
    expect(r.value.expires_at).toBe(new Date(NOW + 14 * 24 * 60 * 60 * 1000).toISOString());
    expect(r.value).toMatchObject({ brand_primary: "#2C3A52", brand_secondary: "#FFFFFF", team_members: [], crew_lead_id: null, email: null, logo_url: null });
  });

  it("two previews for the same office get different links", () => {
    expect(newSlug("Harbor Realty")).not.toBe(newSlug("Harbor Realty"));
    expect(slugify("  Müller & Söhne, LLC!  ")).toBe("muller-and-sohne-llc");
    expect(newSlug("!!!", "abc234")).toBe("preview-abc234");
  });

  it("reads the team one per line, name then title", () => {
    expect(parseTeam("Dana Whitfield, Senior Agent\n\n  Marcus Lee  \nJo Park, Broker, CRS")).toEqual([
      { name: "Dana Whitfield", title: "Senior Agent" },
      { name: "Marcus Lee", title: "" },
      { name: "Jo Park", title: "Broker, CRS" },
    ]);
    expect(parseTeam(Array.from({ length: 30 }, (_, i) => `Person ${i}`).join("\n"))).toHaveLength(12);
  });

  it("says what to fix, in words", () => {
    const err = (o: Record<string, string>) => { const r = parsePreviewForm(form(o)); return r.ok ? null : r.error; };
    expect(err({ ...base, office_name: "" })).toMatch(/office's name/);
    expect(err({ ...base, owner_name: " " })).toMatch(/owner's name/);
    expect(err({ ...base, phone: "call me" })).toMatch(/phone number/);
    expect(err({ ...base, email: "nope" })).toMatch(/email/);
    expect(err({ ...base, logo_url: "http://example.com/logo.png" })).toMatch(/https/);
    expect(err({ ...base, logo_url: "javascript:alert(1)" })).toMatch(/https/);
    expect(err({ ...base, expires_days: "0" })).toMatch(/1 to 90 days/);
    expect(err({ ...base, crew_lead_id: "42" })).toMatch(/lead ID/);
    expect(err(base)).toBeNull();
  });

  it("a colour that isn't a colour falls back instead of reaching the page", () => {
    const r = parsePreviewForm(form({ ...base, brand_primary: "red; background:url(x)", brand_secondary: "#0a7f3f" }));
    expect(r.ok && r.value.brand_primary).toBe("#2C3A52");
    expect(r.ok && r.value.brand_secondary).toBe("#0A7F3F");
  });

  it("turns the phone number into something a dialer accepts", () => {
    expect(telHref("(212) 555-0199")).toBe("tel:2125550199");
    expect(telHref("+1 212-555-0199")).toBe("tel:+12125550199");
    expect(telHref("212.555.0199 x44")).toBe("tel:2125550199");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
function read(p: string): string {
  return readFileSync(join(process.cwd(), p), "utf8");
}
