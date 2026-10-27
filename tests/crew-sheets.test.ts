import { describe, expect, it, vi } from "vitest";
import { propose } from "@/lib/crew/approvals";
import { formatExamples } from "@/lib/crew/context";
import { decide } from "@/lib/crew/decide";
import { PUBLIC_KINDS, tier2Executable } from "@/lib/crew/execute";
import { link, safeCell, colLetter, a1 } from "@/lib/crew/google/sheets";
import { AGENTS } from "@/lib/crew/registry";
import { applyChange, applyPasteRow, applySuppressionRow } from "@/lib/crew/sheets/apply";
import { specHash } from "@/lib/crew/sheets/bootstrap";
import { applyControl, controlDefs, parseScheduleText } from "@/lib/crew/sheets/controls";
import { queueRows } from "@/lib/crew/sheets/derived";
import { SHEET_AGENT_IDS, TAB_WORKER_IDS } from "@/lib/crew/sheets/registry";
import { agentHash, approvalKey, approvalRows, buildRows, leadRows, linkedinIn, type RowSources } from "@/lib/crew/sheets/rows";
import { PIPELINE_STATUSES, TASK_STATUSES, hasKeyColumn } from "@/lib/crew/sheets/spec";
import { priorityOf, statusForApproval } from "@/lib/crew/sheets/status";
import { readableTabs } from "@/lib/crew/sheets/sync";
import { AGENT_TABS, ALL_TABS, INSTAGRAM_LINKEDIN_BIO, OPERATING_TABS, REDDIT_REPLY, tabsForAgent } from "@/lib/crew/sheets/tabs";
import { MemoryStore } from "@/lib/crew/store-memory";
import type { Approval, SheetRow } from "@/lib/crew/types";
import { writingProblems } from "@/lib/crew/writing-check";
import { fakeAgent, setup } from "./crew-helpers";

// ── The Google Sheets headquarters (src/lib/crew/sheets) ────────────────────
// One workbook, one tab per agent with its own columns, prepared messages and
// exact links, a Status the owner sets that becomes the same decision the
// admin buttons make, suppression that stops every channel, controls the
// backend validates, dry run on by default. Pinned here with no network: the
// row builders, the status words, the apply step and the controls are pure or
// run against the in-memory store.

const sources = (over: Partial<RowSources> = {}): RowSources => ({ approvals: [], leads: [], findings: [], people: [], facts: [], geoHistory: [], known: new Map(), blueskyLive: false, ...over });

function approval(o: Partial<Approval>): Approval {
  return {
    id: "0b2f6c1e-1111-4222-8333-444455556666",
    created_at: "2026-10-25T14:00:00Z",
    agent_id: "replies-reddit",
    team: "replies",
    kind: "reply",
    status: "pending",
    title: "Reddit r/realtors: Is there a cheaper way to do link in bio and a card?",
    summary: "They asked for a tool.",
    body: "Honestly one app that does both is easier. I built SwiftCard, so I'm biased.",
    platform: "reddit",
    target_url: "https://www.reddit.com/r/realtors/comments/abc123/is_there/xyz789/",
    person_id: null,
    debate: null,
    model_used: null,
    meta: { score: 0.82, angle: "cheaper link page", why: "They asked which tool to use.", asks_for_tools: true, author: "jane_sells", post_title: "Is there a cheaper way to do link in bio and a card?", community: "realtors", pitched: true },
    decided_at: null,
    reject_reason: null,
    done_at: null,
    expires_at: "2026-11-01T14:00:00Z",
    ...o,
  };
}

