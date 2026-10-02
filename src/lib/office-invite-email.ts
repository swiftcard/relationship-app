import { escapeHtml } from "@/lib/escape";
import { INVITE_TTL_MS } from "@/lib/office-invite";
import { extractEmailDomain, isPersonalEmailDomain } from "@/lib/logo-provider";

// ── Office invite email ──────────────────────────────────────────────────────
// Pure builder: no IO, so tests assert the real bytes instead of grepping the
// route's source. It lives here rather than inline in the route because the
// invite is the ONLY mail SwiftCard sends to someone with no prior relationship
// to us — a stranger whose address a third party typed in — so it says who sent
// it, why they got it, and that ignoring it is safe.
//
// IT MUST LAND IN THE PRIMARY INBOX (owner, 2026-10-02: "it cannot go to spam
// and it cannot go to promotions"). It reads like the workspace invites Gmail
// files under Primary — Slack's, Google Docs' — and carries none of the
// newsletter markers its Promotions classifier and SpamAssassin score:
//   • no unsubscribe link in the body, and no List-Unsubscribe header (the
//     route sends it personal: true). An invite is not a list; the invitee
//     ignores it or the admin revokes it, and a one-click opt-out also wrote
//     them into message_opt_outs, blocking the re-invite they'd then ask for.
//   • a complete HTML document (doctype, <html>, <body>) — a bare <div> trips
//     SpamAssassin's HTML_MIME_NO_HTML_TAG.
//   • a subject shaped "Dana invited you to join Acme on SwiftCard", not a
//     product pitch ("create your … digital business card").
//   • no store-promo copy ("Get the app from the App Store").
// Sender side, unchanged and also required: support@ (not news@), SPF + DKIM +
// DMARC on swiftcard.me, open/click tracking off (resend-domain.ts), a text
// part (sendRawEmail), and a Reply-To only at a company address (below).
//
// Deliberately does NOT reuse layout() from email-templates.ts: that hardcodes
// SwiftCard's own header image and branding, which fights the whole point of a
// team invite looking like it came from the recipient's employer.

export type InviteEmail = { subject: string; html: string; fromName: string };

// A complete document around the body. `title` is the subject; htmlToText drops
// the whole <head>, so it never leaks into the text part.
export function emailDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">${body}</body></html>`;
}

// An image an email client will actually show. SVG isn't one — Gmail strips
// it and Outlook draws an empty box — and data:/javascript: URLs are blocked
// outright. A company logo that fails this is left out and the email uses its
// company-name header instead of a broken image. (Uploads are re-encoded to
// PNG/JPEG, but the brand's logo field accepts any URL.)
export function emailSafeImageUrl(url: string | null | undefined): string | null {
  const u = (url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    if (/\.svgz?$/i.test(new URL(u).pathname)) return null;
  } catch {
    return null;
  }
  return u;
}

