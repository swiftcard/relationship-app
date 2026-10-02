import { describe, it, expect, vi } from "vitest";

// ── Who sees what: every plan × every account type ───────────────────────────
//
// Owner, 2026-10-02: "for each plan and each account type, all the correct
// notifications are showing and there are no mistakes." This is that matrix,
// run through the REAL functions every bell read goes through
// (api/notifications → hideForReader → redactForPlan), on one sample row of
// every kind the product writes. A change that hands a row to the wrong reader,
// or unmasks a Free account, fails here.
//
// Who receives TEAM news (team inbox + team pushes) is pinned with a database
// stand-in in notification-audit-2026-10-02.test.ts; the iPhone app's copy in
// free-notification-hooks / native-suppression.

vi.mock("@/lib/supabase-admin", () => ({ getAdminSupabase: () => { throw new Error("no db in the matrix"); } }));

import { redactForPlan, FREE_STATE_TYPES } from "@/lib/notification-privacy";
import { hideForReader, ORDINARY_READER, REFERRAL_TYPES, PERSONAL_BILLING_TYPES, type NotificationReader } from "@/lib/office-account-notifications";
import { NATIVE_BODY_REMAP, NATIVE_HIDDEN_TYPES } from "@/lib/native-notification-copy";
import { markName } from "@/lib/contact-privacy";
import { markPlace } from "@/lib/location-privacy";

type Row = { id: string; type: string; title: string; body: string; lead_id?: string };

const DANA = markName("Dana Whitfield");
const AUSTIN = markPlace("Austin, TX");

// One row of every kind, written the way its producer writes it.
const ROWS: Row[] = [
  { id: "view", type: "card_viewed", title: "Someone viewed your card", body: `Someone viewed your card in ${AUSTIN}` },
  { id: "saved", type: "contact_saved", title: "Someone saved your contact", body: `Saved to their phone in ${AUSTIN}` },
  { id: "lead", type: "new_lead", title: "New contact: Dana Whitfield", body: "Dana Whitfield shared their info with you.", lead_id: "L1" },
  { id: "locked", type: "new_lead", title: `New contact: ${DANA}`, body: `${DANA} shared their info — open to unlock.`, lead_id: "L2" },
  { id: "back", type: "contact_returned", title: `${DANA} re-opened your card`, body: `${DANA} re-opened your card.`, lead_id: "L3" },
  { id: "reply", type: "lead_reply", title: "Dana replied", body: "Sounds good, Tuesday works.", lead_id: "L1" },
  { id: "m50", type: "milestone_50", title: "50 views", body: `Your card reached 50 views — latest from ${AUSTIN}` },
  { id: "recap", type: "weekly_recap", title: "Your week: 12 views", body: `Top place: ${AUSTIN}` },
  { id: "cap", type: "lead_cap_reached", title: "That's 5 of 5", body: "Pro opens every one of them." },
  { id: "proEnded", type: "pro_ended", title: "Your Pro plan has ended", body: "Subscribe to get it back." },
  { id: "downgraded", type: "plan_downgraded", title: "Back on Free", body: "Paused until you upgrade." },
  { id: "paused", type: "sequence_paused", title: "Follow-up sequences paused", body: "Text follow-ups are part of Pro." },
  { id: "refProgress", type: "referral_progress", title: "2 of 3 referrals complete", body: "One more to unlock Pro free for one month." },
  { id: "refClaim", type: "referral_claim", title: "You earned a free month", body: "Tap here to get it." },
  { id: "payFail", type: "payment_failed", title: "Payment failed", body: "Update your card." },
  { id: "subReminder", type: "personal_sub_reminder", title: "You still have a personal Pro subscription", body: "Cancel it in Plan and billing." },
  { id: "joined", type: "office_joined", title: "You joined Harbor Realty", body: "Your card is part of the team now." },
  { id: "brand", type: "office_brand_updated", title: "Team branding updated", body: "Your card picked up the new look." },
];

type Persona = { name: string; paid: boolean; reader: NotificationReader };
const PERSONAS: Persona[] = [
  { name: "Free", paid: false, reader: ORDINARY_READER },
  { name: "Pro", paid: true, reader: ORDINARY_READER },
  { name: "Office owner", paid: true, reader: { officeAccount: true, teamMember: false, ownSubscription: true } },
  { name: "Office member (company pays)", paid: true, reader: { officeAccount: true, teamMember: true, ownSubscription: false } },
  { name: "Office member (still pays for own Pro)", paid: true, reader: { officeAccount: true, teamMember: true, ownSubscription: true } },
  // A lapsed Office owner IS a Free account: plan is free, so the reader is ordinary.
  { name: "Former Office owner (lapsed to Free)", paid: false, reader: ORDINARY_READER },
];

