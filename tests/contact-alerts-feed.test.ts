import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Warm-lead plan PR B2: the in-app side of a returning-contact alert.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// Owner decision 2026-09-23: the contact panel has no "Copy personal link"
// line and no "Alert me when they come back" switch. Every returning contact
// alerts (unless Not interested / Closed); links SwiftCard sends for you still
// carry the contact's code on their own.
describe("the contact panel stays without the personal-link line and the per-contact switch", () => {
  it("renders neither, and neither component or route exists", () => {
    const panel = read("src/components/ContactsClient.tsx");
    expect(panel).not.toMatch(/CopyPersonalLinkButton|ContactAlertsToggle|Copy personal link|Alert me when they come back/);
    for (const f of [
      "src/components/CopyPersonalLinkButton.tsx",
      "src/components/ContactAlertsToggle.tsx",
      "src/app/api/leads/[id]/link/route.ts",
      "src/app/api/leads/[id]/alerts/route.ts",
    ]) expect(existsSync(join(process.cwd(), f))).toBe(false);
  });
});

describe("Wrong person?", () => {
  const src = read("src/app/api/leads/[id]/wrong-person/route.ts");

  it("only for the owner's own alert about their own contact", () => {
    expect(src).toMatch(/!ownsLead\(usernames, lead\) \|\| !note \|\| note\.user_id !== user\.id \|\| note\.lead_id !== leadId/);
  });

  it("unbinds the visit's browsers (kept and marked — the trust metric) and removes the alert", () => {
    expect(src).toMatch(/update\(\{ wrong_at: new Date\(\)\.toISOString\(\) \}\)/);
    expect(src).not.toMatch(/from\("contact_devices"\)\s*\.delete/);
    expect(src).toMatch(/from\("notifications"\)\.delete\(\)\.eq\("id", notificationId\)\.eq\("user_id", user\.id\)/);
  });

  it("takes the contact off that visit's events, so their history and score stop counting it", () => {
    expect(src).toMatch(/from\("card_events"\)\.update\(\{ lead_id: null, lead_confidence: null \}\)/);
    expect(src).toMatch(/from\("card_views"\)\.update\(\{ lead_id: null \}\)/);
  });

  // In the bell since the dashboard's notifications list went with Quick
  // Contacts (owner, 2026-09-29).
  it("is offered only on rows that name a returning contact", () => {
    const bell = read("src/components/NotificationBell.tsx");
    expect(bell).toMatch(/const NAMED_RETURN_TYPES = new Set\(\["contact_returned", "contact_engaged"\]\);/);
    expect(bell).toMatch(/NAMED_RETURN_TYPES\.has\(n\.type\) && n\.lead_id &&/);
    // Asks first, then POSTs with the notification id; the row comes back if
    // the request fails.
    expect(bell).toContain("fetch(`/api/leads/${encodeURIComponent(n.lead_id)}/wrong-person`");
    expect(bell).toContain("body: JSON.stringify({ notificationId: n.id })");
    expect(bell).toContain("Not them? We&apos;ll stop recognising that device.");
  });
});

// The bell is the feed now: the dashboard's per-card list went with Quick
// Contacts (owner, 2026-09-29).
describe("the feed", () => {
  const bell = read("src/components/NotificationBell.tsx");

  it("opens the contact by id, else that card's contacts", () => {
    expect(bell).toContain("if (n.lead_id) return `/contacts?${card ? `${card}&` : \"\"}lead=${encodeURIComponent(n.lead_id)}`;");
    expect(bell).toMatch(/"contact_returned", "contact_engaged"\]\);/);
  });

  it("blurs a Free account's contact names in titles", () => {
    expect(bell).toMatch(/<NotificationBody text=\{n\.title\} \/>/);
  });

  it("refreshes while on screen, and not at all while hidden", () => {
    expect(bell).toMatch(/setInterval\(poll, 30000\)/);
    expect(bell).toMatch(/if \(document\.visibilityState === "hidden"\) return;/);
  });

  it("the API hands back lead_id, and still works without the column", () => {
    const api = read("src/app/api/notifications/route.ts");
    expect(api).toMatch(/scopedQuery\("id, type, title, body, read, created_at, card_owner, lead_id"\)/);
    expect(api).toMatch(/if \(error\) \(\{ data: scoped, error \} = await scopedQuery\("id, type, title, body, read, created_at, card_owner"\)\);/);
  });
});

describe("measuring it", () => {
  it("opening a contact stamps their alerts as opened — once, owner-scoped, after the response", () => {
    const page = read("src/app/contacts/page.tsx");
    expect(page).toMatch(/\.update\(\{ opened_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\("user_id", ownerId\)\s*\.eq\("lead_id", selectedLeadParam\)\s*\.is\("opened_at", null\)/);
    expect(page).toMatch(/after\(async \(\) => \{/);
  });
});
