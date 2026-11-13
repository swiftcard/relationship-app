import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { callBrief } from "@/lib/prospect-preview/call";
import { digestDue, digestKey, digestText } from "@/lib/prospect-preview/digest";
import { parsePreviewFields, readSources, readSpecifics } from "@/lib/prospect-preview/input";
import { buildMessages } from "@/lib/prospect-preview/messages";
import { checkOutreach, fillLink, parseOutreachForm, readOutreach, resolveOutreach } from "@/lib/prospect-preview/outreach";
import { approvalQueue, followUps } from "@/lib/prospect-preview/pipeline";
import { assessQuality, buyerVerified, isVerified } from "@/lib/prospect-preview/quality";
import type { Outreach, PreviewListRow, Specific } from "@/lib/prospect-preview/types";

// Owner, 2026-11-13: "AI does the work and I only approve and answer alerts."
// The outreach is written per prospect at build time and saved on the preview;
// what the owner pastes counts as confirmed by them; there is an Approve queue
// and a morning push; and through all of it NOTHING is ever sent for them.

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const LINK = "https://swiftcard.me/p/harbor-realty-group-k3x9qa";
const spec = (over: Partial<Specific> = {}): Specific => ({ kind: "listing", text: "Listed 14 Garden Pl, a 4-bedroom brownstone, at $3.4M", source_url: "https://harborrealty.com/listings/14-garden-pl", dated: "2026-11-03", uncertain: false, ...over });
const SPECIFICS = [
  spec({ kind: "open_house", text: "Open house at 88 Hicks St, Sunday Nov 16, 1-3pm", source_url: "https://harborrealty.com/open-houses", dated: "2026-11-16" }),
  spec(),
  spec({ kind: "cell_numbers", text: "11 of 14 agents list a personal cell number on the team page", source_url: "https://harborrealty.com/team", dated: "2026-11-12" }),
];

const WRITTEN = {
  first_text: "Hi Dana, Menash from SwiftCard. Saw your open house at 88 Hicks St Sunday. I made you a card for it. Want me to send it?",
  first_text_b: "Hi Dana, Menash from SwiftCard. 11 of your 14 agents give out their own cell. I made Harbor a card for that. Want to see it?",
  link_text: "Dana, here's the card. 11 of your 14 agents hand out their own cell, this keeps those contacts with Harbor: {link}",
  email_subject: "Dana, a card for 14 Garden Pl",
  email_body: "Hi Dana,\n\nI saw 14 Garden Pl go up at $3.4M. I made a card you could send with it, and you'd see when it's opened.\n\nHere it is: {link}\n\nMenash\nFounder, SwiftCard",
  call_opener: "Hi Dana, it's Menash, I sent you the card. With the open house at 88 Hicks on Sunday, do you want everyone who walks in to tap it?",
  voicemail: "Hi Dana, it's Menash from SwiftCard. I counted 11 of your 14 agents giving out their own cell. I made you a card that keeps those contacts with Harbor. Text me back when you have two minutes.",
  nudge_no_view: "Dana, the card I made for Harbor is still up. Worth 20 seconds before Sunday's open house: {link}",
  nudge_viewed: "Dana, saw you opened the card. Tried you just now. Is later today or tomorrow morning better for 5 minutes on 14 Garden Pl?",
  uses: { first_text: 0, first_text_b: 2, link_text: 2, email_body: 1, call_opener: 0, voicemail: 2, nudge_no_view: 0, nudge_viewed: 1 },
};
const outreach = (over: Record<string, unknown> = {}): Outreach => readOutreach({ ...WRITTEN, ...over })!;
const ctx = { link: LINK, specifics: SPECIFICS, complete: true };

const preview = {
  id: "11111111-1111-4111-8111-111111111111", slug: "harbor-realty-group-k3x9qa", status: "draft",
  office_name: "Harbor Realty Group", owner_name: "Dana Whitfield", owner_title: "Owner", logo_url: null, team_members: [],
  expires_at: "2026-11-27T15:00:00Z", detail: null, hook_why: null, buyer_role: "broker_owner", buyer_reason: null, team_size: null,
  views: 0, team_strip_scrolled: false, sent_at: null, specifics: SPECIFICS, sources: {}, outreach: null,
} as unknown as PreviewListRow;

