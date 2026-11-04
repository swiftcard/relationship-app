import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EmailView from "@/app/admin/crew/email/EmailView";
import { decide } from "@/lib/crew/decide";
import type { EmailConfig, EmailDeps } from "@/lib/crew/execute";
import type { GmailAccount, GmailTransport, SendOutcome, ThreadMessage } from "@/lib/crew/email/gmail";
import { buildRaw, draftProblems, finalText, parseDraft } from "@/lib/crew/email/message";
import { checkReplies, draftFromLead, followUpDue, readThread, readyLeads, emailDrafts } from "@/lib/crew/email/outbox";
import { MemoryEmailSends } from "@/lib/crew/email/sends";
import { personFor } from "@/lib/crew/ledger";
import { leadKey } from "@/lib/crew/sheets/keys";
import { MemoryStore } from "@/lib/crew/store-memory";

// Approved emails from the SwiftCard mailbox: nothing leaves without the
// admin's Send, a dry run sends nothing, one draft is one email at most, and
// suppression, opt-outs and the limits all hold. Gmail is a fake here; no
// network, no database.

const BODY = `Subject: matching cards for your team

Hi Kevin,

I'm Menash, one of the two people who built SwiftCard. I saw your team covers Bay Ridge and Dyker Heights, so I'm guessing clients meet a few different agents before they sign.

I'd be glad to put together a sample card with your branding so you can see how the team would look. Would that be useful?

Menash`;

class FakeGmail implements GmailTransport {
  sent: string[] = [];
  next: SendOutcome[] = [];
  inSent = new Map<string, { id: string; threadId: string }>();
  findUnavailable = false;
  threads = new Map<string, ThreadMessage[]>();
  constructor(public acct: GmailAccount = { ok: true, email: "hello@swiftcard.me" }) {}
  async account() {
    return this.acct;
  }
  async send(raw: string): Promise<SendOutcome> {
    this.sent.push(raw);
    const n = this.next.shift() ?? { ok: true, id: `m${this.sent.length}`, threadId: `t${this.sent.length}` };
    // A "no answer" that did go out lands in Sent under its Message-ID.
    if (!n.ok && !n.definite && this.inSent.has("__went__")) {
      const mid = /Message-ID: (<[^>]+>)/.exec(Buffer.from(raw, "base64url").toString())![1];
      this.inSent.set(mid, { id: "mX", threadId: "tX" });
    }
    return n;
  }
  async findSent(mid: string) {
    if (this.findUnavailable) return "unavailable" as const;
    return this.inSent.get(mid) ?? null;
  }
  async thread(id: string) {
    return this.threads.get(id) ?? null;
  }
  inboxMessages: ThreadMessage[] = [];
  async inbox() {
    return this.inboxMessages;
  }
}

const LIVE: EmailConfig = { live: true, mailbox: "hello@swiftcard.me", fromName: "Menash", dailyCap: 20, postalAddress: "1 Main St, Brooklyn, NY 11201" };

async function setup(o: { config?: Partial<EmailConfig>; email?: string; body?: string; status?: "pending" | "approved"; gmail?: FakeGmail } = {}) {
  const store = new MemoryStore();
  const sends = new MemoryEmailSends();
  const gmail = o.gmail ?? new FakeGmail();
  const email = o.email ?? "kevin@baysiderealty.com";
  const person = await personFor(store, "email", email, "Kevin");
  const ins = await store.insertApproval({ agent_id: "office-outreach", team: "office", kind: "dm", title: "Office email to Kevin", summary: "", body: o.body ?? BODY, platform: "email", person_id: person, meta: { email, name: "Kevin", company: "Bayside Realty" } });
  if (!("id" in ins)) throw new Error("no approval");
  await store.claimDm(person!, ins.id);
  if (o.status === "approved") await store.updateApproval(ins.id, { status: "approved" });
  const deps: EmailDeps = { sends, gmail, config: { ...LIVE, ...o.config } };
  const send = (body?: string) => decide(store, ins.id, { action: "send_email", by: "owner@swiftcard.me", ...(body ? { body } : {}) }, new Date(), { email: deps });
  return { store, sends, gmail, id: ins.id, person: person!, deps, send };
}

