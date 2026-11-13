import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildMessages, mailtoHref, possessive, smsHref, teamNames } from "@/lib/prospect-preview/messages";
import { followUps, stageCounts, stageOf, STAGES } from "@/lib/prospect-preview/pipeline";

// Card Builder, part 3 (2026-11-11): the pipeline, the three messages, sending by hand.

const NOW = Date.parse("2026-11-11T15:00:00Z");
const DAY = 86400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const base = {
  id: "p1", status: "live" as const, stage: null as string | null, called: false, called_at: null as string | null, views: 0,
  last_viewed_at: null as string | null, sent_at: null as string | null, asked_at: null as string | null,
  expires_at: at(-10), updated_at: at(0),
};
const row = (over: Partial<typeof base>) => ({ ...base, ...over });

describe("a preview's stage comes from what has happened", () => {
  it("draft → ready → sent → viewed → called, in that order of precedence", () => {
    expect(stageOf(row({ status: "draft" }))).toBe("draft");
    expect(stageOf(row({}))).toBe("ready");
    expect(stageOf(row({ asked_at: at(1) }))).toBe("ready"); // the first text has no link: nothing to view yet
    expect(stageOf(row({ sent_at: at(1) }))).toBe("sent");
    expect(stageOf(row({ sent_at: at(1), views: 2 }))).toBe("viewed");
    expect(stageOf(row({ views: 1 }))).toBe("viewed"); // viewed without us marking it sent
    expect(stageOf(row({ sent_at: at(1), views: 2, called: true }))).toBe("called");
  });

  it("an outcome a person chose wins, and anything else in that column is ignored", () => {
    for (const s of ["meeting_booked", "won", "lost"]) expect(stageOf(row({ stage: s, views: 3 }))).toBe(s);
    expect(stageOf(row({ stage: "nonsense", views: 3 }))).toBe("viewed");
  });

  it("counts every stage, including the empty ones", () => {
    const counts = stageCounts([row({ status: "draft" }), row({}), row({}), row({ views: 1 }), row({ stage: "won" })]);
    expect(Object.keys(counts)).toEqual([...STAGES]);
    expect(counts).toMatchObject({ draft: 1, ready: 2, sent: 0, viewed: 1, called: 0, meeting_booked: 0, won: 1, lost: 0 });
  });
});

describe("follow up today", () => {
  it("viewed but not reached comes first, then sent a day ago and not opened, then the rest", () => {
    const list = followUps([
      row({ id: "ready-old", updated_at: at(3) }),
      row({ id: "called-old", called: true, called_at: at(2.5), views: 1 }),
      row({ id: "asked", asked_at: at(2) }),
      row({ id: "sent-2d", sent_at: at(2) }),
      row({ id: "sent-4d", sent_at: at(4) }),
      row({ id: "viewed-old", views: 1, last_viewed_at: at(3) }),
      row({ id: "viewed-now", views: 1, last_viewed_at: at(0.01) }),
    ], NOW);
    expect(list.map((f) => f.id)).toEqual(["viewed-now", "viewed-old", "sent-4d", "sent-2d", "asked", "called-old", "ready-old"]);
    expect(list.map((f) => f.screen)).toEqual(["call", "call", "send", "send", "send", "call", "send"]);
    expect(list[2].why).toBe("Sent 4 days ago, not opened.");
  });

  it("nothing is chased too early, and nothing with an outcome or still in draft is chased at all", () => {
    expect(followUps([
      row({ id: "sent-today", sent_at: at(0.5) }),
      row({ id: "asked-today", asked_at: at(0.5) }),
      row({ id: "called-yesterday", called: true, called_at: at(1), views: 1 }),
      row({ id: "new", updated_at: at(0.2) }),
      row({ id: "draft", status: "draft", updated_at: at(9) }),
      row({ id: "won", stage: "won", views: 2 }),
      row({ id: "lost", stage: "lost", sent_at: at(5) }),
      row({ id: "booked", stage: "meeting_booked", views: 1 }),
    ], NOW)).toEqual([]);
  });

  it("says when the link has expired or is about to", () => {
    const [gone] = followUps([row({ sent_at: at(3), expires_at: at(1) })], NOW);
    expect(gone.next).toContain("The link has expired");
    const [soon] = followUps([row({ sent_at: at(3), expires_at: at(-1) })], NOW);
    expect(soon.next).toContain("expires within 2 days");
  });
});

