import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { from, replyToFor, SENDERS, INBOX_ADDRESS, MUST_RECEIVE, ALIASES_LIVE } from "../src/lib/email-senders";
import {
  receiptEmail, trialStartedEmail, paymentFailedEmail,
  welcomeEmail, trialEndingSoonEmail, trialEndedEmail,
  marketingEmail, promoEmail,
} from "../src/lib/email-templates";

// ── Every email leaves from the right identity ───────────────────────────────
//
// One address used to send everything: a user hand-sharing their card, a Stripe
// receipt, a marketing blast, and the watchdog's own alerts. That meant a
// complaint on a campaign damaged the deliverability of the card shares the
// product exists to send, and a reply to a receipt landed in the same queue as
// a reply to a stranger's team invite.
//
// Five identities now, split by WHAT THE MESSAGE IS:
//   connect@  a user, to another person       reply → that user
//   support@  platform, to its own users      reply → us
//   billing@  money, nothing else             reply → us
//   news@     bulk campaigns                  reply → support@
//   hello@    INBOUND ONLY, never a From
//
// These tests are the guardrail. A new send site that forgets its identity
// silently inherits `support`, and a send site that reaches for hello@ throws.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the five identities", () => {
  it("are all on the verified domain, so none needs new DNS", () => {
    for (const [key, s] of Object.entries(SENDERS)) {
      expect(s.address, `${key} is off-domain`).toMatch(/@swiftcard\.me$/);
    }
  });

  it("hello@ can never appear in a From header", () => {
    expect(SENDERS.inbox.canSend).toBe(false);
    expect(() => from("inbox")).toThrow(/receive-only/);
  });

  it("names the person on a user-to-user send, and only there", () => {
    expect(from("connect", "Dana Reed")).toBe("Dana Reed via SwiftCard <connect@swiftcard.me>");
    expect(from("billing")).toBe("SwiftCard <billing@swiftcard.me>");
    expect(from("support")).toBe("SwiftCard <support@swiftcard.me>");
    expect(from("news")).toBe("SwiftCard <news@swiftcard.me>");
  });

  it("never doubles the brand into 'SwiftCard via SwiftCard'", () => {
    expect(from("support", "SwiftCard Agents")).toBe("SwiftCard Agents <support@swiftcard.me>");
    expect(from("connect", "SwiftCard")).toBe("SwiftCard <connect@swiftcard.me>");
  });

  it("cannot be broken out of by a hostile display name", () => {
    const f = from("connect", 'Dana <evil@x.com>\r\nBcc: leak@x.com');
    expect(f).not.toMatch(/[\r\n]/);
    expect(f.match(/</g)!.length).toBe(1);
    expect(f.endsWith("<connect@swiftcard.me>")).toBe(true);
  });
});

describe("no reply goes nowhere", () => {
  // THE hard rule: no user-facing email may have a reply path that dead-ends.
  //
  // Sending from connect@/support@/billing@/news@ works the moment the domain
  // is verified, but RECEIVING needs the Google Workspace aliases to exist.
  // Until they do, ALIASES_LIVE stays false and every default reply target is
  // hello@ — the one mailbox we know is monitored. Pointing a receipt at
  // billing@ before it exists would be strictly worse than the old behaviour,
  // where no Reply-To meant replies fell back to hello@ and reached a human.

  it("sends a card-share reply to the USER, never to us", () => {
    expect(replyToFor("connect", "dana@acme.com")).toBe("dana@acme.com");
  });

  it("every default reply target is an address that actually receives", () => {
    for (const key of ["connect", "support", "billing", "news"] as const) {
      const to = replyToFor(key);
      expect(to, `${key} has no reply path`).toBeTruthy();
      expect(MUST_RECEIVE, `${key} replies to an unprovisioned mailbox`).toContain(to);
    }
  });

  it("falls back to the monitored inbox while the aliases are not live", () => {
    if (ALIASES_LIVE) return; // covered by the next test instead
    expect(MUST_RECEIVE).toEqual([INBOX_ADDRESS]);
    for (const key of ["connect", "support", "billing", "news"] as const) {
      expect(replyToFor(key)).toBe(INBOX_ADDRESS);
    }
  });

  it("moves every reply onto its own identity once the aliases are live", () => {
    if (!ALIASES_LIVE) return; // the flip has not happened yet
    expect(replyToFor("billing")).toBe("billing@swiftcard.me");
    expect(replyToFor("support")).toBe("support@swiftcard.me");
    expect(replyToFor("news")).toBe("support@swiftcard.me");
    expect(MUST_RECEIVE).toEqual(expect.arrayContaining([
      "hello@swiftcard.me", "support@swiftcard.me", "billing@swiftcard.me", "connect@swiftcard.me",
    ]));
  });

  it("derives the receivable list rather than hand-asserting it", () => {
    // A hand-written array would prove only that the list contains itself.
    expect(read("src/lib/email-senders.ts")).toMatch(/MUST_RECEIVE: string\[\] = ALIASES_LIVE/);
  });
});

