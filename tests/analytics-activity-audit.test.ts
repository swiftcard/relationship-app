import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markPhrase, markPlace, redactPlaces, stripLocationMarks, teaseLocation } from "@/lib/location-privacy";
import { personalRecapCopy } from "@/lib/weekly-recap";
import { resolveDateRange } from "@/lib/office-analytics-dates";
import { fillDateRange } from "@/lib/office-analytics-metrics";

// ── Analytics + Activity & Messages audit (owner, 2026-09-23) ───────────────
// "Analytics must work perfectly for every plan … Free should not be able to
// see locations … if the user opens the link on their own phone it doesn't
// show up as a view — a huge legal issue … Activity and Messages are showing a
// lot of false information. It cannot lie."

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the owner's own phone", () => {
  it("a contact typed in on the owner's own device never binds that device to the contact", () => {
    const s = code("src/app/api/leads/route.ts");
    expect(s).toContain("const fromOwnersDevice = await isOwnerRequest(admin, card_owner).catch(() => false);");
    expect(s).toContain("visitor_id: fromOwnersDevice ? null : visitor_id,");
    expect(s).toContain("if (insertedLead?.id && ownerProfile?.id && !fromOwnersDevice) {");
  });
});

describe("Free never learns where — not even how precisely", () => {
  it("every hidden place is one shape, whatever the precision", () => {
    const city = `Sam viewed your card${markPhrase(` near ${markPlace("Roslyn, NY")}`)}.`;
    const region = `Sam viewed your card${markPhrase(` in the ${markPlace("New York")} area`)}.`;
    const a = stripLocationMarks(redactPlaces(city));
    const b = stripLocationMarks(redactPlaces(region));
    expect(a).toBe(b);
    expect(a).not.toMatch(/Roslyn|New York|near|area/);
  });
  it("the recap's place count is hidden with the place, and paid reads it unchanged", () => {
    const c = personalRecapCopy({ views: 9, contacts: 0, places: ["Austin, TX", "Waco, TX", "Dallas, TX"] })!;
    expect(stripLocationMarks(c.body)).toBe("Top spot in Austin, TX · 3 places in all.");
    expect(teaseLocation(c.body)).toBe("Top spot in ▒▒▒▒▒, ▒▒.");
    expect(stripLocationMarks(redactPlaces(c.body))).not.toContain("places in all");
  });
});

describe("the numbers are right", () => {
  it("card + Swift Links in one visit is one viewer and no repeat", () => {
    const s = code("src/app/dashboard/page.tsx");
    expect(s).toContain("const pageKey = `${vid}|${v.username as string}`;");
    expect(s).toContain("for (const n of perPage.values()) repeatViews += n - 1;");
  });
  it("link taps are an exact count, not rows capped at 1000", () => {
    expect(code("src/app/dashboard/page.tsx")).toMatch(/\.from\("card_events"\)\s*\.select\("id", \{ count: "exact", head: true \}\)[\s\S]{0,200}?\.eq\("event_type", "clicked_link"\)/);
  });
  it("the sample contact is not a contact in the review prompt", () => {
    const s = code("src/app/dashboard/page.tsx");
    // The Traffic box's footer no longer shows Contacts or Best day (owner,
    // 2026-10-06) — link taps are its only stat.
    expect(s).not.toContain("Contacts <span className=\"text-gray-200 font-semibold tabular-nums\">");
    expect(s).not.toContain("Best day <span");
    expect(s).toContain("<ReviewPromptTrigger hasLead={realLeadCount > 0} />");
  });
  it("the weekly recap counts views exactly", () => {
    const s = code("src/app/api/push/recap/route.ts");
    expect(s).toContain("views: viewCount ?? views?.length ?? 0,");
  });
  it("Office analytics days are the viewer's local days", () => {
    const now = new Date("2026-09-24T02:30:00Z"); // 22:30 on Sep 23 in New York
    const r = resolveDateRange("7d", now, undefined, "America/New_York");
    expect(r.until).toBe("2026-09-24T04:00:00.000Z"); // local midnight after Sep 23
    expect(r.since).toBe("2026-09-17T04:00:00.000Z");
    const days = fillDateRange([{ date: "2026-09-23", views: 4 }], r.since, r.until, "America/New_York");
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe("2026-09-17");
    expect(days[6]).toEqual({ date: "2026-09-23", views: 4 });
    // Without a zone: UTC, exactly as before.
    expect(resolveDateRange("7d", now).until).toBe("2026-09-25T00:00:00.000Z");
  });
});

describe("Activity & Messages says only what happened", () => {
  const ce = code("src/app/api/card-events/route.ts");
  const get = ce.slice(ce.indexOf("export async function GET"));
  it("never matches a contact by what a browser CLAIMED (email/phone)", () => {
    expect(get).not.toContain('.ilike("visitor_email"');
    expect(get).not.toContain('.eq("visitor_phone"');
  });
  it("honours wrong-person and hand-offs, never shows another contact's stamped events", () => {
    expect(get).toContain("!bd.superseded_at && !bd.wrong_at");
    expect(get).toContain("const notAnotherContact = leadId ? `lead_id.is.null,lead_id.eq.${leadId}` : null;");
    expect(get).toMatch(/\.eq\("visitor_id", bd\.visitor_id as string\)\.or\(notAnotherContact!\)/);
  });
  it("the arrival line is what really happened — shared, added by you, or the sample", () => {
    const s = read("src/components/ContactsClient.tsx");
    expect(s).toContain("Sample contact — ${fname} isn't a real person.");
    expect(s).toContain("You added ${fname} to your contacts");
    expect(s).toContain('if (selected.message && !addedByOwner)');
  });
  it("a contact opened from a notification loads its feed", () => {
    expect(read("src/components/ContactsClient.tsx")).toContain("if (initialSelectedId && selected?.id === initialSelectedId) void refreshRef.current();");
  });
  it("never 'Sent' for a cancelled text, a bounced email, or a step that didn't go", () => {
    const s = read("src/components/ContactsClient.tsx");
    expect(s).toMatch(/case "canceled":\s*case "cancelled":\s*return \{ text: "Not sent"/);
    expect(s).toMatch(/case "bounced":\s*return \{ text: "Not delivered"/);
    expect(s).toContain("Not sent — ${it.not_sent === \"opted_out\" ? \"they unsubscribed\"");
    expect(code("src/app/api/resend/webhook/route.ts")).toContain('update({ status: "bounced" })');
    expect(code("src/app/api/reminders/route.ts")).toContain("await markNotSent(supabase, seqLead.id as string, item, r.status)");
  });
  it("the bubble is the text that went", () => {
    expect(code("src/lib/messaging.ts")).toContain('channel: "sms", body: smsBody, status, providerSid: sid');
    expect(code("src/app/api/leads/share-card/route.ts")).not.toContain("(shared card link)");
  });
  it("nothing is ever sent to the sample contact", () => {
    for (const p of ["src/app/api/leads/share-card/route.ts", "src/app/api/leads/[id]/message/route.ts", "src/app/api/sms/send/route.ts"]) {
      expect(code(p), p).toContain('.includes("demo")');
    }
    expect(code("src/app/api/reminders/route.ts")).toContain('if ((seqLead.tags ?? []).includes("demo")) continue;');
  });
});
