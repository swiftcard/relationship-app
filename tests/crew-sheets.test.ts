import { describe, expect, it, vi } from "vitest";
import { propose } from "@/lib/crew/approvals";
import { formatExamples } from "@/lib/crew/context";
import { decide } from "@/lib/crew/decide";
import { PUBLIC_KINDS, tier2Executable } from "@/lib/crew/execute";
import { link, safeCell, colLetter, a1 } from "@/lib/crew/google/sheets";
import { AGENTS } from "@/lib/crew/registry";
import { applyChange, applyPasteRow, markSent } from "@/lib/crew/sheets/apply";
import { specHash } from "@/lib/crew/sheets/bootstrap";
import { applyControl, controlDefs, parseScheduleText } from "@/lib/crew/sheets/controls";
import { SHEET_AGENT_IDS, TAB_WORKER_IDS } from "@/lib/crew/sheets/registry";
import { NEEDS_MESSAGE, NO_LINK, agentHash, approvalKey, approvalRows, buildRows, leadRows, linkedinIn, type RowSources } from "@/lib/crew/sheets/rows";
import { PIPELINE_STATUSES, TASK_STATUSES, hasKeyColumn } from "@/lib/crew/sheets/spec";
import { priorityOf, statusForApproval } from "@/lib/crew/sheets/status";
import { readableTabs } from "@/lib/crew/sheets/sync";
import { AGENT_TABS, ALL_TABS, OPERATING_TABS, PASTE, REDDIT_REPLY, RETIRED_TAB_NAMES, SEND_COLUMNS, tabsForAgent } from "@/lib/crew/sheets/tabs";
import { MemoryStore } from "@/lib/crew/store-memory";
import type { Approval, SheetRow } from "@/lib/crew/types";
import { stripEmDashes } from "@/lib/crew/voice";
import { writingProblems } from "@/lib/crew/writing-check";
import { fakeAgent, setup } from "./crew-helpers";

// ── The Google Sheets headquarters (src/lib/crew/sheets) ────────────────────
// Owner, 2026-10-29: "I just want you to give me the person's name, the
// message to either write to them or reply to them, a link directly to where
// they literally just paste the message and send it. I only want those three
// things." One tab per agent, Name, Message, Link (the Key hidden), Paste a
// Post the only other tab. "sent" typed over a message finishes its row; a
// deleted row records nothing and comes back (2026-10-29). Pinned here with
// no network: the row builders, the status words, the apply step.

const sources = (over: Partial<RowSources> = {}): RowSources => ({ approvals: [], leads: [], known: new Map(), ...over });

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

const href = (cell: unknown) => /=HYPERLINK\("([^"]+)"/.exec(String(cell))?.[1] ?? null;

