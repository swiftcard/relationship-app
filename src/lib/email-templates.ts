import { escapeHtml, safeUrlAttr } from "./escape";
import { htmlToText } from "./email-text";
import { PLAY_STORE_URL, appStoreEmailBlock } from "./app-store";
// The downgrade card quotes real limits rather than remembered ones.
import { PLAN_LIMITS, PLAN_PRICES } from "./plan";
import { from as senderFrom_, replyToFor, type SenderKey } from "./email-senders";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
// The From on every template now comes from lib/email-senders — the single
// source of truth — instead of an env var read in a dozen places. Money mail
// goes out as billing@, account/lifecycle mail as support@, campaigns as
// news@. Splitting them means a reply to a receipt and a reply to a campaign
// land in different queues, and a complaint on a campaign is attributable to
// the campaign identity rather than to the address that also sends receipts.
//
// NOTE ON ISOLATION: all four are on swiftcard.me, which mailbox providers
// score as ONE reputation. This split buys per-address filtering, clean reply
// routing, and a seam to move bulk onto its own subdomain later — it does not
// yet stop a campaign complaint from touching transactional mail. Moving
// `news` to news.swiftcard.me is the change that would, and it costs a
// cold-start warm-up, which is why it is deliberately not done here.
const BILLING_FROM: SenderKey = "billing";
const SUPPORT_FROM: SenderKey = "support";
const MARKETING_FROM: SenderKey = "news";

// CAN-SPAM §7704(a)(5) requires a VALID PHYSICAL POSTAL ADDRESS in every
// commercial message — a street address, or a registered PO/private mailbox.
// "New York, NY" is a city, not an address: it satisfies neither the statute
// nor the filters that look for a parseable address block, and its absence is
// a documented spam signal. Set COMPANY_POSTAL_ADDRESS to the real one (a
// virtual-mailbox address is fine and is what most small companies use); the
// fallback below keeps the footer from rendering empty but is NOT compliant.
const POSTAL_ADDRESS =
  process.env.COMPANY_POSTAL_ADDRESS?.trim() || "Swift Card Inc · New York, NY";

