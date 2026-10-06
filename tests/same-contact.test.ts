import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sameContactFill, MAX_MERGED_MESSAGE } from "@/lib/same-contact";

// ── Sharing your info again doesn't make you a second contact ────────────────
//
// Save Contact opens "Share your info" on every save, filled in from last time
// (owner, 2026-10-05), so a returning visitor re-sends with one tap. With only a
// 5-minute dedup window, every later visit became a duplicate contact, a second
// "new lead" alert, a second CRM sync and, on Free, one of the month's 5
// contacts used up. Owner, 2026-10-06: the same person is one contact.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r/g, "");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("what a repeat share adds to the contact", () => {
  it("nothing new → nothing written", () => {
    expect(sameContactFill({ email: "a@b.co", company: "Acme", message: "Hi" }, { email: "a@b.co", company: "Acme", message: "Hi" })).toBeNull();
    expect(sameContactFill({ email: "a@b.co" }, {})).toBeNull();
  });

  it("fills a missing email or company", () => {
    expect(sameContactFill({ email: null, company: "" }, { email: " a@b.co ", company: "Acme" })).toEqual({ email: "a@b.co", company: "Acme" });
  });

  it("never replaces what the contact has — the owner may have edited it", () => {
    expect(sameContactFill({ email: "owner-fixed@b.co", company: "Acme Inc" }, { email: "typo@b.co", company: "acme" })).toBeNull();
  });

  it("appends a new message, once, newest kept under the cap", () => {
    expect(sameContactFill({ message: "Met at the expo" }, { message: "Can we talk Tuesday?" }))
      .toEqual({ message: "Met at the expo\n\nCan we talk Tuesday?" });
    expect(sameContactFill({ message: "Met at the expo\n\nCan we talk Tuesday?" }, { message: "Can we talk Tuesday?" })).toBeNull();
    const long = sameContactFill({ message: "x".repeat(MAX_MERGED_MESSAGE) }, { message: "latest" });
    expect(long?.message.length).toBe(MAX_MERGED_MESSAGE);
    expect(long?.message.endsWith("latest")).toBe(true);
  });
});

describe("api/leads: same phone to the same card is the contact they already are", () => {
  const route = code("src/app/api/leads/route.ts");
  const known = route.indexOf("const known = knownRows?.[0];");

  it("matches on card + phone at any time, never the sample contact", () => {
    const q = route.slice(route.indexOf("const { data: knownRows }"), known);
    expect(q).toMatch(/\.eq\("card_owner", card_owner\)/);
    expect(q).toMatch(/\.eq\("phone", phone\)/);
    expect(q).toMatch(/\.not\("tags", "cs", "\{demo\}"\)/);
    // No time window: a visit next month is the same person.
    expect(q).not.toMatch(/\.(gte|gt)\("created_at"/);
    expect(route).not.toMatch(/DEDUP_WINDOW_MS/);
  });

  it("returns success before anything is counted, inserted, notified or synced", () => {
    expect(known).toBeGreaterThan(-1);
    const block = route.slice(known, route.indexOf("return attachVisitIdentity(NextResponse.json({ success: true, deduped: true }), visitIdentity);", known));
    expect(block).toMatch(/sameContactFill\(known, \{ email, company, message \}\)/);
    expect(block).toMatch(/bindFormDevice\(admin, \{ leadId: known\.id as string/);
    for (const later of ["bumpUsage(", ".insert(leadRow)", "syncLeadToAllCrms(", "sendLeadToZapier("]) {
      const at = route.indexOf(later);
      expect(at, later).toBeGreaterThan(known);
    }
  });
});