describe("the messages written for one prospect", () => {
  it("a complete, clean set passes: every text is 160 or under with the real link in it", () => {
    expect(checkOutreach(outreach(), ctx)).toEqual([]);
    for (const k of ["first_text", "first_text_b", "link_text", "nudge_no_view", "nudge_viewed"] as const) expect(fillLink(WRITTEN[k], LINK).length).toBeLessThanOrEqual(160);
  });

  it("a text past 160 characters is refused, counted WITH the link, and the email is not held to it", () => {
    const long = `${"Dana, here is the card I made for you and the whole Harbor team this week, have a look: ".padEnd(120, "x")}{link}`;
    expect(checkOutreach(outreach({ link_text: long }), ctx).join(" ")).toMatch(/Text with the link: \d+ characters with the link in it\. A text stays at 160 or under\./);
    expect(checkOutreach(outreach({ email_body: `${"A long email. ".repeat(40)}{link}` }), ctx)).toEqual([]);
    expect(checkOutreach(outreach({ voicemail: "A long voicemail script. ".repeat(12) }), ctx)).toEqual([]);
  });

  it("no emojis, never the word \"free\", and no filler that could go to any office", () => {
    expect(checkOutreach(outreach({ first_text: "Hi Dana 👋 want your card?" }), ctx).join(" ")).toMatch(/First text, no link: no emojis\./);
    expect(checkOutreach(outreach({ nudge_viewed: "Dana, it is free to try. Call me?" }), ctx).join(" ")).toMatch(/don't say "free"/);
    expect(checkOutreach(outreach({ voicemail: "Dana, the Freeman listing looks busy. Call me back." }), ctx)).toEqual([]); // "Freeman" is not "free"
    expect(checkOutreach(outreach({ email_body: "Hi Dana, love your website. {link}" }), ctx).join(" ")).toMatch(/compliment or filler/);
  });

  it("the first text carries no link; the second text and the email must; and an address is never typed by hand", () => {
    expect(checkOutreach(outreach({ first_text: "Dana, your card: {link}" }), ctx).join(" ")).toMatch(/this one carries no link/);
    expect(checkOutreach(outreach({ first_text: "Dana, see swiftcard.me/p/x" }), ctx).join(" ")).toMatch(/this one carries no link/);
    expect(checkOutreach(outreach({ link_text: "Dana, here's the card." }), ctx).join(" ")).toMatch(/Text with the link: put \{link\} where the link goes\./);
    expect(checkOutreach(outreach({ email_body: "Hi Dana, it is at https://swiftcard.me/p/harbor" }), ctx).join(" ")).toMatch(/write \{link\} instead of an address/);
  });

  it("each message is built on a VERIFIED specific, and they use different ones where the preview has them", () => {
    const all0 = Object.fromEntries(Object.keys(WRITTEN.uses).map((k) => [k, 0]));
    expect(checkOutreach(outreach({ uses: all0 }), ctx).join(" ")).toMatch(/lean on 1 of the 3 verified specifics\. Use a different one in each where possible/);
    expect(checkOutreach(outreach({ uses: { ...WRITTEN.uses, voicemail: undefined } }), ctx).join(" ")).toMatch(/Voicemail script: say which specific it is built on/);
    const unverified = [SPECIFICS[0], SPECIFICS[1], spec({ uncertain: true })];
    expect(checkOutreach(outreach(), { ...ctx, specifics: unverified }).join(" ")).toMatch(/built on specific 2, which isn't a verified one/);
    // Two verified specifics: both must appear, and that is enough.
    const two = { ...all0, first_text_b: 1 };
    expect(checkOutreach(outreach({ uses: two }), { ...ctx, specifics: SPECIFICS.slice(0, 2) })).toEqual([]);
  });

  it("the command must write all of them; the edit screen may save some, and the rest fall back", () => {
    expect(checkOutreach(outreach({ voicemail: "" }), ctx).join(" ")).toMatch(/Voicemail script: not written\./);
    expect(checkOutreach(null, ctx)).toEqual(["No messages were written."]);
    expect(checkOutreach(outreach({ voicemail: "" }), { link: LINK, specifics: SPECIFICS })).toEqual([]);
    expect(checkOutreach(null, { link: LINK, specifics: SPECIFICS })).toEqual([]);
  });

  it("reads back only what it knows, keeps the email's line breaks, and nothing written is null", () => {
    expect(readOutreach(null)).toBeNull();
    expect(readOutreach({ first_text: "   ", uses: { first_text: 0 } })).toBeNull();
    const o = readOutreach({ ...WRITTEN, extra: "x", uses: { first_text: 1, nonsense: 2, link_text: "3" } })!;
    expect(o.email_body).toContain("\n\nHere it is: {link}\n\n");
    expect(o.uses).toEqual({ first_text: 1 });
    expect("extra" in o).toBe(false);
  });

  it("the edit screen's form keeps what each message was built on, and an emptied form clears them all", () => {
    const before = outreach();
    const saved = parseOutreachForm((k) => (k === "o_first_text" ? "Hi Dana, want the card I made for 88 Hicks?" : ""), before, new Date("2026-11-13T15:00:00Z"))!;
    expect(saved.first_text).toBe("Hi Dana, want the card I made for 88 Hicks?");
    expect(saved.uses).toEqual(before.uses);
    expect(saved.written_at).toBe("2026-11-13T15:00:00.000Z");
    expect(parseOutreachForm(() => "", before)).toBeNull();
  });
});

describe("what the screens show", () => {
  it("the written messages, with the real link filled in", () => {
    const m = resolveOutreach({ ...preview, outreach: outreach() }, { link: LINK, sender: "Menash Harooni" });
    expect(m.written).toBe(true);
    expect(m.specific).toBe(true);
    expect(m.ask).toBe(WRITTEN.first_text);
    expect(m.text).toBe(`Dana, here's the card. 11 of your 14 agents hand out their own cell, this keeps those contacts with Harbor: ${LINK}`);
    expect(m.email).toEqual({ subject: "Dana, a card for 14 Garden Pl", body: WRITTEN.email_body.replace("{link}", LINK) });
    expect(m.nudge_no_view).toContain(LINK);
    expect(m.voicemail).toBe(WRITTEN.voicemail);
  });

  it("the templates only when none were written, and per message when only some were", () => {
    const t = buildMessages(preview, { link: LINK, sender: "Menash Harooni" });
    expect(resolveOutreach(preview, { link: LINK, sender: "Menash Harooni" })).toEqual(t);
    expect(t.written).toBe(false);
    const some = resolveOutreach({ ...preview, outreach: readOutreach({ first_text: "Hi Dana, want the card I made for 88 Hicks?" }) }, { link: LINK, sender: "Menash Harooni" });
    expect(some.ask).toBe("Hi Dana, want the card I made for 88 Hicks?");
    expect(some.text).toBe(t.text);
    expect(some.nudge_viewed).toBe(t.nudge_viewed);
  });

  it("the fallback voicemail and nudges say nothing false, have no emoji and never say free", () => {
    const t = buildMessages(preview, { link: LINK, sender: null });
    for (const words of [t.voicemail, t.nudge_no_view, t.nudge_viewed]) {
      expect(words).toContain("Dana");
      expect(words).not.toMatch(/\bfree\b|\p{Extended_Pictographic}/iu);
    }
    expect(t.voicemail).toContain("the founder of SwiftCard");
    expect(t.nudge_no_view).toContain(LINK);
    expect(t.nudge_viewed).not.toContain("swiftcard.me");
  });

  it("the Call screen opens with the written opener when there is one", () => {
    const written = callBrief({ ...preview, outreach: outreach() }, { sender: "Menash Harooni" });
    expect(written.opener).toBe(WRITTEN.call_opener);
    expect(written).toMatchObject({ written: true, specific: true });
    expect(callBrief(preview, { sender: "Menash Harooni" })).toMatchObject({ written: false, specific: false });
  });
});

describe("what the owner pastes is confirmed by the owner", () => {
  const base = {
    specifics: SPECIFICS, sources: {}, buyer_role: "broker_owner", detail: "your open house at 88 Hicks St this Sunday", hook_specific: 0, hook_angle: "open_house",
    hook_why: "Everyone who walks through can tap your card instead of signing a sheet.", headshot_url: null, logo_url: null, specialty: null, website: null,
    social_links: {}, license: null, current_tool: null, team_members: [], owner_title: null, quality_override: false,
  } as unknown as Parameters<typeof assessQuality>[0];

  it("a specific the owner supplied needs no page and no date; an uncertain one still doesn't count", () => {
    expect(isVerified(spec({ source_url: "", dated: "", owner: true }))).toBe(true);
    expect(isVerified(spec({ source_url: "", dated: "" }))).toBe(false);
    expect(isVerified(spec({ source_url: "", dated: "", owner: true, uncertain: true }))).toBe(false);
  });

  it("the owner saying who runs the office verifies the decision-maker; research still needs two sites", () => {
    expect(buyerVerified({ buyer_role: "broker_owner", sources: { buyer_role: { url: "", uncertain: false, note: "Owner: 'Dana owns it'", owner: true } } })).toBe(true);
    expect(buyerVerified({ buyer_role: "broker_owner", sources: { buyer_role: { url: "https://harborrealty.com/about", uncertain: false, note: "" } } })).toBe(false);
    expect(buyerVerified({ buyer_role: null, sources: { buyer_role: { url: "", uncertain: false, note: "x", owner: true } } })).toBe(false);
  });

  it("a draft built only from the owner's notes isn't too generic, and it still needs a real hook", () => {
    const pasted = [0, 1, 2].map((i) => spec({ text: SPECIFICS[i].text, source_url: "", dated: "", owner: true }));
    const sources = { buyer_role: { url: "", uncertain: false, note: "Owner: 'Dana owns it'", owner: true as const } };
    const q = assessQuality({ ...base, specifics: pasted, sources });
    expect(q.tooGeneric).toBe(false);
    expect(q.mayPublish).toBe(true);
    expect(assessQuality({ ...base, specifics: pasted, sources, detail: "you cover Brooklyn Heights" }).tooGeneric).toBe(true);
    // The same facts with no owner mark and no pages are research that wasn't done.
    expect(assessQuality({ ...base, specifics: pasted.map((s) => ({ ...s, owner: undefined })), sources: {} }).tooGeneric).toBe(true);
  });

  it("the mark survives the edit screen's save, and is only ever present when true", () => {
    expect(readSources({ phone: { owner: true, note: "Owner: 'her cell'" }, email: { url: "https://x.com/a" } })).toEqual({
      phone: { url: "", uncertain: false, note: "Owner: 'her cell'", owner: true },
      email: { url: "https://x.com/a", uncertain: false, note: "" },
    });
    expect(readSpecifics([{ text: "They have 14 agents", owner: "on" }, { text: "Listed 14 Garden Pl" }])).toEqual([
      { kind: "other", text: "They have 14 agents", source_url: "", dated: "", uncertain: false, owner: true },
      { kind: "other", text: "Listed 14 Garden Pl", source_url: "", dated: "", uncertain: false },
    ]);
    const form: Record<string, unknown> = { office_name: "Harbor Realty", owner_name: "Dana Whitfield", phone: "718 555 0199", buyer_role: "broker_owner", own_buyer_role: "on", note_buyer_role: "Owner: 'Dana owns it'", spec_text_0: "They have 14 agents", spec_own_0: "on" };
    const parsed = parsePreviewFields((k) => form[k]);
    expect(parsed.ok && parsed.value.sources.buyer_role?.owner).toBe(true);
    expect(parsed.ok && parsed.value.specifics[0].owner).toBe(true);
    const edit = read("src/app/admin/card-builder/edit/[id]/EditView.tsx");
    expect(edit).toContain("name={`own_${k}`}");
    expect(edit).toContain("name={`spec_own_${i}`}");
  });
});

describe("follow-ups come with their words", () => {
  const NOW = Date.parse("2026-11-13T15:00:00Z");
  const at = (daysAgo: number) => new Date(NOW - daysAgo * 86400_000).toISOString();
  const base = { id: "p1", status: "live" as const, stage: null, called: false, called_at: null, views: 0, last_viewed_at: null, sent_at: null as string | null, asked_at: null as string | null, expires_at: at(-10), updated_at: at(0), created_at: at(3) };

  it("a link not opened is nudged after two days, once", () => {
    expect(followUps([{ ...base, sent_at: at(1.5) }], NOW)).toEqual([]);
    expect(followUps([{ ...base, sent_at: at(2) }], NOW)).toEqual([{ id: "p1", kind: "sent_not_viewed", why: "Sent 2 days ago, not opened.", next: "Send the nudge.", screen: "send", send: "nudge_no_view" }]);
    expect(followUps([{ ...base, sent_at: at(5), nudge_no_view_at: at(3) }], NOW)).toEqual([]);
  });

  it("viewed and not reached: call first (voicemail script to hand), then one text, then the phone again", () => {
    const viewed = { ...base, sent_at: at(1), views: 1, last_viewed_at: at(0.2) };
    expect(followUps([viewed], NOW)[0]).toMatchObject({ kind: "viewed_not_reached", next: "Call them.", voicemail: true });
    expect(followUps([viewed], NOW)[0].send).toBeUndefined();
    const tried = { ...viewed, call_outcome: "no_answer", call_outcome_at: at(0.1) };
    expect(followUps([tried], NOW)[0]).toMatchObject({ send: "nudge_viewed", next: "Text them, then try again." });
    const texted = followUps([{ ...tried, nudge_viewed_at: at(0.05) }], NOW)[0];
    expect(texted).toMatchObject({ voicemail: true, next: "Try again." });
    expect(texted.why).toContain("Texted today.");
    expect(texted.send).toBeUndefined();
  });

  it("asked with no link gets the link text; published and never sent gets the first text; an expired link gets nothing to send", () => {
    expect(followUps([{ ...base, asked_at: at(2) }], NOW)[0]).toMatchObject({ kind: "asked_no_link", send: "text" });
    expect(followUps([{ ...base, updated_at: at(2) }], NOW)[0]).toMatchObject({ kind: "ready_not_sent", send: "ask" });
    expect(followUps([{ ...base, sent_at: at(3), expires_at: at(1) }], NOW)[0].send).toBeUndefined();
  });

  it("the Approve queue: drafts waiting, approved ones with nothing sent yet, and the skipped", () => {
    const q = approvalQueue([
      { ...base, id: "draft-new", status: "draft", created_at: at(1) },
      { ...base, id: "draft-old", status: "draft", created_at: at(4) },
      { ...base, id: "skipped", status: "draft", skipped_at: at(1) },
      { ...base, id: "approved" },
      { ...base, id: "asked", asked_at: at(0.1) },
      { ...base, id: "sent", sent_at: at(0.1) },
      { ...base, id: "expired", expires_at: at(1) },
    ], NOW);
    expect(q.waiting.map((r) => r.id)).toEqual(["draft-new", "draft-old"]);
    expect(q.send.map((r) => r.id)).toEqual(["approved"]);
    expect(q.skipped.map((r) => r.id)).toEqual(["skipped"]);
  });
});

describe("the morning push", () => {
  it("is due from 8am to 8pm New York time, and keyed by the New York day", () => {
    expect(digestDue(Date.parse("2026-11-13T12:59:00Z"))).toBe(false); // 7:59am EST
    expect(digestDue(Date.parse("2026-11-13T13:00:00Z"))).toBe(true); // 8:00am
    expect(digestDue(Date.parse("2026-11-14T00:59:00Z"))).toBe(true); // 7:59pm
    expect(digestDue(Date.parse("2026-11-14T01:00:00Z"))).toBe(false); // 8:00pm
    expect(digestKey(Date.parse("2026-11-14T00:30:00Z"))).toBe("prospect-follow-ups:2026-11-13");
  });

  it("says the count, then who is first and why", () => {
    const list = [
      { id: "a", kind: "viewed_not_reached" as const, why: "Viewed today, not reached yet.", next: "Call them.", screen: "call" as const },
      { id: "b", kind: "sent_not_viewed" as const, why: "Sent 2 days ago, not opened.", next: "Send the nudge.", screen: "send" as const },
    ];
    expect(digestText(list, (id) => (id === "a" ? "Dana Whitfield" : "?"))).toEqual({ title: "2 follow-ups due today", body: "Dana Whitfield: Viewed today, not reached yet. And 1 more." });
    expect(digestText(list.slice(0, 1), () => "Dana Whitfield").title).toBe("1 follow-up due today");
  });

  it("claims the day before pushing, sends nothing when nobody is due, and goes only to staff", () => {
    const src = code("src/lib/prospect-preview/digest.ts");
    expect(src.indexOf('if (!due.length) return')).toBeLessThan(src.indexOf('.from("admin_notifications").insert('));
    expect(src.indexOf('.from("admin_notifications").insert(')).toBeLessThan(src.indexOf("sendPushToUser("));
    expect(src).toContain('error.code === "23505" ? "already_sent"');
    expect(src).toContain("await adminUserIds()");
    const route = code("src/app/api/push/prospect-follow-ups/route.ts");
    expect(route.indexOf("if (!authorized(req))")).toBeLessThan(route.indexOf("sendFollowUpDigest()"));
    expect(read(".github/workflows/push-catchup.yml")).toContain("https://swiftcard.me/api/push/prospect-follow-ups");
    // Still two daily Vercel crons: the Hobby plan fails every deploy on a third.
    expect(JSON.parse(read("vercel.json")).crons).toHaveLength(2);
  });
});

describe("nothing is ever sent for the owner", () => {
  const FILES = [
    "src/lib/prospect-preview/outreach.ts", "src/lib/prospect-preview/messages.ts", "src/lib/prospect-preview/pipeline.ts", "src/lib/prospect-preview/store.ts",
    "src/app/api/admin/card-builder/[id]/route.ts", "src/app/admin/card-builder/approve/ApproveView.tsx", "src/app/admin/card-builder/approve/page.tsx",
    "src/app/admin/card-builder/OneTapSend.tsx", "src/app/admin/card-builder/CardBuilderView.tsx",
  ];

  it("no Card Builder file can text or email a prospect, and none calls a model", () => {
    for (const f of FILES) {
      expect(code(f), f).not.toMatch(/twilio|resend|deliverToLead|sendEmail|sendSms|sendPushToUser|@anthropic-ai|generateText|\bai-sdk\b|openai/i);
    }
    // The one push in Card Builder's digest goes to staff, about staff's own to-do list.
    expect(code("src/lib/prospect-preview/digest.ts")).not.toMatch(/twilio|resend|deliverToLead|sendEmail|sendSms/i);
  });

  it("a one-tap send is a link to the founder's own Messages or Mail; the server only notes that it went", () => {
    const tap = code("src/app/admin/card-builder/OneTapSend.tsx");
    expect(tap).toContain("href={href}");
    expect(tap).toContain('body: JSON.stringify({ action: "sent", kind })');
    const view = code("src/app/admin/card-builder/approve/ApproveView.tsx");
    expect(view).toMatch(/href=\{smsHref\(r\.phone, m\.ask\)\}/);
    expect(view).toMatch(/href=\{mailtoHref\(r\.email, m\.email\.subject, m\.email\.body\)\}/);
  });

  it("Approve publishes through the same quality gate as the edit screen, and publishes only", () => {
    const route = code("src/app/api/admin/card-builder/[id]/route.ts");
    const approve = route.slice(route.indexOf('case "approve"'), route.indexOf('case "skip"'));
    expect(approve).toContain("if (p.status !== \"live\" && !assessQuality(p).mayPublish) return reply(\"held\", 409);");
    expect(approve).toContain("publishPreview(id)");
    expect(approve).not.toMatch(/markSent|setQualityOverride/);
    // Skip never touches a published preview.
    expect(code("src/lib/prospect-preview/store.ts")).toMatch(/skipped_at: on \? now\.toISOString\(\) : null[^;]+\.eq\("status", "draft"\)/);
  });

  it("the new columns are additive, nullable and safe to run twice", () => {
    const sql = read("supabase/prospect-previews-outreach.sql");
    for (const col of ["outreach         jsonb", "skipped_at       timestamptz", "nudge_no_view_at timestamptz", "nudge_viewed_at  timestamptz"]) {
      expect(sql).toContain(`alter table public.prospect_previews add column if not exists ${col};`);
    }
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(/not null|drop |create policy|grant /i);
  });
});
