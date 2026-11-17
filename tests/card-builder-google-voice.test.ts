import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_GV_DAILY_CAP, GV_LIMIT_NOTE, googleVoiceHref, googleVoiceQueue, googleVoiceSent, gvSentToday, isSendWith, mainSendButton, numberBlocks, sendWithFor,
} from "@/lib/prospect-preview/google-voice";
import { DEFAULT_SENDER, readSenderSettings } from "@/lib/prospect-preview/send-window";
import { parseBatchForm } from "@/lib/prospect-preview/batch-input";
import { channelOf, openerResults, openerStats, type MessageEvent } from "@/lib/prospect-preview/learn";
import { tallyText } from "@/app/admin/card-builder/approve/ApproveView";
import type { PreviewListRow } from "@/lib/prospect-preview/types";

// ── Card Builder: Google Voice as a second way to send openers (owner, 2026-11-17) ─
// "I send every Google Voice text myself with one tap, the same way the
// LinkedIn button works. Don't automate Google Voice in any way."

const code = (f: string) => readFileSync(f, "utf8");
const NOW = Date.parse("2026-11-17T17:00:00Z"); // noon in New York

const row = (over: Partial<PreviewListRow> & { send_with?: "imessage" | "google_voice" | null } = {}): PreviewListRow => ({
  id: "p1", created_at: "2026-11-16T15:00:00Z", updated_at: "2026-11-16T15:00:00Z", expires_at: "2026-11-30T15:00:00Z", status: "live",
  slug: "harbor-k3x9qa", office_name: "Harbor Realty", owner_name: "Dana Whitfield", owner_title: null, phone: "(516) 555-0101", email: "dana@harbor.example",
  logo_url: null, headshot_url: null, address: null, website: null, social_links: {}, specialty: null, brand_primary: "#000000", brand_secondary: "#FFFFFF",
  team_members: [], sources: {}, buyer_role: null, buyer_reason: null, team_size: null, detail: null, license: null, type_feel: null, current_tool: null,
  specifics: [], hook_specific: null, hook_angle: null, hook_why: null, quality_override: false, quality_override_at: null, call_outcome: null, call_outcome_at: null,
  called: false, called_at: null, notes: null, asked_at: null, sent_at: null, sent_channel: null, stage: null, crew_lead_id: null,
  views: 0, last_viewed_at: null, team_strip_scrolled: false, devices: 0, batch_id: null, phone_kind: "mobile", not_imessage_at: null,
  ...over,
} as PreviewListRow);

describe("the link the button opens", () => {
  it("opens Google Voice's messages view on their number, in +1 form, encoded", () => {
    expect(googleVoiceHref("(516) 555-0101")).toBe("https://voice.google.com/u/0/messages?itemId=t.%2B15165550101");
    expect(googleVoiceHref("+1 516 555 0101")).toBe("https://voice.google.com/u/0/messages?itemId=t.%2B15165550101");
  });
  it("a number it can't read still opens Google Voice's messages, never a made-up thread", () => {
    expect(googleVoiceHref("ext 12")).toBe("https://voice.google.com/u/0/messages");
  });
});

describe("which way an opener goes", () => {
  const gvBatch = new Map([["b-gv", "google_voice" as const]]);
  it("the prospect's own choice beats the batch's, and iMessage is the default", () => {
    expect(sendWithFor(row(), gvBatch)).toBe("imessage");
    expect(sendWithFor(row({ batch_id: "b-gv" }), gvBatch)).toBe("google_voice");
    expect(sendWithFor(row({ batch_id: "b-gv", send_with: "imessage" }), gvBatch)).toBe("imessage");
    expect(sendWithFor(row({ send_with: "google_voice" }), new Map())).toBe("google_voice");
    expect(isSendWith("google_voice") && isSendWith("imessage") && !isSendWith("sms")).toBe(true);
  });
  it("a number off iMessage leads with Google Voice; an office line gets neither", () => {
    expect(mainSendButton(row({ not_imessage_at: "2026-11-16T15:00:00Z" }), new Map())).toBe("google_voice");
    expect(mainSendButton(row({ phone_kind: "office", batch_id: "b-gv" }), gvBatch)).toBe("none");
    expect(mainSendButton(row({ phone_kind: "office", not_imessage_at: "2026-11-16T15:00:00Z" }), new Map())).toBe("none");
    expect(mainSendButton(row(), new Map())).toBe("imessage");
  });
});

