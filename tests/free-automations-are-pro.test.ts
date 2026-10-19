import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── TEXT follow-ups are Pro; EMAIL follow-ups are every plan ─────────────────
//
// Owner, 2026-09-11, revising the same day's earlier "only pro can do follow-up
// automations": "for the free account we'll give free users access to the email
// automation but text automation will only be for the pro account."
//
// Three places have to agree, or a contact ends up with a flow that looks live
// and never fires: the panel (which channel is tagged), the API (what may be
// stored), and the daily sender (what actually goes out). A fourth — the draft
// generator — decides who WRITES the copy, which is the other half of what Pro
// buys on email: a paid account's steps are composed by AI from the contact's
// notes, a Free account gets editable starter copy and no AI call is made.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const contacts = read("src/components/ContactsClient.tsx");
const route = read("src/app/api/leads/[id]/route.ts");

describe("the app", () => {
  it("marks ONLY the text channel PRO, and small", () => {
    // The gate reads the channel now: an email card on a Free account carries
    // no tag and opens the setup flow like any paid account's.
    expect(contacts).toMatch(/const needsPro = !isPro && ch === "sms" && !hasActive;/);
  });

  it("keeps the badge small where it does appear", () => {
    // 0.5rem is the same tag the card finishes use — the smallest in the
    // product, and deliberately not a banner.
    expect(contacts).toMatch(/needsPro && <span className="text-\[0\.5rem\] font-bold text-blue-400 shrink-0">PRO<\/span>/);
    // Both cards still exist; only the text one can be tagged.
    expect(contacts).toMatch(/ch: "email" as const, label: "Email"/);
    expect(contacts).toMatch(/ch: "sms" as const,\s+label: "Text"/);
  });

  it("tells them email is included when they tap the text switch", () => {
    expect(contacts).toMatch(/Text follow-ups are part of Pro\. Email follow-ups are included on your plan/);
  });

  it("does not claim a Free email draft was written by AI", () => {
    // No "AI draft" tag over starter copy, and no Regenerate button that would
    // redraw the identical text.
    expect(contacts).toMatch(/\{draftIsAi && <AiDraftTag \/>\}/);
    expect(contacts).toMatch(/draftIsAi\s*\?\s*<button onClick=\{\(\) => draftPreset && selectPreset\(draftPreset\)\}/);
    expect(contacts).toMatch(/setDraftIsAi\(data\.aiWritten !== false\)/);
  });

  it("explains only when they tap the switch — nothing pops up uninvited", () => {
    const onClick = contacts.slice(contacts.indexOf("if (needsPro) {"), contacts.indexOf("if (isDrafting) cancelDraft()"));
    expect(onClick).toMatch(/setAiUpgrade\(/);
    expect(onClick).toMatch(/return;/);
  });

  it("never blocks switching an existing automation OFF", () => {
    // A downgraded account has to be able to stop the text flow it already
    // has: `!hasActive` keeps the gate off any card with steps on it.
    expect(contacts).toMatch(/const needsPro = !isPro && ch === "sms" && !hasActive;/);
    // `locked` (missing contact details) never blocks a running flow either.
    expect(contacts).toMatch(/const locked = !can && !running;/);
    const onClick = contacts.slice(contacts.indexOf("if (locked) return;"), contacts.indexOf("if (needsPro) {"));
    expect(onClick).toMatch(/if \(running\) \{ toggleChannelPause\(ch\); return; \}/);
  });

  it("takes the plan from the server, not from a guess in the browser", () => {
    expect(read("src/app/contacts/page.tsx")).toMatch(/isPro=\{paid\}/);
    expect(contacts).toMatch(/isPro = false,/);
  });
});

describe("the server", () => {
  it("refuses to store a TEXT step for a Free account", () => {
    const block = route.slice(route.indexOf('if ("follow_up_sequence" in body)'), route.indexOf("// `tags` is server-owned"));
    expect(block).toMatch(/const addingSms = steps\.some\(\(s\) => s\?\.channel === "sms"\)/);
    expect(block).toMatch(/isPaidPlan\(prof\?\.plan as string \| null\)/);
    expect(block).toMatch(/status: 402/);
    expect(block).toMatch(/code: "PRO_REQUIRED"/);
  });

  it("stores an EMAIL-only sequence on any plan", () => {
    // The gate keys on an sms step being present, so an email-only array never
    // reaches the plan lookup at all.
    const block = route.slice(route.indexOf('if ("follow_up_sequence" in body)'), route.indexOf("// `tags` is server-owned"));
    expect(block).toMatch(/if \(addingSms\) \{/);
  });

  it("the draft generator refuses TEXT on Free and allows EMAIL", () => {
    const gen = read("src/app/api/leads/[id]/generate-sequence/route.ts");
    expect(gen).toMatch(/if \(isText && !paid\) \{/);
    expect(gen).toMatch(/Text follow-ups are a Pro feature\. Email follow-ups are included on every plan\./);
    // And a Free account never reaches the AI provider: cost, not capability.
    expect(gen).toMatch(/if \(paid\) \{\s*\n\s*try \{\s*\n\s*raw = \(await aiComplete/);
    expect(gen).toMatch(/aiWritten: paid/);
  });

  it("still lets anyone CLEAR one", () => {
    const block = route.slice(route.indexOf('if ("follow_up_sequence" in body)'), route.indexOf("// `tags` is server-owned"));
    // An empty array has no sms step in it, so Reset ↺ and the dissolve path
    // never reach the plan check at all.
    expect(block).toMatch(/const steps = Array\.isArray\(next\) \? \(next as \{ channel\?: string \}\[\]\) : \[\];/);
    expect(block).toMatch(/if \(addingSms\) \{/);
  });

  it("the sender holds TEXT steps on Free and keeps EMAIL flowing", () => {
    const reminders = read("src/app/api/reminders/route.ts");
    // The plan check sits INSIDE the sms branch now, not above the whole lead.
    const smsBranch = reminders.slice(reminders.indexOf('if (itemChannel === "sms") {'));
    expect(smsBranch.slice(0, 1200)).toMatch(/if \(!ownerPaid\) \{/);
    expect(smsBranch.slice(0, 1200)).toMatch(/type: "sequence_paused"/);
    // Nothing stops the lead before the loop any more.
    const beforeLoop = reminders.slice(reminders.indexOf("const ownerPaid ="), reminders.indexOf("for (const item of seq)"));
    expect(beforeLoop).not.toMatch(/continue;\s*\n\s*\}\s*\n\s*\n\s*\/\/ Back on a paid plan/);
  });

  it("a held text is left unsent, so it resumes on upgrade — never deleted", () => {
    const reminders = read("src/app/api/reminders/route.ts");
    const smsBranch = reminders.slice(reminders.indexOf('if (itemChannel === "sms") {'), reminders.indexOf("const asEmail"));
    // `continue` skips the step without stamping sent_at.
    expect(smsBranch).toMatch(/continue;/);
    expect(smsBranch).not.toMatch(/stampStep/);
    expect(reminders).toMatch(/nothing has been deleted/i);
  });

  it("does not tell an email-only Free account that anything is paused", () => {
    // The notice is written inside the sms branch, so a flow with no text steps
    // never triggers it.
    const reminders = read("src/app/api/reminders/route.ts");
    const notice = reminders.indexOf('title: "Text follow-ups are paused"');
    const smsStart = reminders.indexOf('if (itemChannel === "sms") {');
    expect(notice).toBeGreaterThan(smsStart);
  });
});
