import Link from "next/link";
import { PageHeader, Section, Stack } from "../_ui/layout";
import { Tabs } from "../_ui/links";
import { EmptyState } from "../_ui/states";
import { StatusBadge } from "../_ui/badges";
import { Icon } from "../_ui/icons";
import { fmtDateTime } from "../_ui/format";
import { DEMO_RULES, DEMO_TIME_ZONE } from "@/lib/demo/config";
import { fmtLongDay, fmtRange, fmtTime, tzAbbr, tzLabel } from "@/lib/demo/format";
import CopyLinkButton from "./CopyLinkButton";

// ── Demos: what's booked, and the calendar it runs on ───────────────────────
// Every action is a plain <form method="post"> to /api/admin/demos/<id>, so it
// works before hydration. Cancel is two steps (a <details> that opens the
// form), so one stray tap can't cancel someone's demo.

export type DemoRow = {
  id: string;
  status: "confirmed" | "canceled" | "completed" | "no_show";
  starts_at: string;
  ends_at: string;
  created_at: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  team_size: string;
  role: string | null;
  crm: string | null;
  notes: string | null;
  timezone: string;
  sms_opt_in: boolean;
  meet_url: string | null;
  calendar_status: "pending" | "created" | "failed" | "not_connected";
  calendar_error: string | null;
  attendee_response: string | null;
  reconfirmed_at: string | null;
  canceled_by: string | null;
  cancel_reason: string | null;
  manage_link: string | null;
};

type Connection = { state: "ok" | "not_connected" | "revoked" | "unavailable"; account: string | null; connectedAt: string | null; detail?: string };

