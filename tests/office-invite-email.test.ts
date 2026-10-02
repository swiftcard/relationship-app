import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildInviteEmail, buildJoinSignInEmail, inviteReplyTo } from "@/lib/office-invite-email";
import { senderFrom } from "@/lib/messaging";
import { htmlToText } from "@/lib/email-text";

// The office invite is the only mail SwiftCard sends to someone with no prior
// relationship to us, and it was the only send site that bypassed sendRawEmail.
// These assert the real built values — not that the source contains a pattern.

const BASE = "SwiftCard <hello@swiftcard.me>";

function invite(over: Partial<Parameters<typeof buildInviteEmail>[0]> = {}) {
  return buildInviteEmail({
    ownerFirst: "Dana",
    officeName: "Acme Realty",
    inviteeFirst: "Sam",
    inviteUrl: "https://swiftcard.me/join/tok123",
    ...over,
  });
}

describe("office invite email", () => {
  const prev = process.env.RESEND_FROM_EMAIL;
  beforeEach(() => { process.env.RESEND_FROM_EMAIL = BASE; });
  afterEach(() => {
    if (prev === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = prev;
  });

  it("From names the inviter — never the company — on the verified address", () => {
    // support@ — a team invitation is the platform writing to a stranger on a
    // customer's behalf. The route passes sender:"support" (api/office/invite).
    const from = senderFrom(invite().fromName, "support");
    // No company in the From: an organisation's name on mail from a domain
    // that isn't theirs is what impersonation filters flag (owner report
    // 2026-09-24, invites in spam). The company is in the subject and body.
    expect(from).toBe("Dana via SwiftCard <support@swiftcard.me>");
    expect(from).not.toContain("Acme");
    // The bug this replaces: header said "SwiftCard", body said "Dana invited you".
    expect(from).not.toBe(BASE);
  });

  it("a hostile office name cannot break the From header", () => {
    const from = senderFrom('Dana <evil@x.com>\r\nBcc: leak@x.com (Acme)', "support");
    expect(from).not.toMatch(/[\r\n]/);
    expect(from.match(/</g)!.length).toBe(1);
    expect(from.endsWith("<support@swiftcard.me>")).toBe(true);
  });

  it("tells a stranger that ignoring it is safe — with no unsubscribe link", () => {
    // An unsubscribe link is a newsletter marker (owner, 2026-10-02: the invite
    // must reach the Primary inbox). See the inbox-placement block below.
    const { html } = invite();
    expect(html).toContain("you can ignore this email — nothing happens unless you accept");
    expect(html).not.toMatch(/unsubscribe/i);
    expect(html).not.toContain("undefined");
  });

  it("carries a sender-identity block and says how the address was obtained", () => {
    const { html } = invite();
    expect(html).toContain("on behalf of Acme Realty");
    expect(html).toContain("New York, NY");
    expect(html).toContain("added you to");
  });

  it("the derived text part keeps the accept link, and not the <title>", () => {
    const e = invite();
    const text = htmlToText(e.html);
    // Guards the parity that dropping the hand-maintained text body buys: the
    // two MIME parts are now derived from one source and cannot disagree.
    expect(text).toContain("/join/tok123");
    // The subject sits in <head><title>; htmlToText drops the whole head.
    expect(text.trim().startsWith(e.subject)).toBe(false);
    expect(text).not.toMatch(/unsubscribe/i);
  });

  it("an office name containing markup is escaped, not rendered", () => {
    const { html } = invite({ officeName: '<img src=x onerror=alert(1)>' });
    expect(html.includes("<img src=x")).toBe(false);
    expect(html.includes("&lt;img")).toBe(true);
  });

  it("prints the destination host as visible text", () => {
    expect(invite().html).toContain("This link goes to swiftcard.me");
  });

  it("falls back to a safe host label when the invite URL is unparseable", () => {
    expect(invite({ inviteUrl: "not-a-url" }).html).toContain("This link goes to swiftcard.me");
  });

  // Unknown inviter name / unknown company: the old stand-in strings were read
  // as words in the sentence — "A invited you…", "create your your new team
  // digital business card", "added you to the your new team team".
  it("an inviter with no name on file is never a fragment like 'A'", () => {
    const e = invite({ ownerFirst: null });
    expect(e.subject).toBe("You're invited to join Acme Realty on SwiftCard");
    expect(e.html).toContain("You've been added to the <strong>Acme Realty</strong> team on SwiftCard");
    expect(e.html).toContain("because a team admin entered your email address");
    expect(e.fromName).toBe("");
    expect(senderFrom(e.fromName, "support")).toBe("SwiftCard <support@swiftcard.me>");
  });

  it("an office with no company name reads as a sentence, not a placeholder", () => {
    const e = invite({ officeName: null });
    expect(e.subject).toBe("Dana invited you to join their team on SwiftCard");
    expect(e.html).toContain("Dana added you to their team on SwiftCard");
    expect(e.html).not.toMatch(/your new team|My Office|the\s+team/);
    expect(e.html).toContain("Sent by SwiftCard · New York, NY");
    expect(e.fromName).toBe("Dana");
  });

  it("neither known: plain SwiftCard From, still a real sentence", () => {
    const e = invite({ ownerFirst: null, officeName: null });
    expect(e.subject).toBe("You're invited to join a team on SwiftCard");
    expect(e.html).toContain("You've been added to a team on SwiftCard");
    expect(senderFrom(e.fromName, "support")).toBe("SwiftCard <support@swiftcard.me>");
  });

  it("a company already named '… Team' doesn't get a second 'team'", () => {
    expect(invite({ officeName: "Sales Team" }).html).toContain("the <strong>Sales Team</strong> on SwiftCard");
  });

  it("tells Apple users to share their email so the app can find the invite", () => {
    expect(invite().html).toContain("Choose <strong>Share My Email</strong>");
  });
});

// ── App Store badge: added to the invite on 2026-09-02, removed again on
// 2026-09-06 — the invite has exactly one door. ──────────────────────────────
describe("office invite App Store badge", () => {
  // 2026-09-06 the app was kept OUT of the invite: installing first and
  // signing in with Google stranded people in a personal Free account with the
  // invite still pending. Owner, 2026-09-16: "when the subuser gets the email
  // ... they just download the app and then they log in with the same email".
  // That path now works (onboarding, the dashboard and /welcome all route a
  // pending invite to Join), so the invite names the app and the address to use.
  it("tells the invitee they can use the app with their invited address", () => {
    const html = buildInviteEmail({ ownerFirst: "Ada", officeName: "Acme", inviteUrl: "https://swiftcard.me/join/tok123", inviteEmail: "sam@acme.com" }).html;
    expect(html).toContain("You can also do this in the <strong>SwiftCard</strong> app — create your account there with <strong>sam@acme.com</strong>");
    // Still one button: the claim link. No store badge competing with it.
    expect(html).not.toContain("apps.apple.com");
  });

  it("the paths that make the app door safe are in place", () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    expect(read("src/app/onboarding/page.tsx")).toContain('intent === "signin" && !(await findPendingInviteForEmail(user.email, user.id))');
    expect(read("src/app/welcome/page.tsx")).toContain("if (invite) redirect(`/join/${encodeURIComponent(invite.token)}`)");
    expect(read("src/components/JoinSignIn.tsx")).toContain("if (native) {");
    expect(read("src/components/JoinButton.tsx")).toContain("/cards/${json.firstCardId}/edit?joined=1");
  });

  it("the welcome email rides the same switch (appStoreEmailBlock)", () => {
    const tpl = readFileSync(join(process.cwd(), "src/lib/email-templates.ts"), "utf8");
    expect(tpl).toMatch(/\$\{appStoreEmailBlock\(/);
    const lib = readFileSync(join(process.cwd(), "src/lib/app-store.ts"), "utf8");
    expect(lib).toMatch(/if \(!APP_STORE_URL\) return "";/);
  });
});

// Owner report 2026-09-24: invites landing in the invitee's spam. A personal
// mailbox as the Reply-To on mail From swiftcard.me is a spam rule on its own
// (SpamAssassin FREEMAIL_FORGED_REPLYTO), so only a company address is used.
describe("the invite's Reply-To", () => {
  it("is the inviter at a company address, so 'who is this?' reaches them", () => {
    expect(inviteReplyTo("dana@meridianbank.com")).toBe("dana@meridianbank.com");
    expect(inviteReplyTo("  dana@acme-realty.co.uk ")).toBe("dana@acme-realty.co.uk");
  });

  it("falls back to support@ (null) for a personal mailbox, or no address", () => {
    for (const e of ["dana@gmail.com", "Dana@GMAIL.com", "d@icloud.com", "d@yahoo.com", "d@outlook.com", "d@hotmail.com", "d@aol.com", "d@proton.me"]) {
      expect(inviteReplyTo(e), e).toBeNull();
    }
    expect(inviteReplyTo(null)).toBeNull();
    expect(inviteReplyTo("")).toBeNull();
    expect(inviteReplyTo("not-an-email")).toBeNull();
  });
});

// ── Inbox placement (owner, 2026-10-02) ──────────────────────────────────────
// "When an admin sends a subuser an invitation, that email goes to his inbox.
// It cannot go to spam and it cannot go to promotions." Each rule below is a
// signal that Gmail's Promotions classifier or SpamAssassin scores; bringing
// any one of them back is how an invite slides out of Primary with nothing
// visibly broken in the app.
describe("the invite is built for the Primary inbox", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

  it("reads like a workspace invite: 'Dana invited you to join Acme on SwiftCard'", () => {
    expect(invite().subject).toBe("Dana invited you to join Acme Realty on SwiftCard");
    for (const e of [invite(), invite({ ownerFirst: null }), invite({ officeName: null }), invite({ ownerFirst: null, officeName: null })]) {
      expect(e.subject).not.toMatch(/digital business card|free|save|offer|%|!/i);
    }
  });

  it("is a complete HTML document (no HTML_MIME_NO_HTML_TAG)", () => {
    const signIn = buildJoinSignInEmail({ officeName: "Acme", signInUrl: "https://swiftcard.me/auth/confirm?x=1", inviteEmail: "sam@acme.com" });
    for (const html of [invite().html, signIn.html]) {
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toMatch(/<body[^>]*>[\s\S]*<\/body><\/html>$/);
    }
  });

  it("carries no newsletter or store-promo markers", () => {
    const { html } = invite({ brandLogoUrl: "https://cdn.example.com/logo.png", inviteEmail: "sam@acme.com" });
    expect(html).not.toMatch(/unsubscribe/i);
    expect(html).not.toMatch(/App Store|apps\.apple\.com|play\.google/i);
    expect(html).not.toMatch(/view (this|in) (email|browser)/i);
    // One image at most (the company logo) and exactly one link (the invite).
    expect(html.match(/<img\b/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(html.match(/<a\b/g)?.length).toBe(1);
  });

  it("is sent as personal mail from support@, never as a list from news@", () => {
    const route = read("src/app/api/office/invite/route.ts");
    expect(route).toMatch(/personal: true/);
    expect(route).toMatch(/sender: "support"/);
    expect(route).not.toMatch(/contactUnsubUrl/);
    expect(route).not.toMatch(/sender: "news"/);
  });

  it("open and click tracking stay off for the sending domain", () => {
    expect(read("src/lib/resend-domain.ts")).toContain("JSON.stringify({ open_tracking: false, click_tracking: false })");
  });

  it("no email is ever handed to a QA address that can only bounce", () => {
    expect(read("src/lib/messaging.ts").match(/if \(isTestMailbox\(opts\.to\)\) return "sent";/g)?.length).toBe(2);
  });
});