describe("the tabs", () => {
  it("has the twelve operating tabs in the spec's order, then one tab per marketing or outreach agent", () => {
    expect(OPERATING_TABS.slice(0, 12).map((t) => t.name)).toEqual(["Dashboard", "Today - Top 50", "Today - Action Queue", "All Leads", "Intent Leads", "Pipeline", "Meetings", "Source Stats", "Agent Performance", "Controls", "Activity Log", "Suppression List"]);
    expect(new Set(ALL_TABS.map((t) => t.id)).size).toBe(ALL_TABS.length);
    expect(new Set(ALL_TABS.map((t) => t.name)).size).toBe(ALL_TABS.length);
    for (const t of ALL_TABS) {
      if (t.layout === "rows" || t.layout === "derived") expect(hasKeyColumn(t) || t.id === "source-stats" || t.id === "performance" || t.id === "activity", `${t.name} ends with the Key column`).toBe(true);
      expect(new Set(t.columns.map((c) => c.key)).size, `${t.name} has unique column keys`).toBe(t.columns.length);
      if (t.layout !== "free") expect(t.description.length, `${t.name} explains itself`).toBeGreaterThan(40);
    }
  });

  it("every agent that drafts something has a tab of its own; the Watchdog and the Sheet keepers have none", () => {
    for (const id of TAB_WORKER_IDS) expect(tabsForAgent(id).length, `${id} has a tab`).toBeGreaterThan(0);
    for (const id of ["watch-bugs", "watch-security", "sheet-sync", "sheet-daily", "replies-manager"]) expect(tabsForAgent(id)).toEqual([]);
    expect(SHEET_AGENT_IDS.has("replies-reddit")).toBe(true);
    expect(SHEET_AGENT_IDS.has("watch-bugs")).toBe(false);
    expect(SHEET_AGENT_IDS.has("sheet-sync")).toBe(false);
    // Every agent tab that is live names at least one real agent.
    for (const t of AGENT_TABS.filter((x) => x.layout === "rows")) for (const id of t.agents) expect(AGENTS.some((d) => d.id === id), `${t.name} → ${id}`).toBe(true);
  });

  it("the Instagram LinkedIn Bio and Reddit Reply tabs carry exactly the spec's columns, in order", () => {
    expect(INSTAGRAM_LINKEDIN_BIO.columns.map((c) => c.header)).toEqual(["Priority", "Name", "Occupation", "Company", "Instagram Username", "Instagram Profile", "LinkedIn Profile", "Location", "Reason They're a Fit", "Personalization Detail", "Message to Send", "Open Instagram", "Status", "Date Found", "Date Contacted", "Notes", "Key"]);
    expect(REDDIT_REPLY.columns.map((c) => c.header)).toEqual(["Priority", "Subreddit", "Thread Title", "Reddit Username", "Original Post or Comment", "What They're Asking", "Why It's Relevant", "Suggested Reply", "Open Exact Reply Location", "Status", "Date Found", "Date Posted", "Upvotes / Engagement", "Notes", "Key"]);
  });

  it("status words: an approved draft is never a sent one, and the pipeline has the original eight", () => {
    expect(TASK_STATUSES).toContain("Approved");
    expect(TASK_STATUSES).toContain("Sent / Posted");
    expect([...PIPELINE_STATUSES]).toEqual(["New", "Queued", "Contacted", "Replied", "Meeting", "Customer", "Not Interested", "Unsubscribed"]);
    expect(statusForApproval(approval({ status: "approved" }))).toBe("Approved");
    expect(statusForApproval(approval({ status: "done" }))).toBe("Sent / Posted");
    expect(statusForApproval(approval({ status: "done", kind: "blog_post" }))).toBe("Completed");
    expect(statusForApproval(approval({ status: "pending", meta: { needs_review: true } }))).toBe("Needs Review");
    expect(statusForApproval(approval({ status: "pending" }))).toBe("Ready");
    expect(statusForApproval(approval({ status: "rejected" }))).toBe("Skipped");
    // The owner's own words stick.
    expect(statusForApproval(approval({ status: "done" }), { status: "Replied" })).toBe("Replied");
    expect(statusForApproval(approval({ status: "rejected" }), { status: "Not Interested" })).toBe("Not Interested");
    expect(priorityOf(approval({}))).toBe("High");
    expect(priorityOf(approval({ meta: { score: 0.5 } }))).toBe("Low");
    expect(priorityOf(approval({ kind: "code_fix", meta: { severity: "critical" } }))).toBe("High");
  });

  it("the spec hash changes when a column changes, so the workbook is re-shaped once", () => {
    const a = specHash();
    const b = specHash([{ ...REDDIT_REPLY, columns: REDDIT_REPLY.columns.slice(1) }]);
    expect(a).not.toBe(b);
    expect(a).toBe(specHash());
  });
});