describe("the email that goes out", () => {
  it("is the owner's words, the subject from the first line, a way to say no and the postal address", () => {
    const d = parseDraft(BODY)!;
    expect(d.subject).toBe("matching cards for your team");
    const text = finalText(d, "1 Main St, Brooklyn, NY 11201");
    expect(text.startsWith("Hi Kevin,")).toBe(true);
    expect(text).toContain('reply "no thanks" and I won\'t email again');
    expect(text).toContain("SwiftCard, 1 Main St, Brooklyn, NY 11201");
    expect(text).not.toMatch(/[—–]/);
  });
  it("can't carry a header someone smuggled into the subject or the address", () => {
    const raw = Buffer.from(buildRaw({ from: "hello@swiftcard.me", fromName: "Menash", to: "kevin@x.com", subject: "hi\r\nBcc: everyone@x.com", text: "hello", messageId: "<sc-1@swiftcard.me>", unsubscribe: "mailto:hello@swiftcard.me?subject=unsubscribe" }), "base64url").toString();
    const head = raw.split("\r\n\r\n")[0];
    expect(head).not.toMatch(/^Bcc:/m);
    expect(head).toContain("Subject: hi Bcc: everyone@x.com");
    expect(head).toContain("List-Unsubscribe: <mailto:hello@swiftcard.me?subject=unsubscribe>");
    expect(() => buildRaw({ from: "hello@swiftcard.me", fromName: "", to: "a@b.com\r\nBcc: c@d.com", subject: "s", text: "t", messageId: "<x@y>", unsubscribe: "mailto:x@y.com" })).toThrow();
  });
  it("refuses a draft with no subject, a placeholder, or no real address", () => {
    expect(draftProblems("Hi there, no subject line here at all but plenty of words to pass the length check easily.", "a@b.com").join()).toMatch(/Subject/);
    expect(draftProblems(BODY.replace("Kevin", "[First name]"), "a@b.com").join()).toMatch(/placeholder/);
    expect(draftProblems(BODY, "not-an-email").join()).toMatch(/address/);
  });
});

describe("dry run (the default)", () => {
  it("records what would go and sends nothing; the draft keeps waiting", async () => {
    const t = await setup({ config: { live: false } });
    const r = await t.send();
    expect(r).toMatchObject({ ok: true, simulated: true });
    expect(t.gmail.sent).toHaveLength(0);
    expect((await t.store.getApproval(t.id))!.status).toBe("approved");
    expect(t.sends.rows[0].status).toBe("simulated");
    expect(t.store.activity.at(-1)).toMatchObject({ action: "email", simulated: true, result: "simulated" });
  });
  it("a dry run never blocks the real send later", async () => {
    const t = await setup({ config: { live: false } });
    await t.send();
    t.deps.config.live = true;
    expect((await t.send()).ok).toBe(true);
    expect(t.gmail.sent).toHaveLength(1);
  });
});

describe("live", () => {
  it("sends once from the mailbox, then the draft is done, the person contacted, the lead off the Sheet", async () => {
    const t = await setup();
    const leadRow = leadKey("lead-1");
    await t.store.updateApproval(t.id, { meta: { ...(await t.store.getApproval(t.id))!.meta, lead_id: "lead-1" } });
    await t.store.upsertSheetRow({ tab: "web-leads", row_key: leadRow, entity_kind: "lead", entity_id: "lead-1", status: "New", owner_cols: {}, shown_status: null, agent_hash: "", synced_at: null, owner_edited_at: null });
    const r = await t.send();
    expect(r.ok).toBe(true);
    expect(t.gmail.sent).toHaveLength(1);
    const mime = Buffer.from(t.gmail.sent[0], "base64url").toString();
    expect(mime).toContain('From: "Menash" <hello@swiftcard.me>');
    expect(mime).toContain("To: <kevin@baysiderealty.com>");
    const a = (await t.store.getApproval(t.id))!;
    expect(a.status).toBe("done");
    expect(a.meta.sent_via).toBe("gmail");
    expect(t.store.touches.map((x) => x.kind)).toEqual(["emailed"]);
    expect((await t.store.getSheetRow(leadRow))!.status).toBe("Contacted");
    expect(t.sends.rows[0]).toMatchObject({ status: "sent", gmail_id: "m1", thread_id: "t1" });
  });
  it("a second Send, or two at once, can never make a second email", async () => {
    const t = await setup({ status: "approved" });
    await Promise.all([t.send(), t.send(), t.send()]);
    expect(t.gmail.sent).toHaveLength(1);
    await t.send();
    expect(t.gmail.sent).toHaveLength(1);
  });
  it("an edit made right before Send is what goes, and is kept as a writing example", async () => {
    const t = await setup();
    await t.send(BODY.replace("Would that be useful?", "Want me to make one?"));
    expect(Buffer.from(Buffer.from(t.gmail.sent[0], "base64url").toString().split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString()).toContain("Want me to make one?");
    expect(t.store.edits).toHaveLength(1);
  });
  it("one first email per address, across drafts", async () => {
    const t = await setup();
    await t.send();
    const other = await t.store.insertApproval({ agent_id: "leads-web", team: "leads", kind: "dm", title: "again", summary: "", body: BODY, platform: "email", meta: { email: "Kevin+x@baysiderealty.com" } });
    if (!("id" in other)) throw new Error();
    const r = await decide(t.store, other.id, { action: "send_email", by: "owner" }, new Date(Date.now() + 2 * 86_400_000), { email: t.deps });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already emailed/);
    expect(t.gmail.sent).toHaveLength(1);
  });
});

