import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PUSH_ASK_GAP_MS, PUSH_ASK_MAX, PUSH_ASK_MAX_AGE_MS, PUSH_ASK_TYPES,
  decidePushAsk, laterPushAsk, pickAskCandidate, pushAlreadyOn, pushAskCopy, pushAskQuietUntil, readPushAsk,
  snoozePushAsk, stopPushAsk, type AskPlatform,
} from "@/lib/push-ask";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// ── "Get notifications like this on your phone" ─────────────────────────────
//
// Owner, 2026-09-18: when someone who skipped the notifications switch gets an
// important notification, the bell should offer push right there. But "not on
// all their notifications, because it's going to be too spammy. After reminding
// them a few times, if they really don't want push notifications on, they
// don't want it on." And then: "I'm talking about mainly for the app. Most
// people will have the app downloaded" — with the website doing whatever makes
// sense on a computer and on a phone. These pin exactly that.

const NOW = Date.parse("2026-09-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const row = (id: string, type: string, agoMs: number, read = false) =>
  ({ id, type, read, created_at: new Date(NOW - agoMs).toISOString() });

describe("which notification may carry the reminder", () => {
  it("only a new contact, a reply or a contact download — never a view or anything else", () => {
    expect([...PUSH_ASK_TYPES].sort()).toEqual(["contact_saved", "lead_reply", "new_lead"]);
    for (const t of ["card_viewed", "milestone_25", "signature_stale", "pro_ended", "payment_failed", "referral_claim"]) {
      expect(pickAskCandidate([row("a", t, 1000)], NOW)).toBeNull();
    }
  });

  it("ONE row: the newest unread important one", () => {
    const rows = [
      row("old-lead", "new_lead", 3 * 60_000),
      row("view", "card_viewed", 60_000),
      row("new-reply", "lead_reply", 2 * 60_000),
      row("read-save", "contact_saved", 30_000, true),
    ];
    expect(pickAskCandidate(rows, NOW)).toBe("new-reply");
  });

  it("nothing already read, and nothing older than two weeks", () => {
    expect(pickAskCandidate([row("a", "new_lead", 1000, true)], NOW)).toBeNull();
    expect(pickAskCandidate([row("a", "new_lead", PUSH_ASK_MAX_AGE_MS + 1000)], NOW)).toBeNull();
    expect(pickAskCandidate([row("a", "new_lead", PUSH_ASK_MAX_AGE_MS - 1000)], NOW)).toBe("a");
  });
});

describe.each(["app", "web"] as AskPlatform[])("a few reminders, then never again — %s", (platform) => {
  const empty = readPushAsk(undefined);

  it("the first important notification gets a reminder, and it is recorded on this side", () => {
    const d = decidePushAsk(empty, platform, "lead-1", NOW);
    expect(d.show).toBe(true);
    expect(d.next![platform]).toEqual({ n: 1, at: new Date(NOW).toISOString(), id: "lead-1", later: false });
  });

  it("the SAME notification is one reminder however often the bell is opened", () => {
    const after = decidePushAsk(empty, platform, "lead-1", NOW).next!;
    expect(decidePushAsk(after, platform, "lead-1", NOW + 60_000)).toEqual({ show: true, next: null });
  });

  it("'Not now' puts it away for good", () => {
    const shown = decidePushAsk(empty, platform, "lead-1", NOW).next!;
    const later = laterPushAsk(shown, platform, "lead-1")!;
    expect(decidePushAsk(later, platform, "lead-1", NOW + 1000).show).toBe(false);
    expect(laterPushAsk(shown, platform, "some-other-id")).toBeNull();
  });

  it(`a second reminder waits at least ${PUSH_ASK_GAP_MS / DAY} days — three leads in an afternoon are ONE reminder`, () => {
    const first = laterPushAsk(decidePushAsk(empty, platform, "lead-1", NOW).next!, platform, "lead-1")!;
    expect(decidePushAsk(first, platform, "lead-2", NOW + 2 * 60 * 60_000).show).toBe(false);
    expect(decidePushAsk(first, platform, "lead-2", NOW + PUSH_ASK_GAP_MS - 1000).show).toBe(false);
    const second = decidePushAsk(first, platform, "lead-2", NOW + PUSH_ASK_GAP_MS + 1000);
    expect(second.show).toBe(true);
    expect(second.next![platform].n).toBe(2);
  });

  it(`never more than ${PUSH_ASK_MAX} on this side, however long it has been`, () => {
    let ledger = readPushAsk(undefined);
    let t = NOW;
    for (let i = 1; i <= PUSH_ASK_MAX; i++) {
      const d = decidePushAsk(ledger, platform, `lead-${i}`, t);
      expect(d.show).toBe(true);
      ledger = laterPushAsk(d.next!, platform, `lead-${i}`)!;
      t += PUSH_ASK_GAP_MS + DAY;
    }
    expect(decidePushAsk(ledger, platform, "lead-99", t + 365 * DAY).show).toBe(false);
  });

  it("'Not now' on the dashboard box rests the reminders on this side — no second ask seconds later", () => {
    const pending = decidePushAsk(empty, platform, "lead-1", NOW).next!;
    const rested = snoozePushAsk(pending, platform, NOW + 60_000)!;
    expect(decidePushAsk(rested, platform, "lead-1", NOW + 120_000).show).toBe(false);
    expect(decidePushAsk(rested, platform, "lead-2", NOW + 120_000).show).toBe(false);
    expect(pushAskQuietUntil(rested, platform)).toBe(NOW + 60_000 + PUSH_ASK_GAP_MS);
    expect(rested[platform].n).toBe(1); // a box "Not now" does not spend the budget
  });
});

describe("the app's reminders are its own", () => {
  it("everything the website does leaves the app's reminders untouched", () => {
    let l = readPushAsk(undefined);
    // Two reminders on a laptop, both put away…
    l = laterPushAsk(decidePushAsk(l, "web", "lead-1", NOW).next!, "web", "lead-1")!;
    l = laterPushAsk(decidePushAsk(l, "web", "lead-2", NOW + PUSH_ASK_GAP_MS + 1).next!, "web", "lead-2")!;
    l = snoozePushAsk(l, "web", NOW + PUSH_ASK_GAP_MS + 2)!;
    // …and the phone still gets its own, today.
    expect(decidePushAsk(l, "app", "lead-3", NOW + PUSH_ASK_GAP_MS + 3).show).toBe(true);
  });

  it("but 'Don't ask again' — from anywhere — ends it everywhere", () => {
    const stopped = stopPushAsk(decidePushAsk(readPushAsk(undefined), "web", "lead-1", NOW).next!)!;
    for (const p of ["app", "web"] as AskPlatform[]) {
      expect(decidePushAsk(stopped, p, "lead-1", NOW).show).toBe(false);
      expect(decidePushAsk(stopped, p, "lead-9", NOW + 30 * DAY).show).toBe(false);
    }
    expect(stopPushAsk(stopped)).toBeNull(); // nothing to write twice
  });

  it("the app asks until the PHONE gets pushes; the website stops once anything does", () => {
    const laptopOnly = ["https://fcm.googleapis.com/fcm/send/abc"];
    const phone = ["apns:abcdef0123456789abcdef"];
    expect(pushAlreadyOn([], "app")).toBe(false);
    expect(pushAlreadyOn(laptopOnly, "app")).toBe(false); // a laptop is not the phone in their pocket
    expect(pushAlreadyOn(phone, "app")).toBe(true);
    expect(pushAlreadyOn([], "web")).toBe(false);
    expect(pushAlreadyOn(laptopOnly, "web")).toBe(true);
    expect(pushAlreadyOn(phone, "web")).toBe(true); // the phone has it: a computer has nothing to add
  });

  it("the first release's flat record is read as the website's — it can only make the website ask less", () => {
    const legacy = readPushAsk({ n: 1, at: new Date(NOW).toISOString(), id: "lead-1", later: true, stop: false });
    expect(legacy.web).toEqual({ n: 1, at: new Date(NOW).toISOString(), id: "lead-1", later: true });
    expect(legacy.app).toEqual({ n: 0, at: null, id: null, later: false });
  });

  it("reads anything stored — or nothing, or junk — as a sane ledger", () => {
    const blank = { n: 0, at: null, id: null, later: false };
    expect(readPushAsk(null)).toEqual({ app: blank, web: blank, stop: false });
    expect(readPushAsk({ app: { n: "7", later: 1 }, stop: "yes" })).toEqual({ app: blank, web: blank, stop: false });
    expect(readPushAsk({ app: { n: 2.9 }, stop: true })).toMatchObject({ app: { n: 2 }, stop: true });
  });
});

describe("the words fit the device", () => {
  it("phone on a phone, computer on a computer, and the app on an iPhone browser", () => {
    expect(pushAskCopy("phone").title).toBe("Get notifications like this on your phone");
    expect(pushAskCopy("computer").title).toBe("Get notifications like this on this computer");
    // An iPhone browser tab cannot get web push without Add to Home Screen:
    // the words send them to the app — open it, or download it.
    const iphone = pushAskCopy("iphone-browser");
    expect(iphone.title).toBe("Get notifications like this on your phone");
    expect(iphone.sub).toContain("SwiftCard app");
    expect(iphone.sub).toMatch(/open it/i);
    expect(iphone.sub).toMatch(/download/i);
  });

  it("after a 'Don't Allow': says notifications are off, and points at iPhone Settings", () => {
    const c = pushAskCopy("phone", { denied: true });
    expect(c.title).toBe("Notifications are off for SwiftCard");
    expect(c.sub).toMatch(/iPhone Settings/);
    expect(c.sub).toMatch(/next contact/i);
  });

  it("never a sales line", () => {
    for (const d of ["phone", "computer", "iphone-browser"] as const) {
      for (const denied of [false, true]) {
        const c = pushAskCopy(d, { denied });
        expect(`${c.title} ${c.sub}`).not.toMatch(/\bpro\b|upgrade|\$|free trial/i);
      }
    }
  });
});

describe("the server is the authority", () => {
  const route = read("src/app/api/push/ask/route.ts");

  it("decides app or website from the REQUEST, never from what the page says", () => {
    expect(route).toMatch(/const platformOf = \(req: NextRequest\): AskPlatform => \(isShellRequest\(req\) \? "app" : "web"\);/);
    expect(route).not.toMatch(/body\.platform/);
  });

  it("never asks for what the account already has on this side; a failed read counts as 'has it'", () => {
    expect(route).toMatch(/if \(await alreadyOn\(user\.id, platform\)\) return NextResponse\.json\(\{ show: false \}\);/);
    expect(route).toMatch(/if \(error\) return true;/);
    expect(route).toMatch(/return pushAlreadyOn\(/);
  });

  it("checks the notification is theirs, unread, recent and important before spending anything", () => {
    expect(route).toMatch(/\.eq\("id", id\)\s*\n\s*\.eq\("user_id", user\.id\)/);
    expect(route).toMatch(/!row \|\| row\.read \|\| !isAskableType\(row\.type as string\) \|\| !\(age <= PUSH_ASK_MAX_AGE_MS\)/);
  });

  it("decides inside the verified read-modify-write, and an unrecorded ask is not shown", () => {
    expect(route).toMatch(/mutateCustomization<unknown>\(user\.id, PUSH_ASK_KEY, \(cur\) => \{\s*\n\s*const d = decidePushAsk\(readPushAsk\(cur\), platform, id\);/);
    expect(route).toMatch(/if \(!r\.ok\) return NextResponse\.json\(\{ show: false \}\);/);
  });
});

describe("one ask on screen, and every way of saying no is honoured", () => {
  // Two surfaces since the dashboard's notifications list went with Quick
  // Contacts (2026-09-29): the box, then the bell.
  it("the box outranks the bell", () => {
    expect(read("src/lib/push-ask-client.ts")).toMatch(/const RANK: Record<AskSurface, number> = \{ nudge: 3, bell: 1 \};/);
    expect(read("src/components/PushNudge.tsx")).toMatch(/useAskSlot\("nudge", visible\);/);
    // The bell counts a reminder only when its dropdown is actually open.
    expect(read("src/components/NotificationBell.tsx")).toMatch(/usePushAsk\("bell", askId, open\)/);
  });

  it("only where this device can act: the switch where it works, the app on an iPhone browser", () => {
    const src = read("src/components/PushAskCallout.tsx");
    expect(src).toMatch(/const deviceCanAct = state === "idle" \|\| \(state === "ios-install" && !!APP_STORE_URL\) \|\| deniedInApp;/);
    expect(src).toMatch(/const askable = deviceCanAct && !askStopped\(\) && !askPushOn\(\) && !askSnoozed\(\) && decision !== false;/);
    expect(src).toMatch(/const mode: PushAsk\["mode"\] = state === "ios-install" \? "app" : deniedInApp \? "settings" : "switch";/);
    // Going to the App Store is the answer: that reminder is done.
    expect(src).toContain("<AppStoreBadge onClick={() => laterAsk(id)} />");
  });

  it("Settings on an iPhone browser points to the app first, and keeps the home-screen route", () => {
    const btn = read("src/components/EnablePushButton.tsx");
    expect(btn).toMatch(/Notifications come through the <strong>SwiftCard app<\/strong> — open it and allow them\./);
    expect(btn).toContain("Add to Home Screen");
  });

  // Owner, 2026-09-23: a "Don't Allow" at the phone's prompt no longer ends the
  // reminders. iOS asks once per install, so the only road back is Settings —
  // and the reminder under the next important notification carries that
  // button, within the same budget.
  it("a 'Don't Allow' at the device's own prompt does NOT end it — only 'Don't ask again' and switching off do", () => {
    const btn = read("src/components/EnablePushButton.tsx");
    expect(btn).not.toMatch(/askedHere/);
    // stopAsk is called exactly once: from turnedOffOnPurpose.
    expect((btn.match(/stopAsk\(\)/g) ?? []).length).toBe(1);
    expect(btn).toMatch(/const turnedOffOnPurpose = \(\) => stopAsk\(\);/);
  });

  it("in the app, a denied phone still gets the reminder — with the Settings button, not a switch", () => {
    const src = read("src/components/PushAskCallout.tsx");
    expect(src).toMatch(/const deniedInApp = state === "denied" && detectNativeApp\(\);/);
    expect(src).toMatch(/deniedInApp \? "settings" : "switch"/);
    expect(src).toMatch(/\|\| deniedInApp;/);
    expect(src).toContain('<EnablePushButton compact={ask.mode === "settings"} onDone={() => confirmEnabledFromAsk(id)} />');
    expect(src).toMatch(/pushAskCopy\(device, \{ denied: ask\.mode === "settings" \}\)/);
    // The compact button is the same one Settings shows, and it is the ONLY
    // thing rendered in that mode — no amber paragraph under a reminder.
    const btn = read("src/components/EnablePushButton.tsx");
    expect(btn).toMatch(/if \(compact\) return openSettings;/);
    expect(btn).toContain('window.location.href = "app-settings:"');
  });

  it("coming back from Settings allowed turns push on by itself — and only when they went there from here", () => {
    const btn = read("src/components/EnablePushButton.tsx");
    expect(btn).toMatch(/wentToSettings\.current = true;/);
    expect(btn).toMatch(/if \(state !== "denied" \|\| !detectNativeApp\(\)\) return;/);
    expect(btn).toMatch(/const cameFromHere = wentToSettings\.current;\s*\n\s*wentToSettings\.current = false;\s*\n\s*const perm = await recheck\(\);\s*\n\s*if \(perm !== "granted" \|\| !cameFromHere\) return;\s*\n\s*await enableAndReport\(\);/);
    expect(btn).toMatch(/document\.addEventListener\("visibilitychange", onVisible\);/);
    // recheck never prompts: checkPermissions only, requestPermissions stays in enable().
    const hook = btn.slice(btn.indexOf("const recheck"), btn.indexOf("async function enable"));
    expect(hook).toContain("checkPermissions()");
    expect(hook).not.toContain("requestPermissions");
  });

  it("switching push OFF on purpose ends it — sign-out does not", () => {
    const btn = read("src/components/EnablePushButton.tsx");
    expect((btn.match(/turnedOffOnPurpose\(\);/g) ?? []).length).toBe(2); // native + web
    expect(read("src/lib/push-device.ts")).not.toMatch(/stopAsk|push\/ask/);
    // …and one person's "no" is never written where the next person on a
    // shared phone would inherit it.
    expect(read("src/lib/push-ask-client.ts")).not.toMatch(/localStorage\.setItem/);
  });

  it("turning push on anywhere retires every ask on screen", () => {
    expect(read("src/components/EnablePushButton.tsx")).toMatch(/if \(ok\) \{ setForcedOff\(false\); onDone\?\.\(\); notePushOn\(\); \}/);
  });

  it("the dashboard box respects the account too, and 'Not now' there rests the reminders", () => {
    const nudge = read("src/components/PushNudge.tsx");
    expect(nudge).toMatch(/setAccount\(j\.pushOn \|\| j\.stopped \|\| quiet \? "done" : "ask"\)/);
    expect(nudge).toMatch(/onClick=\{\(\) => \{ dismiss\(\); snoozeAsk\(\); \}\}/);
    expect(nudge).toContain("<EnablePushButton onDone={dismiss} />");
  });

  it("the bell's reminder is a sibling of the row, so a tap on the switch can never open the contact", () => {
    const bell = read("src/components/NotificationBell.tsx");
    const rowEnd = bell.indexOf("{n.id === askId && <PushAskCallout");
    const clickable = bell.lastIndexOf("onClick={CONTACT_TYPES.has(n.type)", rowEnd);
    const closeRow = bell.lastIndexOf("</div>", rowEnd);
    expect(rowEnd).toBeGreaterThan(-1);
    expect(clickable).toBeGreaterThan(-1);
    expect(closeRow).toBeGreaterThan(clickable);
  });
});
