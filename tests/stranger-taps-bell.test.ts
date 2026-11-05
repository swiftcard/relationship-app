import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  tapName, tapAction, tapPhrase, tapNames, tapSentence, withTapSentence, joinNames,
} from "@/lib/visit-taps";
import { TAPS_MARK, stripLocationMarks, resolveTaps, teaseLocation, markPhrase, markPlace, markDetail } from "@/lib/location-privacy";
import { redactForPlan } from "@/lib/notification-privacy";
import { visitKeyBucket, visitKeys } from "@/lib/visit-notify";

// ── Owner, 2026-11-05 ────────────────────────────────────────────────────────
// "If they tap on an additional link or my Instagram or something like that,
// only if I have them as a contact will it save in the activity and messages.
// If not it will just tell me in my notification center."
//
// Until now a stranger's tap reached NOTHING the owner reads: no bell row, no
// push, only Pro's Recent visits. Now the visit's one bell row says what they
// tapped — never a second row, never a second buzz — and which link is a Pro
// detail: Free reads "They tapped a link."

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a tap is called the same thing everywhere", () => {
  it("names a link by its own label, else its host", () => {
    expect(tapName({ target: "instagram.com", target_label: "Instagram" })).toBe("Instagram");
    expect(tapName({ target: "calendly.com", target_label: null })).toBe("calendly.com");
    expect(tapName({ target: null, target_label: null })).toBeNull();
  });

  it("names a phone, email or text tap as the button, never the number", () => {
    expect(tapName({ target: "phone", target_label: "Phone" })).toBe("phone number");
    expect(tapName({ target: "email", target_label: "Email" })).toBe("email");
    expect(tapName({ target: "text", target_label: "Text" })).toBe("Text button");
    expect(tapAction({ target: "phone" })).toBe("Tapped your phone number");
    expect(tapAction({ target: "instagram.com", target_label: "Instagram" })).toBe("Tapped Instagram");
    expect(tapPhrase({ target: "email" })).toBe("tapped your email");
    expect(tapPhrase({ target: "zillow.com", target_label: "Listings" })).toBe("tapped your Listings link");
    expect(tapPhrase({}, "the")).toBe("tapped one of the links");
  });

  it("lists each thing once, in the order it was tapped", () => {
    expect(tapNames([
      { target: "instagram.com", target_label: "Instagram" },
      { target: "phone" },
      { target: "instagram.com", target_label: "Instagram" },
    ])).toEqual(["Instagram", "phone number"]);
    expect(joinNames(["a"])).toBe("a");
    expect(joinNames(["a", "b"])).toBe("a and b");
    expect(joinNames(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("the bell's tap sentence: which link is Pro, that they tapped is everyone's", () => {
  const sentence = tapSentence(["Instagram", "Website"]);

  it("Pro reads the names, Free reads how many", () => {
    expect(resolveTaps(sentence, true)).toBe(" They tapped your Instagram and Website.");
    expect(resolveTaps(sentence, false)).toBe(" They tapped 2 links.");
    expect(resolveTaps(tapSentence(["Instagram"]), false)).toBe(" They tapped a link.");
    expect(tapSentence([])).toBe("");
  });

  it("sits after the first sentence, so a milestone's count and tip stay after it", () => {
    const body = `Someone${markDetail(" on the Columbia University network")} viewed your card${markPhrase(` near ${markPlace("Austin, TX")}`)}. That's 50 views across your card and Swift Links. Share it today.`;
    const out = withTapSentence(body, sentence);
    expect(stripLocationMarks(out)).toBe(
      "Someone on the Columbia University network viewed your card near Austin, TX. They tapped your Instagram and Website. That's 50 views across your card and Swift Links. Share it today.",
    );
  });

  it("a later tap replaces the sentence — never a second one", () => {
    const once = withTapSentence("Someone viewed your card.", tapSentence(["Instagram"]));
    const twice = withTapSentence(once, tapSentence(["Instagram", "phone number"]));
    expect(stripLocationMarks(twice)).toBe("Someone viewed your card. They tapped your Instagram and phone number.");
    expect(twice.split(TAPS_MARK).length).toBe(4);
  });

  it("never splits on an initial or a full stop inside a marked span", () => {
    const body = `Looks like J. Doe viewed your card${markPhrase(` near ${markPlace("St. Louis, MO")}`)}.`;
    expect(stripLocationMarks(withTapSentence(body, tapSentence(["Instagram"]))))
      .toBe("Looks like J. Doe viewed your card near St. Louis, MO. They tapped your Instagram.");
  });

  it("the plain-text and Free paths resolve it — no surface can print both halves", () => {
    const body = withTapSentence("Someone viewed your card.", sentence);
    expect(stripLocationMarks(body)).toBe("Someone viewed your card. They tapped your Instagram and Website.");
    // The Free lock screen.
    expect(teaseLocation(body)).toBe("Someone viewed your card. They tapped 2 links.");
    // The bell, both plans.
    const [paid] = redactForPlan([{ type: "card_viewed", title: "Card viewed", body }], true);
    const [free] = redactForPlan([{ type: "card_viewed", title: "Card viewed", body }], false);
    expect(paid.body).toBe("Someone viewed your card. They tapped your Instagram and Website.");
    expect(free.body).toBe("Someone viewed your card. They tapped 2 links.");
    expect(String(free.body)).not.toContain("Instagram");
  });
});

describe("the visit a tap belongs to", () => {
  it("reads the bucket back out of any visit key shape", () => {
    const { current } = visitKeys({ cardOwner: "dana", visitorId: "lead:0b6c1f9e-1111-4222-8333-944455556666", now: 1_800_000_000_000 });
    expect(visitKeyBucket(current)).toBe(Math.floor(1_800_000_000_000 / (30 * 60 * 1000)));
    expect(visitKeyBucket(`${current}#user-1`)).toBe(visitKeyBucket(current));
    expect(visitKeyBucket(visitKeys({ cardOwner: "dana", ip: "2001:db8::1", now: 1_800_000_000_000 }).current)).toBe(visitKeyBucket(current));
  });
});

describe("wiring: a stranger's tap reaches the bell and nothing else", () => {
  const route = read("src/app/api/card-events/route.ts");
  const notify = read("src/lib/visit-notify.ts");

  it("refreshes the visit's row after every event and after every tap", () => {
    expect(route).toContain("refreshVisitTaps(");
    // A tap never creates a notification of its own unless it opened the visit.
    expect(route).toMatch(/const asView = event_type === "viewed_card" \|\| \(event_type === "clicked_link" && companionView\);/);
  });

  it("the refresh never pushes and never moves the row's time", () => {
    const fn = notify.slice(notify.indexOf("export async function refreshVisitTaps"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).not.toMatch(/sendPushToUser|push\(/);
    expect(body).not.toMatch(/created_at:/);
    expect(body).toContain(".update({ body: after, read: false })");
  });

  it("bell rows open the right place: a contact opens them, a stranger opens Recent visits", () => {
    const bell = read("src/components/NotificationBell.tsx");
    expect(bell).toContain("#recent-visits");
    expect(bell).toMatch(/milestone_/);
  });
});
