import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKnownContact, samePersonLeadIds } from "@/lib/known-contact";

// ── Owner, 2026-11-05 ────────────────────────────────────────────────────────
// "If someone reopens a user's card and clicks around on it, I want all that
// information if they're inside of the user's contact… If they tap on an
// additional link or my Instagram or something like that, only if I have them
// as a contact will it save in the activity and messages."
//
// A saved contact's return visit — the open, every tap — is in their Activity
// & Messages for as long as they're a contact. Pinned here: the timeline reads
// a browser only they used for good; a failed lookup is retried, not filed as a
// stranger; the same person on two contact rows is one history; and a contact
// the owner typed in can be recognised through the link Share sends them.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// A tiny stand-in for the Supabase client: every chain resolves to the next
// queued answer for its table.
function fakeAdmin(answers: Record<string, { data?: unknown; error?: unknown }[]>) {
  const calls: Record<string, number> = {};
  const chain = (table: string): unknown => {
    const next = () => {
      calls[table] = (calls[table] ?? 0) + 1;
      return (answers[table] ?? []).shift() ?? { data: [], error: null };
    };
    const proxy: unknown = new Proxy(function () {}, {
      get: (_t, prop) => {
        if (prop === "then") return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(next()).then(res, rej);
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  };
  return { admin: { from: (t: string) => chain(t) } as never, calls };
}

describe("a saved contact's return visit is theirs", () => {
  it("a browser only they were bound to is read for good — the cap is for a SHARED browser", () => {
    for (const src of [read("src/app/api/card-events/route.ts"), read("src/lib/office-contact-detail.ts")]) {
      expect(src).toContain("const others = (sharedDevice ?? []).filter((o) => o.visitor_id === bd.visitor_id);");
      expect(src).toContain('if (others.length && boundAt) q = q.lte("created_at"');
    }
  });

  it("a failed lookup is tried again instead of filing their visit as a stranger's", async () => {
    const lead = { id: "lead-p", name: "Priya Shah", email: "p@x.com", phone: "9179057335", card_owner: "dana", created_at: "2026-10-01T00:00:00Z", status: null, tags: [], where_met: null };
    const { admin, calls } = fakeAdmin({
      contact_devices: [
        { data: null, error: { message: "timeout" } },
        { data: [{ lead_id: "lead-p", bound_via: "form", link_device_index: null }], error: null },
      ],
      leads: [{ data: [lead], error: null }],
      profiles: [{ data: { email: "owner@x.com", phone: "5550000000" }, error: null }],
      cards: [{ data: [], error: null }],
    });
    const r = await resolveKnownContact(admin, { ownerId: "owner-1", visitorId: "visitor-aaaa" });
    expect(r).toMatchObject({ kind: "known", leadId: "lead-p" });
    expect(calls.contact_devices).toBe(2);
  });

  it("a real 'no binding' is anonymous at once, with no retry", async () => {
    const { admin, calls } = fakeAdmin({ contact_devices: [{ data: [], error: null }] });
    expect(await resolveKnownContact(admin, { ownerId: "owner-1", visitorId: "visitor-aaaa" })).toMatchObject({ kind: "anonymous" });
    expect(calls.contact_devices).toBe(1);
  });
});

describe("the same person on two contact rows is one history", () => {
  it("finds the other rows by the same email or the same number however typed", async () => {
    const { admin } = fakeAdmin({
      leads: [
        { data: [{ id: "lead-a", email: "P@X.com", phone: null }, { id: "lead-me", email: "p@x.com", phone: null }] },
        { data: [{ id: "lead-b", email: null, phone: "(917) 905-7335" }, { id: "lead-c", email: null, phone: "212 905 7335" }] },
      ],
    });
    const ids = await samePersonLeadIds(admin, { leadId: "lead-me", cardSlugs: ["dana"], email: "p@x.com", phone: "+1 917-905-7335" });
    expect(ids.sort()).toEqual(["lead-a", "lead-b"]);
  });

  it("nothing to match on is nobody else", async () => {
    const { admin } = fakeAdmin({});
    expect(await samePersonLeadIds(admin, { leadId: "x", cardSlugs: ["dana"], email: null, phone: null })).toEqual([]);
  });

  it("the timeline reads every row of that person, newest first and paged", () => {
    const route = read("src/app/api/card-events/route.ts");
    expect(route).toContain('.in("lead_id", theirLeadIds).order("created_at", { ascending: false })');
    expect(route).toContain("const MAX_PAGES = 5;");
  });

  it("a repeat share with the number typed differently is the contact they already are", () => {
    const leads = read("src/app/api/leads/route.ts");
    expect(leads).toContain("const typed = normalizePhone(phone);");
    expect(leads).toContain("normalizePhone(l.phone) === typed");
  });
});

describe("a contact the owner typed in can be recognised", () => {
  it("Share → Text / Email sends their own link, fetched before the tap", () => {
    const btn = read("src/components/ShareMyInfoButton.tsx");
    expect(btn).toContain("/card-link`");
    expect(btn).toContain("const cardUrl = cardOwner ? (personalUrl ?? `${APP_URL}/${cardOwner}?shared=1`) : null;");
    // Copy and the share sheet keep the plain link: the recipient is unknown.
    expect(btn).toContain("const url = `${APP_URL}/${cardOwner}?shared=1`;");
  });

  it("the link is made only for the owner's own contact, plain for the sample", () => {
    const route = read("src/app/api/leads/[id]/card-link/route.ts");
    expect(route).toContain("if (!lead || !ownsLead(usernames, lead))");
    expect(route).toContain('const sample = ((lead.tags as string[] | null) ?? []).includes("demo");');
    expect(route).toContain("contactCardUrl(admin, {");
  });
});

describe("the timeline names phone and email taps as what they were", () => {
  it("one wording for the member and the Office drawer", () => {
    expect(read("src/components/ContactsClient.tsx")).toContain('if (e.event_type === "clicked_link") return tapPhrase(e);');
    expect(read("src/lib/office-contact-timeline.ts")).toContain("return tapPhrase(ev, P);");
  });
});