describe("rows", () => {
  it("a Reddit reply becomes a row with the exact comment link and no post body (Reddit's terms)", () => {
    const [row] = approvalRows(approval({}), sources());
    expect(row.tab.id).toBe("reddit-reply");
    expect(row.key).toBe(approvalKey("0b2f6c1e-1111-4222-8333-444455556666"));
    expect(row.key).toMatch(/^A-[a-f0-9]{10}$/);
    expect(row.cells).toMatchObject({ priority: "High", subreddit: "r/realtors", who: "u/jane_sells", asking: "cheaper link page", why: "They asked which tool to use.", date_found: "2026-10-25" });
    expect(String(row.cells.post)).not.toContain("Honestly");
    expect(row.cells.open).toBe('=HYPERLINK("https://www.reddit.com/r/realtors/comments/abc123/is_there/xyz789/","Open thread / comment")');
    expect(row.initialStatus).toBe("Ready");
  });

  it("an Instagram link-in-bio prospect gets the profile, the LinkedIn link from the bio and a DM link that opens the app", () => {
    const a = approval({ agent_id: "contact-instagram-linkinbio", team: "contact", kind: "dm", platform: "instagram", target_url: "https://www.instagram.com/jane.realtor/", meta: { score: 0.7, author: "@Jane.Realtor", excerpt: "Realtor in Austin. linkedin.com/in/jane-realtor", why: "Uses Linktree", angle: "bio links out" } });
    const [row] = approvalRows(a, sources());
    expect(row.tab.id).toBe("instagram-linkedin-bio");
    expect(row.cells.username).toBe("@jane.realtor");
    expect(row.cells.profile).toContain("https://www.instagram.com/jane.realtor/");
    expect(row.cells.linkedin).toContain("https://www.linkedin.com/in/jane-realtor/");
    expect(row.cells.open).toBe('=HYPERLINK("https://ig.me/m/jane.realtor","Open DM (Instagram app)")');
    expect(linkedinIn("see https://www.linkedin.com/in/some-one/ for more")).toBe("https://www.linkedin.com/in/some-one/");
    expect(linkedinIn("nothing here")).toBeNull();
  });

  it("a cold lead lands on All Leads with a source link; an office lead on Office Prospects", () => {
    const [cold] = leadRows({ id: "11111111-2222-3333-4444-555555555555", created_at: "2026-10-25T10:00:00Z", list: "cold", email: "hi@acme.com", company: "Acme Realty", business_type: "real estate offices", city: "Charlotte", region: "NC", source_platform: "web", source_url: "https://acme.com/contact" }, sources());
    // Each lead lands on its own agent's tab; All Leads is the combined view rebuilt every sync.
    expect(cold.tab.id).toBe("web-leads");
    expect(cold.key).toMatch(/^L-[a-f0-9]{10}$/);
    expect(cold.cells).toMatchObject({ email: "hi@acme.com", business: "Acme Realty", industry: "real estate offices", state: "NC", email_status: "Risky", source_platform: "Web" });
    expect(cold.cells.website).toContain("https://acme.com");
    const [office] = leadRows({ id: "11111111-2222-3333-4444-555555555556", created_at: "2026-10-25T10:00:00Z", list: "office", name: "Sam Broker", title: "Broker", phone: "2125550100", email: null, company: "NYC Team", business_type: "real estate teams", source_platform: "web", source_url: "https://nycteam.com", notes: "They just opened a second office." }, sources());
    expect(office.tab.id).toBe("office-prospects");
    expect(office.cells).toMatchObject({ company: "NYC Team", name: "Sam Broker", talking_point: "They just opened a second office." });
  });

  it("cells never run as formulas, links are quoted, and the agent hash ignores the owner's columns", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("+1 555")).toBe("'+1 555");
    expect(safeCell("hello")).toBe("hello");
    expect(safeCell(link("https://x.com/a", 'say "hi"'))).toBe('=HYPERLINK("https://x.com/a","say ""hi""")');
    expect(link("javascript:alert(1)", "x")).toBe("");
    expect(colLetter(0)).toBe("A");
    expect(colLetter(26)).toBe("AA");
    expect(a1("Today - Top 50", "A2:C3")).toBe("'Today - Top 50'!A2:C3");
    const [row] = approvalRows(approval({}), sources());
    const h1 = agentHash(row.tab, row.cells);
    expect(agentHash(row.tab, { ...row.cells, notes: "my note", status: "Replied" })).toBe(h1);
    expect(agentHash(row.tab, { ...row.cells, message: "changed" })).not.toBe(h1);
  });

  it("the Action Queue lists open drafts most important first, with the agent's tab and the same Key", () => {
    const known = new Map<string, SheetRow>();
    const high = approval({ id: "aaaaaaaa-0000-4000-8000-000000000001", meta: { score: 0.9, author: "a" } });
    const low = approval({ id: "aaaaaaaa-0000-4000-8000-000000000002", meta: { score: 0.5, author: "b" } });
    const done = approval({ id: "aaaaaaaa-0000-4000-8000-000000000003", status: "done" });
    const built = buildRows(sources({ approvals: [low, high, done], known }));
    const q = queueRows(built, known, "sheet1", { gid: new Map([["Reddit Reply", 7]]), rowOf: new Map([[approvalKey(high.id), 5]]) });
    expect(q.map((r) => r[0])).toEqual(["High", "Low"]);
    expect(q[0][1]).toBe("Reddit Reply");
    expect(q[0][10]).toBe(approvalKey(high.id));
    expect(String(q[0][9])).toContain("gid=7&range=A5");
  });
});

