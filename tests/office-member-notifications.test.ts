import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPaidPlan } from "@/lib/plan";
import { redactForPlan } from "@/lib/notification-privacy";
import { cardEventNotice } from "@/lib/card-event-notify";
import { stripLocationMarks, teaseLocation } from "@/lib/location-privacy";
import { hideForReader, brandChangeNotice, brandContentChanged, ORDINARY_READER } from "@/lib/office-account-notifications";
import { officeAccessEndedMessage, officeRemovedMessage } from "@/lib/office-billing-sync";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── An Office team member's own notifications (2026-09-23 audit) ────────────
// Owner: location is unlocked on Office, so "viewed in New York" must say New
// York; a member never gets Free, Pro or admin notifications; office news about
// their card is clear and correct.

describe("a team member sees the place a view came from", () => {
  it("their plan counts as paid, so the bell hands them the real place", () => {
    expect(isPaidPlan("enterprise")).toBe(true);
    const notice = cardEventNotice({ eventType: "viewed_card", surface: "links", location: "New York, NY", geoAccuracy: "city" });
    expect(notice).toBeTruthy();
    const [row] = redactForPlan([{ type: notice!.type, title: notice!.title, body: notice!.body }], isPaidPlan("enterprise"));
    expect(row.body).toContain("New York");
    expect(row.body).not.toMatch(/▒|█/);
  });
  it("and the same sentence on their lock screen keeps the place (push only teases it for Free)", () => {
    const notice = cardEventNotice({ eventType: "viewed_card", surface: "card", location: "New York, NY", geoAccuracy: "city" })!;
    expect(stripLocationMarks(notice.body)).toContain("New York");
    expect(teaseLocation(notice.body)).not.toContain("New York"); // what a Free phone would get instead
    expect(code("src/lib/push.ts")).toContain("const paid = isPaidPlan(plan);");
  });
});

describe("a team member is never shown notifications meant for someone else", () => {
  const rows = [
    { type: "card_viewed" },
    { type: "referral_progress" },
    { type: "referral_claim" },
    { type: "payment_failed" },
    { type: "personal_sub_reminder" },
    { type: "new_lead" },
  ];
  it("referral pitches are hidden from every Office account, owner included", () => {
    const owner = hideForReader(rows, { officeAccount: true, teamMember: false, ownSubscription: true }).map((r) => r.type);
    expect(owner).not.toContain("referral_progress");
    expect(owner).not.toContain("referral_claim");
    expect(owner).toContain("payment_failed"); // the owner pays — billing news is theirs
  });
  it("billing rows are hidden from a member with nothing of their own to pay for", () => {
    const m = hideForReader(rows, { officeAccount: true, teamMember: true, ownSubscription: false }).map((r) => r.type);
    expect(m).toEqual(["card_viewed", "new_lead"]);
  });
  it("…but kept for a member still paying for their own Pro (Stripe or Apple)", () => {
    const m = hideForReader(rows, { officeAccount: true, teamMember: true, ownSubscription: true }).map((r) => r.type);
    expect(m).toEqual(["card_viewed", "payment_failed", "personal_sub_reminder", "new_lead"]);
  });
  it("an ordinary account is untouched", () => {
    expect(hideForReader(rows, ORDINARY_READER)).toEqual(rows);
  });
  it("both lists apply it: the notifications API and the dashboard", () => {
    // The two reads are resolved together (they hit the same profiles row and
    // neither needs the other), then applied in the SAME order as before:
    // hideForReader first, redactForPlan second. Both sources are pinned here,
    // so removing either filter — or flipping the order — still fails.
    const api = code("src/app/api/notifications/route.ts");
    expect(api).toMatch(/notificationReader\(user\.id\)/);
    expect(api).toMatch(/isPaidUser\(user\.id\)/);
    const filtered = api.indexOf("data = hideForReader(data ?? [], reader);");
    expect(filtered).toBeGreaterThan(-1);
    expect(api.indexOf("return NextResponse.json(redactForPlan(data ?? [], paid));")).toBeGreaterThan(filtered);
    const dash = code("src/app/dashboard/page.tsx");
    for (const list of ["panelNotifications", "bellNotifications"]) {
      const hide = dash.indexOf(`${list} = hideForReader(${list} ?? [], notifReader);`);
      expect(hide).toBeGreaterThan(-1);
      expect(dash.indexOf(`${list} = redactForPlan(${list} ?? [], isPro);`)).toBeGreaterThan(hide);
    }
  });
  it("and no new referral pitch is written for an Office account at all", () => {
    const s = code("src/lib/referral-server.ts");
    const fn = s.slice(s.indexOf("async function notifyReferrerOfSignup"));
    const stop = fn.indexOf('if (acct?.plan === "enterprise") return;');
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(fn.indexOf("await insertNotification("));
  });
});