describe("the tabs", () => {
  it("every agent tab is Name, Message, Link and a hidden Key, and nothing else", () => {
    expect(SEND_COLUMNS.map((c) => c.header)).toEqual(["Name", "Message", "Link", "Key"]);
    for (const t of AGENT_TABS) {
      expect(t.columns, t.name).toBe(SEND_COLUMNS);
      expect(hasKeyColumn(t), `${t.name} ends with the Key`).toBe(true);
      expect(t.description.length, `${t.name} explains itself`).toBeGreaterThan(40);
      expect(t.description).toContain("type sent over the message");
      expect(t.description).toContain("Deleting a row records nothing");
      expect(t.description).not.toMatch(/counts as sent/);
    }
    expect(new Set(ALL_TABS.map((t) => t.id)).size).toBe(ALL_TABS.length);
    expect(new Set(ALL_TABS.map((t) => t.name)).size).toBe(ALL_TABS.length);
  });

  it("Paste a Post is the only other tab; the old operating tabs and the removed agents' tabs are retired by name", () => {
    expect(OPERATING_TABS).toEqual([PASTE]);
    for (const name of ["Dashboard", "Today - Action Queue", "Pipeline", "Controls", "Activity Log", "Blog Writer", "Social Media", "SEO Opportunities", "Competitor Intel", "Events", "Partnerships"]) {
      expect(RETIRED_TAB_NAMES, name).toContain(name);
      expect(ALL_TABS.map((t) => t.name)).not.toContain(name);
    }
  });

  it("every agent that writes messages has a tab of its own, every tab has a real agent, and X and TikTok are covered", () => {
    for (const id of TAB_WORKER_IDS) expect(tabsForAgent(id).length, `${id} has a tab`).toBeGreaterThan(0);
    for (const id of ["watch-bugs", "watch-security", "sheet-sync", "sheet-daily", "watchdog-manager"]) expect(tabsForAgent(id)).toEqual([]);
    for (const t of AGENT_TABS) for (const id of t.agents) expect(AGENTS.some((d) => d.id === id), `${t.name} → ${id}`).toBe(true);
    for (const id of ["replies-x", "contact-x", "replies-tiktok", "contact-tiktok"]) expect(tabsForAgent(id).length, id).toBe(1);
    expect(SHEET_AGENT_IDS.has("replies-reddit")).toBe(true);
    expect(SHEET_AGENT_IDS.has("watch-bugs")).toBe(false);
  });

  it("the removed agents are gone from the whole system, and every other worker writes to the Sheet (owner, 2026-10-29)", () => {
    for (const id of ["marketing-blog", "marketing-seo", "marketing-geo", "marketing-social", "competitor-watch", "events", "partnerships", "leads-reddit", "leads-quora", "leads-facebook", "leads-alignable", "leads-linkedin"]) {
      expect(AGENTS.some((d) => d.id === id), id).toBe(false);
    }
    for (const d of AGENTS.filter((x) => x.role === "worker" && !x.infrastructure && x.team !== "watchdog")) expect(tabsForAgent(d.id).length, d.id).toBe(1);
  });

  it("status words: an approved draft is never a sent one, and the pipeline has the original eight", () => {
    expect(TASK_STATUSES).toContain("Approved");
    expect(TASK_STATUSES).toContain("Sent / Posted");
    expect([...PIPELINE_STATUSES]).toEqual(["New", "Queued", "Contacted", "Replied", "Meeting", "Customer", "Not Interested", "Unsubscribed"]);
    expect(statusForApproval(approval({ status: "approved" }))).toBe("Approved");
    expect(statusForApproval(approval({ status: "done" }))).toBe("Sent / Posted");
    expect(statusForApproval(approval({ status: "pending", meta: { needs_review: true } }))).toBe("Needs Review");
    expect(statusForApproval(approval({ status: "pending" }))).toBe("Ready");
    expect(statusForApproval(approval({ status: "rejected" }))).toBe("Skipped");
    expect(priorityOf(approval({}))).toBe("High");
  });

  it("the spec hash changes when a column changes, so the workbook is re-shaped once", () => {
    const a = specHash();
    const b = specHash([{ ...REDDIT_REPLY, columns: REDDIT_REPLY.columns.slice(1) }]);
    expect(a).not.toBe(b);
    expect(a).toBe(specHash());
  });
});

