import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { markName, NAME_MARK } from "@/lib/contact-privacy";
import { redactForPlan } from "@/lib/notification-privacy";
import { contactMayPush } from "@/lib/contact-return-notify";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// ── The 2026-09-23 notification audit: three gaps, pinned ───────────────────
//
// Every account type, both inboxes, both kinds of push were walked end to
// end. The architecture held (one sender, one policy, targeting by the card's
// user_id, two tables for two inboxes). These are the places it didn't.

describe("a locked Free lead's name never reaches the bell or the lock screen", () => {
  // Over the free monthly cap the lead is stored and hidden from Contacts —
  // its NAME is what the cap withholds. The bell row said it anyway.
  const route = read("src/app/api/leads/route.ts");

  it("wraps the name in the NAME mark when the lead is locked, and only then", () => {
    expect(route).toMatch(/const shown = locked \? markName\(name\) : name;/);
    expect(route).toMatch(/const title = `New contact: \$\{shown\}`;/);
    expect(route).toMatch(/\? `\$\{shown\} shared their info — open to unlock\.`\s*\n\s*: `\$\{name\} shared their info with you\$\{sourceStr\}\.`/);
  });

  it("the lock screen gets its own words with no name in them", () => {
    expect(route).toMatch(/\.\.\.\(locked \? \{ pushTitle: "New contact" \} : \{\}\),/);
    expect(route).toMatch(/pushBody: locked\s*\n\s*\? "Someone shared their info — open to unlock\."/);
  });

  it("a Free bell shows blocks, a paid bell the name — and an upgrade reveals what was already there", () => {
    const row = { type: "new_lead", title: `New contact: ${markName("Dana Whitfield")}`, body: `${markName("Dana Whitfield")} shared their info — open to unlock.` };
    const [free] = redactForPlan([row], false);
    expect(free.title).not.toContain("Dana");
    expect(free.title).toContain("█");
    expect(free.body).not.toContain("Dana");
    const [paid] = redactForPlan([row], true);
    expect(paid.title).toBe("New contact: Dana Whitfield");
    // Once paid, the contact IS unlocked — "open to unlock" is Free copy and a
    // paid reader gets the plain fact (Pro notifications review, 2026-09-23).
    expect(paid.body).toBe("Dana Whitfield shared their info with you.");
    expect(paid.title).not.toContain(NAME_MARK);
  });
});

describe("the 8am catch-up honours the contacts the owner silenced", () => {
  const route = read("src/app/api/push/catchup/route.ts");

  it("one rule for 'may this contact ring the phone', shared by produce time and the morning", () => {
    expect(contactMayPush({ status: "new" })).toBe(true);
    expect(contactMayPush({ status: "not_interested" })).toBe(false);
    expect(contactMayPush({ status: "dissolved" })).toBe(false);
    expect(contactMayPush({ status: null })).toBe(true);
    expect(read("src/lib/contact-return-notify.ts")).toMatch(/const mayPush = contactMayPush\(contact\);/);
  });

  it("re-reads the contact behind a held return alert and applies closed status", () => {
    expect(route).toMatch(/\.select\("type, title, body, card_owner, created_at, lead_id"\)/);
    expect(route).toMatch(/if \(!contactMayPush\(\{ status: l\.status as string \| null \}\)\) return false;/);
    // Only return alerts are re-checked; a lead or a view is untouched.
    expect(route).toMatch(/held = held\.filter\(\(x\) => x\.category !== "contact_return" \|\| !x\.row\.lead_id \|\| allowed\(String\(x\.row\.lead_id\)\)\);/);
  });
});

describe("a member an admin removes is told, like every automated way off a team", () => {
  const route = read("src/app/api/office/members/route.ts");

  it("writes the same bell row the teardown cascade writes, after the plan revert, and never blocks the removal", () => {
    const revert = route.indexOf("const plan = await memberFallbackPlan(member.user_id);");
    const notice = route.indexOf('type: "office_plan_downgraded"');
    expect(revert).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(revert);
    // Removal-specific words, not "your team's plan changed" (2026-09-23).
    expect(route).toMatch(/title: "Your Office access ended",\s*\n\s*body: officeRemovedMessage\(plan\),\s*\n\s*\}\)\.catch\(\(\) => \{\}\);/);
    expect(route).toMatch(/import \{ insertNotification \} from "@\/lib\/notify";/);
  });
});