describe("office news about their card is clear and correct", () => {
  it("joining tells them what being on a team means — once, bell only", () => {
    const s = code("src/app/api/join/route.ts");
    const at = s.indexOf('type: "office_joined"');
    expect(at).toBeGreaterThan(-1);
    expect(s.slice(s.lastIndexOf("if (didActivate) {", at), at)).toContain("insertNotification({");
    expect(s).not.toMatch(/sendPushToUser\([^)]*office_joined/);
  });

  it("switching 'keep every card matching' ON says their design is now the company's", () => {
    const n = brandChangeNotice({ cardLock: [false, true], linkLock: [false, false], contentChanged: true })!;
    expect(n.title).toBe("Your company now sets your card's design");
    expect(n.body).toContain("Card design is managed for you now");
  });
  it("switching it OFF says they can style their card again", () => {
    const n = brandChangeNotice({ cardLock: [true, false], linkLock: [false, false], contentChanged: false })!;
    expect(n.title).toBe("You can style your card yourself");
    expect(n.body).toContain("unlocked Card design");
  });
  it("both locks on at once is one line, not two", () => {
    const n = brandChangeNotice({ cardLock: [false, true], linkLock: [false, true], contentChanged: false })!;
    expect(n.body).toContain("Card design and Social design are managed for you now");
  });
  it("a plain brand update says so; a save that changed nothing says nothing", () => {
    expect(brandChangeNotice({ cardLock: [true, true], linkLock: [false, false], contentChanged: true })!.title).toBe("Your company updated your card");
    expect(brandChangeNotice({ cardLock: [true, true], linkLock: [false, false], contentChanged: false })).toBeNull();
  });
  it("a look change while unlocked reaches no member card, so it is not news", () => {
    const before = { brand_design: { accentColor: "#111" }, brand_company: "Meridian" };
    const after = { brand_design: { accentColor: "#222" }, brand_company: "Meridian" };
    expect(brandContentChanged(before, after, { card: false, link: false })).toBe(false);
    expect(brandContentChanged(before, after, { card: true, link: false })).toBe(true);
    expect(brandContentChanged(before, { ...before, brand_phone: "(212) 555-0100" }, { card: false, link: false })).toBe(true);
  });
  it("the Branding save tells members after the response, replaces their unread one, and skips whoever saved", () => {
    const s = code("src/app/api/office/brand/route.ts");
    expect(s).toContain("const toTell = verifiedInOffice.filter((id) => id !== user.id);");
    const block = s.slice(s.indexOf("after(async () => {"));
    const del = block.indexOf('.delete().eq("user_id", uid).eq("type", BRAND_NOTICE_TYPE).eq("read", false)');
    expect(del).toBeGreaterThan(-1);
    // Tagged with the member's office card since 2026-09-24 (isolation audit).
    expect(block.search(/await insertNotification\(\{\s*user_id: uid, type: BRAND_NOTICE_TYPE/)).toBeGreaterThan(del);
    expect(block.slice(0, block.indexOf("await writeAudit"))).not.toContain("sendPushToUser");
  });

  it("losing the team says what happened to their card, not only their plan", () => {
    for (const f of ["pro", "free"] as const) {
      expect(officeAccessEndedMessage(f)).toContain("The company branding came off your card");
      expect(officeAccessEndedMessage(f)).toContain("Settings → Cards and sharing");
    }
    expect(officeRemovedMessage("free")).toContain("turn it back on any time in Settings → Cards and sharing");
  });
});