describe("rows: Name, Message, Link, and the link is where the message goes", () => {
  it("a Reddit reply: u/name, the message, the exact comment", () => {
    const [row] = approvalRows(approval({}), sources());
    expect(row.tab.id).toBe("reddit-reply");
    expect(row.key).toBe(approvalKey("0b2f6c1e-1111-4222-8333-444455556666"));
    expect(row.key).toMatch(/^A-[a-f0-9]{10}$/);
    expect(Object.keys(row.cells)).toEqual(["name", "message", "link"]);
    expect(row.cells.name).toBe("u/jane_sells");
    expect(row.cells.message).toContain("I built SwiftCard");
    expect(href(row.cells.link)).toBe("https://www.reddit.com/r/realtors/comments/abc123/is_there/xyz789/");
  });

  it("a Reddit DM opens Reddit's message screen addressed to them with the message filled in", () => {
    const [row] = approvalRows(approval({ agent_id: "contact-reddit", team: "contact", kind: "dm", meta: { author: "jane_sells" } }), sources());
    expect(row.tab.id).toBe("reddit-dms");
    expect(href(row.cells.link)).toBe(`https://www.reddit.com/message/compose/?to=jane_sells&message=${encodeURIComponent("Honestly one app that does both is easier. I built SwiftCard, so I'm biased.")}`);
  });

  it("an Instagram DM opens the chat in the app, not the profile", () => {
    const a = approval({ agent_id: "contact-instagram-linkinbio", team: "contact", kind: "dm", platform: "instagram", target_url: "https://www.instagram.com/jane.realtor/", meta: { name: "Jane Realtor", author: "@Jane.Realtor" } });
    const [row] = approvalRows(a, sources());
    expect(row.tab.id).toBe("instagram-linkedin-bio");
    expect(row.cells.name).toBe("Jane Realtor, @jane.realtor");
    expect(href(row.cells.link)).toBe("https://ig.me/m/jane.realtor");
    expect(linkedinIn("see https://www.linkedin.com/in/some-one/ for more")).toBe("https://www.linkedin.com/in/some-one/");
  });

  it("an X reply opens the post; X and TikTok outreach open the profile", () => {
    const reply = approval({ agent_id: "replies-x", platform: "x", target_url: "https://twitter.com/dana_homes/status/1850000000000000001", meta: {} });
    const [r] = approvalRows(reply, sources());
    expect(r.tab.id).toBe("x-replies");
    expect(r.cells.name).toBe("@dana_homes");
    expect(href(r.cells.link)).toBe("https://x.com/dana_homes/status/1850000000000000001");
    const [dm] = approvalRows(approval({ agent_id: "contact-tiktok", team: "contact", kind: "dm", platform: "tiktok", target_url: "https://www.tiktok.com/@plumber.pete/video/7400000000000000000", meta: {} }), sources());
    expect(dm.tab.id).toBe("tiktok-dms");
    expect(href(dm.cells.link)).toBe("https://www.tiktok.com/@plumber.pete");
  });

  it("an office email opens a new email with the subject and message already in it", () => {
    const body = "Subject: Cards for the team\n\nHi Edith, quick one about the team's cards. I built SwiftCard for teams like yours.";
    const [row] = approvalRows(approval({ agent_id: "office-outreach", team: "office", kind: "dm", platform: "email", target_url: null, body, meta: { name: "Edith Yang", company: "Yang Team", email: "edith@yangteam.com" } }), sources());
    expect(row.tab.id).toBe("office-prospects");
    expect(row.cells.name).toBe("Edith Yang, Yang Team");
    expect(href(row.cells.link)).toBe(`mailto:edith@yangteam.com?subject=${encodeURIComponent("Cards for the team")}&body=${encodeURIComponent("Hi Edith, quick one about the team's cards. I built SwiftCard for teams like yours.")}`);
  });

  it("a reply whose link isn't the exact post never becomes a row; one pasted without a link says so", () => {
    expect(approvalRows(approval({ target_url: "https://www.reddit.com/r/realtors/" }), sources())).toEqual([]);
    const [pasted] = approvalRows(approval({ agent_id: "replies-facebook", platform: "facebook", target_url: "paste:abc", meta: { author: "Sam" } }), sources());
    expect(pasted.cells.link).toBe(NO_LINK);
  });

  it("only open items are rows: sent, skipped and expired drafts leave the Sheet", () => {
    for (const status of ["done", "rejected", "expired"] as const) expect(approvalRows(approval({ status }), sources()), status).toEqual([]);
    expect(approvalRows(approval({ status: "approved" }), sources())).toHaveLength(1);
  });

  it("a lead with no message is a row marked as needing one; with one: name, the message, an email that's ready to send", () => {
    const lead = { id: "11111111-2222-3333-4444-555555555555", created_at: "2026-10-25T10:00:00Z", list: "cold" as const, name: "Dana Ellis", title: "Owner", email: "dana@acme.com", company: "Acme Realty", source_platform: "web" as const, source_url: "https://acme.com/contact" };
    const [bare] = leadRows(lead, sources());
    expect(bare.cells.message).toBe(NEEDS_MESSAGE);
    expect(href(bare.cells.link)).toBe("mailto:dana@acme.com?body=");
    const [row] = leadRows({ ...lead, message: "Subject: your open houses\n\nDana, I built SwiftCard so visitors tap and save you." }, sources());
    expect(row.tab.id).toBe("web-leads");
    expect(row.cells.name).toBe("Dana Ellis, Owner, Acme Realty");
    expect(href(row.cells.link)).toMatch(/^mailto:dana@acme\.com\?subject=your%20open%20houses&body=/);
    // Already contacted: not a row again.
    const known = new Map<string, SheetRow>([[row.key, { row_key: row.key, status: "Contacted" } as SheetRow]]);
    expect(leadRows({ ...lead, message: "x" }, sources({ known }))).toEqual([]);
  });

  it("cells never run as formulas, links are quoted, and the agent hash follows the message", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("+1 555")).toBe("'+1 555");
    expect(safeCell(link("https://x.com/a", 'say "hi"'))).toBe('=HYPERLINK("https://x.com/a","say ""hi""")');
    expect(link("javascript:alert(1)", "x")).toBe("");
    expect(colLetter(26)).toBe("AA");
    expect(a1("Reddit Reply", "A2:C3")).toBe("'Reddit Reply'!A2:C3");
    const [row] = approvalRows(approval({}), sources());
    const h1 = agentHash(row.tab, row.cells);
    expect(agentHash(row.tab, { ...row.cells, message: "changed" })).not.toBe(h1);
  });

  it("buildRows gives each record one row", () => {
    const a = approval({ id: "aaaaaaaa-0000-4000-8000-000000000001" });
    const b = approval({ id: "aaaaaaaa-0000-4000-8000-000000000002", status: "done" });
    expect(buildRows(sources({ approvals: [a, b, a] })).map((r) => r.entityId)).toEqual([a.id]);
  });
});

