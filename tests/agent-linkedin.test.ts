import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LI_DEFAULTS, LI_TRIGGERS, NOTE_MAX, STATUS_STAMP, buildDraftPrompt, clamp, fallbackDrafts, mergeLiSettings, nextStep, parseDrafts, prospectCode, startOfDayNY,
  type LiTrigger, type ProspectFacts,
} from "@/lib/linkedin-desk";
import { isCampaignSource, isSignupSource } from "@/lib/referral";
import { campaignDestination, campaignLink } from "@/lib/campaign-links";
import { getSignupSourceLabel } from "@/lib/source-labels";

// Owner order 2026-10-02: LinkedIn first, and "the main goal is to gain users".
// The LinkedIn desk writes the outreach and keeps the ledger; the owner sends.
// These pin the two things that keep it worth having: it can never act on
// LinkedIn by itself (that is what gets an account restricted), and a signup is
// countable against the exact person it came from.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const link = (profession: string | null) => campaignLink("li_d_abc12345", profession);
const facts = (trigger: LiTrigger, over: Partial<ProspectFacts> = {}): ProspectFacts => ({ name: "Dana Reyes", headline: "Realtor", company: "Compass", trigger, profession: null, hook: null, ...over });

describe("the desk never touches LinkedIn", () => {
  it("has no code path that calls LinkedIn — the owner's click is the only send", () => {
    const lib = code("src/lib/linkedin-desk.ts");
    const route = code("src/app/api/admin/agents/linkedin/route.ts");
    expect(lib).not.toMatch(/\bfetch\(/);
    expect(route).not.toMatch(/\bfetch\(/);
    for (const src of [lib, route]) {
      expect(src).not.toMatch(/api\.linkedin\.com|linkedin\.com\/(?:voyager|rest|v2)/);
      expect(src).not.toContain("agent-connections");
    }
  });
  it("the screen only links out to LinkedIn's own search, in a new tab", () => {
    const ui = code("src/app/admin/agent-flow/LinkedInDesk.tsx");
    expect(ui).toContain("https://www.linkedin.com/search/results/content/");
    expect(ui).toMatch(/datePosted=%22past-week%22/);
    // Every request the screen makes itself goes to our own route.
    expect(ui.match(/fetch\(([^,)]+)/g)).toEqual(["fetch(API", "fetch(API"]);
    expect(ui).toContain('const API = "/api/admin/agents/linkedin"');
  });
  it("is admin-only and service-role only", () => {
    const route = code("src/app/api/admin/agents/linkedin/route.ts");
    expect(route.match(/if \(!\(await requireAdmin\(\)\)\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\)/g)).toHaveLength(2);
    const sql = read("supabase/agent-linkedin.sql");
    expect(sql).toMatch(/alter table agent_li_prospects enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/create unique index if not exists agent_li_prospects_profile_idx on agent_li_prospects \(lower\(profile_url\)\)/);
  });
  it("is a tab in Agent Flow", () => {
    const client = read("src/app/admin/agent-flow/AgentFlowClient.tsx");
    expect(client).toMatch(/\["linkedin", "LinkedIn desk"\]/);
    expect(client).toContain('{view === "linkedin" && <LinkedInDesk />}');
  });
});

describe("every person has their own tracked link", () => {
  it("a prospect code is a valid signup source and lands in the builder", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = prospectCode();
      expect(c).toMatch(/^li_d_[a-f0-9]{8}$/);
      expect(isCampaignSource(c)).toBe(true);
      expect(isSignupSource(c)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
    expect(campaignDestination("li_d_abc12345", null)).toBe("/cards/new?src=li_d_abc12345");
    expect(getSignupSourceLabel("li_d_abc12345")).toMatch(/^LinkedIn/);
  });
  it("the route counts taps and signups by that code, and marks the signup itself", () => {
    const route = code("src/app/api/admin/agents/linkedin/route.ts");
    expect(route).toMatch(/\.eq\("name", "campaign_link_clicked"\)\.eq\("is_internal", false\)/);
    expect(route).toMatch(/\.like\("signup_source", "li\\\\_%"\)/);
    expect(route).toMatch(/status: "signed_up", signed_up_at/);
  });
});

describe("the drafts", () => {
  it("the model's reply is held to the limits, with the link in the message exactly once", () => {
    const raw = JSON.stringify({
      name: "Dana Reyes", headline: "Realtor", company: "Compass", trigger: "new_license", profession: "real-estate-agents",
      hook: "passed the exam on the second try",
      comment: ["Second try and you still posted the score. Respect. Try https://swiftcard.me now", "b"],
      note: ["Dana, " + "word ".repeat(80) + "see swiftcard.me/pricing", "short note {link}"],
      message: ["Thanks for connecting. I work with SwiftCard. Make yours here: {link} and again {link}", "No placeholder in this one"],
      followup: ["One thing agents like: the QR on the open-house table. https://swiftcard.me/go/whatever"],
    });
    const out = parseDrafts(raw, link, {})!;
    expect(out.facts).toMatchObject({ name: "Dana Reyes", trigger: "new_license", profession: "real-estate-agents" });
    const url = link("real-estate-agents");
    expect(url).toContain("/go/li_d_abc12345?for=real-estate-agents");
    for (const c of out.drafts.comment) expect(c).not.toMatch(/swiftcard\.me|https?:/);
    for (const n of out.drafts.note) { expect(n.length).toBeLessThanOrEqual(NOTE_MAX); expect(n).not.toMatch(/swiftcard\.me|\{link\}/); }
    for (const m of [...out.drafts.message, ...out.drafts.followup]) {
      expect(m.split(url)).toHaveLength(2);
      expect(m).not.toContain("{link}");
      expect(m).not.toContain("/go/whatever");
    }
  });
  it("someone we already know gets a message, never a cold note or comment", () => {
    const raw = JSON.stringify({ trigger: "other", comment: ["x"], note: ["y"], message: ["try it {link}"], followup: ["again {link}"] });
    const out = parseDrafts(raw, link, { trigger: "warm", name: "Sam" })!;
    expect(out.facts.trigger).toBe("warm");
    expect(out.facts.name).toBe("Sam");
    expect(out.drafts.comment).toEqual([]);
    expect(out.drafts.note).toEqual([]);
    expect(fallbackDrafts(facts("warm"), link(null)).note).toEqual([]);
  });
  it("garbage from the model is refused, and the plain versions still carry the link", () => {
    expect(parseDrafts(null, link, {})).toBeNull();
    expect(parseDrafts("Sorry, I can't help with that.", link, {})).toBeNull();
    expect(parseDrafts('{"message": []}', link, {})).toBeNull();
    for (const t of Object.keys(LI_TRIGGERS) as LiTrigger[]) {
      const d = fallbackDrafts(facts(t), link(null));
      expect(d.message.length).toBeGreaterThan(0);
      expect(d.comment).toEqual([]);
      for (const m of [...d.message, ...d.followup]) expect(m).toContain(link(null));
      for (const n of d.note) { expect(n.length).toBeLessThanOrEqual(NOTE_MAX); expect(n).toContain("I work with SwiftCard"); expect(n).not.toContain("swiftcard.me"); }
    }
  });
  it("the prompt states only what is true, and says who we are", () => {
    const p = buildDraftPrompt({ pasted: "I'm happy to share that I'm starting a new position as Realtor at Compass!", sender: "Aaron" });
    expect(p).toContain("I work with SwiftCard");
    expect(p).toContain("Never state a price, a number of users");
    expect(p).toContain("HARD LIMIT 190 characters");
    expect(p).not.toMatch(/\$\d/);
  });
  it("clamp never cuts mid-word and never exceeds the limit", () => {
    const long = "Congrats on the new role at Compass, the open-house season is about to start and ".repeat(5);
    const c = clamp(long, NOTE_MAX);
    expect(c.length).toBeLessThanOrEqual(NOTE_MAX);
    expect(long.startsWith(c)).toBe(true);
    expect(long[c.length]).toMatch(/[\s,]/);
  });
});

describe("the ledger", () => {
  const now = Date.parse("2026-10-10T15:00:00Z");
  const base = { trigger: "new_job", messaged_at: null, followup_sent_at: null };
  it("says what to do next, and when a follow-up is due", () => {
    expect(nextStep({ ...base, status: "new" }, now, 3)).toMatchObject({ due: true });
    expect(nextStep({ ...base, status: "new", trigger: "warm" }, now, 3).label).toBe("Send the message");
    expect(nextStep({ ...base, status: "requested" }, now, 3).due).toBe(false);
    expect(nextStep({ ...base, status: "connected" }, now, 3).due).toBe(true);
    expect(nextStep({ ...base, status: "messaged", messaged_at: "2026-10-09T15:00:00Z" }, now, 3)).toMatchObject({ due: false, label: "Waiting for a reply (follow-up in 2d)" });
    expect(nextStep({ ...base, status: "messaged", messaged_at: "2026-10-06T15:00:00Z" }, now, 3)).toMatchObject({ due: true });
    expect(nextStep({ ...base, status: "messaged", messaged_at: "2026-10-01T15:00:00Z", followup_sent_at: "2026-10-05T15:00:00Z" }, now, 3).due).toBe(false);
    expect(nextStep({ ...base, status: "replied" }, now, 3).due).toBe(true);
    expect(nextStep({ ...base, status: "signed_up" }, now, 3)).toEqual({ label: "Signed up", due: false });
  });
  it("each status stamps a column the schema has", () => {
    const sql = read("supabase/agent-linkedin.sql");
    for (const col of Object.values(STATUS_STAMP)) if (col) expect(sql).toMatch(new RegExp(`\\b${col}\\s+timestamptz`));
    expect(sql).toMatch(/followup_sent_at\s+timestamptz/);
  });
  it("the daily number is capped where LinkedIn starts restricting accounts", () => {
    expect(mergeLiSettings(null)).toEqual(LI_DEFAULTS);
    expect(mergeLiSettings({ daily_target: 500, followup_days: 0, senders: [" Aaron ", "", "Aaron"] })).toEqual({ senders: ["Aaron"], daily_target: 20, followup_days: 3 });
  });
  it("'today' is the owner's day in New York", () => {
    expect(startOfDayNY(new Date("2026-10-02T19:41:29Z"))).toBe("2026-10-02T04:00:00.000Z");
    expect(startOfDayNY(new Date("2026-10-03T02:00:00Z"))).toBe("2026-10-02T04:00:00.000Z");
  });
});
