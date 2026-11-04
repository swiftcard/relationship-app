import { escapeHtml, safeUrlAttr } from "@/lib/escape";
import { toGsm7 } from "@/lib/messaging";
import { DEMO_RULES, DEMO_TIME_ZONE } from "./config";
import { fmtLongDay, fmtRange, fmtTime, fmtWhen, fmtWhenShort, tzAbbr, tzLabel } from "./format";
import { manageUrl } from "./token";
import type { DemoBooking, MessageKind } from "./store";

// ── Every demo email and text ───────────────────────────────────────────────
// The prospect's: confirmation, three reminders, the Meet link when it came
// late, rescheduled, canceled. The owner's (to hello@swiftcard.me): new,
// rescheduled, canceled. Every value a visitor typed is escaped.
//
// The prospect's times are in THEIR time zone, with New York time alongside
// when it differs; the owner's are New York time first.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";
const POSTAL_ADDRESS = process.env.COMPANY_POSTAL_ADDRESS?.trim() || "Swift Card Inc · New York, NY";

export type BuiltEmail = {
  /** Who it goes to: the prospect, or the owner's inbox. */
  audience: "prospect" | "owner";
  subject: string;
  html: string;
  /** Sent because a person just did something (booked, moved, canceled), not
   *  by a schedule: no List-Unsubscribe headers. Reminders are scheduled. */
  personal: boolean;
};

const e = escapeHtml;