describe("what stops a send before Gmail is touched", () => {
  it("the address or its domain on the suppression list", async () => {
    for (const v of ["kevin@baysiderealty.com", "@baysiderealty.com"]) {
      const t = await setup();
      await t.store.addSuppression(v, "test");
      const r = await t.send();
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/suppression/);
      expect(t.gmail.sent).toHaveLength(0);
    }
  });
  it("an opt-out, or contact some other way", async () => {
    const a = await setup();
    await a.store.addTouch(a.person, "email", "opted_out", null);
    expect((await a.send()).message).toMatch(/opted out/);
    const b = await setup();
    await b.store.addTouch(b.person, "email", "emailed", null);
    expect((await b.send()).message).toMatch(/already contacted/);
    expect(a.gmail.sent.length + b.gmail.sent.length).toBe(0);
  });
  it("the office locked, the mailbox not connected or the wrong account, no postal address", async () => {
    const locked = await setup();
    await locked.store.updateSettings({ kill_all: true });
    expect((await locked.send()).message).toMatch(/locked/);
    expect((await (await setup({ gmail: new FakeGmail({ ok: false, reason: "not_connected" }) })).send()).message).toMatch(/Connect/);
    expect((await (await setup({ gmail: new FakeGmail({ ok: true, email: "me@gmail.com" }) })).send()).message).toMatch(/not hello@swiftcard.me/);
    expect((await (await setup({ config: { postalAddress: null } })).send()).message).toMatch(/POSTAL/);
  });
  it("the 24-hour cap, and one per company a day", async () => {
    const t = await setup({ config: { dailyCap: 1 } });
    expect((await t.send()).ok).toBe(true);
    const next = await setup({ config: { dailyCap: 1 }, email: "sam@other.com" });
    next.deps.sends = t.sends;
    expect((await next.send()).message).toMatch(/limit/);
    const sameCo = await setup({ email: "dana@baysiderealty.com" });
    sameCo.deps.sends = t.sends;
    expect((await sameCo.send()).message).toMatch(/baysiderealty\.com was emailed/);
  });
  it("only an email draft, and only one still open", async () => {
    const t = await setup();
    await decide(t.store, t.id, { action: "reject", reason: "no", by: "owner" });
    expect((await t.send()).ok).toBe(false);
    expect(t.gmail.sent).toHaveLength(0);
    const store = new MemoryStore();
    const r = await store.insertApproval({ agent_id: "replies-reddit", team: "replies", kind: "reply", title: "", summary: "", body: "hi", platform: "reddit" });
    if (!("id" in r)) throw new Error();
    expect((await decide(store, r.id, { action: "send_email", by: "o" }, new Date(), { email: t.deps })).message).toMatch(/Only an email draft/);
  });
  it("a refused send leaves the draft on the Sheet (send_error, not error)", async () => {
    const t = await setup({ config: { postalAddress: null } });
    await t.send();
    const a = (await t.store.getApproval(t.id))!;
    expect(a.meta.error).toBeUndefined();
    expect(String(a.meta.send_error)).toMatch(/POSTAL/);
  });
});

