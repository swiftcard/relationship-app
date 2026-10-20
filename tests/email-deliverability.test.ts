import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { welcomeEmail, marketingEmail, promoEmail, marketingHeaders } from "@/lib/email-templates";
import { senderFrom } from "@/lib/messaging";
import { htmlToText } from "@/lib/email-text";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Deliverability invariants — these are the things that, if they regress, send
// legitimate mail to spam. Locking them here so a future refactor can't quietly
// reintroduce the unauthenticated sender or drop the one-click unsubscribe pair.

describe("email deliverability invariants", () => {
  it("marketingHeaders emits BOTH RFC 8058 one-click unsubscribe headers", () => {
    const url = "https://swiftcard.me/unsubscribe?token=abc";
    const h = marketingHeaders(url);
    // A footer link alone is not enough — Gmail/Yahoo require both of these.
    expect(h["List-Unsubscribe"]).toBe(`<${url}>`);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("default sender is the authenticated swiftcard.me domain, never onboarding@resend.dev", () => {
    const e = welcomeEmail({
      firstName: "Alex",
      cardUrl: "https://swiftcard.me/card/alex",
      unsubscribeUrl: "https://swiftcard.me/unsubscribe?token=x",
    });
    expect(e.from).toContain("swiftcard.me");
    expect(e.from).not.toContain("resend.dev");
  });

  it("marketing + promo emails carry a plain-text alternative (multipart, not HTML-only)", () => {
    const mk = marketingEmail({
      firstName: "Alex", subject: "Hi", headline: "Big news", body: "Body copy",
      ctaLabel: "Go", ctaUrl: "https://swiftcard.me", unsubscribeUrl: "https://swiftcard.me/unsubscribe?token=x",
    });
    const promo = promoEmail({
      firstName: "Alex", code: "SAVE20", discountText: "20% off", headline: "Deal", body: "copy",
      unsubscribeUrl: "https://swiftcard.me/unsubscribe?token=x",
    });
    for (const e of [mk, promo]) {
      expect(typeof e.text).toBe("string");
      expect(e.text.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── 2026-09-03: "our emails are going to spam" ───────────────────────────────
//
// The DNS side (SPF, DKIM, custom Return-Path, DMARC) was already right; what
// was left were the signals INSIDE the message. Each block below pins one of
// them so it cannot quietly regress.

describe("From: the person, via SwiftCard", () => {
  const prev = process.env.RESEND_FROM_EMAIL;
  beforeEach(() => { process.env.RESEND_FROM_EMAIL = "SwiftCard <hello@swiftcard.me>"; });
  afterEach(() => {
    if (prev === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = prev;
  });

  // A bare personal name on hello@swiftcard.me with a gmail.com Reply-To is
  // the shape of display-name spoofing, and Gmail scores it as such — and when
  // a user mails THEMSELVES to test, Gmail flags "someone is using your name".
  it("a user's name is suffixed with 'via SwiftCard'", () => {
    // Default identity is connect@ — a user writing to another person.
    expect(senderFrom("Dana Reed")).toBe("Dana Reed via SwiftCard <connect@swiftcard.me>");
  });

  it("SwiftCard's own mail is not 'SwiftCard via SwiftCard'", () => {
    expect(senderFrom("SwiftCard")).toBe("SwiftCard <connect@swiftcard.me>");
    expect(senderFrom(null)).toBe("SwiftCard <connect@swiftcard.me>");
    expect(senderFrom("SwiftCard Agents", "support")).toBe("SwiftCard Agents <support@swiftcard.me>");
  });

  it("the address is chosen by IDENTITY, never by a caller-supplied string", () => {
    // The second argument used to be a raw address, which is how a campaign
    // could accidentally ship from the transactional sender. It is now a
    // closed set of keys resolved in lib/email-senders.
    expect(senderFrom("Dana", "billing")).toBe("Dana via SwiftCard <billing@swiftcard.me>");
    expect(senderFrom("Dana", "news")).toBe("Dana via SwiftCard <news@swiftcard.me>");
  });

  it("header injection still cannot escape the display name", () => {
    const from = senderFrom('Dana <evil@x.com>\r\nBcc: leak@x.com');
    expect(from).not.toMatch(/[\r\n]/);
    expect(from.match(/</g)!.length).toBe(1);
  });
});

describe("the plain-text part names the sender even when the body is an image", () => {
  it("an <img alt> becomes its alt text", () => {
    const text = htmlToText('<p>Hi,</p><a href="https://swiftcard.me/dana"><img src="https://swiftcard.me/api/card-signature/dana.png" alt="Dana Reed, Acme — SwiftCard" width="360"></a>');
    expect(text).toContain("Dana Reed, Acme — SwiftCard (https://swiftcard.me/dana)");
    expect(text).not.toContain("<img");
  });

  it("an image without alt text simply disappears", () => {
    expect(htmlToText('<p>Hello</p><img src="x.png">')).toBe("Hello");
  });
});

describe("the shared-card email reads like a person's message", () => {
  const src = read("src/app/api/leads/share-card/route.ts");

  it("carries the sender's details as text under the card image", () => {
    // Not only the image: name, title/company, phone and email as real text,
    // so the body has a text-to-image ratio and still identifies the sender
    // with images blocked.
    expect(src).toMatch(/select\("name, title, company, email, phone"\)/);
    expect(src).toMatch(/const sigLines = \[/);
    expect(src).toMatch(/\$\{esc\(ownerName\)\}<\/p>`/);
    expect(src).toMatch(/ownerPhone \? `<p/);
    expect(src).toMatch(/replyTo \? `<p/);
    expect(src.indexOf("${preview}")).toBeLessThan(src.indexOf("${sigLines}"));
  });

  it("says why the recipient is receiving it", () => {
    expect(src).toMatch(/You're receiving this because \$\{esc\(ownerName\)\} shared their contact card with you\./);
  });

  it("keeps the unsubscribe link and the personal (no-list-header) send", () => {
    expect(src).toMatch(/contactUnsubUrl\(lead\.email as string\)/);
    expect(src).toMatch(/personal: true/);
  });
});

describe("Resend tracking is forced off", () => {
  const src = read("src/lib/resend-domain.ts");

  it("both status reads turn open and click tracking off", () => {
    // Click tracking rewrites every link to a foreign host — a link/text
    // mismatch on mail sent under a user's name. Enforced on every read so a
    // dashboard toggle cannot quietly turn it back on.
    expect(src).toMatch(/body: JSON\.stringify\(\{ open_tracking: false, click_tracking: false \}\)/);
    expect(src.match(/await disableTracking\(found\.id, detail\.tracking\)/g)).toHaveLength(2);
  });

  it("a failed update is reported, not hidden behind a domain error", () => {
    const fn = src.match(/async function disableTracking[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).not.toMatch(/throw/);
    expect(fn).toMatch(/return current;/);
  });

  it("the admin panel shows the tracking state", () => {
    expect(read("src/app/admin/marketing/MarketingClient.tsx")).toMatch(/domain\.tracking/);
  });
});

describe("no send goes out HTML-only", () => {
  it("the agent relay attaches a text part", () => {
    // The relay and the Crew reports share one sender (lib/owner-digest).
    expect(read("src/app/api/agent-email/route.ts")).toMatch(/sendOwnerDigest\(/);
    expect(read("src/lib/owner-digest.ts")).toMatch(/text: htmlToText\(/);
  });
});