function layout(body: string, preheader: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#F4F6FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(preheader)}</div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F4F6FB;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:540px;">
  <tr><td style="padding:0 4px 20px;">
    <img src="${APP_URL}/brand-icon.png" width="28" height="28" alt="" style="vertical-align:middle;border-radius:7px;margin-right:8px;" />
    <span style="font-size:13px;font-weight:800;letter-spacing:0.02em;color:#0f172a;vertical-align:middle;">SwiftCard</span>
  </td></tr>
  <tr><td style="background:#ffffff;border:1px solid #E2E8F0;border-radius:20px;padding:32px 28px;">${body}</td></tr>
  <tr><td style="padding:20px 4px 0;">
    <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">${e(POSTAL_ADDRESS)}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

const h1 = (t: string) => `<h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#0f172a;line-height:1.25;">${t}</h1>`;
const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.65;">${t}</p>`;
const small = (t: string) => `<p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.6;">${t}</p>`;
const btn = (href: string, label: string) =>
  `<a href="${safeUrlAttr(href)}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:999px;font-size:14px;font-weight:700;margin:4px 8px 16px 0;">${label}</a>`;
const btn2 = (href: string, label: string) =>
  `<a href="${safeUrlAttr(href)}" style="display:inline-block;background:#ffffff;color:#1D4ED8;text-decoration:none;padding:12px 24px;border-radius:999px;font-size:14px;font-weight:700;border:1px solid #BFDBFE;margin:4px 8px 16px 0;">${label}</a>`;
const link = (href: string, label: string) => `<a href="${safeUrlAttr(href)}" style="color:#1D4ED8;text-decoration:underline;">${label}</a>`;

function details(rows: [string, string][]): string {
  const tr = rows.map(([k, v]) => `<tr>
      <td style="padding:8px 12px 8px 0;font-size:13px;color:#64748b;vertical-align:top;width:110px;">${k}</td>
      <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:600;vertical-align:top;line-height:1.5;">${v}</td>
    </tr>`).join("");
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;padding:8px 16px;margin:4px 0 20px;">${tr}</table>`;
}

const firstName = (b: DemoBooking) => b.name.trim().split(/\s+/)[0] || b.name;
const start = (b: DemoBooking) => new Date(b.starts_at);
const end = (b: DemoBooking) => new Date(b.ends_at);

/** "Wednesday, November 11<br>3:00–3:30 PM EST" (+ New York time when theirs differs). */
function whenCell(b: DemoBooking, tz: string): string {
  const s = start(b);
  let out = `${e(fmtLongDay(s, tz))}<br>${e(fmtRange(s, end(b), tz))}`;
  if (fmtTime(s, tz) !== fmtTime(s, DEMO_TIME_ZONE) || tzAbbr(s, tz) !== tzAbbr(s, DEMO_TIME_ZONE)) {
    out += `<br><span style="font-weight:400;color:#64748b;">${e(fmtTime(s, DEMO_TIME_ZONE))} New York time</span>`;
  }
  return out;
}

function prospectDetails(b: DemoBooking): string {
  const rows: [string, string][] = [
    ["When", whenCell(b, b.timezone)],
    ["Where", b.meet_url ? link(b.meet_url, "Google Meet") : "Google Meet (link to follow)"],
    ["Length", `${DEMO_RULES.durationMin} minutes`],
  ];
  return details(rows);
}

function changeLinks(b: DemoBooking): string {
  return small(`Need a different time? ${link(manageUrl(b, "reschedule"), "Pick a new time")} or ${link(manageUrl(b, "cancel"), "cancel the demo")}.`);
}

function joinBlock(b: DemoBooking): string {
  return b.meet_url
    ? btn(b.meet_url, "Join with Google Meet")
    : p("Your Google Meet link is on its way in a separate email.");
}

function prospect(kind: MessageKind, b: DemoBooking): BuiltEmail | null {
  const tz = b.timezone;
  const s = start(b);
  const name = e(firstName(b));
  const when = e(fmtWhen(s, tz));
  const short = fmtWhenShort(s, tz);
  const inviteNote = b.calendar_status === "created"
    ? p("A calendar invitation from hello@swiftcard.me is on its way too. Accept it to add the demo to your calendar.")
    : "";
  switch (kind) {
    case "confirmation":
      return {
        audience: "prospect", personal: true,
        subject: `Confirmed: your SwiftCard demo on ${short}`,
        html: layout(
          h1(`You're booked, ${name}!`) +
          p("Your SwiftCard Office demo is set. Here are the details:") +
          prospectDetails(b) + joinBlock(b) + inviteNote +
          p("We'll show you how SwiftCard Office works for your team and answer your questions. There's nothing to prepare.") +
          changeLinks(b),
          `Your SwiftCard demo: ${short}`,
        ),
      };
    case "halfway":
      return {
        audience: "prospect", personal: false,
        subject: `Reminder: your SwiftCard demo on ${short}`,
        html: layout(
          h1("Your demo is coming up") +
          p(`Hi ${name}, a quick reminder: your SwiftCard Office demo is on ${when}.`) +
          prospectDetails(b) +
          p("Still good for you? One tap lets us know.") +
          btn(manageUrl(b, "confirm"), "Yes, I'll be there") + (b.meet_url ? btn2(b.meet_url, "Join with Google Meet") : "") +
          changeLinks(b),
          `Reminder: ${short}`,
        ),
      };
    case "night_before":
      return {
        audience: "prospect", personal: false,
        subject: `Tomorrow: your SwiftCard demo at ${fmtTime(s, tz)} ${tzAbbr(s, tz)}`.trim(),
        html: layout(
          h1("See you tomorrow") +
          p(`Hi ${name}, your SwiftCard Office demo is tomorrow, ${when}.`) +
          prospectDetails(b) +
          btn(manageUrl(b, "confirm"), "Yes, I'll be there") + (b.meet_url ? btn2(b.meet_url, "Join with Google Meet") : "") +
          changeLinks(b),
          `Tomorrow at ${fmtTime(s, tz)}`,
        ),
      };
    case "day_of":
      return {
        audience: "prospect", personal: false,
        subject: `Today at ${fmtTime(s, tz)} ${tzAbbr(s, tz)}: your SwiftCard demo`.replace(/\s+:/, ":"),
        html: layout(
          h1(`Today at ${e(fmtTime(s, tz))}`) +
          p(`Hi ${name}, your SwiftCard Office demo is today. Join from your computer or your phone with the button below.`) +
          prospectDetails(b) + joinBlock(b) +
          changeLinks(b),
          `Your demo is today at ${fmtTime(s, tz)}`,
        ),
      };
    case "meet_link":
      if (!b.meet_url) return null;
      return {
        audience: "prospect", personal: true,
        subject: `Your Google Meet link for ${short}`,
        html: layout(
          h1("Here's your Google Meet link") +
          p(`Hi ${name}, here is the link for your SwiftCard Office demo on ${when}.`) +
          btn(b.meet_url, "Join with Google Meet") + inviteNote + changeLinks(b),
          `Your Meet link for ${short}`,
        ),
      };
    case "rescheduled":
      return {
        audience: "prospect", personal: true,
        subject: `Rescheduled: your SwiftCard demo is now ${short}`,
        html: layout(
          h1("Your demo has a new time") +
          p(`Hi ${name}, your SwiftCard Office demo is now on ${when}.`) +
          prospectDetails(b) + joinBlock(b) +
          (b.calendar_status === "created" ? p("Your calendar invitation is updated to the new time.") : "") +
          changeLinks(b),
          `New time: ${short}`,
        ),
      };
    case "canceled": {
      const why =
        b.canceled_by === "prospect" ? `As you asked, your SwiftCard demo on ${when} is canceled.`
        : b.canceled_by === "declined" ? `You declined the calendar invitation, so your SwiftCard demo on ${when} is canceled.`
        : b.canceled_by === "admin" ? `We're sorry, we had to cancel your SwiftCard demo on ${when}.`
        : `Your SwiftCard demo on ${when} is canceled.`;
      return {
        audience: "prospect", personal: true,
        subject: `Canceled: your SwiftCard demo on ${short}`,
        html: layout(
          h1("Your demo is canceled") + p(`Hi ${name}. ${why}`) +
          p("Want to pick another time? It only takes a minute.") +
          btn(`${APP_URL}/demo`, "Book a new time"),
          `Your demo on ${short} is canceled`,
        ),
      };
    }
    default:
      return null;
  }
}

function ownerDetails(b: DemoBooking): string {
  const s = start(b);
  const theirs = b.timezone !== DEMO_TIME_ZONE ? `<br><span style="font-weight:400;color:#64748b;">${e(fmtTime(s, b.timezone))} their time (${e(tzLabel(b.timezone, s))})</span>` : "";
  const rows: [string, string][] = [
    ["When", `${e(fmtLongDay(s, DEMO_TIME_ZONE))}<br>${e(fmtRange(s, end(b), DEMO_TIME_ZONE))}${theirs}`],
    ["Name", e(b.name)],
    ["Email", link(`mailto:${b.email}`, e(b.email))],
    ["Phone", link(`tel:${b.phone.replace(/[^\d+]/g, "")}`, e(b.phone))],
    ["Company", e(b.company)],
    ["Team size", e(b.team_size)],
  ];
  if (b.role) rows.push(["Role", e(b.role)]);
  if (b.crm) rows.push(["CRM", e(b.crm)]);
  if (b.notes) rows.push(["Notes", e(b.notes).replace(/\n/g, "<br>")]);
  rows.push(["Text reminder", b.sms_opt_in ? "Yes" : "No"]);
  return details(rows);
}

function owner(kind: MessageKind, b: DemoBooking): BuiltEmail | null {
  const s = start(b);
  const nyShort = fmtWhenShort(s, DEMO_TIME_ZONE);
  const who = `${b.name}, ${b.company}`;
  const admin = link(`${APP_URL}/admin/demos`, "Open Demos in admin");
  const calendarNote = b.calendar_status === "created" ? ""
    : p(`<strong style="color:#b45309;">The Google Calendar event isn't made yet</strong> (${e(b.calendar_status === "not_connected" ? "the calendar isn't connected" : b.calendar_error ?? "Google didn't answer")}). The clock retries every 5 minutes; connect or check it on the Demos page.`);
  switch (kind) {
    case "owner_new":
      return {
        audience: "owner", personal: true,
        subject: `New demo: ${who} (${b.team_size}) · ${nyShort}`,
        html: layout(
          h1("New demo booked") + p(`${e(b.name)} from ${e(b.company)} booked an Office demo.`) +
          ownerDetails(b) + (b.meet_url ? btn(b.meet_url, "Join with Google Meet") : "") + calendarNote +
          small(`Reply to this email to write to ${e(firstName(b))} directly. ${admin}.`),
          `${who} · ${nyShort}`,
        ),
      };
    case "owner_rescheduled":
      return {
        audience: "owner", personal: true,
        subject: `Demo moved: ${who} · now ${nyShort}`,
        html: layout(
          h1("A demo has a new time") + p(`${e(b.name)} from ${e(b.company)} moved their demo.`) +
          ownerDetails(b) + (b.meet_url ? btn(b.meet_url, "Join with Google Meet") : "") + calendarNote + small(admin + "."),
          `${who} · now ${nyShort}`,
        ),
      };
    case "owner_canceled": {
      const by =
        b.canceled_by === "prospect" ? `${e(b.name)} canceled it from the link in their email.`
        : b.canceled_by === "declined" ? `${e(b.name)} declined the Google Calendar invitation.`
        : b.canceled_by === "calendar" ? "The event was deleted from the Google Calendar."
        : "It was canceled from the admin Demos page.";
      return {
        audience: "owner", personal: true,
        subject: `Demo canceled: ${who} · was ${nyShort}`,
        html: layout(
          h1("A demo was canceled") + p(by) +
          (b.cancel_reason ? p(`Their reason: "${e(b.cancel_reason)}"`) : "") +
          ownerDetails(b) + small(`The time is open again. ${admin}.`),
          `${who} · was ${nyShort}`,
        ),
      };
    }
    default:
      return null;
  }
}

export function buildDemoEmail(kind: MessageKind, b: DemoBooking): BuiltEmail | null {
  return kind.startsWith("owner_") ? owner(kind, b) : prospect(kind, b);
}

/** The morning-of text. Plain GSM-7, one segment where it fits. */
export function buildDemoText(b: DemoBooking): string {
  const s = start(b);
  const parts = [
    `SwiftCard: your demo is today at ${fmtTime(s, b.timezone)} ${tzAbbr(s, b.timezone)}.`,
    b.meet_url ? `Join: ${b.meet_url}` : "",
    `Change it: ${manageUrl(b)}`,
  ].filter(Boolean);
  return toGsm7(parts.join("\n"));
}
