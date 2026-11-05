import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cardEventNotice } from "@/lib/card-event-notify";

// A card owner reported that someone opened their card and nothing happened:
// no notification, and nothing in that person's conversation. Both were real,
// and both were quiet — every piece recorded correctly, the pieces just never
// met. These tests pin the joins that were missing.

describe("what the owner is told", () => {
  it("announces a view, which used to be silent by design", () => {
    const n = cardEventNotice({ eventType: "viewed_card", visitorName: "Aaron Lavi", nameConfirmed: true });
    expect(n).not.toBeNull();
    expect(n!.type).toBe("card_viewed");
    expect(n!.body).toBe("Aaron Lavi viewed your card.");
  });

  it("says Someone when the visitor is genuinely unknown, rather than guessing", () => {
    for (const name of [null, undefined, "", "   "]) {
      expect(cardEventNotice({ eventType: "viewed_card", visitorName: name, nameConfirmed: true })!.body)
        .toBe("Someone viewed your card.");
    }
  });

  it("distinguishes a Swift Links view from a card view — by the page, not the source", () => {
    expect(cardEventNotice({ eventType: "viewed_card", visitorName: "Aaron", nameConfirmed: true, surface: "links", source: "swift_links" })!.body)
      .toBe("Aaron viewed your Swift Links.");
    // Tapped through from Swift Links to the card: a CARD view.
    expect(cardEventNotice({ eventType: "viewed_card", visitorName: "Aaron", nameConfirmed: true, surface: "card", source: "swift_links" })!.body)
      .toBe("Aaron viewed your card.");
    expect(cardEventNotice({ eventType: "viewed_card", visitorName: "Aaron", nameConfirmed: true, source: "qr_code" })!.body)
      .toBe("Aaron viewed your card.");
  });

  it("keeps the save notification, and names the source only there", () => {
    const saved = cardEventNotice({ eventType: "downloaded_vcard", visitorName: "Aaron", nameConfirmed: true, source: "qr_code" });
    // Type unchanged (VISIT_RANK / push category / CRM event name); WORDING
    // changed, because a download is all SwiftCard can actually prove — the
    // "Add to Contacts" sheet belongs to the operating system and never reports
    // whether the person tapped Add, edited it, or cancelled.
    expect(saved!.type).toBe("contact_saved");
    expect(saved!.body).toMatch(/^Aaron downloaded your contact card from /);
    expect(saved!.body).not.toMatch(/\bsaved\b/);

    // A view's source is noise on the most frequent notification an owner gets.
    expect(cardEventNotice({ eventType: "viewed_card", visitorName: "Aaron", nameConfirmed: true, source: "qr_code" })!.body)
      .not.toMatch(/from/);

    // direct_link is the default and reads as clutter.
    expect(cardEventNotice({ eventType: "downloaded_vcard", visitorName: "Aaron", nameConfirmed: true, source: "direct_link" })!.body)
      .toBe("Aaron downloaded your contact card.");
  });

  it("stays silent for events that are not news", () => {
    for (const t of ["clicked_save_contact", "clicked_link", "unknown_event", ""]) {
      expect(cardEventNotice({ eventType: t })).toBeNull();
    }
  });
});

// ── The joins, pinned at the source ─────────────────────────────────────────
// These read the files rather than mounting React. What broke here was not
// logic inside a component — it was a field left off a request body in three
// places, which no unit test of those components would have noticed.

const read = (p: string) => readFile(p, "utf8");

describe("a contact is always linked to its own activity", () => {
  it("every surface that creates a contact sends visitor_id", async () => {
    // SaveContactButton, ConnectButton and SocialLinkIntercept all POSTed to
    // /api/leads without it, so the contact row stored null — and the
    // conversation view joins card_events BY visitor_id. The events existed;
    // they had nothing to attach to.
    // SocialLinkIntercept dropped 2026-08-25: links no longer capture — they navigate directly (owner decision).
    for (const f of ["SaveContactButton", "ConnectButton", "LeadCaptureForm"]) {
      const src = await read(`src/components/${f}.tsx`);
      const leadPost = src.slice(src.indexOf('fetch("/api/leads"'));
      expect(leadPost.length, `${f}: no /api/leads call found`).toBeGreaterThan(0);
      expect(leadPost.slice(0, 900), `${f} must send visitor_id`).toMatch(/visitor_id:/);
    }
  });

  it("the conversation asks by lead, and never bails on a missing visitor id", async () => {
    const src = await read("src/components/ContactsClient.tsx");
    expect(src).toMatch(/card-events\?lead_id=/);
    // The client half of the same bug: a contact with no visitor_id returned
    // early and never even asked, so its conversation was empty by construction.
    expect(src).not.toMatch(/if \(!lead\.visitor_id\) return;/);
  });

  it("a view never carries the browser's own claim of who it is", async () => {
    // It used to send the swiftcard_visitor blob, which names someone to every
    // card they open after sharing with ANY one (warm-lead plan H4, owner
    // decision 2026-09-18). Who a visitor is to this owner is now decided on
    // the server from the owner's own contact record — tests/known-contact.
    const src = await read("src/components/CardEventTracker.tsx");
    expect(src).not.toMatch(/getVisitorInfo/);
    expect(src).not.toMatch(/visitor_name:/);
    expect(src).not.toMatch(/visitor_email:/);
    expect(src).not.toMatch(/visitor_phone:/);
  });

  it("the server names an anonymous visitor only from this owner's own record of them", async () => {
    const route = await read("src/app/api/card-events/route.ts");
    expect(route).toMatch(/const ownersOwnContact = contact\.kind === "known" && contact\.confidence !== "forwarded" \? contact : null;/);
    expect(route).toMatch(/visitor_name: ownersOwnContact \? ownersOwnContact\.name \|\| null : null,\s*\n\s*visitor_email: null,\s*\n\s*visitor_phone: null,/);
  });
});

describe("the bell does not wait", () => {
  it("polls on mount and when the app comes back to the foreground", async () => {
    const src = await read("src/components/NotificationBell.tsx");
    // A 30s interval alone meant opening the app showed state from up to half a
    // minute ago — after a push had already buzzed the phone.
    expect(src).toMatch(/visibilitychange/);
    expect(src).toMatch(/addEventListener\("focus"/);
    // Called immediately, not only inside setInterval.
    expect(src).toMatch(/\n\s*poll\(\);/);
  });
});