describe("one text per number, both ways", () => {
  const dana = row({ id: "p1" });
  it("do-not-contact by number, by email and by the email's domain", () => {
    expect(numberBlocks([dana], { all: [dana], outbox: [], dnc: new Set(["tel:+15165550101"]) }).get("p1")).toBe("do_not_contact");
    expect(numberBlocks([dana], { all: [dana], outbox: [], dnc: new Set(["dana@harbor.example"]) }).get("p1")).toBe("do_not_contact");
    expect(numberBlocks([dana], { all: [dana], outbox: [], dnc: new Set(["@harbor.example"]) }).get("p1")).toBe("do_not_contact");
  });
  it("a number the Mac texted, or that may have gone, is never offered again", () => {
    for (const o of [{ status: "sent", error: null }, { status: "sending", error: null }, { status: "failed", error: "interrupted while sending: it may have gone" }]) {
      expect(numberBlocks([dana], { all: [dana], outbox: [{ phone: "+15165550101", preview_id: "p9", ...o }], dnc: new Set() }).get("p1")).toBe("texted");
    }
    // A plain failure (not on iMessage, canceled) doesn't block it.
    expect(numberBlocks([dana], { all: [dana], outbox: [{ phone: "+15165550101", preview_id: "p1", status: "not_imessage", error: null }], dnc: new Set() }).has("p1")).toBe(false);
  });
  it("the same number on another card that already went (from Google Voice or anywhere) counts", () => {
    const twin = row({ id: "p2", phone: "516.555.0101", sent_at: "2026-11-16T15:00:00Z", sent_channel: "google_voice" });
    expect(numberBlocks([dana], { all: [dana, twin], outbox: [], dnc: new Set() }).get("p1")).toBe("texted");
  });
  it("waiting on the Mac keeps it off the Google Voice list", () => {
    expect(numberBlocks([dana], { all: [dana], outbox: [{ phone: "+15165550101", preview_id: "p1", status: "scheduled", error: null }], dnc: new Set() }).get("p1")).toBe("with_mac");
  });
});

