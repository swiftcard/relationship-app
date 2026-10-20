import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { heldCategory, CONTACT_RULE_CATEGORIES } from "@/lib/catchup-category";
import { contactReturnNotice, FORWARDED_OPEN_TITLE } from "@/lib/contact-return-notify";
import type { KnownContact } from "@/lib/known-contact";

// ── The 8am catch-up announces what would have buzzed, and only that ────────
//
// NM-01: the forwarded-link note shares contact_returned with a real return,
//        but is bell only; at 11pm it used to buzz the phone at 8am.
// NM-02: a closed contact downloading the card again never buzzes live, but
//        the morning only applied the closed rule to returns.
// NM-03: a view that crossed a milestone is upgraded to milestone_<N>, which
//        the morning dropped, losing the one view worth celebrating.

const contact: KnownContact = {
  kind: "known",
  leadId: "lead-1",
  cardOwner: "dana",
  name: "Priya Shah",
  whereMet: null,
  capturedAt: "2026-10-01T12:00:00Z",
  status: "new",
  confidence: "forwarded",
  tags: [],
};

describe("heldCategory", () => {
  it("the forwarded-link note is bell only, a real return is caught up", () => {
    const forwarded = contactReturnNotice({
      contact,
      eventType: "viewed_card", surface: "card", visitsThisWeek: 1, paid: true,
    });
    expect(forwarded?.title).toBe(FORWARDED_OPEN_TITLE);
    expect(forwarded && "pushCategory" in forwarded).toBe(false);
    expect(heldCategory({ type: "contact_returned", title: FORWARDED_OPEN_TITLE, lead_id: "lead-1" })).toBeUndefined();
    expect(heldCategory({ type: "contact_returned", title: "Priya re-opened your card", lead_id: "lead-1" })).toBe("contact_return");
  });

  it("a view that crossed a milestone is still that view", () => {
    expect(heldCategory({ type: "milestone_50", title: "50 views", lead_id: null })).toBe("card_view");
    expect(heldCategory({ type: "milestone_100", title: "100 views", lead_id: "lead-1" })).toBe("contact_return");
  });

  it("a link tap is the returning contact's visit, upgraded in silence", () => {
    expect(heldCategory({ type: "contact_engaged", title: "Priya tapped your a link", lead_id: "lead-1" })).toBe("contact_return");
  });

  it("everything else keeps its category, and bell-only types stay out", () => {
    expect(heldCategory({ type: "card_viewed" })).toBe("card_view");
    expect(heldCategory({ type: "new_lead" })).toBe("new_lead");
    expect(heldCategory({ type: "payment_failed" })).toBe("billing_problem");
    expect(heldCategory({ type: "lead_cap_reached" })).toBeUndefined();
    expect(heldCategory({ type: "weekly_recap" })).toBeUndefined();
  });

  it("the closed-contact rule covers a returning contact's download too", () => {
    expect(CONTACT_RULE_CATEGORIES).toEqual(expect.arrayContaining(["contact_return", "contact_saved"]));
  });
});

describe("wired into the catch-up", () => {
  const route = readFileSync("src/app/api/push/catchup/route.ts", "utf8");
  it("reads the category from the row, not a type map", () => {
    expect(route).toContain("heldCategory(r)");
    expect(route).not.toMatch(/CATEGORY_FOR_TYPE/);
    // title is what tells the forwarded note apart
    expect(route).toMatch(/\.select\("type, title, body, card_owner, created_at, lead_id"\)/);
  });
  it("filters every silenceable row, not only returns", () => {
    expect(route).toContain("CONTACT_RULE_CATEGORIES.includes(x.category) && !!x.row.lead_id");
    expect(route).toContain("held = held.filter((x) => !silenceable(x) || allowed(String(x.row.lead_id)));");
  });
});
