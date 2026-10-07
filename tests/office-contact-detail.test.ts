import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildContactTimeline,
  describeArrival,
  deliveryLabel,
  type OfficeContactDetail,
} from "@/lib/office-contact-timeline";
import { __test } from "@/lib/office-contact-detail";

// ── One contact, opened from the Office admin console (owner, 2026-10-07) ────
//
// "When they're on the admin page and they go to Contacts, they should be able
// to click on that contact and see when they were added, how they were added,
// the activity and message history between whoever captured it and that
// contact, and which of their sub-users that contact belongs to."
//
// Owner decisions the same day: history is visible only for the time the
// teammate is ON the team (joined → left), and the office owner's own
// conversations are visible to the owner alone.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with comments removed — comments here explain what was left out. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIB = "src/lib/office-contact-detail.ts";
const ROUTE = "src/app/api/office/contacts/[id]/route.ts";
const MEMBER_ROUTE = "src/app/api/card-events/route.ts";

describe("the boundary: one office's contacts, never another's", () => {
  const lib = code(LIB);

  it("finds the contact through the Contacts table's own query, plus its id", () => {
    // scopedOfficeLeads is the filter the table pages through; the drawer adds
    // the id on top, so it can never hold a looser copy of the office rule.
    expect(lib).toMatch(/scopedOfficeLeads\(officeId, Array\.from\(bySlug\.keys\(\)\), DETAIL_COLUMNS\)\s*\.eq\("id", contactId\)/);
    expect(code("src/lib/office-leads.ts")).toContain("export function scopedOfficeLeads(");
  });

  it("checks the id is a UUID before it is used anywhere", () => {
    // The id is interpolated into a PostgREST .or() filter string for the
    // event lookup; a crafted value must never reach it.
    const fn = lib.slice(lib.indexOf("export async function getOfficeContactDetail"));
    const check = fn.indexOf("if (!CONTACT_ID.test(contactId)) return null;");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(fn.indexOf("scopedOfficeLeads("));
    expect(lib).toContain("const CONTACT_ID = /^[0-9a-f-]{36}$/i;");
  });

  it("the route is gated like the Contacts tab and answers from the session's office", () => {
    const route = code(ROUTE);
    expect(route).toContain('requireOfficeCapability(user.id, "view_org_analytics")');
    expect(route).toContain("officeId: ctx.officeId");
    expect(route).toContain("viewerId: user.id");
    expect(route).toMatch(/status: 404/);
    expect(route).toContain('"Cache-Control": "no-store"');
  });

  it("does not bring back the retired status-setter route", () => {
    expect(existsSync(join(root, "src/app/api/office/leads/[id]/route.ts"))).toBe(false);
  });
});

describe("private notes stay private", () => {
  it("the teammate's Notes & Context columns are never selected", () => {
    const cols = code(LIB).match(/const DETAIL_COLUMNS =\s*"([^"]+)"/)?.[1] ?? "";
    expect(cols).toContain("created_at");
    expect(cols).toContain("source");
    for (const banned of ["notes", "where_met", "convo_details"]) {
      expect(cols.split(/,\s*/), banned).not.toContain(banned);
    }
  });

  it("the drawer says so", () => {
    expect(read("src/components/office/ContactDrawer.tsx")).toContain("private notes on this contact are never shown here.");
  });
});

describe("the same activity the teammate sees — the rules agree", () => {
  // The event matching is duplicated (the member route is pinned as text by
  // many tests). Each guard below must be present in BOTH copies.
  const lib = code(LIB);
  const member = code(MEMBER_ROUTE);
  for (const guard of [
    "!bd.superseded_at && !bd.wrong_at &&",
    '!(bd.bound_via === "link" && ((bd.link_device_index as number | null) ?? 1) > 1)',
    "const LEAD_IN_MS = 2 * 60 * 60 * 1000;",
    'since((bd.bound_at as string | null) ?? ',
    '.eq("visitor_id", bd.visitor_id as string).or(',
  ]) {
    it(guard, () => {
      expect(member, "the member's timeline changed — update lib/office-contact-detail to match").toContain(guard);
      expect(lib, "the office copy drifted from card-events GET").toContain(guard);
    });
  }

  it("never takes an event already stamped as ANOTHER contact's", () => {
    expect(member).toContain("`lead_id.is.null,lead_id.eq.${leadId}`");
    expect(lib).toContain("`lead_id.is.null,lead_id.eq.${contactId}`");
  });
});

