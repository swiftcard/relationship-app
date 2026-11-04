import { createHash, randomUUID } from "node:crypto";
import { stripEmDashes } from "../voice";

// ── An approved draft → the email that goes out ────────────────────────────
// Pure: no network, no database. Drafts are written as
//   Subject: <subject>
//
//   <body, signed Menash>
// (the Office and Web Leads prompts, and emailComposeLink, all use that
// shape). What is added here is only what an outreach email must carry: a
// one-line way to say no and the postal address (US CAN-SPAM), plus the
// headers that make the "no" one click in Gmail and Outlook. Nothing is
// rewritten in the owner's words.

export const EMAIL_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[a-z]{2,24}$/i;

export type Draft = { subject: string; text: string };

/** "Subject: …" on the first line, then the body. Null when there is no subject. */
export function parseDraft(body: string): Draft | null {
  const m = /^\s*subject:[ \t]*(.+)\r?\n+/i.exec(body);
  if (!m) return null;
  const subject = oneLine(m[1]);
  const text = body.slice(m[0].length).replace(/\r\n/g, "\n").trim();
  return subject && text ? { subject, text } : null;
}

/** Header-safe: no CR/LF (header injection), no runs of space. */
export function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Why a draft can't be sent as it is, or [] when it can. */
export function draftProblems(body: string, to: string): string[] {
  const out: string[] = [];
  if (!EMAIL_RE.test(to.trim())) out.push("the address doesn't look like an email address");
  const d = parseDraft(body);
  if (!d) {
    out.push('the first line must be "Subject: ..." with the email under it');
    return out;
  }
  if (d.subject.length > 120) out.push("the subject is longer than 120 characters");
  const words = d.text.split(/\s+/).filter(Boolean).length;
  if (words < 15) out.push("the email is shorter than 15 words");
  if (words > 250) out.push("the email is longer than 250 words");
  if (/\[[^\]]*(name|company|first|insert)[^\]]*\]|\{\{|\}\}/i.test(body)) out.push("it still has a placeholder in it");
  return out;
}

/** The two lines under every outreach email. */
export function footer(postalAddress: string | null): string {
  const lines = ['If this isn\'t useful, reply "no thanks" and I won\'t email again.'];
  if (postalAddress) lines.push(`SwiftCard, ${oneLine(postalAddress)}`);
  return lines.join("\n");
}

/** The exact text that is sent: the owner's words, then the footer. No em dashes anywhere. */
export function finalText(d: Draft, postalAddress: string | null): string {
  return stripEmDashes(`${d.text}\n\n--\n${footer(postalAddress)}`);
}

/** A Message-ID we choose, so a send with no answer can be found in Sent later. */
export function newMessageId(domain: string): string {
  return `<sc-${randomUUID()}@${domain.replace(/[^a-z0-9.-]/gi, "") || "swiftcard.me"}>`;
}

export function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

/** RFC 2047 for a header with anything but plain ASCII. */
function encodeHeader(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function displayName(name: string): string {
  const n = oneLine(name).replace(/["\\]/g, "");
  if (!n) return "";
  const enc = encodeHeader(n);
  return enc === n ? `"${n}" ` : `${enc} `;
}

export type Mime = { from: string; fromName: string; to: string; subject: string; text: string; messageId: string; unsubscribe: string };

/** The RFC 822 message, base64url, ready for Gmail's users.messages.send `raw`. */
export function buildRaw(m: Mime): string {
  const to = oneLine(m.to);
  const from = oneLine(m.from);
  if (!EMAIL_RE.test(to) || !EMAIL_RE.test(from)) throw new Error("bad address");
  const body = Buffer.from(m.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  const headers = [
    `From: ${displayName(m.fromName)}<${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(oneLine(m.subject))}`,
    `Message-ID: ${oneLine(m.messageId)}`,
    `List-Unsubscribe: <${oneLine(m.unsubscribe)}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
}

/** mailto: that opens a "unsubscribe" email to the mailbox (List-Unsubscribe). */
export function unsubscribeMailto(mailbox: string): string {
  return `mailto:${mailbox}?subject=${encodeURIComponent("unsubscribe")}`;
}