describe("each template leaves from its own identity", () => {
  const U = "https://swiftcard.me/u";
  const cases: [string, { from: string; replyTo?: string }, string][] = [
    ["receipt", receiptEmail({ firstName: "Dana", email: "d@a.com", planName: "Pro", amount: "$4.99", interval: "month", paymentDate: "Apr 1", invoiceNumber: "H63-1", manageUrl: U }), "billing"],
    ["trial started", trialStartedEmail({ firstName: "Dana", planName: "Pro", amount: "$4.99", interval: "month", firstChargeDate: "May 1", manageUrl: U }), "billing"],
    ["payment failed", paymentFailedEmail({ firstName: "Dana", planName: "Pro", amount: "$4.99", manageUrl: U }), "billing"],
    ["welcome", welcomeEmail({ firstName: "Dana", cardUrl: U, unsubscribeUrl: U }), "support"],
    ["trial ending soon", trialEndingSoonEmail({ firstName: "Dana", daysLeft: 3, isTrial: true, unsubscribeUrl: U }), "support"],
    ["trial ended", trialEndedEmail({ firstName: "Dana", isTrial: true, unsubscribeUrl: U }), "support"],
    ["marketing broadcast", marketingEmail({ firstName: "Dana", subject: "s", headline: "h", body: "b", ctaLabel: "Go", ctaUrl: U, unsubscribeUrl: U }), "news"],
    ["promo code", promoEmail({ firstName: "Dana", code: "X", discountText: "20% off", headline: "h", body: "b", unsubscribeUrl: U }), "news"],
  ];

  for (const [name, built, expected] of cases) {
    it(`${name} → ${expected}@`, () => {
      expect(built.from).toBe(`SwiftCard <${expected}@swiftcard.me>`);
    });
    it(`${name} carries a working Reply-To`, () => {
      expect(built.replyTo, `${name} has no reply path`).toBeTruthy();
      expect(MUST_RECEIVE).toContain(built.replyTo);
    });
  }
});

describe("every send site declares its identity", () => {
  it("card share and scanner send as the user, replying to the user", () => {
    const share = read("src/app/api/leads/share-card/route.ts");
    expect(share).toMatch(/sender: "connect"/);
    expect(share).toMatch(/replyTo,/);
    const scan = read("src/app/api/scanner/send/route.ts");
    expect(scan).toMatch(/sender: "connect"/);
    // Was missing entirely — a reply would have died on connect@.
    expect(scan).toMatch(/replyTo: user\.email \?\? null/);
  });

  it("automated follow-ups still send AS the user", () => {
    expect(read("src/lib/messaging.ts")).toMatch(/sender: "connect", replyTo: sender\.email/);
  });

  it("account setup and team invites come from the platform", () => {
    expect(read("src/app/api/admin/create-card/route.ts")).toMatch(/sender: "support"/);
    const inv = read("src/app/api/office/invite/route.ts");
    expect(inv).toMatch(/sender: "support"/);
    // A stranger's "who are you?" reaches the inviter at a company address;
    // a personal mailbox falls back to support@ (see office-invite-email).
    expect(inv).toMatch(/replyTo: inviteReplyTo\(user\.email\)/);
  });

  it("campaigns no longer have their sender overwritten", () => {
    // THE bug: `from` was spread AFTER the template, silently replacing the
    // campaign sender with the transactional one — so the split never existed.
    for (const p of ["src/app/api/admin/broadcast/route.ts", "src/app/api/admin/promo-codes/send/route.ts"]) {
      expect(read(p), `${p} still overrides the template sender`).not.toMatch(/^\s+from,$/m);
      expect(read(p)).not.toMatch(/getMarketingFrom/);
    }
  });

  it("internal alerts land ON hello@ but never come FROM it", () => {
    for (const p of ["src/app/api/agent-email/route.ts", "src/app/api/contact/route.ts"]) {
      const src = read(p);
      expect(src, `${p} does not send from support@`).toMatch(/senderAddress\("support"/);
      expect(src, `${p} lost its hello@ destination`).toMatch(/INBOX_ADDRESS/);
    }
    expect(INBOX_ADDRESS).toBe("hello@swiftcard.me");
  });
});

describe("the sandbox sender is gone", () => {
  it("cannot put a user's name on an unauthenticated domain", () => {
    // getMarketingFrom() fell back to Resend's shared sandbox, which is not
    // authenticated for us and only delivers to the Resend account owner.
    // Match the string as a VALUE, not the comment explaining why it's gone.
    const dom = read("src/lib/resend-domain.ts");
    expect(dom).not.toMatch(/["'`][^"'`]*onboarding@resend\.dev/);
    expect(dom).not.toMatch(/export async function getMarketingFrom/);
    // And nothing anywhere may fall back to it.
    for (const p of ["src/lib/messaging.ts", "src/lib/email-templates.ts", "src/lib/email-senders.ts"]) {
      expect(read(p), `${p} references the sandbox sender`).not.toMatch(/resend\.dev/);
    }
  });

  it("no send site reads RESEND_FROM_EMAIL any more", () => {
    for (const p of ["src/lib/messaging.ts", "src/lib/email-templates.ts", "src/app/api/contact/route.ts"]) {
      expect(read(p), `${p} still reads the legacy env var`).not.toMatch(/RESEND_FROM_EMAIL/);
    }
  });
});