describe("the history window", () => {
  const lib = code(LIB);

  it("a current teammate's history starts when they joined", () => {
    expect(lib).toMatch(/\.from\("office_members"\)\s*\.select\("joined_at"\)/);
    expect(lib).toContain("if (joinedAt) window = { from: joinedAt, until: null };");
  });

  it("someone who left stops at their removal, and starts at the join before it", () => {
    expect(lib).toContain('.eq("action", "member.removed")');
    expect(lib).toContain('.eq("action", "invite.accepted")');
    expect(lib).toContain('.lt("created_at", removal.created_at)');
    expect(lib).toContain("window: { from: joined.created_at as string, until: removal.created_at }");
    // Removals record the slugs held at the time, so a renamed card still dates.
    expect(code("src/app/api/office/members/route.ts")).toContain("metadata: { slugs: removedSlugs }");
  });

  it("fails closed: no record of the dates → no history, only when and how", () => {
    expect(lib).toContain('else hiddenBecause = "no_record";');
    expect(lib).toContain("if (!joined?.created_at) return { userId, window: null };");
  });

  it("the owner's own conversations are the owner's alone", () => {
    expect(lib).toContain("if (viewerId === ownerId) window = { from: null, until: null };");
    expect(lib).toContain('else hiddenBecause = "owner_private";');
  });

  it("messages and events are both cut to the window", () => {
    expect(lib).toContain('if (window.from) q = q.gte("created_at", window.from);');
    expect(lib).toContain('if (window.until) q = q.lte("created_at", window.until);');
    expect(lib).toContain("events.filter((e) => inWindow(e.created_at, w))");
  });

  it("inWindow keeps exactly the window", () => {
    const w = { from: "2026-03-04T00:00:00Z", until: "2026-09-02T00:00:00Z" };
    expect(__test.inWindow("2026-03-03T23:59:59Z", w)).toBe(false);
    expect(__test.inWindow("2026-03-04T00:00:00Z", w)).toBe(true);
    expect(__test.inWindow("2026-06-01T12:00:00Z", w)).toBe(true);
    expect(__test.inWindow("2026-09-02T00:00:01Z", w)).toBe(false);
    expect(__test.inWindow("2020-01-01T00:00:00Z", { from: null, until: null })).toBe(true);
  });

  it("a step's date is the daily send's run, not the due instant", () => {
    // Anchored 9pm Eastern (01:00 UTC next day), day 1 → that UTC day's 18:00 run.
    expect(__test.stepRunsAt("2026-10-07T01:00:00Z", 1)).toBe("2026-10-08T18:00:00.000Z");
  });
});

// ── What the admin reads ─────────────────────────────────────────────────────

const base = (over: Partial<OfficeContactDetail> = {}): OfficeContactDetail => ({
  id: "c1",
  name: "Jordan Lee",
  email: "jordan@example.com",
  phone: null,
  company: null,
  location: null,
  createdAt: "2026-10-01T15:00:00Z",
  source: "qr_code",
  arrivalSource: null,
  message: null,
  owner: { name: "Jane Doe", userId: "u1", isFormer: false, isOfficeOwner: false },
  followUp: "none",
  upcomingSteps: [],
  history: { shown: true, hiddenBecause: null, from: null, until: null },
  events: [],
  messages: [],
  ...over,
});

describe("how they were added — only what really happened", () => {
  it("a shared contact names the card and the channel", () => {
    expect(describeArrival(base())).toEqual({ title: "Shared their info on Jane's card", via: "QR code scan" });
  });

  it("a contact the teammate typed or scanned never 'shared their info'", () => {
    const d = base({ source: "manual" });
    expect(describeArrival(d).title).toBe("Added by Jane Doe");
    const lines = buildContactTimeline(d).map((i) => (i.kind === "event" ? i.text : ""));
    expect(lines.join(" ")).not.toMatch(/shared their info/);
  });

  it("the Connect button and the share-back sheet say what they are, with the real channel", () => {
    expect(describeArrival(base({ source: "swift_connect", arrivalSource: "swift_links" }))).toEqual({
      title: "Tapped Connect on Jane's Swift Links and shared their info",
      via: null,
    });
    expect(describeArrival(base({ source: "save_contact_conversion", arrivalSource: "nfc_card" }))).toEqual({
      title: "Downloaded Jane's contact card, then shared their info",
      via: "NFC tap",
    });
  });

  it("someone who has left is not named", () => {
    const d = base({ owner: { name: "Former team member", userId: null, isFormer: true, isOfficeOwner: false } });
    expect(describeArrival(d).title).toBe("Shared their info on the card");
    expect(describeArrival({ ...d, source: "manual" }).title).toBe("Added by a former teammate");
  });
});