describe("errors are visible and retriable without a duplicate", () => {
  it("Gmail refused (4xx): failed, nothing sent, Retry sends", async () => {
    const t = await setup();
    t.gmail.next.push({ ok: false, definite: true, status: 400, message: "Gmail 400: bad" });
    expect((await t.send()).ok).toBe(false);
    expect(t.sends.rows[0]).toMatchObject({ status: "failed", error: "Gmail 400: bad" });
    expect((await t.send()).ok).toBe(true);
    expect(t.gmail.sent).toHaveLength(2);
    expect(t.sends.rows[0]).toMatchObject({ status: "sent", attempts: 2 });
  });
  it("no answer, and it did go: the retry finds it in Sent and does not send again", async () => {
    const t = await setup();
    t.gmail.inSent.set("__went__", { id: "", threadId: "" });
    t.gmail.next.push({ ok: false, definite: false, status: null, message: "no answer" });
    await t.send();
    expect(t.sends.rows[0].status).toBe("unknown");
    t.sends.rows[0].updated_at = new Date(Date.now() - 5 * 60_000).toISOString();
    const r = await t.send();
    expect(r.ok).toBe(true);
    expect(t.gmail.sent).toHaveLength(1);
    expect(t.sends.rows[0]).toMatchObject({ status: "sent", gmail_id: "mX" });
    expect((await t.store.getApproval(t.id))!.status).toBe("done");
  });
  it("no answer, and it didn't go: the retry sends; Gmail can't be asked: nothing is resent", async () => {
    const t = await setup();
    t.gmail.next.push({ ok: false, definite: false, status: 503, message: "Gmail 503" });
    await t.send();
    // Straight away: refused, so a slow-to-appear send can still show up in Sent.
    expect((await t.send()).message).toMatch(/Wait two minutes/);
    const age = () => (t.sends.rows[0].updated_at = new Date(Date.now() - 5 * 60_000).toISOString());
    age();
    t.gmail.findUnavailable = true;
    expect((await t.send()).ok).toBe(false);
    expect(t.gmail.sent).toHaveLength(1);
    t.gmail.findUnavailable = false;
    age();
    expect((await t.send()).ok).toBe(true);
    expect(t.gmail.sent).toHaveLength(2);
  });
  it("a double-click on Retry after no answer sends at most once", async () => {
    const t = await setup();
    t.gmail.next.push({ ok: false, definite: false, status: null, message: "no answer" });
    await t.send();
    t.sends.rows[0].updated_at = new Date(Date.now() - 5 * 60_000).toISOString();
    await Promise.all([t.send(), t.send(), t.send()]);
    expect(t.gmail.sent).toHaveLength(2);
    expect(t.sends.rows).toHaveLength(1);
    expect(t.sends.rows[0].status).toBe("sent");
  });
  it("sends to the address as written (a +tag is kept); suppression still matches the plain address", async () => {
    const t = await setup({ email: "Jane+Sales@Acme.com" });
    await t.send();
    expect(Buffer.from(t.gmail.sent[0], "base64url").toString()).toContain("To: <jane+sales@acme.com>");
    const s = await setup({ email: "jane+sales@acme.com" });
    await s.store.addSuppression("jane@acme.com", "test");
    expect((await s.send()).message).toMatch(/suppression/);
  });
});

describe("Web Leads become drafts, never emails", () => {
  async function withLead(o: { message?: string; email_status?: string } = {}) {
    const store = new MemoryStore();
    await store.insertLeads([{ list: "cold", name: "Ana", company: "Clean Co", email: "ana@cleanco.com", source_platform: "web", source_url: "https://cleanco.com", message: o.message ?? BODY, email_status: o.email_status ?? "Domain OK" }]);
    return { store, lead: store.leads[0] };
  }
  it("Review as email makes one pending draft through the contact rules; twice is still one", async () => {
    const { store, lead } = await withLead();
    const a = await draftFromLead(store, lead.id, "owner");
    const b = await draftFromLead(store, lead.id, "owner");
    expect(a.ok && b.ok && a.id === b.id).toBe(true);
    const drafts = await emailDrafts(store);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: "pending", kind: "dm", platform: "email", agent_id: "leads-web" });
    expect(drafts[0].meta).toMatchObject({ email: "ana@cleanco.com", lead_id: lead.id });
    expect(await readyLeads(store, drafts)).toHaveLength(0);
  });
  it("not for a suppressed address, a domain with no mail server, or a lead without a written email", async () => {
    const s1 = await withLead();
    await s1.store.addSuppression("@cleanco.com", "test");
    expect((await draftFromLead(s1.store, s1.lead.id, "o")).ok).toBe(false);
    const s2 = await withLead({ email_status: "No Mail Server" });
    expect((await draftFromLead(s2.store, s2.lead.id, "o")).ok).toBe(false);
    const s3 = await withLead({ message: "Hi Ana, quick question about your team." });
    expect((await draftFromLead(s3.store, s3.lead.id, "o")).ok).toBe(false);
  });
});