describe("what a change in the Sheet does", () => {
  async function drafted(o: { kind?: Approval["kind"]; platform?: "reddit" | "instagram" | "bluesky"; handle?: string } = {}) {
    const { store, ctx } = await setup({ def: fakeAgent({ id: "contact-reddit", team: "contact", approvalKind: o.kind ?? "dm" }) });
    const r = await propose(ctx, { kind: o.kind ?? "dm", title: "Reddit DM to u/jane", summary: "s", body: "Saw your post about Linktree. One app for the card and the links was the fix for me.", platform: o.platform ?? "reddit", targetUrl: "https://www.reddit.com/r/x/comments/1/a/", person: { platform: o.platform ?? "reddit", handle: o.handle ?? "u/jane" } });
    if (!r.ok) throw new Error(r.reason);
    const a = (await store.getApproval(r.id))!;
    const key = approvalKey(a.id);
    await store.upsertSheetRow({ tab: "reddit-dms", row_key: key, entity_kind: "approval", entity_id: a.id, status: "Ready", owner_cols: {}, agent_hash: "x", synced_at: null, owner_edited_at: null });
    return { store, ctx, a, key };
  }

  it("Sent / Posted on a pending draft approves it and records the contact; it never sends anything", async () => {
    const { store, a, key } = await drafted();
    const r = await applyChange(store, { rowKey: key, column: "status", value: "Sent / Posted", by: "owner@example.com" });
    expect(r.ok).toBe(true);
    expect((await store.getApproval(a.id))!.status).toBe("done");
    expect(store.touches.some((t) => t.person_id === a.person_id && t.kind === "dm_sent")).toBe(true);
    expect((await store.getSheetRow(key))!.status).toBe("Sent / Posted");
    expect(store.activity.map((x) => x.action)).toEqual(["status"]);
    expect(store.activity[0].approved_by).toBe("owner@example.com");
  });

  it("Unsubscribed stops every channel: suppression per identity, an opted_out touch, and no new draft to that person", async () => {
    const { store, ctx, a, key } = await drafted();
    await applyChange(store, { rowKey: key, column: "status", value: "Unsubscribed", by: "owner" });
    expect((await store.getApproval(a.id))!.status).toBe("rejected");
    expect(await store.isSuppressed(["reddit:u/jane"])).toBe(true);
    expect(store.touches.some((t) => t.person_id === a.person_id && t.kind === "opted_out")).toBe(true);
    const again = await propose(ctx, { kind: "dm", title: "again", summary: "s", body: "hello again", platform: "reddit", targetUrl: "https://www.reddit.com/r/x/comments/2/b/", person: { platform: "reddit", handle: "u/Jane" } });
    expect(again).toEqual({ ok: false, reason: "on the suppression list" });
    expect(store.activity.map((x) => x.action)).toContain("suppressed");
  });

  it("Approved does not send; Skipped rejects; a nonsense word is refused and the old word comes back", async () => {
    const { store, a, key } = await drafted();
    expect((await applyChange(store, { rowKey: key, column: "status", value: "Approved", by: "owner" })).ok).toBe(true);
    expect((await store.getApproval(a.id))!.status).toBe("approved");
    const bad = await applyChange(store, { rowKey: key, column: "status", value: "Maybe later", by: "owner" });
    expect(bad).toMatchObject({ ok: false, status: "Approved" });
    expect((await applyChange(store, { rowKey: key, column: "status", value: "Skipped", by: "owner" })).ok).toBe(true);
    expect((await store.getApproval(a.id))!.status).toBe("rejected");
  });

  it("an edited message is saved, becomes the draft, and is shown to the model as an example; agent columns are refused", async () => {
    const { store, a, key } = await drafted();
    const r = await applyChange(store, { rowKey: key, column: "message", value: "Hey, saw the Linktree post. One app did both for me, happy to show you.", by: "owner" });
    expect(r.ok).toBe(true);
    expect((await store.getApproval(a.id))!.body).toContain("happy to show you");
    const edits = await store.recentEdits("contact-reddit", "dm", 30);
    expect(edits).toHaveLength(1);
    expect(formatExamples(edits)).toContain("Owner's version");
    expect(formatExamples([])).toBe("");
    const refused = await applyChange(store, { rowKey: key, column: "why", value: "x", by: "owner" });
    expect(refused.ok).toBe(false);
    expect((await applyChange(store, { rowKey: key, column: "notes", value: "call Monday", by: "owner" })).ok).toBe(true);
    expect((await store.getSheetRow(key))!.owner_cols.notes).toBe("call Monday");
  });

  it("rows the owner types into the Suppression List and Paste a Post are taken in", async () => {
    const store = new MemoryStore();
    expect(await applySuppressionRow(store, "Someone@Example.com", "asked us to stop", "owner")).toBe(true);
    expect(await applySuppressionRow(store, "@spam.example", "", "owner")).toBe(true);
    expect(await applySuppressionRow(store, "instagram:@jane", "", "owner")).toBe(true);
    expect(await applySuppressionRow(store, "not an address", "", "owner")).toBe(false);
    expect(await store.isSuppressed(["someone@example.com", "@spam.example", "instagram:@jane"])).toBe(true);
    expect((await store.listSuppression(10)).map((s) => s.channel).sort()).toEqual(["domain", "email", "instagram"]);
    expect(await applyPasteRow(store, { platform: "Facebook", url: "", kind: "", text: "A long enough pasted post from a group about business cards." })).toBe(true);
    expect(await applyPasteRow(store, { platform: "myspace", url: "", kind: "post", text: "A long enough pasted post." })).toBe(false);
    expect(await store.countNewInputs(["facebook"])).toBe(1);
  });
});