// Every sentence below has a version for "we don't know" — no name on the
// inviter's account, no company anywhere — because the old single-string
// fallbacks read as words in the sentence: "A colleague" was cut to its first
// word and sent as "A invited you…", and "your new team" produced "create your
// your new team digital business card" and "added you to the your new team
// team". Pass null; never pass a placeholder.
export function buildInviteEmail(opts: {
  /** The inviting admin's first name, or null when their account has none. */
  ownerFirst: string | null;
  /** The company (lib/office-display-name), or null when none is known. */
  officeName: string | null;
  inviteeFirst?: string | null;
  inviteUrl: string;
  brandLogoUrl?: string | null;
  /** The invited address, so the "get the app" line can say which email to use. */
  inviteEmail?: string | null;
}): InviteEmail {
  const ownerRaw = opts.ownerFirst?.trim() || null;
  const officeRaw = opts.officeName?.trim() || null;
  const owner = ownerRaw ? escapeHtml(ownerRaw) : null;
  const office = officeRaw ? escapeHtml(officeRaw) : null;
  const first = opts.inviteeFirst ? escapeHtml(opts.inviteeFirst) : null;
  const safeLogo = emailSafeImageUrl(opts.brandLogoUrl);
  const logo = safeLogo ? escapeHtml(safeLogo) : null;
  const ttlDays = Math.round(INVITE_TTL_MS / (24 * 60 * 60 * 1000));
  // "the Sales Team team" — a company already named "… Team" takes no second one.
  const teamPhrase = office
    ? `the <strong>${office}</strong>${/\bteam$/i.test(officeRaw!) ? "" : " team"}`
    : owner ? "their team" : "a team";
  const addedLine = owner
    ? `${owner} added you to ${teamPhrase} on SwiftCard and invited you to create your company digital business card.`
    : `You've been added to ${teamPhrase} on SwiftCard and invited to create your company digital business card.`;
  const why = `You received this because ${owner ?? "a team admin"} entered your email address when adding you to ${office ?? "their team"}.`;
  // Printed as visible text so the recipient can see where the button goes
  // before clicking it — the thing that separates a legitimate invite from the
  // credential-harvest template that shares its shape.
  const host = (() => {
    try {
      return new URL(opts.inviteUrl).host;
    } catch {
      return "swiftcard.me";
    }
  })();

  // "Dana invited you to join Acme Realty on SwiftCard" — the workspace-invite
  // shape, with a version for each thing we may not know.
  const subject = `${ownerRaw ? `${ownerRaw} invited you` : "You're invited"} to join ${officeRaw ?? (ownerRaw ? "their team" : "a team")} on SwiftCard`;

  const html = emailDocument(subject, `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;">
        ${logo
          ? `<img src="${logo}" width="56" height="56" alt="${office ?? ""}" style="border-radius:10px;display:block;margin:0 0 20px;" />`
          : office ? `<div style="margin:0 0 20px;"><span style="font-size:20px;font-weight:800;color:#111827;">${office}</span></div>` : ""}
        <h2 style="font-size:22px;font-weight:700;color:#111;margin:0 0 10px;">${first ? `${first}, you're` : "You're"} invited</h2>
        <p style="color:#444;font-size:15px;line-height:1.5;margin:0 0 24px;">
          ${addedLine} It takes 2 minutes.
        </p>
        <a href="${opts.inviteUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-weight:600;text-decoration:none;padding:13px 30px;border-radius:100px;font-size:15px;">Create my card →</a>
        <p style="color:#6b7280;font-size:12px;margin-top:14px;">This link goes to ${escapeHtml(host)}. The invite expires in ${ttlDays} days.</p>
        ${/* The app is a real second door now (2026-09-16): signing in there
            with this address (email, Google or Apple) finds the invite and goes
            straight to Join, because onboarding, the dashboard and /welcome all
            route a pending invite there, so it no longer strands anyone. */ ""}
        <p style="color:#444;font-size:14px;line-height:1.5;margin:20px 0 0;">
          ${/* Says the same thing the old "Get the SwiftCard app from the App
              Store" line did, minus the store pitch — that phrasing is ad copy
              to a classifier, in the one email that most needs to look like a
              colleague wrote it. */ ""}Prefer your phone? You can also do this in the <strong>SwiftCard</strong> app — create your account there with <strong>${opts.inviteEmail ? escapeHtml(opts.inviteEmail) : "this email address"}</strong> and your invite will be waiting.
          ${/* Hide My Email gives the account a relay address no invite can be
              matched to, so the app-first door finds the invite only when
              Apple shares the real address. */ ""}Signing in with Apple? Choose <strong>Share My Email</strong> so your invite can find you.
        </p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">${why} If you weren't expecting it, you can ignore this email — nothing happens unless you accept.</p>
        <p style="color:#6b7280;font-size:11px;margin:0;line-height:1.6;">
          Sent by SwiftCard${office ? ` on behalf of ${office}` : ""} · New York, NY
        </p>
      </div>
    `);

  return {
    subject,
    // "Dana via SwiftCard": the From names the person the body says invited
    // them, so the header and the body agree. The COMPANY is deliberately NOT in
    // the From (owner report 2026-09-24: invites landing in the invitee's spam).
    // "Dana (Meridian Bank) via SwiftCard <support@swiftcard.me>" is an
    // organisation's name on mail from a domain that isn't theirs, which is the
    // exact shape Outlook's and Gmail's impersonation filters look for, and a
    // bank or brokerage name makes it worse. The company is in the subject and
    // the body, where it reads as content rather than a claimed identity.
    // Sanitized downstream by senderFrom(); never concatenate this yourself.
    // Empty when the inviter has no name, which leaves the From as "SwiftCard".
    fromName: ownerRaw ?? "",
    html,
  };
}

/**
 * The invite's Reply-To: the inviting admin, but only at a COMPANY address.
 *
 * A stranger's "who is this?" should reach the person who invited them, and a
 * company address (dana@meridianbank.com) makes that possible. A personal
 * mailbox (gmail.com, icloud.com, …) as the Reply-To on mail From swiftcard.me
 * is a standard spam rule (SpamAssassin FREEMAIL_FORGED_REPLYTO, about +2 on
 * its own), and on first contact with a stranger it can be the point that
 * tips the invite into spam. For those, null leaves the sender's default
 * (support@swiftcard.me), which is aligned with the From and is monitored.
 */
export function inviteReplyTo(inviterEmail: string | null | undefined): string | null {
  const domain = extractEmailDomain(inviterEmail ?? "");
  if (!domain || isPersonalEmailDomain(domain)) return null;
  return inviterEmail!.trim();
}

// ── The invite's sign-in email ───────────────────────────────────────────────
// Sent when an invitee taps "Email me a sign-in link" on /join. It used to be
// Supabase's stock template — "Your sign-in link / Follow the link below to
// sign in", no SwiftCard, no company, nothing to say why it arrived — landing a
// minute after a branded invite and looking like phishing next to it. Now it
// is ours: the same company header as the invite, and it says what it's for.
//
// `signInUrl` goes to /auth/confirm, which verifies the link on the server, so
// it works on any device — not only in the browser that asked for it.
export function buildJoinSignInEmail(opts: {
  officeName: string | null;
  brandLogoUrl?: string | null;
  signInUrl: string;
  inviteEmail: string;
}): { subject: string; html: string; fromName: string } {
  const officeRaw = opts.officeName?.trim() || null;
  const office = officeRaw ? escapeHtml(officeRaw) : null;
  const safeLogo = emailSafeImageUrl(opts.brandLogoUrl);
  const logo = safeLogo ? escapeHtml(safeLogo) : null;
  const email = escapeHtml(opts.inviteEmail);
  const host = (() => {
    try {
      return new URL(opts.signInUrl).host;
    } catch {
      return "swiftcard.me";
    }
  })();
  const joining = office ? `your <strong>${office}</strong> team` : "your team";
  const subject = officeRaw ? `Your sign-in link to join ${officeRaw} on SwiftCard` : "Your SwiftCard sign-in link";

  const html = emailDocument(subject, `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;">
        ${logo
          ? `<img src="${logo}" width="56" height="56" alt="${office ?? ""}" style="border-radius:10px;display:block;margin:0 0 20px;" />`
          : office ? `<div style="margin:0 0 20px;"><span style="font-size:20px;font-weight:800;color:#111827;">${office}</span></div>` : ""}
        <h2 style="font-size:22px;font-weight:700;color:#111;margin:0 0 10px;">Your sign-in link</h2>
        <p style="color:#444;font-size:15px;line-height:1.5;margin:0 0 24px;">
          Tap the button to sign in as <strong>${email}</strong> and finish joining ${joining} on SwiftCard. No password needed.
        </p>
        <a href="${escapeHtml(opts.signInUrl)}" style="display:inline-block;background:#2563eb;color:#fff;font-weight:600;text-decoration:none;padding:13px 30px;border-radius:100px;font-size:15px;">Sign in and join →</a>
        <p style="color:#6b7280;font-size:12px;margin-top:14px;">This link goes to ${escapeHtml(host)}. It works once, on any device, and expires soon — if it has, open your invite again and send a new one.</p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">You got this because someone asked for a sign-in link on your ${office ? `${office} ` : ""}team invitation. If it wasn't you, ignore this email — nobody can sign in without it.</p>
        <p style="color:#6b7280;font-size:11px;margin:0;line-height:1.6;">Sent by SwiftCard${office ? ` on behalf of ${office}` : ""} · New York, NY</p>
      </div>
    `);

  return {
    subject,
    // Plain "SwiftCard", never "Meridian Bank via SwiftCard". A company-named
    // sender plus a sign-in link, from a domain that isn't the company's, is
    // the credential-phishing template that spam filters are built to catch
    // (owner report 2026-09-24). The company is in the subject and the body.
    fromName: "",
    html,
  };
}