const CONNECT_HREF = "/api/admin/connect/google_calendar";
const meetHref = (u: string | null) => (u && /^https:\/\/meet\.google\.com\//.test(u) ? u : null);

const DONE: Record<string, string> = {
  canceled: "Canceled. They've been emailed, and the Google Calendar event is gone.",
  no_show: "Marked as a no-show.",
  resent: "Confirmation sent again.",
  failed: "That didn't work. Try again in a minute.",
};

function CalendarCard({ c, message }: { c: Connection; message: { ok: boolean; text: string } | null }) {
  const hours = `Monday to Friday, ${DEMO_RULES.startHour}:00 AM to ${DEMO_RULES.endHour - 12}:00 PM New York time, ${DEMO_RULES.durationMin} minutes each`;
  return (
    <Section title="Google Calendar" hint="Every demo becomes an event with a Google Meet link, and Google sends the invitation.">
      {message && (
        <p className={`${message.ok ? "adm-callout-good" : "adm-callout-danger"} sc-t-footnote rounded-xl px-3 py-2 mb-3`}>
          {message.ok ? `Connected: ${message.text.replace(/^google_calendar:/, "")}` : message.text.replace(/^google_calendar:\s*/, "")}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {c.state === "ok" && <p className="sc-t-subhead font-semibold flex items-center gap-1.5"><span className="adm-good"><Icon name="check" className="w-5 h-5" /></span>Connected as {c.account ?? "the calendar"}</p>}
          {c.state === "not_connected" && <p className="sc-t-subhead font-semibold adm-warn">Not connected yet</p>}
          {c.state === "revoked" && <p className="sc-t-subhead font-semibold adm-bad">Needs reconnecting: Google stopped accepting the connection</p>}
          {c.state === "unavailable" && <p className="sc-t-subhead font-semibold adm-warn">Connected as {c.account ?? "the calendar"}, but Google didn&apos;t answer just now</p>}
          <p className="sc-t-footnote adm-muted mt-1">Bookable: {hours}. To block any time, add a busy event to the calendar.</p>
          {c.state !== "ok" && <p className="sc-t-footnote adm-muted mt-1">Until it works, demos still book and every email still goes, but without a Meet link or calendar event.</p>}
        </div>
        <a href={CONNECT_HREF} className={`sc-btn sc-btn-sm ${c.state === "ok" ? "sc-btn-gray" : "sc-btn-filled"} shrink-0`}>
          <Icon name="calendar" className="w-4 h-4" />{c.state === "ok" ? "Reconnect" : "Connect Google Calendar"}
        </a>
      </div>
    </Section>
  );
}

function when(r: DemoRow) {
  const s = new Date(r.starts_at);
  const e = new Date(r.ends_at);
  const theirs = r.timezone !== DEMO_TIME_ZONE && fmtTime(s, r.timezone) !== fmtTime(s, DEMO_TIME_ZONE)
    ? `${fmtTime(s, r.timezone)} ${tzAbbr(s, r.timezone)} their time (${tzLabel(r.timezone, s)})`
    : null;
  return { day: fmtLongDay(s, DEMO_TIME_ZONE), range: fmtRange(s, e, DEMO_TIME_ZONE), theirs };
}

function statusBadge(r: DemoRow) {
  if (r.status === "canceled") return <StatusBadge tone="bad">Canceled{r.canceled_by === "prospect" ? " by them" : r.canceled_by === "declined" ? " (declined invite)" : r.canceled_by === "calendar" ? " in Calendar" : ""}</StatusBadge>;
  if (r.status === "no_show") return <StatusBadge tone="warn">No-show</StatusBadge>;
  if (r.status === "completed") return <StatusBadge tone="neutral">Done</StatusBadge>;
  if (r.reconfirmed_at) return <StatusBadge tone="good">Reconfirmed</StatusBadge>;
  if (r.attendee_response === "accepted") return <StatusBadge tone="good">Accepted invite</StatusBadge>;
  return <StatusBadge tone="tint">Booked</StatusBadge>;
}

function Detail({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1">
      <dt className="sc-t-footnote adm-faint w-24 shrink-0">{k}</dt>
      <dd className="sc-t-footnote min-w-0 break-words">{children}</dd>
    </div>
  );
}

function DemoItem({ r, tab, now }: { r: DemoRow; tab: "upcoming" | "past"; now: number }) {
  const w = when(r);
  const meet = meetHref(r.meet_url);
  const back = tab === "past" ? "/admin/demos?tab=past" : "/admin/demos";
  const upcoming = r.status === "confirmed" && new Date(r.starts_at).getTime() > now;
  return (
    <li className="px-4 sm:px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="sc-t-headline">{w.day}</p>
            <span className="sc-t-subhead adm-muted">{w.range}</span>
            {statusBadge(r)}
          </div>
          {w.theirs && <p className="sc-t-caption adm-faint mt-0.5">{w.theirs}</p>}
          <p className="sc-t-subhead font-semibold mt-2">{r.name} <span className="adm-muted font-normal">· {r.company} · team of {r.team_size}</span></p>
          <dl className="mt-1.5">
            <Detail k="Email"><a className="adm-link" href={`mailto:${r.email}`}>{r.email}</a></Detail>
            <Detail k="Phone"><a className="adm-link" href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a>{r.sms_opt_in ? <span className="adm-faint"> · text reminder on</span> : null}</Detail>
            {r.role && <Detail k="Role">{r.role}</Detail>}
            {r.crm && <Detail k="CRM">{r.crm}</Detail>}
            {r.notes && <Detail k="Notes"><span className="whitespace-pre-line">{r.notes}</span></Detail>}
            {r.cancel_reason && <Detail k="Why canceled">{r.cancel_reason}</Detail>}
            <Detail k="Booked">{fmtDateTime(r.created_at)}</Detail>
            {r.calendar_status !== "created" && r.status === "confirmed" && (
              <Detail k="Calendar"><span className="adm-warn">No event yet{r.calendar_error ? ` (${r.calendar_error})` : ""}. Retrying every 5 minutes.</span></Detail>
            )}
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:max-w-[22rem]">
          {meet && upcoming && <a href={meet} target="_blank" rel="noopener noreferrer" className="sc-btn sc-btn-sm sc-btn-filled"><Icon name="video" className="w-4 h-4" />Join Meet</a>}
          {upcoming && r.manage_link && <CopyLinkButton link={r.manage_link} />}
          {upcoming && (
            <form method="post" action={`/api/admin/demos/${r.id}`}>
              <input type="hidden" name="action" value="resend" />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="sc-btn sc-btn-sm sc-btn-plain">Resend confirmation</button>
            </form>
          )}
          {upcoming && (
            <details className="w-full lg:w-auto">
              <summary className="sc-btn sc-btn-sm sc-btn-plain adm-bad list-none cursor-pointer">Cancel demo</summary>
              <form method="post" action={`/api/admin/demos/${r.id}`} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input type="hidden" name="action" value="cancel" />
                <input type="hidden" name="back" value={back} />
                <input name="reason" maxLength={500} placeholder="Reason (optional, only you see it)" aria-label="Reason for canceling" className="sc-field sc-field-fit px-3 py-2 text-sm min-w-0 flex-1" />
                <button type="submit" className="sc-btn sc-btn-sm sc-btn-destructive">Yes, cancel and email them</button>
              </form>
            </details>
          )}
          {!upcoming && (r.status === "completed" || r.status === "confirmed") && (
            <form method="post" action={`/api/admin/demos/${r.id}`}>
              <input type="hidden" name="action" value="no_show" />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="sc-btn sc-btn-sm sc-btn-plain">Mark no-show</button>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}

export default function DemosView({ tab, rows, loadFailed, upcomingCount, connection, connectMessage, actionMessage, now }: {
  tab: "upcoming" | "past";
  /** The time the page was made (server), so the view stays pure. */
  now: number;
  rows: DemoRow[];
  loadFailed: boolean;
  upcomingCount: number;
  connection: Connection;
  connectMessage: { ok: boolean; text: string } | null;
  actionMessage: string | null;
}) {
  const done = actionMessage ? DONE[actionMessage] : null;
  return (
    <Stack>
      <PageHeader
        title="Demos"
        description="Office demos people book from the Book a demo button on the pricing page. Each one emails the inbox, rings the bell, and lands on the Google Calendar with a Meet link."
      />
      <CalendarCard c={connection} message={connectMessage} />
      {done && <p className={`${actionMessage === "failed" ? "adm-callout-danger" : "adm-callout-good"} sc-t-footnote rounded-xl px-3 py-2`}>{done}</p>}
      <Tabs
        base="/admin/demos"
        items={[{ key: "upcoming", label: "Upcoming", count: upcomingCount || undefined }, { key: "past", label: "Past and canceled" }]}
        active={tab}
      />
      <Section flush>
        {loadFailed ? (
          <EmptyState className="px-4">The demos didn&apos;t load. Refresh the page; if it keeps happening, the demo tables may be missing (supabase/demo-bookings.sql).</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState className="px-4">
            {tab === "upcoming" ? "No demos booked yet. They show up here the moment someone books one from the pricing page." : "Nothing here yet."}
          </EmptyState>
        ) : (
          <ul className="adm-divide">{rows.map((r) => <DemoItem key={r.id} r={r} tab={tab} now={now} />)}</ul>
        )}
      </Section>
      <p className="sc-t-caption adm-faint">
        People change or cancel their own demo from the link in every email. Moving or deleting the event in Google Calendar works too; this page catches up within the hour.{" "}
        <Link href="/admin/notifications?tab=demos" className="adm-link">Demo notifications</Link>
      </p>
    </Stack>
  );
}
