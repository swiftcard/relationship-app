import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { autoTextable, nanpE164 } from "@/lib/sms-number";
import { buildSmsBody, toGsm7 } from "@/lib/messaging";

// ── Scheduled texts: the ways one could go wrong after "Submit & activate" ────
//
// Audit 2026-10-18. Each of these was live: a text sent twice, a text that
// lost its sender's name, a number retried every day forever while the contact
// screen said "scheduled".

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("two runs at once cannot both send a step", () => {
  const src = read("src/app/api/reminders/route.ts");
  const stamp = src.slice(src.indexOf("async function stampStep"), src.indexOf("function notSentReason"));

  it("never claims a step that is already claimed", () => {
    expect(stamp).toMatch(/if \(sentAt && current\.sent_at\) return \{ ok: false/);
  });

  it("has the database re-check the step is unclaimed at write time", () => {
    expect(stamp).toMatch(/\.filter\("follow_up_sequence", "cs", JSON\.stringify\(\[probe\]\)\)/);
  });

  it("treats a write that matched no row as a lost claim", () => {
    expect(stamp).toMatch(/await write\.select\("id"\)/);
    expect(stamp).toMatch(/if \(!wrote\?\.length\) return \{ ok: false/);
  });
});

describe("the sender's name and the SwiftCard line survive a long message", () => {
  const long = "x".repeat(900);

  it("cuts the message, not the signature", () => {
    const body = buildSmsBody({ senderName: "Dana Reed", company: "Acme", text: long, cardUrl: "https://swiftcard.me/dana", paid: true });
    expect(body.length).toBeLessThanOrEqual(480);
    expect(body).toContain("- Dana Reed, Acme");
    expect(body).toContain("https://swiftcard.me/dana");
    expect(body.endsWith("via SwiftCard")).toBe(true);
    expect(body).toContain("...");
  });

  it("keeps the free-plan line whole too", () => {
    const body = buildSmsBody({ senderName: "Dana", text: long, paid: false });
    expect(body.length).toBeLessThanOrEqual(480);
    expect(body).toMatch(/via SwiftCard https?:\/\/\S+\/join\?src=follow_up$/);
  });

  it("leaves a normal message untouched", () => {
    const body = buildSmsBody({ senderName: "Dana", text: "Great meeting you today!", paid: true });
    expect(body).toBe("Great meeting you today!\n\n- Dana\nvia SwiftCard");
  });
});

describe("accented names keep their letters", () => {
  it("drops the accent, not the letter", () => {
    expect(toGsm7("José García — Señor Müller")).toBe("Jose Garcia - Senor Muller");
  });
});

describe("numbers a scheduled text can never reach", () => {
  it("only US and Canadian numbers the daily run reaches in daytime", () => {
    expect(autoTextable("(516) 555-0199")).toBe(true);
    expect(autoTextable("+1 416 555 0199")).toBe(true);
    expect(autoTextable("+1 808 555 0199")).toBe(true); // Hawaii: 8am at the run
    expect(autoTextable("+1 787 555 0199")).toBe(true); // Puerto Rico
    for (const bad of ["+44 20 7946 0958", "555-0199", "", null, "+1 876 555 0199"]) {
      expect(autoTextable(bad), String(bad)).toBe(false);
    }
    // Guam / N. Marianas (4am at the run) and American Samoa (7am).
    for (const outside of ["+1 671 555 0199", "+1 670 555 0199", "+1 684 555 0199"]) {
      expect(autoTextable(outside), outside).toBe(false);
      expect(nanpE164(outside), `${outside} can still be texted by hand`).not.toBeNull();
    }
  });

  it("the sender records them as not sent instead of retrying forever", () => {
    const msg = read("src/lib/messaging.ts");
    expect(msg).toMatch(/if \(opts\.automated \? !autoTextable\(lead\.phone\) : !nanpE164\(lead\.phone\)\) return \{ channel: "sms", status: "no_contact" \};/);
    const cron = read("src/app/api/reminders/route.ts");
    expect(cron).toMatch(/automated: true,/);
    expect(cron).toMatch(/"bad_number"/);
  });

  it("Twilio's final refusals are final here too", () => {
    const msg = read("src/lib/messaging.ts");
    expect(msg).toMatch(/const TWILIO_OPTED_OUT = 21610;/);
    expect(msg).toMatch(/if \(code === TWILIO_OPTED_OUT\) \{\s*[\s\S]{0,200}await addOptOut\("sms", lead\.phone\);/);
    expect(msg).toMatch(/TWILIO_NUMBER_CANNOT_TEXT\.has\(code\)\) return \{ channel: "sms", status: "no_contact" \}/);
  });

  it("the contact screen won't start one, and says why", () => {
    const ui = read("src/components/ContactsClient.tsx");
    expect(ui).toMatch(/can: autoTextable\(selected\.phone\)/);
    expect(ui).toContain("This number can't get automated texts");
    expect(ui).toContain(`it.not_sent === "bad_number"`);
    // …but a live flow can always be switched off.
    expect(ui).toMatch(/const locked = !can && !running;/);
    expect(ui).toMatch(/disabled=\{locked\}/);
  });
});

describe("a blank message can't be scheduled", () => {
  it("submit refuses an emptied step", () => {
    const ui = read("src/components/ContactsClient.tsx");
    const submit = ui.slice(ui.indexOf("async function submitDraft"));
    expect(submit.slice(0, 600)).toMatch(/draftItems\.some\(\(it\) => !it\.message\.trim\(\)\)/);
  });
});
