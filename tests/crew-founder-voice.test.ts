import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BANNED_PHRASES, HUMAN_VOICE, voiceProblems } from "@/lib/crew/voice";
import { assessPrompt } from "@/lib/crew/leads/assess";
import { leadsFromSite } from "@/lib/crew/agents/leads";
import { emailComposeLink } from "@/lib/crew/exact-links";
import { leadRows } from "@/lib/crew/sheets/rows";

// Founder-led outreach (owner, 2026-11-04): every message reads like Menash,
// one of the two founders, wrote it after a minute on their site. One
// verified detail, why it could help them, an offer to show them a sample
// with their branding, one low pressure question. No pricing, no demo or
// call request, no invented problems, no em dashes.

describe("the shared voice", () => {
  it("is one founder offering something useful, not a pitch", () => {
    expect(HUMAN_VOICE).toMatch(/one of the two founders of SwiftCard/);
    expect(HUMAN_VOICE).toMatch(/offering them something useful, not asking them to buy something/);
    expect(HUMAN_VOICE).toMatch(/sample card with their name or branding/);
    expect(HUMAN_VOICE).toMatch(/No pricing unless they asked/);
    expect(HUMAN_VOICE).toMatch(/Never ask for a demo, a call or a meeting in a first message/);
    expect(HUMAN_VOICE).toMatch(/Never invent a problem/);
    expect(HUMAN_VOICE).toMatch(/Email 60 to 100 words/);
    // The old push: name a cost they live with, always say "free to start".
    expect(HUMAN_VOICE).not.toMatch(/small cost they're living with/);
    expect(HUMAN_VOICE).not.toMatch(/free to start/);
    // Kept from before.
    expect(HUMAN_VOICE).toMatch(/No hyphens at all/);
  });
  it("personalizes on what connects to their business, never unrelated trivia", () => {
    expect(HUMAN_VOICE).toMatch(/ONE specific detail about their business[^.]*connects to why SwiftCard could help/);
    expect(HUMAN_VOICE).toMatch(/Never personal trivia unrelated to that \(hobbies, schools, a past career, family\), even when it's true/);
  });
  it("never forces a SwiftCard mention where the instructions forbid one", () => {
    // The engine tells non-promotional replies "Do NOT mention SwiftCard or any product"; the shared voice must agree.
    expect(HUMAN_VOICE).not.toMatch(/Every message mentions SwiftCard/);
    expect(HUMAN_VOICE).toMatch(/When they say not to mention SwiftCard or any product[^.]*don't, and drop the founder offer/);
    expect(readFileSync("src/lib/crew/replies/engine.ts", "utf8")).toMatch(/Do NOT mention SwiftCard or any product, and include no link/);
  });
  it("turns away the phrases that make it read like a campaign", () => {
    for (const p of ["i hope this email finds you well", "impressive", "revolutionize", "your workflow", "unlock your potential", "quick demo", "10 minute call"]) expect(BANNED_PHRASES).toContain(p);
    expect(voiceProblems("I hope this email finds you well. Your impressive team could revolutionize your workflow — book a quick demo?")).toEqual(
      expect.arrayContaining(['uses "i hope this email finds you well"', 'uses "impressive"', 'uses "revolutionize"', 'uses "your workflow"', 'uses "quick demo"', "uses an em dash"]),
    );
  });
});

describe("every agent asks for this style", () => {
  it("Instagram DMs and replies: founder, specific, an offer, no pricing", () => {
    const engine = readFileSync("src/lib/crew/replies/engine.ts", "utf8");
    expect(engine).toMatch(/offer to make them a sample card/);
    expect(engine).toMatch(/Never invent a problem they didn't mention\. No pricing/);
    expect(engine).not.toMatch(/Mention that it's free to start/);
  });
  it("Office emails: an offer of a sample with their branding, never a 10-minute call", () => {
    const office = readFileSync("src/lib/crew/agents/office.ts", "utf8");
    expect(office).toMatch(/offer to put together a sample card with their branding/);
    expect(office).toMatch(/No pricing, no demo or call request/);
    expect(office).not.toMatch(/10-minute call/);
  });
  it("Web Leads: a whole first email with its own subject, not a one-line opener", () => {
    const { prompt } = assessPrompt([{ name: "Acme Insurance", website: "https://acme.example.com", type: "insurance agencies", area: "Chicago", pages: [{ url: "https://acme.example.com/", html: "Acme Insurance" }] }], { office: false });
    expect(prompt).toMatch(/the whole first email to them, from Menash/);
    expect(prompt).toMatch(/First line "Subject: "/);
    expect(prompt).toMatch(/60 to 100 words/);
    expect(prompt).toMatch(/offer to put together a sample card with their branding/);
    expect(prompt).not.toMatch(/under 30 words/);
    // The Office call opener is still a phone script.
    expect(assessPrompt([], { office: true }).prompt).toMatch(/what the caller says when someone picks up/);
  });
});

describe("Web Leads rows carry the whole email", () => {
  const email = "Subject: Cards for the Acme team\n\nHi Dana,\n\nI was on Acme's Meet the Team page and saw you've got eight agents across two offices. I'm one of the two founders of SwiftCard, and we make matching digital business cards for teams, so everyone's details look the same and save with one tap. I'd be happy to put together a sample with Acme's branding so you can see it. Want me to send one over?\n\nMenash";
  const pages = [{ url: "https://acme.example.com/team", html: "<h2>Dana Ortiz</h2><p>Owner</p><p>dana@acme.example.com</p><p>eight agents across two offices</p>" }];
  const found = { i: 0, fit: 30, why: "", hook: "", talking_point: "", opener: email, people: [{ name: "Dana Ortiz", title: "Owner", email: "dana@acme.example.com", phone: "" }] };

  it("keeps it whole (it was cut at 300 characters), with the subject on the email link", () => {
    expect(email.length).toBeGreaterThan(300);
    const [row] = leadsFromSite({ name: "Acme Insurance", website: "https://acme.example.com/" }, pages, "insurance agencies", found);
    expect(row.message).toBe(email);
    const link = emailComposeLink(row.email!, row.message!)!;
    expect(link).toMatch(/^mailto:dana@acme\.example\.com\?subject=Cards%20for%20the%20Acme%20team&body=Hi%20Dana/);
  });
  it("fills the Google Sheets email link: recipient, subject and body", () => {
    const [lead] = leadsFromSite({ name: "Acme Insurance", website: "https://acme.example.com/" }, pages, "insurance agencies", found);
    const [row] = leadRows({ ...lead, id: "11111111-2222-3333-4444-555555555555", created_at: "2026-11-04T15:00:00Z" }, { approvals: [], leads: [], known: new Map() });
    const cell = String(row.cells.link);
    expect(cell).toMatch(/^=HYPERLINK\("mailto:dana@acme\.example\.com\?subject=Cards%20for%20the%20Acme%20team&body=Hi%20Dana%2C%0A%0AI%20was%20on/);
    expect(cell).toContain(encodeURIComponent("Want me to send one over?\n\nMenash"));
    expect(cell).not.toContain(encodeURIComponent("Subject:")); // the subject line isn't repeated in the body
    expect(cell).toMatch(/"Email dana@acme\.example\.com"\)$/);
    expect(row.cells.message).toBe(email);
  });
  it("never lets a dash through", () => {
    const [row] = leadsFromSite({ name: "Acme Insurance", website: "https://acme.example.com/" }, pages, "insurance agencies", { ...found, opener: "Subject: Acme cards\n\nHi Dana — quick idea for the team.\n\nMenash" });
    expect(row.message).not.toMatch(/[—–]/);
  });
  it("still drops a message that greets someone the site doesn't name", () => {
    const [row] = leadsFromSite({ name: "Acme Insurance", website: "https://acme.example.com/" }, pages, "insurance agencies", { ...found, opener: "Subject: Hi\n\nHi Robert, quick idea.\n\nMenash", people: [...found.people, { name: "Robert Fake", title: "CEO", email: "", phone: "" }] });
    expect(row.message).toBeNull();
  });
});