describe("the Send from Google Voice list", () => {
  const opener = { candidates: [{ text: "Saw your open house on Hicks St, made you a card for it", hook: "listing", scores: { specificity: 9, human: 9, curiosity: 8 } }], pick: 0, alt: null, edited: null } as unknown as PreviewListRow["openers"];
  const gvBatch = new Map([["b-gv", "google_voice" as const]]);
  const ctx = (blocks = new Map()) => ({ batchSendWith: gvBatch, blocks, now: NOW, hasOpener: (r: PreviewListRow) => !!r.openers });
  const rows = [
    row({ id: "gv-old", batch_id: "b-gv", openers: opener, updated_at: "2026-11-15T15:00:00Z" }),
    row({ id: "gv-new", batch_id: "b-gv", openers: opener, updated_at: "2026-11-16T15:00:00Z" }),
    row({ id: "imsg", openers: opener }),
    row({ id: "switched", openers: opener, send_with: "google_voice" }),
    row({ id: "draft", batch_id: "b-gv", openers: opener, status: "draft" }),
    row({ id: "sent", batch_id: "b-gv", openers: opener, sent_at: "2026-11-16T15:00:00Z", sent_channel: "google_voice" }),
    row({ id: "office", batch_id: "b-gv", openers: opener, phone_kind: "office" }),
    row({ id: "no-opener", batch_id: "b-gv" }),
    row({ id: "expired", batch_id: "b-gv", openers: opener, expires_at: "2026-11-16T15:00:00Z" }),
  ];
  it("approved, unsent, Google Voice, with an opener and a textable number; oldest first", () => {
    expect(googleVoiceQueue(rows, ctx()).map((r) => r.id)).toEqual(["gv-old", "gv-new", "switched"]);
  });
  it("a blocked number never shows", () => {
    expect(googleVoiceQueue(rows, ctx(new Map([["gv-old", "with_mac"], ["gv-new", "do_not_contact"]]))).map((r) => r.id)).toEqual(["switched"]);
  });
  it("what went from Google Voice in the last 14 days, newest first, for They said stop", () => {
    const sent = [
      row({ id: "a", sent_at: "2026-11-17T14:00:00Z", sent_channel: "google_voice" }),
      row({ id: "b", sent_at: "2026-11-16T14:00:00Z", sent_channel: "google_voice" }),
      row({ id: "c", sent_at: "2026-11-01T14:00:00Z", sent_channel: "google_voice" }),
      row({ id: "d", sent_at: "2026-11-17T14:00:00Z", sent_channel: "text" }),
    ];
    expect(googleVoiceSent(sent, NOW).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("the daily count and cap", () => {
  it("counts today's Google Voice sends in New York time", () => {
    const rows = [
      row({ sent_at: "2026-11-17T14:00:00Z", sent_channel: "google_voice" }),
      row({ sent_at: "2026-11-17T04:30:00Z", sent_channel: "google_voice" }), // 11:30pm on the 16th in New York
      row({ sent_at: "2026-11-17T14:00:00Z", sent_channel: "text" }),
    ];
    expect(gvSentToday(rows, "America/New_York", new Date(NOW))).toBe(1);
  });
  it("defaults to 20, is changed in the sender settings, and is clamped", () => {
    expect(DEFAULT_GV_DAILY_CAP).toBe(20);
    expect(DEFAULT_SENDER.gv_daily_cap).toBe(20);
    expect(readSenderSettings(null).gv_daily_cap).toBe(20);
    expect(readSenderSettings({ gv_daily_cap: "12" }).gv_daily_cap).toBe(12);
    expect(readSenderSettings({ gv_daily_cap: "900" }).gv_daily_cap).toBe(100);
    expect(code("src/app/api/admin/card-builder/sender/route.ts")).toContain('gv_daily_cap: form.get("gv_daily_cap")');
    expect(code("src/app/admin/card-builder/sender/SenderView.tsx")).toContain('name="gv_daily_cap"');
  });
  it("the list says Google can restrict a personal number that texts many new people", () => {
    expect(GV_LIMIT_NOTE).toMatch(/Google can restrict a personal Google Voice number/);
    expect(code("src/app/admin/card-builder/google-voice/GoogleVoiceView.tsx")).toContain("{GV_LIMIT_NOTE}");
  });
});

describe("per batch: Send with", () => {
  const form = (v: Record<string, string>) => (k: string) => v[k] ?? null;
  it("iMessage unless Google Voice is picked", () => {
    expect(parseBatchForm(form({ target: "realtors in Great Neck", count: "10" }), null)).toMatchObject({ ok: true, value: { sendWith: "imessage" } });
    expect(parseBatchForm(form({ target: "realtors in Great Neck", count: "10", send_with: "google_voice" }), null)).toMatchObject({ ok: true, value: { sendWith: "google_voice" } });
    expect(parseBatchForm(form({ target: "realtors in Great Neck", count: "10", send_with: "carrier pigeon" }), null)).toMatchObject({ ok: true, value: { sendWith: "imessage" } });
  });
  it("the form offers both, and the batch is saved with it", () => {
    const view = code("src/app/admin/card-builder/batch/BatchView.tsx");
    expect(view).toContain('name="send_with" value="imessage"');
    expect(view).toContain('name="send_with" value="google_voice"');
    expect(code("src/lib/prospect-preview/desk.ts")).toMatch(/send_with: "google_voice"/);
  });
  it("a Google Voice prospect never goes into the Mac's outbox", () => {
    const outbox = code("src/lib/prospect-preview/outbox.ts");
    expect(outbox).toMatch(/if \(\(await sendWithOf\(p\)\) === "google_voice"\) return "google_voice";/);
    expect(outbox).toMatch(/if \(p\.sent_at\) return "already";/);
    expect(tallyText("queued:2,google_voice:3")).toBe("2 published and queued for your Mac. 3 published and waiting in your Google Voice list.");
  });
});

describe("recording the channel", () => {
  it("the tap records sent, opener, google_voice, the way the LinkedIn button records its note", () => {
    const btn = code("src/app/admin/card-builder/GoogleVoiceButton.tsx");
    expect(btn).toContain('JSON.stringify({ action: "sent", kind, channel: "google_voice", words })');
    expect(btn).toContain("navigator.clipboard?.writeText(words)");
    expect(btn).toContain('target="_blank"');
    expect(btn).toContain('children = "Send from Google Voice"');
    expect(btn).toContain('"Copied. Paste and send in Google Voice"');
  });
  it("the route stores sent_channel google_voice and takes back anything the Mac had for that number", () => {
    const route = code("src/app/api/admin/card-builder/[id]/route.ts");
    expect(route).toContain('const channel = input.channel === "google_voice" ? "google_voice" : null;');
    expect(route).toContain("markSent(id, kind, new Date(), channel)");
    expect(route).toMatch(/cancelQueuedFor\(nanp\(p\.phone\), channel === "google_voice" \? "texted from Google Voice"/);
    expect(code("src/lib/prospect-preview/store.ts")).toMatch(/channel === "google_voice" \? "google_voice" : "text"/);
  });
  it("open rates split by channel; old rows without one are texts", () => {
    expect(channelOf({ message: "opener", channel: null })).toBe("text");
    expect(channelOf({ message: "opener", channel: "google_voice" })).toBe("google_voice");
    expect(channelOf({ message: "email", channel: undefined })).toBe("email");
    const events: MessageEvent[] = [
      { at: "2026-11-16T15:00:00Z", preview_id: "a", kind: "sent", message: "opener", variant: "listing", before: null, after: null, channel: "google_voice" },
      { at: "2026-11-16T15:00:00Z", preview_id: "b", kind: "sent", message: "opener", variant: "listing", before: null, after: null },
    ];
    const rows = [row({ id: "a", last_viewed_at: "2026-11-16T16:00:00Z", views: 1 }), row({ id: "b" })];
    const stats = openerStats(events, rows, new Map());
    expect(stats.byChannel).toEqual([{ key: "google_voice", sent: 1, opened: 1 }, { key: "text", sent: 1, opened: 0 }]);
    expect(openerResults(stats).by_channel.map((r) => r.label)).toEqual(["Google Voice", "iMessage or text"]);
  });
});

describe("They said stop", () => {
  it("puts the number on the do-not-contact list and cancels what is queued for it", () => {
    const outbox = code("src/lib/prospect-preview/outbox.ts");
    expect(outbox).toMatch(/from\("crew_suppression"\)\.upsert\(\{ value: suppressionKey\(e164\)/);
    expect(outbox).toMatch(/await cancelQueuedFor\(e164, "they asked not to be texted"\);/);
    expect(outbox).toMatch(/\.in\("status", \["scheduled", "queued"\]\)/);
    const route = code("src/app/api/admin/card-builder/[id]/route.ts");
    expect(route).toMatch(/case "stop": \{[\s\S]*?suppressNumber\(e164,/);
  });
  it("is on the Google Voice list and the Call screen", () => {
    expect(code("src/app/admin/card-builder/google-voice/GoogleVoiceView.tsx")).toContain(">They said stop</button>");
    expect(code("src/app/admin/card-builder/call/[id]/CallView.tsx")).toContain(">They said stop</button>");
  });
});

describe("never automated", () => {
  it("nothing in Card Builder drives, scrapes or calls Google Voice: it only links to it", () => {
    const files = [
      "src/lib/prospect-preview/google-voice.ts", "src/app/admin/card-builder/GoogleVoiceButton.tsx", "src/app/admin/card-builder/google-voice/GoogleVoiceView.tsx",
      "src/app/admin/card-builder/google-voice/page.tsx", "src/lib/prospect-preview/outbox.ts", "src/app/api/admin/card-builder/[id]/route.ts", "scripts/card-builder-mac/agent.mjs",
    ];
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toMatch(/playwright|puppeteer|selenium|osascript[^\n]*voice|fetch\([^)]*voice\.google|googlevoice:\/\/|gvoice-api|pygooglevoice/i);
    }
    // The only voice.google.com in the app is the link the owner taps.
    expect(code("src/lib/prospect-preview/google-voice.ts").match(/voice\.google\.com/g)?.length).toBe(2);
  });
});

describe("the SQL", () => {
  const sql = code("supabase/card-builder-google-voice.sql").replace(/--.*$/gm, "");
  it("is additive: widens sent_channel, adds send_with twice and the event's channel", () => {
    expect(sql).not.toMatch(/\b(delete from|update |truncate|drop table|drop column)\b/i);
    expect(sql).toMatch(/sent_channel in \('text', 'email', 'google_voice'\)/);
    expect(sql).toMatch(/prospect_previews add column if not exists send_with text;/);
    expect(sql).toMatch(/prospect_batches add column if not exists send_with text not null default 'imessage';/);
    expect(sql).toMatch(/prospect_message_events add column if not exists channel text;/);
  });
});