describe("the timeline", () => {
  const d = base({
    message: "Loved the open house",
    events: [
      { id: "e2", event_type: "downloaded_vcard", source: "qr_code", created_at: "2026-10-01T15:01:00Z" },
      { id: "e1", event_type: "viewed_card", source: "qr_code", created_at: "2026-10-01T14:59:00Z" },
      { id: "e3", event_type: "shared_info", source: "qr_code", created_at: "2026-10-01T15:00:00Z" },
      { id: "e4", event_type: "viewed_card", source: null, created_at: "2026-10-02T10:00:00Z", surface: "links" },
      { id: "e5", event_type: "clicked_link", source: null, created_at: "2026-10-02T10:01:00Z", target_label: "Calendly" },
    ],
    messages: [
      { id: "m1", direction: "out", channel: "email", body: "Hi Jordan", status: "delivered", created_at: "2026-10-02T18:00:00Z" },
      { id: "m2", direction: "in", channel: "sms", body: "Thanks!", status: "received", created_at: "2026-10-03T09:00:00Z" },
    ],
  });
  const items = buildContactTimeline(d);

  it("is oldest first, third person, and skips what the arrival already says", () => {
    const text = items.map((i) => (i.kind === "event" ? i.text : `${i.kind}:${i.body}`));
    expect(text).toEqual([
      "Jordan viewed Jane's card",
      "Jordan shared their info on Jane's card",
      "in:Loved the open house",
      "Jordan downloaded Jane's contact card",
      "Jordan viewed Jane's Swift Links",
      "Jordan tapped Jane's Calendly link",
      "out:Hi Jordan",
      "in:Thanks!",
    ]);
  });

  it("says who sent each message", () => {
    const out = items.find((i) => i.kind === "out");
    const inn = items.filter((i) => i.kind === "in").pop();
    expect(out && out.kind === "out" && out.who).toBe("Jane");
    expect(inn && inn.kind === "in" && inn.who).toBe("Jordan");
  });

  it("never says 'saved' for a download", () => {
    expect(items.map((i) => (i.kind === "event" ? i.text : "")).join(" ")).not.toMatch(/saved/i);
  });

  it("shows only the arrival when the history is hidden", () => {
    const hidden = buildContactTimeline({ ...d, history: { shown: false, hiddenBecause: "owner_private", from: null, until: null } });
    expect(hidden).toHaveLength(1);
    expect(hidden[0].kind).toBe("event");
  });

  it("names a forwarded link honestly", () => {
    const f = buildContactTimeline(base({
      events: [{ id: "x", event_type: "viewed_card", source: null, created_at: "2026-10-02T10:00:00Z", lead_confidence: "forwarded" }],
    }));
    expect(f.map((i) => (i.kind === "event" ? i.text : ""))).toContain("Jane's link to Jordan was opened on another device");
  });

  it("never says 'lead' to an admin", () => {
    const all = items.map((i) => (i.kind === "event" ? i.text : i.body)).join(" ");
    expect(all).not.toMatch(/\blead(s)?\b/i);
  });
});

describe("delivery wording — the carrier's verdict, never optimism", () => {
  it.each([
    ["delivered", "Delivered"],
    ["undelivered", "Not delivered"],
    ["bounced", "Not delivered"],
    ["failed", "Failed"],
    ["not_configured", "Not sent"],
    ["queued", "Sending"],
    ["sent", "Sent"],
    [null, "Sent"],
  ])("%s → %s", (status, label) => {
    expect(deliveryLabel(status).text).toBe(label);
  });
});

describe("every console screen that lists a contact opens it", () => {
  it("the Contacts table rows are links to the contact", () => {
    const table = code("src/app/office/admin/leads/LeadsTable.tsx");
    expect(table).toContain("href={contactHref(l.id, followUp)}");
    expect(table).toContain("onClick={(e) => openContact(e, l.id)}");
    expect(code("src/app/office/admin/leads/page.tsx")).toContain("initialContact={initialContact}");
  });

  for (const f of ["src/app/office/admin/team/[id]/page.tsx", "src/app/office/admin/analytics/[id]/page.tsx"]) {
    it(`${f}: recent contacts open the drawer`, () => {
      expect(read(f)).toContain("href={`/office/admin/leads?contact=${l.id}`}");
    });
  }

  it("the close control is a link too — it works before hydration", () => {
    expect(read("src/components/office/ContactDrawer.tsx")).toContain('<a href={closeHref} onClick={close} aria-label="Close"');
  });
});

describe("teammates are told before they join", () => {
  it("every invitee, not only those bringing a card", () => {
    const page = read("src/app/join/[token]/page.tsx");
    expect(page).toContain("While you&apos;re on the team, its admin can see the contacts you make and the messages and activity");
    expect(page).toContain("with them — your private notes stay yours.");
  });
});