// RFC 8058 one-click unsubscribe headers. Gmail & Yahoo REQUIRE these on bulk /
// marketing / automated-lifecycle mail (their Feb-2024 sender rules) — a visible
// footer link alone is NOT enough and is a leading reason legitimate mail lands
// in spam. Attach to EVERY marketing or lifecycle send that carries an
// unsubscribe URL (both List-Unsubscribe and the -Post header must be present for
// one-click to be honored). The URL MUST be a route handler that exports POST —
// see unsubUrl() below for why a page route can never satisfy this in Next 16.
// UNSUBSCRIBE_MAILTO adds a second, mailto: method to the same header. Gmail and
// Yahoo act on the https one-click URI, but a number of clients — Outlook and
// Hotmail most importantly — only ever surface the mailto form, so an
// https-only header reads to them as "no unsubscribe offered" and costs
// reputation on exactly the providers we're weakest with. It is deliberately
// opt-in: advertising a mailbox that does not exist bounces every opt-out
// request, which is worse than offering only the link. Set it ONLY once
// the address actually receives mail.
export function marketingHeaders(unsubscribeUrl: string): Record<string, string> {
  const mailto = process.env.UNSUBSCRIBE_MAILTO?.trim();
  return {
    // RFC 2369 allows several methods, most-preferred last; RFC 8058 one-click
    // always resolves to the https URI, so the mailto never hijacks it.
    "List-Unsubscribe": mailto
      ? `<mailto:${mailto}?subject=unsubscribe>, <${unsubscribeUrl}>`
      : `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// Every builder returns html AND a plain-text alternative. Passing `text` to
// Resend makes the message multipart/alternative — HTML-only mail is a strong
// spam signal, so this materially improves inbox placement. See email-text.ts.
// Every template carries its From AND its Reply-To. Setting Reply-To centrally
// is what guarantees the hard rule: no user-facing email may have a reply path
// that goes nowhere. A receipt that says "just reply to this email" has to mean
// it — billing@ and support@ receive, and campaigns route replies to support@.
function built(key: SenderKey, subject: string, html: string) {
  const replyTo = replyToFor(key);
  return { from: senderFrom_(key), ...(replyTo ? { replyTo } : {}), subject, html, text: htmlToText(html) };
}

// ─── Shared layout wrapper ────────────────────────────────────────────────────
// `prefsUrl` is the preference centre (lib/email-token → /email/preferences).
// It is offered ALONGSIDE the one-click unsubscribe, never instead of it:
// CAN-SPAM and the Gmail/Yahoo rules both require a way OUT, and a page that
// only offers "manage" is the dark pattern they exist to stop. The plain
// Unsubscribe link stays exactly where it was.
function layout(body: string, unsubscribeUrl?: string, prefsUrl?: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2;min-height:100vh;padding:40px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:520px;">

  <!-- Logo: the real brand mark + wordmark. If a client blocks images, the
       wordmark text still renders, so branding never disappears. -->
  <tr><td style="padding-bottom:32px;">
    <img src="${APP_URL}/brand-icon.png" width="28" height="28" alt="" style="vertical-align:middle;border-radius:7px;margin-right:8px;" />
    <span style="font-size:13px;font-weight:800;letter-spacing:0.02em;color:#111827;vertical-align:middle;">SwiftCard</span>
  </td></tr>

  <!-- Body -->
  <tr><td>${body}</td></tr>

  <!-- Footer -->
  <tr><td style="padding-top:40px;border-top:1px solid #E4DDD4;margin-top:40px;">
    <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">
      ${POSTAL_ADDRESS}
    </p>
    ${unsubscribeUrl || prefsUrl
      ? `<p style="margin:6px 0 0;color:#64748b;font-size:12px;line-height:1.6;">${[
          prefsUrl ? `<a href="${prefsUrl}" style="color:#475569;text-decoration:underline;">Manage email preferences</a>` : "",
          unsubscribeUrl ? `<a href="${unsubscribeUrl}" style="color:#475569;text-decoration:underline;">Unsubscribe</a>` : "",
        ].filter(Boolean).join(" &nbsp;·&nbsp; ")}</p>`
      : `<p style="margin:4px 0 0;color:#b6bcc6;font-size:10px;line-height:1.5;">You are receiving this because you have an account with SwiftCard.</p>`}
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ─── Template helpers ─────────────────────────────────────────────────────────
function h1(text: string) {
  return `<h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0f172a;line-height:1.2;">${text}</h1>`;
}
function p(text: string) {
  return `<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.65;">${text}</p>`;
}
function btn(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:#1D4ED8;color:#fff;text-decoration:none;padding:13px 28px;border-radius:99px;font-size:14px;font-weight:700;margin:8px 0 24px;">${label}</a>`;
}
function card(html: string) {
  return `<div style="background:#EDE5D8;border:1px solid #D4C8B8;border-radius:16px;padding:20px 24px;margin:0 0 24px;">${html}</div>`;
}
function step(n: number, title: string, detail: string, last = false) {
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 ${last ? 0 : 14}px;">
    <tr>
      <td valign="top" style="width:24px;padding-right:10px;">
        <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:99px;background:#1D4ED8;color:#ffffff;font-size:12px;font-weight:700;">${n}</span>
      </td>
      <td valign="top">
        <p style="margin:0 0 2px;font-size:13.5px;font-weight:700;color:#0f172a;line-height:1.4;">${title}</p>
        <p style="margin:0;font-size:13px;color:#475569;line-height:1.55;">${detail}</p>
      </td>
    </tr>
  </table>`;
}
function row(label: string, value: string) {
  return `<tr>
    <td style="padding:9px 0;border-bottom:1px solid #E4DDD4;font-size:13px;color:#64748b;width:140px;">${label}</td>
    <td style="padding:9px 0;border-bottom:1px solid #E4DDD4;font-size:13px;color:#0f172a;font-weight:600;">${value}</td>
  </tr>`;
}

// ─── Email builders ───────────────────────────────────────────────────────────

export function welcomeEmail(opts: {
  firstName: string;
  cardUrl: string;
  /** An Office team member: contacts go to the team (and its CRM, if the
   *  admin connected one), so the "connect your CRM" step is left out. */
  officeMember?: boolean;
  /** The account OWNS an office (the Office admin): add the two team steps
   *  a new admin needs — invite, and check the branding. */
  officeOwner?: boolean;
  unsubscribeUrl?: string;
  /** Preference centre link for the footer — marketing/lifecycle mail only. */
  prefsUrl?: string;
}) {
  const safeName = escapeHtml(opts.firstName);
  const safeCardUrl = safeUrlAttr(opts.cardUrl);
  const cardUrlText = escapeHtml(opts.cardUrl);
  // #signature: the Links page shows one side at a time and opens on Swift
  // Links; this step is about the signature, so land on that side.
  const shareUrl = `${APP_URL}/share#signature`;
  // The Swift Links page lives at /links/<the same slug as the card>.
  const slug = opts.cardUrl.replace(/\/+$/, "").split("/").pop() || "";
  const linksUrl = `${APP_URL}/links/${encodeURIComponent(slug)}`;
  const safeLinksUrl = safeUrlAttr(linksUrl);
  const linksText = escapeHtml(linksUrl.replace(/^https?:\/\//, ""));
  const a = (href: string, text: string) => `<a href="${href}" style="color:#1D4ED8;text-decoration:underline;">${text}</a>`;
  const body = `
    ${h1(`Your SwiftCard is live, ${safeName}! 🎉`)}
    ${p("Send it as a link, show it as a QR code, or tap it over from an NFC card. When they share their details back, the new contact lands in your dashboard on its own \u2014 nothing to type in, nothing to lose.")}
    ${card(`
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.12em;color:#94a3b8;text-transform:uppercase;">Your card link</p>
      <a href="${safeCardUrl}" style="color:#1D4ED8;font-size:15px;font-weight:600;text-decoration:none;">${cardUrlText}</a>
    `)}
    ${btn(safeCardUrl, "See my live card →")}
    ${opts.officeOwner ? card(`
      <p style="margin:0 0 14px;font-weight:700;color:#0f172a;font-size:14px;">Set up your team</p>
      ${step(1, "Invite your team", `Open ${a(`${APP_URL}/office/admin`, "Admin")} from your dashboard and tap “+ Add team member”. Each person gets an email and builds their own card in about two minutes — your card is seat 1.`)}
      ${step(2, "Check your team branding", `We started it from your card. Change the logo, company details or design in ${a(`${APP_URL}/office/admin/branding`, "Admin → Branding")} and every teammate's card follows.`, true)}
    `) : ""}
    ${card(`
      <p style="margin:0 0 14px;font-weight:700;color:#0f172a;font-size:14px;">The best ways to use your SwiftCard</p>
      ${step(1, "Put your Swift Links in your bio", `Your link-in-bio page is live at ${a(safeLinksUrl, linksText)}. Paste it into your Instagram, TikTok and LinkedIn bios \u2014 your photo, socials, links and a Connect button, on one page.`)}
      ${step(2, "Add your Swift Signature", `Copy it from your ${a(shareUrl, "Links page")} and paste it into your email signature settings, so every email you send ends with your card.`)}
      ${step(3, "Add your card to Apple Wallet", `On your ${a(`${APP_URL}/dashboard`, "dashboard")}, tap \u201cOther ways to share\u201d \u2192 \u201cAdd to Apple Wallet\u201d. Your card and QR code are then one double-click away on your iPhone, even with no signal.`)}
      ${opts.officeMember ? "" : step(4, "Send new contacts to your CRM", `When someone shares their details back, they can go straight into your CRM. Connect it in ${a(`${APP_URL}/settings/flows`, "Settings \u2192 Notifications and preferences")} under \u201cSend contacts to your CRM\u201d (Pro and Office).`)}
      ${step(opts.officeMember ? 4 : 5, "Share it everywhere else", `Text or email the link, and download your QR code from \u201cOther ways to share\u201d for a slide, a flyer or your lock screen. Nobody has to install anything to open it.`, true)}
    `)}
    ${appStoreEmailBlock(PLAY_STORE_URL ? "The SwiftCard app — your card, QR code and new contacts, right in your pocket, on iPhone or Android." : "SwiftCard for iPhone — your card, QR code and new contacts, right in your pocket.")}
  `;
  return built(SUPPORT_FROM, `Your SwiftCard is live, ${opts.firstName}!`, layout(body, opts.unsubscribeUrl, opts.prefsUrl));
}

// What happens to an Office owner's TEAM when Office ends — the same facts the
// in-app notice states (lib/billing-state officeEndedNotice). It used to say
// "everyone you invited moves to Free too, and the team dashboard closes":
// a teammate paying for their own Pro keeps it, and the team is kept (members
// suspended, the office row intact) so subscribing again brings it back.
const OFFICE_TEAM_ENDS =
  "Your team's seats end — your teammates keep their first card, without your company branding, and your team is saved for when you come back";

const PRO_MONTHLY = `$${(PLAN_PRICES.PRO_MONTHLY_CENTS / 100).toFixed(2)}/mo`;

// What a user keeps on Free vs. loses when their Pro access ends — reused by
// both trial emails so the message is consistent.
// Every line here was wrong, in the one email meant to drive a re-upgrade:
//
//   "Contacts cap back to 25"          — the real limit is FREE_LEADS_PER_MONTH
//                                        NEW leads per month, so they hit the
//                                        wall at 5, not 25.
//   "new captures pause"               — captures continue; the extras are
//                                        saved and tagged locked.
//   "Extra cards become view-only"     — their PUBLIC PAGES 404 (card-active's
//                                        plan-limit check), which kills printed
//                                        QR codes and programmed NFC tags. Not
//                                        the same thing at all, and much worse.
//   "Day 15 / 30 follow-ups"           — no preset produces those days.
//
// Numbers render from PLAN_LIMITS like every other surface, so this can't
// drift from the enforcement again.
function proLossCard(office = false) {
  return card(`
    <p style="margin:0 0 12px;font-weight:700;color:#0f172a;font-size:14px;">What changes on Free</p>
    <p style="margin:0 0 8px;font-size:13px;color:#475569;">✓ <strong>You keep everything you made</strong> — your card, all your contacts, and your links stay put. Nothing is deleted.</p>
    ${office ? `<p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">• ${OFFICE_TEAM_ENDS}</p>` : ""}
    <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">• New contacts cap at ${PLAN_LIMITS.FREE_LEADS_PER_MONTH} a month — anything past that is still captured, just locked until you upgrade</p>
    <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">• Only your first card stays live; any others stop loading for visitors, including their QR codes and NFC tags</p>
    <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;">• Follow-up sequences pause where they are and resume if you upgrade</p>
    <p style="margin:0;font-size:13px;color:#94a3b8;">• Custom designer, integrations and CRM sync lock</p>
  `);
}

// A Stripe Pro trial is ending and the card on file will be charged. The
// trial-start email promises "cancel before then and you won't be charged";
// this is the reminder that makes that promise fair (2026-09-16 audit).
// Billing mail, not marketing: it is sent regardless of product-update prefs.
export function trialChargeSoonEmail(opts: {
  firstName: string;
  planName?: string;
  chargeDate: string;
  /** The recurring charge. Visa requires the AMOUNT in this notice, not just
   *  the date — an email that says "you'll be charged" without saying how much
   *  is the one a disputing cardholder wins on. Optional only because a legacy
   *  trial row may predate the webhook storing it; the copy adapts. */
  amountCents?: number | null;
  /** "monthly" / "annually" — reads straight into the sentence. */
  intervalWord?: string;
  manageUrl: string;
  /** Their own Pro trial, while they are on someone else's team: the seat
   *  already covers Pro, so "what changes on Free" is not what happens to them. */
  teamMember?: boolean;
}) {
  const safeName = escapeHtml(opts.firstName);
  const date = escapeHtml(opts.chargeDate);
  const planName = escapeHtml(opts.planName || "Pro");
  const price =
    typeof opts.amountCents === "number" && opts.amountCents > 0
      ? `$${(opts.amountCents / 100).toFixed(2)}${opts.intervalWord ? ` ${escapeHtml(opts.intervalWord)}` : ""}`
      : null;
  const tableRows = [
    row("Plan", `SwiftCard ${planName}`),
    row("First charge", date),
    ...(price ? [row("Amount", price)] : []),
  ].join("");

  const body = `
    ${h1(`Your ${planName} trial ends ${date}`)}
    ${p(`Hi ${safeName}, a heads-up while there's still time to decide: your free trial ends on ${date}, and your subscription starts then on the card you added${price ? ` — ${price}` : ""}.`)}
    <div style="background:#fff;border:1px solid #E4DDD4;border-radius:16px;overflow:hidden;margin-bottom:24px;">
      <div style="padding:0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">${tableRows}</table>
      </div>
    </div>
    ${opts.teamMember
      ? p(`You're on a team now, and your team seat already includes everything in Pro — so while you're on the team you don't need this subscription. Cancel before ${date} and you won't be charged; keep it only if you want Pro for yourself if you ever leave the team.`)
      : `${proLossCard(opts.planName === "Office")}
    ${p(`Keeping ${planName}? You don't need to do anything. ${opts.planName === "Office" ? "Don't want to continue?" : "Want to stay on Free instead?"} Cancel before ${date} and you won't be charged.`)}`}
    ${btn(opts.manageUrl, "Manage my plan →")}
  `;
  return built(BILLING_FROM, `Your SwiftCard ${opts.planName || "Pro"} trial ends ${opts.chargeDate}`, layout(body));
}

// Heads-up a few days before a trial / free-month grant ends.
export function trialEndingSoonEmail(opts: {
  firstName: string;
  daysLeft: number;
  isTrial: boolean;
  /** A granted OFFICE (a tester code) is ending, not Pro: it said "free Pro
   *  trial … upgrade to Pro" to an Office owner, with nothing about the team. */
  office?: boolean;
  unsubscribeUrl?: string;
  /** Preference centre link for the footer — marketing/lifecycle mail only. */
  prefsUrl?: string;
}) {
  const day = opts.daysLeft === 1 ? "1 day" : `${opts.daysLeft} days`;
  const safeName = escapeHtml(opts.firstName);
  if (opts.office) {
    const officeBody = `
    ${h1(`${day} left of your free Office access`)}
    ${p(`Hey ${safeName} — your free Office access ends in ${day}. After that your account moves to the Free plan.`)}
    ${proLossCard(true)}
    ${btn(`${APP_URL}/pricing`, "Keep Office →")}
    ${p(`Subscribing to Office keeps your team, its branding and its seats exactly as they are.`)}
  `;
    return built(SUPPORT_FROM, `${day} left of your free Office access`, layout(officeBody, opts.unsubscribeUrl, opts.prefsUrl));
  }
  const what = opts.isTrial ? "free Pro trial" : "free month of Pro";
  const body = `
    ${h1(`${day} left of your ${what}`)}
    ${p(`Hey ${safeName} — your ${what} ends in ${day}. After that your account moves to the Free plan. Keep everything unlocked by upgrading to Pro (just ${PRO_MONTHLY}).`)}
    ${proLossCard()}
    ${btn(`${APP_URL}/pricing`, "Keep Pro — upgrade →")}
    ${p(`No pressure — you can upgrade anytime, even after you're back on Free. Everything you've built will be waiting for you.`)}
  `;
  return built(SUPPORT_FROM, `${day} left of your ${what}`, layout(body, opts.unsubscribeUrl, opts.prefsUrl));
}

// Sent on the day the trial / free-month grant downgrades to Free.
export function trialEndedEmail(opts: {
  firstName: string;
  isTrial: boolean;
  /** A granted OFFICE ended (see trialEndingSoonEmail). */
  office?: boolean;
  unsubscribeUrl?: string;
  /** Preference centre link for the footer — marketing/lifecycle mail only. */
  prefsUrl?: string;
}) {
  if (opts.office) {
    const officeBody = `
    ${h1("Your free Office access has ended")}
    ${p(`Hey ${escapeHtml(opts.firstName)} — your account is on the Free plan now. Your card, contacts and links are exactly where you left them.`)}
    ${proLossCard(true)}
    ${btn(`${APP_URL}/pricing`, "See Office plans →")}
    ${p(`Subscribe to Office and your team comes back with its branding — no one has to be invited again, up to the seats you choose.`)}
  `;
    return built(SUPPORT_FROM, "Your free Office access has ended", layout(officeBody, opts.unsubscribeUrl, opts.prefsUrl));
  }
  const what = opts.isTrial ? "Your 14-day Pro trial has ended" : "Your free month of Pro has ended";
  const safeName = escapeHtml(opts.firstName);
  const body = `
    ${h1(what)}
    ${p(`Hey ${safeName} — you're now on the Free plan. Thanks for trying Pro! Your card, contacts, and links are all exactly where you left them.`)}
    ${proLossCard()}
    ${btn(`${APP_URL}/pricing`, "Upgrade back to Pro →")}
    ${p(`Change your mind? Upgrading takes about 30 seconds and instantly re-unlocks everything — including any paused follow-up sequences.`)}
  `;
  return built(SUPPORT_FROM, what, layout(body, opts.unsubscribeUrl, opts.prefsUrl));
}

// (The old "never shared your card" nudge email was removed for good — no
// automated engagement emails go to account owners. See commit 1e656c9.)

export function promoEmail(opts: {
  firstName: string;
  code: string;
  discountText: string;
  headline: string;
  body: string;
  unsubscribeUrl?: string;
  /** Preference centre link for the footer — marketing/lifecycle mail only. */
  prefsUrl?: string;
}) {
  const safeCode = escapeHtml(opts.code);
  const body = `
    <div style="background:#1D4ED8;border-radius:12px;padding:4px 14px;display:inline-block;margin-bottom:20px;">
      <span style="color:#bfdbfe;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Exclusive offer</span>
    </div>
    ${h1(escapeHtml(opts.headline))}
    ${p(escapeHtml(opts.body))}
    ${card(`
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.12em;color:#94a3b8;text-transform:uppercase;">Your promo code</p>
      <p style="margin:0 0 4px;font-size:28px;font-weight:900;color:#1D4ED8;letter-spacing:0.06em;">${safeCode}</p>
      <p style="margin:0;font-size:13px;color:#64748b;">${escapeHtml(opts.discountText)}</p>
    `)}
    ${btn(safeUrlAttr(`${APP_URL}/pricing?code=${encodeURIComponent(opts.code)}`), `Apply code & upgrade →`)}
    ${p(`Apply it at checkout on the pricing page. If you have any questions, just reply to this email.`)}
  `;
  return built(MARKETING_FROM, opts.headline, layout(body, opts.unsubscribeUrl, opts.prefsUrl));
}

export function receiptEmail(opts: {
  firstName: string;
  email: string;
  planName: string;
  amount: string;
  interval: string;
  paymentDate: string;
  invoiceNumber: string;
  invoiceUrl?: string;
  manageUrl: string;
  /** Office: the seats this charge covers. */
  seats?: number;
  /** invoiceNumber is Stripe's real invoice number: show it in the subject. */
  numberInSubject?: boolean;
}) {
  const safeName = escapeHtml(opts.firstName);
  const safePlanName = escapeHtml(opts.planName);
  const tableRows = [
    row("Plan", safePlanName),
    ...(opts.seats ? [row("Seats", `${opts.seats} (incl. you)`)] : []),
    row("Amount", escapeHtml(opts.amount)),
    row("Billing", escapeHtml(opts.interval)),
    row("Date", escapeHtml(opts.paymentDate)),
    row("Receipt #", escapeHtml(opts.invoiceNumber)),
  ].join("");

  // "View invoice", not "Download invoice PDF": invoiceUrl is Stripe's hosted
  // invoice PAGE (which offers the PDF), so the old label promised a download
  // and opened a web page.
  const body = `
    <div style="margin-bottom:24px;">
      <div style="width:48px;height:48px;background:#EEF2FF;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
        <span style="font-size:22px;">✅</span>
      </div>
      ${h1(`Payment confirmed`)}
      ${p(`Thank you${safeName ? `, ${safeName}` : ""}. Your payment was processed successfully. Here's your receipt.`)}
    </div>
    <div style="background:#fff;border:1px solid #E4DDD4;border-radius:16px;overflow:hidden;margin-bottom:24px;">
      <div style="background:#0f172a;padding:16px 24px;">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.15em;color:#64748b;text-transform:uppercase;">Receipt</p>
        <p style="margin:4px 0 0;font-size:18px;font-weight:800;color:#fff;">SwiftCard ${safePlanName}</p>
      </div>
      <div style="padding:0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">${tableRows}</table>
      </div>
    </div>
    ${opts.invoiceUrl ? btn(safeUrlAttr(opts.invoiceUrl), "View invoice →") : ""}
    ${card(`
      <p style="margin:0 0 8px;font-weight:700;color:#0f172a;font-size:13px;">Manage your subscription</p>
      <p style="margin:0 0 12px;font-size:13px;color:#64748b;">Cancel, change plan, or update payment info at any time.</p>
      <a href="${safeUrlAttr(opts.manageUrl)}" style="color:#1D4ED8;font-size:13px;font-weight:600;text-decoration:none;">Manage billing →</a>
    `)}
    ${p(`If you have any questions about this charge, just reply to this email.`)}
  `;
  // Stripe's own invoice number in the subject when there is one: it is what
  // the customer sees in the billing portal and on the PDF, and it makes each
  // receipt unique (the webhook de-duplicates on it).
  return built(
    BILLING_FROM,
    opts.numberInSubject ? `Your SwiftCard receipt #${opts.invoiceNumber} — ${opts.amount}` : `Your SwiftCard receipt — ${opts.amount}`,
    layout(body),
  );
}

// A checkout that starts with a free trial or a promo's free days charges $0.00
// now. That used to go out on the receipt template, which meant a subject line
// reading "Your SwiftCard receipt — $0.00" over body copy asserting a payment
// was "processed successfully" — and, at the one moment the disclosure matters
// most, no mention of when the real billing starts.
//
// So: confirm what actually happened, and lead with the date of the first
// charge. `firstChargeDate` is required rather than optional on purpose — an
// email about when billing begins that omits the date has no reason to exist.
export function trialStartedEmail(opts: {
  firstName: string;
  planName: string;
  amount: string;
  interval: string;
  firstChargeDate: string;
  manageUrl: string;
  /** Office: the seats the recurring amount covers. */
  seats?: number;
}) {
  const safeName = escapeHtml(opts.firstName);
  const safePlanName = escapeHtml(opts.planName);
  const tableRows = [
    row("Plan", safePlanName),
    ...(opts.seats ? [row("Seats", `${opts.seats} (incl. you)`)] : []),
    row("Due today", "$0.00"),
    row("First charge", escapeHtml(opts.firstChargeDate)),
    row("Then", `${escapeHtml(opts.amount)} ${escapeHtml(opts.interval.toLowerCase())}`),
  ].join("");

  const body = `
    <div style="margin-bottom:24px;">
      <div style="width:48px;height:48px;background:#EEF2FF;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
        <span style="font-size:22px;">🎉</span>
      </div>
      ${h1(`You're on SwiftCard ${safePlanName}`)}
      ${p(`You're all set${safeName ? `, ${safeName}` : ""}. You haven't been charged — your free period has started.`)}
    </div>
    <div style="background:#fff;border:1px solid #E4DDD4;border-radius:16px;overflow:hidden;margin-bottom:24px;">
      <div style="background:#0f172a;padding:16px 24px;">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.15em;color:#64748b;text-transform:uppercase;">Summary</p>
        <p style="margin:4px 0 0;font-size:18px;font-weight:800;color:#fff;">SwiftCard ${safePlanName}</p>
      </div>
      <div style="padding:0 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">${tableRows}</table>
      </div>
    </div>
    ${card(`
      <p style="margin:0 0 8px;font-weight:700;color:#0f172a;font-size:13px;">Cancel any time before ${escapeHtml(opts.firstChargeDate)}</p>
      <p style="margin:0 0 12px;font-size:13px;color:#64748b;">Cancel before then and you won't be charged at all.</p>
      <a href="${safeUrlAttr(opts.manageUrl)}" style="color:#1D4ED8;font-size:13px;font-weight:600;text-decoration:none;">Manage billing →</a>
    `)}
    ${p(`Questions? Just reply to this email.`)}
  `;
  return built(BILLING_FROM, `Your SwiftCard ${opts.planName} starts now — first charge ${opts.firstChargeDate}`, layout(body));
}

// Sent when a renewal charge fails (card expired, declined, insufficient funds).
// Stripe's own Smart Retries will try again automatically; this just prompts
// the customer to fix their payment method before access is eventually lost.
export function paymentFailedEmail(opts: {
  firstName: string;
  planName: string;
  amount: string;
  manageUrl: string;
  /** What happens next. "grace" (a failed renewal) starts the 7-day window;
   *  "retry" (any other invoice) starts no clock; "trial_ended" means the
   *  first charge after a free period failed and the plan has already ended. */
  situation?: "grace" | "retry" | "trial_ended";
  /** Their OWN Pro, while they are on someone else's team: losing it never
   *  moves them to Free — the team seat keeps everything. */
  teamMember?: boolean;
}) {
  const safeName = escapeHtml(opts.firstName);
  const safePlanName = escapeHtml(opts.planName);
  const situation = opts.situation ?? "grace";
  const memberNext = situation === "trial_ended"
    ? `<p style="margin:0 0 8px;font-weight:700;color:#0f172a;font-size:13px;">Your own Pro has ended — nothing changes for you</p>
      <p style="margin:0;font-size:13px;color:#64748b;">Because the first charge didn't go through, your own ${safePlanName} subscription has ended. Nothing was charged, and you're still on your team, which keeps everything working exactly as it does now.</p>`
    : `<p style="margin:0 0 8px;font-weight:700;color:#0f172a;font-size:13px;">This is your own subscription, not your team's</p>
      <p style="margin:0 0 12px;font-size:13px;color:#64748b;">Your team seat already includes everything in Pro, so you can update your card, or simply cancel this subscription while you're on the team. Either way nothing changes on your card.</p>
      <a href="${safeUrlAttr(opts.manageUrl)}" style="color:#1D4ED8;font-size:13px;font-weight:600;text-decoration:none;">Manage my subscription →</a>`;
  const next = opts.teamMember ? memberNext :
    situation === "trial_ended"
      ? `<p style="margin:0 0 8px;font-weight:700;color:#0f172a;font-size:13px;">Your free period has ended</p>
      <p style="margin:0 0 12px;font-size:13px;color:#64748b;">Because the first charge didn't go through, your ${safePlanName} plan has ended and your account is back on Free${opts.planName === "Office" ? `. ${OFFICE_TEAM_ENDS}` : ""}. Nothing was charged. You can pick a plan again any time.</p>
      <a href="${safeUrlAttr(opts.manageUrl)}" style="color:#1D4ED8;font-size:13px;font-weight:600;text-decoration:none;">Choose a plan →</a>`
      : situation === "retry"
        ? `<p style="margin:0 0 8px;font-weight:700;color:#0f172a;font-size:13px;">Please update your payment method</p>
      <p style="margin:0 0 12px;font-size:13px;color:#64748b;">Your plan is still active. Update your card so this charge can go through.</p>
      <a href="${safeUrlAttr(opts.manageUrl)}" style="color:#1D4ED8;font-size:13px;font-weight:600;text-decoration:none;">Update billing →</a>`
        : `<p style="margin:0 0 8px;font-weight:700;color:#0f172a;font-size:13px;">You have 7 days to update your payment method</p>
      <p style="margin:0 0 12px;font-size:13px;color:#64748b;">Your plan stays fully active during that window while we retry the charge. If it's still unresolved after 7 days, your account will automatically move to the Free plan.</p>
      <a href="${safeUrlAttr(opts.manageUrl)}" style="color:#1D4ED8;font-size:13px;font-weight:600;text-decoration:none;">Update billing →</a>`;
  const body = `
    <div style="margin-bottom:24px;">
      <div style="width:48px;height:48px;background:#FEF2F2;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
        <span style="font-size:22px;">⚠️</span>
      </div>
      ${h1(`Your payment didn't go through`)}
      ${p(`${safeName ? `Hey ${safeName} — w` : "W"}e tried to charge ${escapeHtml(opts.amount)} for your SwiftCard ${safePlanName} plan, but the payment failed. This can happen with an expired card, insufficient funds, or a bank decline.`)}
    </div>
    ${card(next)}
    ${p(`If you have any questions, just reply to this email.`)}
  `;
  const subject = opts.teamMember
    ? (situation === "trial_ended"
      ? `Your own SwiftCard ${opts.planName} subscription has ended — your team access is unchanged`
      : `Your own SwiftCard ${opts.planName} payment failed — your team access is unchanged`)
    : situation === "trial_ended"
      ? `Your SwiftCard ${opts.planName} plan has ended — payment didn't go through`
      : `Action needed: your SwiftCard payment failed`;
  return built(BILLING_FROM, subject, layout(body));
}

export function marketingEmail(opts: {
  firstName: string;
  subject: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  unsubscribeUrl?: string;
  /** Preference centre link for the footer — marketing/lifecycle mail only. */
  prefsUrl?: string;
}) {
  const emailBody = `
    ${h1(escapeHtml(opts.headline))}
    ${p(escapeHtml(opts.body))}
    ${btn(safeUrlAttr(opts.ctaUrl), escapeHtml(opts.ctaLabel))}
  `;
  return built(MARKETING_FROM, opts.subject, layout(emailBody, opts.unsubscribeUrl, opts.prefsUrl));
}

// ─── Unsubscribe URL helper ───────────────────────────────────────────────────
// MUST point at a ROUTE HANDLER, never a page. This previously returned
// `/unsubscribe`, which is a page (src/app/unsubscribe/page.tsx) with no
// route.ts — and in Next 16 a urlencoded POST to a page is classified as a
// possible Server Action, so it skips the 405 branch and is answered 200 by the
// static prerender WITHOUT running any code. Mailbox providers that send RFC
// 8058 one-click POSTs therefore recorded every opt-out as honored while the
// mail kept coming, and the recipient's next move is the spam button. A page
// route can never satisfy one-click; /api/unsubscribe exports GET and POST.
//
// Returns undefined for a blank token so we never advertise a one-click URL that
// cannot identify a subscriber.
export function unsubUrl(token: string): string | undefined {
  const t = (token || "").trim();
  if (!t) return undefined;
  return `${APP_URL}/api/unsubscribe?token=${encodeURIComponent(t)}`;
}