describe("replies and follow-ups", () => {
  it("reads a reply, a bounce (and suppresses it), or nothing yet", async () => {
    expect(readThread([{ from: "Menash <hello@swiftcard.me>", labelIds: ["SENT"] }], "hello@swiftcard.me")).toBeNull();
    expect(readThread([{ from: "hello@swiftcard.me", labelIds: ["SENT"] }, { from: "kevin@x.com", subject: "Automatic reply: matching cards", labelIds: ["INBOX"] }], "hello@swiftcard.me")).toBeNull();
    expect(readThread([{ from: "hello@swiftcard.me", labelIds: ["SENT"] }, { from: "Kevin <kevin@x.com>", labelIds: ["INBOX"] }], "hello@swiftcard.me")).toBe("replied");
    expect(readThread([{ from: "hello@swiftcard.me", labelIds: ["SENT"] }, { from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", labelIds: ["INBOX"] }], "hello@swiftcard.me")).toBe("bounced");

    const t = await setup();
    await t.send();
    t.gmail.threads.set("t1", [{ from: "hello@swiftcard.me", labelIds: ["SENT"] }, { from: "mailer-daemon@googlemail.com", labelIds: ["INBOX"] }]);
    const r = await checkReplies(t.store, t.sends, t.gmail, "hello@swiftcard.me");
    expect(r).toEqual({ checked: 1, replied: 0, bounced: 1, unsubscribed: 0 });
    expect(await t.store.isSuppressed(["kevin@baysiderealty.com"])).toBe(true);
  });
  it("an unsubscribe, in the thread or as a new email from the List-Unsubscribe button, stops every channel", async () => {
    expect(readThread([{ from: "hello@swiftcard.me", labelIds: ["SENT"] }, { from: "Kevin <kevin@x.com>", subject: "Re: unsubscribe", labelIds: ["INBOX"] }], "hello@swiftcard.me")).toBe("unsubscribed");
    const t = await setup();
    await t.send();
    t.gmail.threads.set("t1", [{ from: "hello@swiftcard.me", labelIds: ["SENT"] }]);
    t.gmail.inboxMessages = [
      { from: "Kevin <KEVIN@baysiderealty.com>", subject: "unsubscribe", labelIds: ["INBOX"] },
      { from: "Someone <someone@else.com>", subject: "Re: matching cards for your team", labelIds: ["INBOX"] },
    ];
    const r = await checkReplies(t.store, t.sends, t.gmail, "hello@swiftcard.me");
    expect(r.unsubscribed).toBe(1);
    expect(await t.store.isSuppressed(["kevin@baysiderealty.com"])).toBe(true);
    expect(await t.store.isSuppressed(["someone@else.com"])).toBe(false);
    expect(t.store.touches.some((x) => x.kind === "opted_out")).toBe(true);
    expect(t.sends.rows[0].reply_state).toBe("unsubscribed");
    // Running it again changes nothing.
    expect((await checkReplies(t.store, t.sends, t.gmail, "hello@swiftcard.me")).unsubscribed).toBe(0);
  });
  it("every email carries the opt-out line, the postal address and a List-Unsubscribe header", async () => {
    const t = await setup();
    await t.send();
    const mime = Buffer.from(t.gmail.sent[0], "base64url").toString();
    expect(mime).toContain("List-Unsubscribe: <mailto:hello@swiftcard.me?subject=unsubscribe>");
    const body = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString();
    expect(body).toContain('reply "no thanks"');
    expect(body).toContain("SwiftCard, 1 Main St, Brooklyn, NY 11201");
  });
  it("Follow up shows after 4 days with no reply", () => {
    const sent = { status: "sent" as const, reply_state: null, sent_at: "2026-11-01T12:00:00Z" };
    expect(followUpDue(sent, new Date("2026-11-04T12:00:00Z"))).toBe(false);
    expect(followUpDue(sent, new Date("2026-11-05T12:00:00Z"))).toBe(true);
    expect(followUpDue({ ...sent, reply_state: "replied" }, new Date("2026-11-09T12:00:00Z"))).toBe(false);
  });
});

describe("who can send", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("only the admin's Approve route passes send_email, with the email deps; the Sheet never sends", () => {
    const route = read("src/app/api/admin/crew/approvals/[id]/route.ts");
    expect(route).toContain("await requireAdmin()");
    expect(route).toContain('action === "send_email"');
    expect(route).toContain("if (origin && !sameSite(origin, req.nextUrl.host))");
    expect(read("src/lib/crew/sheets/apply.ts")).not.toMatch(/send_email|sendApprovedEmail|LiveGmail/);
    expect(read("src/app/api/admin/crew/email/route.ts")).not.toMatch(/send_email|sendApprovedEmail|decide/);
  });
  it("the mailbox connection asks for gmail.send and gmail.metadata only, and refuses any other account", () => {
    const scopes = read("src/lib/crew/email/scopes.ts");
    expect(scopes).toContain('["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.metadata"]');
    expect(scopes).not.toMatch(/gmail\.(readonly|modify|compose)|mail\.google\.com/);
    const oauth = read("src/lib/agent-connect-oauth.ts");
    expect(oauth).toContain('google_gmail: ["openid", "email", ...GMAIL_SCOPES].join(" ")');
    expect(oauth).toMatch(/const expected = emailMailbox\(\);[\s\S]*if \(!email \|\| email !== expected\) throw/);
  });
  it("sending stays off until CREW_EMAIL_LIVE is exactly 1", async () => {
    expect(read("src/lib/crew/env.ts")).toContain('return env("CREW_EMAIL_LIVE") === "1";');
    const { emailLive } = await import("@/lib/crew/env");
    const before = process.env.CREW_EMAIL_LIVE;
    try {
      for (const v of [undefined, "", "0", "true", "yes", "live"]) {
        if (v === undefined) delete process.env.CREW_EMAIL_LIVE;
        else process.env.CREW_EMAIL_LIVE = v;
        expect(emailLive(), String(v)).toBe(false);
      }
      process.env.CREW_EMAIL_LIVE = "1";
      expect(emailLive()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.CREW_EMAIL_LIVE;
      else process.env.CREW_EMAIL_LIVE = before;
    }
  });
  it("the migration only adds: one table, its indexes, RLS on; nothing dropped, altered or truncated elsewhere", () => {
    const sql = read("supabase/crew-email.sql").replace(/--.*$/gm, "");
    expect(sql.replace(/on delete restrict/gi, "")).not.toMatch(/\b(drop|truncate|delete|update)\b/i);
    expect(sql.match(/\balter table\s+(\w+)/gi)).toEqual(["alter table crew_email_sends"]);
    expect(sql.match(/create table if not exists (\w+)/gi)).toEqual(["create table if not exists crew_email_sends"]);
    expect(sql).toContain("on delete restrict");
    expect(sql).toContain("enable row level security");
  });
  it("no agent, schedule or budget changes: nothing under agents/, schedule or budget is touched by email code", () => {
    for (const f of ["src/lib/crew/email/outbox.ts", "src/lib/crew/execute/email-send.ts", "src/lib/crew/email/gmail.ts"]) {
      expect(read(f)).not.toMatch(/from "\.\.?\/(agents|schedule|budget|tick)/);
      expect(read(f)).not.toMatch(/patchAgentState|updateSettings|setControl|schedule_overrides/);
    }
  });
});

describe("the Email page", () => {
  it("renders a draft with its Send form (posted, works before hydration) and says plainly when it's a dry run", async () => {
    const t = await setup();
    const a = (await t.store.getApproval(t.id))!;
    const props = { config: { live: false, mailbox: "hello@swiftcard.me", dailyCap: 20, postal: false }, account: { ok: false as const, reason: "not_connected" as const }, tableReady: false, drafts: [a], leads: [], sends: [], byApproval: {}, used: 0, now: Date.now(), connect: null };
    const html = renderToStaticMarkup(h(EmailView, props));
    expect(html).toContain("Dry run send (nothing goes out)");
    expect(html).toContain('value="send_email"');
    expect(html).toContain("Connect hello@swiftcard.me");
    expect(html).toContain("Run supabase/crew-email.sql");
    for (const f of html.match(/<form\b[^>]*>/g) ?? []) expect(f).toContain('method="post"');
    const live = renderToStaticMarkup(h(EmailView, { ...props, config: { ...props.config, live: true, postal: true }, account: { ok: true as const, email: "hello@swiftcard.me" }, tableReady: true }));
    expect(live).toContain("Send from hello@swiftcard.me");
    expect(live).not.toContain("Connect hello@swiftcard.me");
  });
});
