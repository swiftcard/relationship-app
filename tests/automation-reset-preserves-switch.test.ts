import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Reset throws away the cadence; it does not flip the switch ───────────────
//
// Reported from the field: turn the Email or Text automation OFF on a contact
// that already has one submitted, press Reset, and the channel comes back ON.
//
// resetChannel stripped the channel's own pause tag unconditionally:
//
//   const tags = (selected.tags ?? []).filter(
//     (t) => t !== "flow-paused" && t !== (ch === "email" ? "email-paused" : "sms-paused"));
//
// and for SMS it passed smsConsent:true, which makes the server grant sms-ok
// AND drop sms-paused (see updateTags). So a reset silently re-armed a channel
// the user had just switched off — the worst direction for this to fail in,
// because the next cron run then messages someone the owner had stopped.
//
// The rule: only SUBMITTING a new automation turns a channel on. submitDraft
// still clears the pause tags, deliberately, and that is left alone.

const root = process.cwd();
const ui = () => readFileSync(join(root, "src/components/ContactsClient.tsx"), "utf8");
const resetFn = () => ui().match(/async function resetChannel\([\s\S]*?\n  \}/)?.[0] ?? "";

describe("resetting an automation keeps the channel's on/off state", () => {
  it("reads the current switch before rebuilding the tags", () => {
    expect(resetFn()).toMatch(/const channelOff = channelPausedFor\(ch\);/);
  });

  it("keeps the pause tag when the channel is off", () => {
    // The tag only comes out when the channel is ON — where removing it is a
    // no-op anyway, since it is not there.
    expect(resetFn()).toMatch(/!\(t === pauseTag && !channelOff\)/);
  });

  it("no longer strips the pause tag unconditionally", () => {
    // The exact shape of the bug.
    expect(resetFn()).not.toMatch(/t !== \(ch === "email" \? "email-paused" : "sms-paused"\)/);
  });

  it("does not re-assert SMS consent for a channel that is off", () => {
    // updateTags(…, true) has the SERVER grant sms-ok and delete sms-paused,
    // so passing true here re-enabled texting regardless of the tag filtering.
    expect(resetFn()).toMatch(/const smsConsent = ch === "sms" && !channelOff \? true : undefined;/);
    expect(resetFn()).not.toMatch(/updateTags\(selected\.id, tags, ch === "sms" \? true : undefined\)/);
  });

  it("still asserts consent when SMS is on, which the cron requires", () => {
    // Losing this would leave a rebuilt text automation that can never send.
    expect(resetFn()).toMatch(/await updateTags\(selected\.id, tags, smsConsent\)/);
  });

  it("still clears the legacy master flow-paused tag either way", () => {
    // A migration leftover with no toggle of its own — nothing visible depends
    // on it, so a reset may keep tidying it up.
    expect(resetFn()).toMatch(/t !== "flow-paused"/);
  });

  it("closes the row instead of opening setup", () => {
    // Owner, 2026-10-20: switch off, press Reset, and the row sprang open with
    // its switch drawn ON — Reset ended in startDraft(ch), and an open setup
    // draws the switch on (switchOn = isDrafting || …). Reset just closes.
    expect(resetFn()).not.toMatch(/startDraft\(/);
    expect(ui()).toMatch(/const switchOn = isDrafting \|\| \(running && !chPaused\);/);
  });

  it("does not claim to have re-enabled a channel it left off", () => {
    // The old failure copy said "we couldn't re-enable texting" even when the
    // channel was meant to stay off.
    expect(resetFn()).toMatch(/fail\(channelOff/);
  });
});

describe("submitting a new automation still turns the channel on", () => {
  it("submitDraft continues to clear the pause tag", () => {
    // This is the ONE action that means "switch this on" — building and
    // submitting a cadence. Untouched by the reset fix.
    const src = ui();
    expect(src).toMatch(/const pauseTag = draftCh === "email" \? "email-paused" : "sms-paused";/);
  });
});

describe("the cron still honours whatever the switch says", () => {
  it("skips a paused channel", () => {
    // The tags are only worth preserving because the sender reads them.
    const cron = readFileSync(join(root, "src/app/api/reminders/route.ts"), "utf8");
    expect(cron).toMatch(/channel === "email" \? "email-paused" : "sms-paused"/);
    expect(cron).toMatch(/sms-ok/);
  });
});
