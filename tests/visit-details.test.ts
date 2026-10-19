import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeDevice, deviceSentence, formatDuration, openedIn, referrerName, cleanModelHint, cleanOsHint } from "@/lib/visit-device";
import { buildRecentVisits, type VisitEventRow } from "@/lib/recent-visits";
import { cardEventNotice } from "@/lib/card-event-notify";
import { redactForPlan } from "@/lib/notification-privacy";
import { DETAIL_MARK, stripLocationMarks, teaseLocation, withoutDetail } from "@/lib/location-privacy";
import { fitBodyKeepingPlace, withDeviceIfItFits } from "@/lib/push-policy";
import { stripNameMarks, genericNames } from "@/lib/contact-privacy";
import { LOCKED_LEAD_TAG } from "@/lib/plan";

// ── Visit details (owner, 2026-10-18) ────────────────────────────────────────
// "Make these analytics for the card link, card view, and location as
// pinpoint as possible." Every visit now says what it was opened on, where it
// was tapped, how long it stayed and what the visitor did — and never claims
// more than the request actually said.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// Real User-Agents from production card_events rows (2026-10).
const UA = {
  igIphone18ProMax: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/24A446 Instagram 451.0.0.37.60 (iPhone19,3; iOS 27_0_1; en_US; en; scale=3.00; 1320x2868; IABMV/1; 1088109557) Safari/604.1",
  igIphone16Pro: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22D72 Instagram 451.0.0.37.60 (iPhone17,1; iOS 18_3_1; en_US; en; scale=3.00; 1206x2622; IABMV/1; 1088109557) Safari/604.1",
  safariIos27: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1",
  safariIos26: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/155.0.8059.37 Mobile/15E148 Safari/604.1",
  androidReduced: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36",
  androidWebviewS24: "Mozilla/5.0 (Linux; Android 14; SM-S921U Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
  fbIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0;FBBV/1;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/26.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
  messengerIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0;FBDV/iPhone15,4;FBSV/26.0]",
};

describe("the device a visit came from", () => {
  it("names the exact iPhone when the app's browser reports it", () => {
    expect(describeDevice(UA.igIphone18ProMax)?.label).toBe("iPhone 18 Pro Max · iOS 27");
    expect(describeDevice(UA.igIphone16Pro)?.label).toBe("iPhone 16 Pro · iOS 18");
    expect(describeDevice(UA.fbIos)?.label).toBe("iPhone 15 Pro Max · iOS 26");
  });

  it("never believes Safari's frozen iOS version — the real one is in Version/", () => {
    expect(describeDevice(UA.safariIos27)?.label).toBe("iPhone · iOS 27");
    expect(describeDevice(UA.safariIos26)?.label).toBe("iPhone · iOS 26");
    // No evidence beyond the frozen 18.7: the version is not said at all.
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")?.label).toBe("iPhone");
    expect(describeDevice(UA.chromeIos)?.label).toBe("iPhone · iOS 26");
  });

  it("an unknown iPhone code is 'iPhone', never a guessed name", () => {
    expect(describeDevice(UA.igIphone16Pro.replace("iPhone17,1", "iPhone21,9"))?.name).toBe("iPhone");
  });

  it("Chrome's reduced Android UA is 'Android phone' until the page's hints name it", () => {
    expect(describeDevice(UA.androidReduced)?.label).toBe("Android phone");
    expect(describeDevice(UA.androidReduced, { model: "SM-S928U", os: "15.0.0" })?.label).toBe("Samsung Galaxy S24 Ultra · Android 15");
    expect(describeDevice(UA.androidReduced, { model: "Pixel 9 Pro", os: "15" })?.label).toBe("Pixel 9 Pro · Android 15");
    // An unknown Samsung code: the brand is certain, the model is not.
    expect(describeDevice(UA.androidReduced, { model: "SM-X999Z" })?.name).toBe("Samsung Galaxy");
    // A bare manufacturer code is not a name a person recognises.
    expect(describeDevice(UA.androidReduced, { model: "CPH2449" })?.name).toBe("Android phone");
  });

  it("an un-reduced Android UA (an app's WebView) still names its model and version", () => {
    expect(describeDevice(UA.androidWebviewS24)?.label).toBe("Samsung Galaxy S24 · Android 14");
  });

  it("computers say only what is true: their versions are frozen too", () => {
    expect(describeDevice(UA.windowsChrome)?.label).toBe("Windows PC");
    expect(describeDevice(UA.macSafari)?.label).toBe("Mac");
    // An iPad in desktop-mode Safari says Mac; the page saw a touch screen.
    expect(describeDevice(UA.macSafari, { model: "iPad" })?.label).toBe("iPad");
    expect(describeDevice("")).toBe(null);
  });

  it("hints are shape-checked before they are believed", () => {
    expect(cleanModelHint("SM-S921U")).toBe("SM-S921U");
    expect(cleanModelHint("<script>")).toBe(null);
    expect(cleanModelHint("x".repeat(80))).toBe(null);
    expect(cleanOsHint("14.0.0")).toBe("14.0.0");
    expect(cleanOsHint("fourteen")).toBe(null);
  });
});