describe("what the owner does in the Sheet", () => {
  async function drafted() {
    const { store, ctx } = await setup({ def: fakeAgent({ id: "contact-reddit", team: "contact", approvalKind: "dm" }) });
    const r = await propose(ctx, { kind: "dm", title: "Reddit DM to u/jane", summary: "s", body: "Saw your post about Linktree. I built SwiftCard so the card and the links are one thing, free to start.", platform: "reddit", targetUrl: "https://www.reddit.com/r/x/comments/1/a/", person: { platform: "reddit", handle: "u/jane" } });
    if (!r.ok) throw new Error(r.reason);
    const a = (await store.getApproval(r.id))!;
    const key = approvalKey(a.id);
    await store.upsertSheetRow({ tab: "reddit-dms", row_key: key, entity_kind: "approval", entity_id: a.id, status: "Ready", owner_cols: {}, agent_hash: "x", synced_at: null, owner_edited_at: null });
    return { store, ctx, a, key };
  }

  it("\"sent\" typed over the message: the draft is done by hand and the person is marked as contacted; nothing is sent", async () => {
    const { store, ctx, a, key } = await drafted();
    const r = await applyChange(store, { rowKey: key, column: "message", value: "sent", by: "sheet" });
    expect(r.ok).toBe(true);
    expect((await store.getApproval(a.id))!.status).toBe("done");
    expect(store.touches.some((t) => t.person_id === a.person_id && t.kind === "dm_sent")).toBe(true);
    expect((await store.getSheetRow(key))!.status).toBe("Sent / Posted");
    // Nobody is messaged twice.
    const again = await propose(ctx, { kind: "dm", title: "again", summary: "s", body: "hello again, SwiftCard", platform: "reddit", targetUrl: "https://www.reddit.com/r/x/comments/2/b/", person: { platform: "reddit", handle: "u/Jane" } });
    expect(again.ok).toBe(false);
  });

  it("a lead marked sent is Contacted, with an emailed touch", async () => {
    const store = new MemoryStore();
    await store.insertLeads([{ list: "cold", name: "Dana", email: "dana@acme.com", source_platform: "web", source_url: "https://acme.com" }]);
    const id = (store as unknown as { leads: { id: string }[] }).leads[0].id;
    const key = "L-abcdef1234";
    await store.upsertSheetRow({ tab: "web-leads", row_key: key, entity_kind: "lead", entity_id: id, status: "New", owner_cols: {}, agent_hash: "x", synced_at: null, owner_edited_at: null });
    expect((await applyChange(store, { rowKey: key, column: "message", value: " Sent. ", by: "sheet" })).ok).toBe(true);
    expect((await store.getSheetRow(key))!.status).toBe("Contacted");
    // The explicit action the admin page shares is unchanged.
    expect((await markSent(store, key, "sheet")).ok).toBe(true);
    expect(store.touches.some((t) => t.kind === "emailed")).toBe(true);
  });

  it("a reworded message is saved, becomes the draft, and is shown to the model as an example; the name and link are the agent's", async () => {
    const { store, a, key } = await drafted();
    const r = await applyChange(store, { rowKey: key, column: "message", value: "Hey, saw the Linktree post. I built SwiftCard for exactly that, free to try.", by: "owner" });
    expect(r.ok).toBe(true);
    expect((await store.getApproval(a.id))!.body).toContain("free to try");
    const edits = await store.recentEdits("contact-reddit", "dm", 30);
    expect(edits).toHaveLength(1);
    expect(formatExamples(edits)).toContain("Owner's version");
    expect(formatExamples([])).toBe("");
    expect((await applyChange(store, { rowKey: key, column: "link", value: "x", by: "owner" })).ok).toBe(false);
  });

  it("Paste a Post takes in a pasted post, X and TikTok included", async () => {
    const store = new MemoryStore();
    expect(await applyPasteRow(store, { platform: "Facebook", url: "", kind: "", text: "A long enough pasted post from a group about business cards." })).toBe(true);
    expect(await applyPasteRow(store, { platform: "x", url: "https://x.com/a/status/1", kind: "post", text: "Anyone know a good digital business card app?" })).toBe(true);
    expect(await applyPasteRow(store, { platform: "myspace", url: "", kind: "post", text: "A long enough pasted post." })).toBe(false);
    expect(await store.countNewInputs(["facebook"])).toBe(1);
    expect(await store.countNewInputs(["x"])).toBe(1);
  });
});