describe("controls", () => {
  it("reads schedules written in plain words, and refuses anything faster than 15 minutes", () => {
    expect(parseScheduleText("every 30 min")).toEqual({ kind: "every", minutes: 30 });
    expect(parseScheduleText("Every 2 hours")).toEqual({ kind: "every", minutes: 120 });
    expect(parseScheduleText("daily 9:00am")).toEqual({ kind: "daily", hour: 9, minute: 0 });
    expect(parseScheduleText("Mon, Wed 8:00am")).toEqual({ kind: "daily", hour: 8, minute: 0, days: [1, 3] });
    expect(parseScheduleText("weekdays 5pm")).toEqual({ kind: "daily", hour: 17, minute: 0, days: [1, 2, 3, 4, 5] });
    expect(parseScheduleText("default")).toBe("default");
    expect(parseScheduleText("every 5 min")).toBeNull();
    expect(parseScheduleText("whenever")).toBeNull();
  });

  it("only known keys with allowed values change anything; dry run starts on; a bad value comes back as the old one", async () => {
    const store = new MemoryStore();
    expect((await store.getControls()).dry_run).toBe(true);
    expect(await applyControl(store, "dry_run", "No", "owner")).toMatchObject({ ok: true, shown: "No" });
    expect((await store.getControls()).dry_run).toBe(false);
    expect(await applyControl(store, "dry_run", "maybe", "owner")).toMatchObject({ ok: false, shown: "No" });
    expect(await applyControl(store, "pause_all", "Yes", "owner")).toMatchObject({ ok: true });
    expect((await store.getSettings()).kill_all).toBe(true);
    expect(await applyControl(store, "daily_usd_cap", "$7.50", "owner")).toMatchObject({ ok: true, shown: "7.5" });
    expect(await applyControl(store, "daily_usd_cap", "9999", "owner")).toMatchObject({ ok: false });
    expect(await applyControl(store, "agent:replies-reddit", "Start", "owner")).toMatchObject({ ok: true, shown: "Running" });
    expect((await store.getAgentState("replies-reddit")).enabled).toBe(true);
    expect(await applyControl(store, "agent:leads-linkedin", "Start", "owner")).toMatchObject({ ok: true, shown: "Stopped" });
    expect(await applyControl(store, "agent:watch-bugs", "Off", "owner")).toMatchObject({ ok: false, message: "unknown setting" });
    expect(await applyControl(store, "tier:bluesky", "Approval posts it", "owner")).toMatchObject({ ok: true });
    expect(await applyControl(store, "tier:reddit", "Approval posts it", "owner")).toMatchObject({ ok: false });
    expect(await applyControl(store, "schedule:replies-reddit", "weekdays 10am", "owner")).toMatchObject({ ok: true, shown: "Weekdays at 10:00am" });
    expect(await applyControl(store, "paid:x_api", "Yes", "owner")).toMatchObject({ ok: true });
    expect(store.activity.filter((a) => a.action === "control").length).toBeGreaterThan(5);
    const keys = controlDefs().map((d) => d.key);
    expect(keys).toContain("pause_all");
    expect(keys.filter((k) => k.startsWith("agent:")).every((k) => SHEET_AGENT_IDS.has(k.slice(6)))).toBe(true);
    expect(keys.some((k) => k === "agent:watch-bugs")).toBe(false);
  });
});