/** Exactly what api/notifications hands this reader. */
function bellFor(p: Persona): Row[] {
  return redactForPlan(hideForReader(ROWS, p.reader), p.paid) as Row[];
}
const ids = (rows: Row[]) => rows.map((r) => r.id);
const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;
const MARK = /[▀-▟]|█|▒/; // the blocks a redacted name or place becomes

describe("the notification matrix", () => {
  for (const p of PERSONAS) {
    describe(p.name, () => {
      const bell = bellFor(p);

      it("sees every row about their own card's activity", () => {
        for (const id of ["view", "saved", "lead", "locked", "back", "reply", "m50", "recap"]) {
          expect(ids(bell), `${p.name} should see ${id}`).toContain(id);
        }
      });

      it(p.paid ? "sees names and places in full" : "has every name and place blocked out", () => {
        for (const r of bell) {
          const text = `${r.title} ${r.body}`;
          if (p.paid) {
            expect(text, `${p.name}: ${r.id}`).not.toMatch(MARK);
            expect(text).not.toMatch(/[-]/); // no invisible marks left behind either
          }
        }
        if (p.paid) {
          expect(byId(bell, "view").body).toContain("Austin, TX");
          expect(byId(bell, "back").title).toContain("Dana Whitfield");
          // An unlocked contact reads as a plain fact, never "open to unlock".
          expect(byId(bell, "locked").body).not.toMatch(/open to unlock/);
        } else {
          expect(byId(bell, "view").body).not.toContain("Austin");
          expect(byId(bell, "back").title).not.toContain("Dana");
          expect(byId(bell, "locked").title).not.toContain("Dana");
        }
      });

      it("a row that names a contact opens that contact only when the name is visible", () => {
        expect(byId(bell, "lead").lead_id).toBe("L1"); // name never masked: the id travels
        if (p.paid) {
          expect(byId(bell, "locked").lead_id).toBe("L2");
          expect(byId(bell, "back").lead_id).toBe("L3");
        } else {
          // The blur would be one tap from undone.
          expect(byId(bell, "locked").lead_id).toBeUndefined();
          expect(byId(bell, "back").lead_id).toBeUndefined();
        }
      });

      it(p.paid ? "is never shown a Free-plan row" : "is shown the Free-plan rows", () => {
        for (const t of FREE_STATE_TYPES) {
          const present = bell.some((r) => r.type === t);
          expect(present, `${p.name} / ${t}`).toBe(!p.paid);
        }
      });

      it(p.reader.officeAccount ? "is never shown referral rows (no referral programme on Office)" : "is shown referral rows", () => {
        for (const t of REFERRAL_TYPES) {
          expect(bell.some((r) => r.type === t), `${p.name} / ${t}`).toBe(!p.reader.officeAccount);
        }
      });

      it(p.reader.teamMember && !p.reader.ownSubscription
        ? "is never shown billing rows about a subscription they no longer have"
        : "is shown their billing rows", () => {
        const hidden = p.reader.teamMember && !p.reader.ownSubscription;
        for (const t of PERSONAL_BILLING_TYPES) {
          expect(bell.some((r) => r.type === t), `${p.name} / ${t}`).toBe(!hidden);
        }
      });
    });
  }
});

describe("inside the iPhone app, no row sells (App Review 3.1.1)", () => {
  // Rows that remain visible after the app's own filter (NotificationBell:
  // referral_claim and NATIVE_HIDDEN_TYPES hidden, NATIVE_BODY_REMAP bodies).
  // referral_progress is deliberately allowed: referrals returned to the app
  // with in-app purchase (owner, 2026-08-26) and the app's own Refer a friend
  // section says the same thing.
  const SELLING = /upgrade|subscribe|price|\$\d|cancel it|billing|unlock pro/i;
  for (const p of PERSONAS) {
    it(p.name, () => {
      const shown = bellFor(p)
        .filter((n) => n.type !== "referral_claim" && !NATIVE_HIDDEN_TYPES.has(n.type))
        .filter((n) => n.type !== "referral_progress")
        .map((n) => (NATIVE_BODY_REMAP[n.type] ? { ...n, body: NATIVE_BODY_REMAP[n.type] } : n));
      for (const r of shown) {
        if (r.type === "payment_failed") continue; // "Update your card" is account upkeep, not a sale
        expect(r.body, `${p.name}: ${r.id}`).not.toMatch(SELLING);
      }
    });
  }
});