describe("controls (admin → Agents uses the same checks)", () => {
  it("reads schedules written in plain words, and refuses anything faster than 15 minutes", () => {
    expect(parseScheduleText("every 30 min")).toEqual({ kind: "every", minutes: 30 });
    expect(parseScheduleText("daily 9:00am")).toEqual({ kind: "daily", hour: 9, minute: 0 });
    expect(parseScheduleText("weekdays 5pm")).toEqual({ kind: "daily", hour: 17, minute: 0, days: [1, 2, 3, 4, 5] });
    expect(parseScheduleText("every 5 min")).toBeNull();
  });

  it("only known keys with allowed values change anything; dry run starts on", async () => {
    const store = new MemoryStore();
    expect((await store.getControls()).dry_run).toBe(true);
    expect(await applyControl(store, "dry_run", "maybe", "owner")).toMatchObject({ ok: false });
    expect(await applyControl(store, "pause_all", "Yes", "owner")).toMatchObject({ ok: true });
    expect((await store.getSettings()).kill_all).toBe(true);
    expect(await applyControl(store, "agent:replies-reddit", "Start", "owner")).toMatchObject({ ok: true, shown: "Running" });
    expect(await applyControl(store, "agent:replies-x", "Start", "owner")).toMatchObject({ ok: true, shown: "Running" });
    expect(await applyControl(store, "agent:watch-bugs", "Off", "owner")).toMatchObject({ ok: false, message: "unknown setting" });
    const keys = controlDefs().map((d) => d.key);
    expect(keys.filter((k) => k.startsWith("agent:")).every((k) => SHEET_AGENT_IDS.has(k.slice(6)))).toBe(true);
  });
});