describe("dry run and the outward gate", () => {
  it("in dry run an approved blog post is simulated, logged, and stays approved; off, it would publish", async () => {
    const { store, ctx } = await setup({ def: fakeAgent({ id: "marketing-blog", team: "marketing", approvalKind: "blog_post" }) });
    const r = await propose(ctx, { kind: "blog_post", title: "Blog: A HiHello alternative", summary: "s", body: "# Post", platform: "site", meta: { slug: "hihello-alternative", description: "d" } });
    if (!r.ok) throw new Error(r.reason);
    const d = await decide(store, r.id, { action: "approve", by: "owner" });
    expect(d.ok).toBe(true);
    expect(d.message).toContain("Dry run");
    expect((await store.getApproval(r.id))!.status).toBe("approved");
    expect(store.activity).toHaveLength(1);
    expect(store.activity[0]).toMatchObject({ action: "publish", result: "simulated", simulated: true, target: "/blog/hihello-alternative" });
    expect(PUBLIC_KINDS).toEqual(["blog_post", "reply", "comment", "post"]);
  });

  it("a Bluesky reply posts itself only when the owner set the tier to Approval and the account is connected", () => {
    const a = { kind: "reply" as const, platform: "bluesky" as const };
    expect(tier2Executable(a, { "tier:bluesky": "Approval posts it" })).toBe(false); // no BLUESKY_* in tests
    vi.stubEnv("BLUESKY_HANDLE", "swiftcardapp.bsky.social");
    vi.stubEnv("BLUESKY_APP_PASSWORD", "xxxx-xxxx");
    expect(tier2Executable(a, { "tier:bluesky": "Approval posts it" })).toBe(true);
    expect(tier2Executable(a, { "tier:bluesky": "Copy & open" })).toBe(false);
    expect(tier2Executable({ kind: "reply", platform: "reddit" }, { "tier:bluesky": "Approval posts it" })).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("the writing check", () => {
  it("flags the owner's banned phrases, em dashes, stacked exclamation points, pitch bullets and long cold emails", () => {
    expect(writingProblems("I hope this finds you well. Let's leverage this to elevate your brand!!")).toEqual(expect.arrayContaining(['uses "i hope this finds you well"', 'uses "leverage"', 'uses "elevate"', "stacked exclamation points"]));
    expect(writingProblems("Saw your post — nice.")).toContain("uses an em dash");
    expect(writingProblems("Here's why:\n- fast\n- cheap\n- easy", { kind: "dm" })).toContain("reads like a bullet-point sales pitch");
    expect(writingProblems("Great tip #networking #cards", { kind: "reply", platform: "reddit" })).toContain("has hashtags");
    expect(writingProblems("Subject: hi\n" + "word ".repeat(90), { kind: "cold_email" })).toEqual(expect.arrayContaining([expect.stringContaining("cold email limit is 80")]));
    expect(writingProblems("Saw your post about losing leads at the expo. One card that saves their number back fixed that for me.")).toEqual([]);
  });

  it("a draft that fails reaches the Sheet marked Needs Review instead of vanishing", async () => {
    const { store, ctx } = await setup();
    const r = await propose(ctx, { kind: "reply", title: "t", summary: "s", body: "I hope this finds you well. Here is a thought.", platform: "quora", targetUrl: "https://quora.com/q/1" });
    if (!r.ok) throw new Error(r.reason);
    const a = (await store.getApproval(r.id))!;
    expect(a.meta.needs_review).toBe(true);
    expect(a.meta.writing_problems).toEqual(['uses "i hope this finds you well"']);
    expect(statusForApproval(a)).toBe("Needs Review");
  });
});

describe("the sync reads what the owner can change", () => {
  it("includes every agent tab, the Action Queue and the Controls, but never the Dashboard or a placeholder", () => {
    const ids = readableTabs().map((t) => t.id);
    expect(ids).toContain("reddit-reply");
    expect(ids).toContain("queue");
    expect(ids).toContain("controls");
    expect(ids).toContain("suppression");
    expect(ids).toContain("paste");
    expect(ids).not.toContain("dashboard");
    expect(ids).not.toContain("x-replies");
  });
});
