import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// ── Audit round 16 (2026-10-18): the icon's number, who mail may go to, and
//    where a morning tap lands ──────────────────────────────────────────────
//
// N-13  The iPhone icon counted rows the bell hides from Office accounts, so
//       a team member saw a number nothing in the bell could clear.
// N-09  Mail to the account holder skipped the bounce/complaint list every
//       other sender consults: an address that hard-bounced or pressed
//       "Report spam" kept getting welcome, trial and payment mail.
// N-20  On Free, a morning summary led by a returning contact opened Contacts
//       (the contact blurred) once anything else was held too; the live push
//       opens that card's dashboard.
// N-18  Checked, no change: on the iPhone the billing section is the
//       compliant subscription panel, never the web billing manager.

let optedOut = new Set<string>();
vi.mock("@/lib/messaging", () => ({ isOptedOut: async (_c: string, to: string) => optedOut.has(to) }));
vi.mock("@/lib/account-email", () => ({ getAccountEmail: async (_id: string, fallback: string | null) => fallback }));

import { hiddenTypesForReader, hideForReader, ORDINARY_READER } from "@/lib/office-account-notifications";
import { ownerMailAddress } from "@/lib/owner-mail";

const read = (p: string) => readFileSync(p, "utf8");

beforeEach(() => { optedOut = new Set(); });

describe("N-13: the icon counts exactly what the bell shows", () => {
  const types = ["referral_progress", "referral_claim", "payment_failed", "personal_sub_reminder", "new_lead"];
  const readers = [
    ORDINARY_READER,
    { officeAccount: true, teamMember: false, ownSubscription: true },
    { officeAccount: true, teamMember: true, ownSubscription: false },
    { officeAccount: true, teamMember: true, ownSubscription: true },
  ];

  it.each(readers)("for %o the hidden list is exactly what hideForReader drops", (reader) => {
    const shown = new Set(hideForReader(types.map((type) => ({ type })), reader).map((r) => r.type));
    const hidden = new Set(hiddenTypesForReader(reader));
    for (const t of types) expect(hidden.has(t), t).toBe(!shown.has(t));
  });

  it("the badge count applies it", () => {
    const push = read("src/lib/push.ts");
    const fn = push.slice(push.indexOf("async function unreadBadgeCount("));
    expect(fn).toContain("const reader = await notificationReader(userId);");
    expect(fn).toContain("...hiddenTypesForReader(reader)");
  });
});

describe("N-09: no mail to an address that bounced or reported spam", () => {
  it("ownerMailAddress returns the address, or nothing once it is suppressed", async () => {
    expect(await ownerMailAddress("u1", "dana@example.com")).toBe("dana@example.com");
    optedOut.add("dana@example.com");
    expect(await ownerMailAddress("u1", "dana@example.com")).toBeNull();
    expect(await ownerMailAddress("u1", null)).toBeNull();
  });

  it.each([
    ["src/app/api/stripe/webhook/route.ts", 2],
    ["src/app/api/reminders/route.ts", 2],
    ["src/lib/trial-notice.ts", 1],
  ])("%s sends owner mail through it", (file, n) => {
    expect(read(file).match(/await ownerMailAddress\(/g)?.length).toBe(n);
  });

  it("the welcome email checks the same list", () => {
    const w = read("src/lib/welcome-email.ts");
    expect(w).toContain('if (await isOptedOut("email", accountEmail)) return "skipped";');
  });
});

describe("N-20: a Free morning tap lands where the live push does", () => {
  it("a returning contact on Free opens that card's dashboard, whatever else was held", () => {
    const c = read("src/app/api/push/catchup/route.ts");
    expect(c).toContain('if (category === "contact_return" && !paid) return `${APP_URL}/dashboard${card}`;');
    expect(c).toContain("destinationFor(top.category, (top.row.card_owner as string | null) ?? null, paid)");
  });
});

describe("N-18: the app's billing destination is the compliant panel", () => {
  it("Settings → Plan and billing renders BillingManager, which paints the App Review panel in the app", () => {
    expect(read("src/app/settings/flows/page.tsx")).toMatch(/BillingManager paints a compliant subscription\s*\n\s*\/\/ panel there/);
  });
});