describe("dry run and the outward gate", () => {
  it("in dry run an approved blog post is simulated, logged, and stays approved", async () => {
    const { store, ctx } = await setup({ def: fakeAgent({ id: "marketing-blog", team: "marketing", approvalKind: "blog_post" }) });
    const r = await propose(ctx, { kind: "blog_post", title: "Blog: A HiHello alternative", summary: "s", body: "# Post", platform: "site", meta: { slug: "hihello-alternative", description: "d" } });
    if (!r.ok) throw new Error(r.reason);
    const d = await decide(store, r.id, { action: "approve", by: "owner" });
    expect(d.ok).toBe(true);
    expect(d.message).toContain("Dry run");
    expect((await store.getApproval(r.id))!.status).toBe("approved");
    expect(PUBLIC_KINDS).toEqual(["blog_post", "reply", "comment", "post"]);
  });

  it("a Bluesky reply posts itself only when the owner set the tier to Approval and the account is connected", () => {
    const a = { kind: "reply" as const, platform: "bluesky" as const };
    expect(tier2Executable(a, { "tier:bluesky": "Approval posts it" })).toBe(false);
    vi.stubEnv("BLUESKY_HANDLE", "swiftcardapp.bsky.social");
    vi.stubEnv("BLUESKY_APP_PASSWORD", "xxxx-xxxx");
    expect(tier2Executable(a, { "tier:bluesky": "Approval posts it" })).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("the writing check: human, and no hyphens at all (owner, 2026-10-29)", () => {
  it("flags banned phrases, dashes, hyphenated words, stacked exclamation points and pitch bullets", () => {
    expect(writingProblems("I hope this finds you well. Let's leverage this to elevate your brand!!")).toEqual(expect.arrayContaining(['uses "i hope this finds you well"', 'uses "leverage"', 'uses "elevate"', "stacked exclamation points"]));
    expect(writingProblems("Saw your post — nice.")).toContain("uses an em dash");
    expect(writingProblems("Put a tap-to-call button up top.")).toContain("has a hyphenated word");
    expect(writingProblems("It's not just a card but a whole page.")).toContain('uses "not just X but Y"');
    expect(writingProblems("Here's why:\n- fast\n- cheap\n- easy", { kind: "dm" })).toContain("reads like a bullet-point sales pitch");
    expect(writingProblems("Great tip #networking #cards", { kind: "reply", platform: "reddit" })).toContain("has hashtags");
    // Links, emails and handles may keep their hyphens.
    expect(writingProblems("Saw it at https://my-site.com, email jo@my-site.com or @jo-pro.")).toEqual([]);
    expect(writingProblems("Saw your post about losing leads at the expo. I built SwiftCard so they tap and save you, free to start.")).toEqual([]);
  });

  it("every draft has its hyphens taken out before it reaches the Sheet, links left alone", () => {
    expect(stripEmDashes("A tap-to-call button — right at the top, 9-5.")).toBe("A tap to call button, right at the top, 9 to 5.");
    expect(stripEmDashes("Your follow-up e-mail, co-founder")).toBe("Your follow up email, cofounder");
    expect(stripEmDashes("see https://link-in-bio.example/x-y and u/some-user")).toBe("see https://link-in-bio.example/x-y and u/some-user");
  });

  it("a draft that fails reaches the Sheet marked Needs Review instead of vanishing", async () => {
    const { store, ctx } = await setup();
    const r = await propose(ctx, { kind: "reply", title: "t", summary: "s", body: "I hope this finds you well. Here is a thought.", platform: "quora", targetUrl: "https://quora.com/q/1" });
    if (!r.ok) throw new Error(r.reason);
    const a = (await store.getApproval(r.id))!;
    expect(a.meta.needs_review).toBe(true);
    expect(statusForApproval(a)).toBe("Needs Review");
  });
});

describe("the sync reads the agent tabs and Paste a Post", () => {
  it("every agent tab and Paste a Post, and nothing that no longer exists", () => {
    const ids = readableTabs().map((t) => t.id);
    expect(ids).toContain("reddit-reply");
    expect(ids).toContain("x-replies");
    expect(ids).toContain("paste");
    for (const gone of ["dashboard", "queue", "controls", "suppression", "pipeline"]) expect(ids).not.toContain(gone);
  });
});