describe("which app or browser it was opened in", () => {
  it("an app's own browser is named for the app", () => {
    expect(openedIn(UA.igIphone16Pro)).toEqual({ name: "Instagram", inApp: true });
    expect(openedIn(UA.fbIos)).toEqual({ name: "Facebook", inApp: true });
    expect(openedIn(UA.messengerIos)).toEqual({ name: "Messenger", inApp: true });
    expect(openedIn(UA.androidWebviewS24)).toEqual({ name: "an app's built-in browser", inApp: true });
  });
  it("browsers, most specific first", () => {
    expect(openedIn(UA.windowsEdge)?.name).toBe("Edge");
    expect(openedIn(UA.windowsChrome)?.name).toBe("Chrome");
    expect(openedIn(UA.chromeIos)?.name).toBe("Chrome");
    expect(openedIn(UA.safariIos27)?.name).toBe("Safari");
  });
  it("where the link was tapped: the service, not its link shim; never our own pages", () => {
    expect(referrerName("https://l.instagram.com/")).toBe("Instagram");
    expect(referrerName("https://lnkd.in/abc")).toBe("LinkedIn");
    expect(referrerName("https://mail.google.com/mail/u/0/")).toBe("Gmail");
    expect(referrerName("https://www.google.com/")).toBe("Google");
    expect(referrerName("https://swiftcard.me/aaronlavi-swiftcardinc")).toBe(null);
    expect(referrerName("https://blog.example.org/post")).toBe("blog.example.org");
    expect(referrerName(null)).toBe(null);
  });
  it("durations", () => {
    expect(formatDuration(25)).toBe("25s");
    expect(formatDuration(100)).toBe("1m 40s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(1800)).toBe("30m+");
    expect(formatDuration(null)).toBe(null);
    expect(formatDuration(0)).toBe(null);
  });
});

describe("the notification carries the device — on Pro, and only where it fits", () => {
  const device = deviceSentence(describeDevice(UA.igIphone16Pro), openedIn(UA.igIphone16Pro));
  const notice = cardEventNotice({ eventType: "viewed_card", location: "Brooklyn, NY", geoAccuracy: "city", device })!;

  it("Pro's bell reads the whole sentence", () => {
    expect(device).toBe(" on an iPhone 16 Pro via Instagram");
    const [pro] = redactForPlan([{ type: "card_viewed", title: notice.title, body: notice.body }], true);
    expect(pro.body).toBe("Someone viewed your card near Brooklyn, NY on an iPhone 16 Pro via Instagram.");
  });

  it("Free's bell has no device at all, and the place is still blocked", () => {
    const [free] = redactForPlan([{ type: "card_viewed", title: notice.title, body: notice.body }], false);
    expect(free.body).not.toMatch(/iPhone|Instagram/);
    expect(free.body).not.toContain(DETAIL_MARK);
    expect(free.body).not.toContain("Brooklyn");
  });

  it("no device known: the sentence is exactly what it always was", () => {
    const plain = cardEventNotice({ eventType: "viewed_card", location: "Brooklyn, NY", geoAccuracy: "city" })!;
    expect(plain.body).not.toContain(DETAIL_MARK);
    expect(stripLocationMarks(plain.body)).toBe("Someone viewed your card near Brooklyn, NY.");
  });

  it("the lock screen keeps the device only when the whole sentence fits", () => {
    const paidRender = (s: string) => stripNameMarks(stripLocationMarks(s));
    const freeRender = (s: string) => teaseLocation(genericNames(s));
    const fits = fitBodyKeepingPlace(withDeviceIfItFits(notice.body, true, paidRender), paidRender);
    expect(fits).toBe("Someone viewed your card near Brooklyn, NY on an iPhone 16 Pro via Instagram.");
    // Free: never.
    expect(fitBodyKeepingPlace(withDeviceIfItFits(notice.body, false, freeRender), freeRender)).not.toMatch(/iPhone/);
    // Too long for the lock screen: the device goes, the who and the where stay.
    const long = cardEventNotice({
      eventType: "downloaded_vcard", source: "qr_code", location: "Rancho Santa Margarita, CA", geoAccuracy: "city",
      device: " on a Samsung Galaxy Z Fold7 via an app's built-in browser",
    })!;
    const out = fitBodyKeepingPlace(withDeviceIfItFits(long.body, true, paidRender), paidRender);
    expect(out).toBe("Someone downloaded your contact card from a QR code near Rancho Santa Margarita, CA.");
  });

  it("withoutDetail drops only the device fragment", () => {
    expect(withoutDetail(`a${DETAIL_MARK} on a Mac${DETAIL_MARK}.`)).toBe("a.");
    expect(withoutDetail("unchanged")).toBe("unchanged");
  });
});

describe("Recent visits", () => {
  const T = (min: number) => new Date(Date.UTC(2026, 9, 18, 15, 0) + min * 60_000).toISOString();
  const ev = (o: Partial<VisitEventRow> & { id: string; created_at: string; event_type: string }): VisitEventRow => ({
    surface: "card", visitor_id: "visitor-aaaa", source: "direct_link", device_info: UA.igIphone16Pro,
    referrer_url: "https://l.instagram.com/", location: "Brooklyn, NY", geo_accuracy: "city_approx", ...o,
  });

  // Newest first, as the dashboard reads them.
  const events: VisitEventRow[] = [
    ev({ id: "tap", created_at: T(3), event_type: "clicked_link", target: "calendly.com", target_label: "Book a call" }),
    ev({ id: "save", created_at: T(2), event_type: "downloaded_vcard" }),
    ev({ id: "v2", created_at: T(0), event_type: "viewed_card", duration_s: 100, device_model: null }),
    ev({ id: "other", created_at: T(-5), event_type: "viewed_card", visitor_id: "visitor-bbbb", device_info: UA.windowsChrome, referrer_url: "https://lnkd.in/x", location: "New York, US", geo_accuracy: "region", lead_id: "lead-1", lead_confidence: "form" }),
    ev({ id: "saveonly", created_at: T(-20), event_type: "downloaded_vcard", visitor_id: "visitor-cccc", source: "qr_code", device_info: UA.safariIos27, referrer_url: null }),
  ];
  const history = [
    { visitor_id: "visitor-aaaa", surface: "card", created_at: T(-3000) },
    { visitor_id: "visitor-aaaa", surface: "card", created_at: T(0) },
    { visitor_id: "visitor-bbbb", surface: "card", created_at: T(-5) },
  ];
  const leads = [{ id: "lead-1", name: "Priya Shah", tags: [] }];

  it("Pro: every detail, with what they did in that visit", () => {
    const [a, b, c] = buildRecentVisits({ events, history, leads, paid: true, limit: 25 });
    expect(a).toMatchObject({
      id: "v2", who: "Someone", surface: "card", locked: false,
      device: "iPhone 16 Pro · iOS 18", openedIn: "Instagram", from: null, // Instagram's own shim isn't news
      place: "Near Brooklyn, NY", duration: "1m 40s", visitNumber: 2,
      actions: ["Saved your contact", "Tapped Book a call"],
    });
    expect(b).toMatchObject({ who: "Priya Shah", device: "Windows PC", openedIn: "Chrome", from: "from LinkedIn", place: "New York (approximate)", visitNumber: 1 });
    // A save with no view event behind it is still a visit, not a gap.
    expect(c).toMatchObject({ id: "saveonly", from: "from a QR code", actions: ["Saved your contact"], device: "iPhone · iOS 27" });
  });

  it("Free: the visit is there, the details never leave the server", () => {
    const rows = buildRecentVisits({ events, history, leads, paid: false, limit: 25 });
    for (const r of rows) {
      expect(r.locked).toBe(true);
      expect([r.place, r.device, r.openedIn, r.from, r.duration]).toEqual([null, null, null, null, null]);
      expect(r.actions).toEqual([]);
    }
    expect(rows[0].visitNumber).toBe(2);
  });

  it("a contact locked behind Free's cap is not named on Free; a forwarded link's opener is never named", () => {
    const locked = [{ id: "lead-1", name: "Priya Shah", tags: [LOCKED_LEAD_TAG] }];
    const free = buildRecentVisits({ events, history, leads: locked, paid: false, limit: 25 });
    expect(free[1].who).toBe(null);
    const fwd = events.map((e) => (e.id === "other" ? { ...e, lead_confidence: "forwarded" } : e));
    expect(buildRecentVisits({ events: fwd, history, leads, paid: true, limit: 25 })[1].who).toBe("Someone");
  });

  it("the Swift Links page's own source tag is not where it was opened from", () => {
    const links = [ev({ id: "l", created_at: T(0), event_type: "viewed_card", surface: "links", source: "swift_links", referrer_url: null, device_info: UA.safariIos27 })];
    expect(buildRecentVisits({ events: links, history: [], leads: [], paid: true, limit: 25 })[0].from).toBe(null);
  });
});

describe("wiring", () => {
  it("the ingest route describes the device from the REQUEST, not the visitor's word", () => {
    const route = read("src/app/api/card-events/route.ts");
    expect(route).toContain('const device_info = str(req.headers.get("user-agent"), 250) ?? str(body?.device_info, 250);');
    expect(route).toContain("device: deviceSentence(describeDevice(device_info, { model: device_model, os: device_os }), openedIn(device_info)),");
  });

  it("the dwell endpoint can only raise a duration, on the caller's own view, within what is physically possible", () => {
    const dwell = read("src/app/api/card-events/dwell/route.ts");
    expect(dwell).toContain("req.cookies.get(VISITOR_COOKIE)");
    expect(dwell).toContain("Math.min(seconds, sinceRecorded + GATE_ALLOWANCE_S, MAX_DURATION_S)");
    expect(dwell).toContain(".or(`duration_s.is.null,duration_s.lt.${secs}`)");
    expect(dwell).not.toMatch(/\.insert\(/);
  });

  it("the tracker reports time on screen and never spends the visit's slot on the hint wait", () => {
    const t = read("src/components/CardEventTracker.tsx");
    expect(t).toMatch(/navigator\.sendBeacon\?\.\("\/api\/card-events\/dwell", blob\)/);
    expect(t.indexOf("const hints = await deviceHints();")).toBeLessThan(t.indexOf("lastFired.set(viewsKey, Date.now());"));
  });

  it("the dashboard shows Recent visits under the chart, never on the Locations tab, and Free's is gated", () => {
    const page = read("src/app/dashboard/page.tsx");
    expect(page).toContain("<RecentVisits visits={recentVisits} paid={isPro} />");
    expect(page).toMatch(/viewsRange === "locations"\n\s*\? Promise\.resolve\(\[\]\)\n\s*: loadRecentVisits\(/);
    const comp = read("src/components/dashboard/RecentVisits.tsx");
    expect(comp).toContain("<details");
    expect(comp).toContain('nativeCopy="Pro feature — Detailed analytics are only available on the Pro plan"');
  });
});