describe("the three messages", () => {
  const p = {
    owner_name: "Dana Whitfield", office_name: "Harbor Realty Group", logo_url: "https://harbor.example/logo.png",
    team_members: [{ name: "Marcus Lee", title: "" }, { name: "Priyanka Rao", title: "" }, { name: "Jo Park", title: "" }],
    expires_at: "2026-11-25T17:00:00Z",
  };
  const link = "https://swiftcard.me/p/harbor-realty-group-k3x9qa";
  const m = buildMessages(p, { link, sender: "Menash Harooni" });

  it("the first text has no link and asks if they want it", () => {
    expect(m.ask).toBe("Hi Dana, it's Menash, the founder of SwiftCard. I made a digital business card for you and for Marcus, Priyanka and Jo, with Harbor Realty Group's logo and colors on it. Want me to text you the link?");
    expect(m.ask).not.toMatch(/https?:|swiftcard\.me/);
  });

  it("the second text and the email carry the link, their details and when it comes down", () => {
    expect(m.text).toBe(`Hi Dana, Menash from SwiftCard. Here's the card I made for you and the team:\n${link}\nIt's up until Nov 25. Tell me what you'd change.`);
    expect(m.email.subject).toBe("Dana, I made your Harbor Realty Group card");
    expect(m.email.body).toContain(`Here it is: ${link}`);
    expect(m.email.body).toContain("one each for Marcus, Priyanka and Jo");
    expect(m.email.body.endsWith("Menash\nFounder, SwiftCard")).toBe(true);
  });

  it("short and plain: no dashes for effect, no pricing, no exclamation marks", () => {
    for (const words of [m.ask, m.text, m.email.body]) {
      expect(words).not.toMatch(/[—–!]|\$\d|free trial|per month/);
      expect(words.length).toBeLessThan(600);
    }
    expect(m.ask.length).toBeLessThan(260);
  });

  it("never invents: no team, no logo and no sender name each just drop out", () => {
    const bare = buildMessages({ ...p, team_members: [], logo_url: null }, { link, sender: null });
    expect(bare.ask).toBe("Hi Dana, this is the founder of SwiftCard. I made a digital business card for you, in Harbor Realty Group's colors. Want me to text you the link?");
    expect(bare.email.body.endsWith("\n\nFounder, SwiftCard")).toBe(true);
    expect(bare.email.body).toContain("set up the whole office");
  });

  it("names a long team without listing it", () => {
    expect(teamNames(["A B", "C D"])).toBe("A and C");
    expect(teamNames(["A", "B", "C", "D", "E"])).toBe("A, B and 3 others");
    expect(possessive("Harbor Homes")).toBe("Harbor Homes'");
  });
});

describe("sent by hand, from the founder's own phone and inbox", () => {
  it("the buttons are links into Messages and Mail, with the number, the address and the words", () => {
    expect(smsHref("(212) 555-0199 x4", "Hi Dana, it's me & you")).toBe("sms:2125550199?&body=Hi%20Dana%2C%20it's%20me%20%26%20you");
    expect(smsHref("+1 212 555 0199", "x")).toBe("sms:+12125550199?&body=x");
    expect(mailtoHref("dana@harbor.example", "A & B", "line 1\nline 2")).toBe("mailto:dana@harbor.example?subject=A%20%26%20B&body=line%201%0Aline%202");
  });

  it("SwiftCard itself sends nothing: no email or SMS sender is imported anywhere in Card Builder", () => {
    for (const f of ["src/lib/prospect-preview/messages.ts", "src/lib/prospect-preview/store.ts", "src/app/api/admin/card-builder/[id]/route.ts", "src/app/admin/card-builder/send/[id]/SendMessage.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/from "@\/lib\/(email|resend|sms|twilio|mailer)[^"]*"|twilio|resend\.emails/i);
    }
  });

  it("pressing a button records the time and the channel; a message with the link can't be marked on an unpublished preview", () => {
    const store = readFileSync("src/lib/prospect-preview/store.ts", "utf8");
    expect(store).toMatch(/sent_at: at, sent_channel: kind/);
    expect(store).toMatch(/\.eq\("status", "live"\)\.gt\("expires_at", at\)/);
    const button = readFileSync("src/app/admin/card-builder/send/[id]/SendMessage.tsx", "utf8");
    expect(button).toContain('JSON.stringify({ action: "sent", kind, words })');
    expect(button).toContain("keepalive: true");
    const page = readFileSync("src/app/admin/card-builder/send/[id]/page.tsx", "utf8");
    expect(page).toMatch(/const admin = await requireAdmin\(\);\s*if \(!admin\) notFound\(\)/);
  });

  it("the SQL only adds columns", () => {
    const sql = readFileSync("supabase/prospect-previews-pipeline.sql", "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/\b(drop |delete from|update |truncate)\b/i);
    for (const c of ["asked_at", "sent_at", "sent_channel", "stage"]) expect(sql).toMatch(new RegExp(`add column if not exists ${c}\\s`));
  });
});
