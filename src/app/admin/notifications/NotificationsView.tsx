import Link from "next/link";
import { PageHeader, Section, Stack } from "../_ui/layout";
import { Tabs } from "../_ui/links";
import { EmptyState } from "../_ui/states";
import { Icon } from "../_ui/icons";
import { fmtDateTime } from "../_ui/format";
import { NOTIFICATION_TABS, notificationsBack, type NotificationTab } from "./tabs";

// ── Notifications: the really important things, in one list ────────────────
// Owner, 2026-10-28: "a notification center in our admin page … for really
// important things". Money (from Stripe), customers leaving (closed accounts,
// cancellations, people an offer kept) and the agents (the Sheet or an agent
// failing, Pause all left on). Admin only: no email, no push.
//
// Mark read and Mark all read are plain <form method="post">s, so they work
// before the page hydrates, or with no JavaScript at all.

export type NotificationRow = {
  id: string;
  created_at: string;
  kind: "money" | "leaving" | "agents";
  severity: "urgent" | "important";
  title: string;
  body: string | null;
  href: string | null;
  meta: Record<string, unknown> | null;
  read_at: string | null;
};

const KIND_LABEL: Record<NotificationRow["kind"], string> = { money: "Money", leaving: "Customers leaving", agents: "Agents" };

/** Only the admin's own pages and Stripe's dashboard are ever linked. */
const adminHref = (h: string | null) => (h && /^\/admin(\/|\?|$)/.test(h) ? h : null);
const stripeHref = (m: Record<string, unknown> | null) => {
  const u = m?.stripeUrl;
  return typeof u === "string" && u.startsWith("https://dashboard.stripe.com/") ? u : null;
};

export default function NotificationsView({ rows, tab, unreadOnly, unread }: {
  rows: NotificationRow[];
  tab: NotificationTab;
  unreadOnly: boolean;
  /** Unread per tab, for the counts on the tabs. */
  unread: Record<NotificationTab, number>;
}) {
  const back = notificationsBack(tab, unreadOnly);
  const unreadHere = unread[tab];
  return (
    <Stack>
      <PageHeader
        title="Notifications"
        description="Money, customers leaving and the agents: the things worth knowing the day they happen. Only here — no emails, no pushes."
        actions={
          <>
            <nav aria-label="Show" className="inline-flex rounded-full p-0.5" style={{ background: "var(--sc-fill)" }}>
              <Link href={notificationsBack(tab, false)} className={`sc-btn sc-btn-sm ${unreadOnly ? "sc-btn-plain" : "sc-btn-filled"}`} aria-current={unreadOnly ? undefined : "page"}>Everything</Link>
              <Link href={notificationsBack(tab, true)} className={`sc-btn sc-btn-sm ${unreadOnly ? "sc-btn-filled" : "sc-btn-plain"}`} aria-current={unreadOnly ? "page" : undefined}>Unread</Link>
            </nav>
            {unreadHere > 0 && (
              <form method="post" action="/api/admin/notifications/read">
                <input type="hidden" name="all" value="1" />
                <input type="hidden" name="kind" value={tab} />
                <input type="hidden" name="back" value={back} />
                <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Mark all read</button>
              </form>
            )}
          </>
        }
      />
      <Tabs
        base="/admin/notifications"
        items={NOTIFICATION_TABS.map((t) => ({ key: t.key, label: t.label, count: unread[t.key] || undefined }))}
        active={tab}
        extra={unreadOnly ? { unread: "1" } : {}}
      />
      <Section flush>
        {rows.length === 0 ? (
          <EmptyState className="px-4">
            {unreadOnly ? "Nothing unread here." : "Nothing here yet. Payments, cancellations, closed accounts and the agents' problems show up here as they happen."}
          </EmptyState>
        ) : (
          <ul className="adm-divide">
            {rows.map((n) => {
              const href = adminHref(n.href);
              const stripe = stripeHref(n.meta);
              return (
                <li key={n.id} className="adm-note px-4 sm:px-5 py-4 flex gap-3" data-unread={!n.read_at}>
                  {n.read_at ? <span className="w-2 shrink-0" aria-hidden /> : <span className="adm-note-dot" data-severity={n.severity} aria-label="Unread" />}
                  <div className="min-w-0 flex-1">
                    <p className="sc-t-subhead font-semibold">{n.title}</p>
                    {n.body && <p className="sc-t-footnote adm-muted mt-0.5 break-words">{n.body}</p>}
                    <p className="sc-t-caption adm-faint mt-1">
                      {n.severity === "urgent" && <span className="adm-bad font-semibold">Urgent · </span>}
                      {KIND_LABEL[n.kind]} · {fmtDateTime(n.created_at)}
                    </p>
                    {(href || stripe || !n.read_at) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {href && <Link href={href} className="sc-btn sc-btn-sm sc-btn-gray">Open<Icon name="chevron" className="w-3.5 h-3.5" /></Link>}
                        {stripe && <a href={stripe} target="_blank" rel="noopener noreferrer" className="sc-btn sc-btn-sm sc-btn-gray">Open in Stripe<Icon name="external" className="w-3.5 h-3.5" /></a>}
                        {!n.read_at && (
                          <form method="post" action="/api/admin/notifications/read">
                            <input type="hidden" name="id" value={n.id} />
                            <input type="hidden" name="back" value={back} />
                            <button type="submit" className="sc-btn sc-btn-sm sc-btn-plain">Mark read</button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </Stack>
  );
}
