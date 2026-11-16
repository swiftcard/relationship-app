import { BackLink } from "../../_ui/links";
import { PageHeader, Section, Stack } from "../../_ui/layout";
import { EmptyState } from "../../_ui/states";
import { StatusBadge } from "../../_ui/badges";
import { fmtDateTime, timeAgo } from "../../_ui/format";
import { macIsOn, type MacStatus, type OutboxRow } from "@/lib/prospect-preview/outbox";
import { DECISION_LABELS, MAX_DAILY_CAP, sendDecision, localClock, type SenderSettings } from "@/lib/prospect-preview/send-window";

// ── Card Builder: the iMessage sender (server component, no data loading) ───
// Owner, 2026-11-16: approved openers go out from MY number over iMessage,
// "with a randomized gap of a few minutes between sends, during daytime hours
// only, and a daily cap I set. Skip numbers that aren't on iMessage." The
// sending itself happens on the owner's Mac (scripts/card-builder-mac); this
// page sets its rules and shows what it did.

const DONE: Record<string, { ok: boolean; text: string }> = {
  saved: { ok: true, text: "Saved. Your Mac uses the new rules from its next check, within a minute." },
  canceled: { ok: true, text: "Taken out of the queue. Nothing was sent." },
  failed: { ok: false, text: "That didn't work. Try again in a minute." },
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS: Record<OutboxRow["status"], { tone: "good" | "bad" | "warn" | "neutral" | "tint"; text: string }> = {
  queued: { tone: "neutral", text: "Queued" }, sending: { tone: "tint", text: "Sending" }, sent: { tone: "good", text: "Sent" },
  failed: { tone: "bad", text: "Failed" }, not_imessage: { tone: "warn", text: "Not on iMessage" }, canceled: { tone: "neutral", text: "Taken out" },
};
const input = "sc-field w-full px-3 py-2";

export default function SenderView({ settings: s, mac, outbox, now, done }: { settings: SenderSettings; mac: MacStatus; outbox: OutboxRow[]; now: number; done: string | null }) {
  const outcome = done ? DONE[done] ?? null : null;
  const on = macIsOn(mac, now);
  const today = localClock(new Date(now), s.tz).date;
  const sentToday = outbox.filter((o) => o.status === "sent" && o.sent_at && localClock(new Date(o.sent_at), s.tz).date === today).length;
  const queued = outbox.filter((o) => o.status === "queued").length;
  const d = sendDecision(s, { now: new Date(now), sentToday, notBefore: null });
  return (
    <Stack className="max-w-xl mx-auto w-full">
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader title="iMessage sender" description="Approved opening texts go out from your own number, through Messages on your Mac, one at a time." />
      {outcome && <p className={`${outcome.ok ? "adm-callout-good" : "adm-callout-danger"} sc-t-subhead rounded-xl px-4 py-3`} role="status">{outcome.text}</p>}

      <div className="grid grid-cols-3 gap-2" data-sender-counts>
        {[["Queued", queued], ["Sent today", `${sentToday} of ${s.daily_cap}`], ["Right now", d.ok ? "Sending" : DECISION_LABELS[d.reason]]].map(([label, v]) => (
          <div key={String(label)} className="adm-card rounded-xl px-3 py-2.5 min-w-0">
            <p className="sc-t-headline tabular-nums truncate">{v}</p>
            <p className="sc-t-caption adm-muted truncate">{label}</p>
          </div>
        ))}
      </div>
      <p className={`${on ? "adm-callout-good" : "adm-callout-warn"} sc-t-footnote rounded-xl px-3 py-2`} data-mac>
        {on ? <>Your Mac is on{mac.note ? `: ${mac.note}` : "."}{mac.next_send_at && Date.parse(mac.next_send_at) > now ? ` Next text no sooner than ${fmtDateTime(mac.next_send_at)}.` : ""}</> : <>Your Mac hasn&apos;t checked in{mac.at ? ` since ${timeAgo(mac.at, now)}` : " yet"}. Nothing is sent while it&apos;s off; the queue waits.</>}
      </p>

      <Section title="Rules">
        <form method="post" action="/api/admin/card-builder/sender" className="flex flex-col gap-4" data-sender-settings>
          <input type="hidden" name="action" value="settings" />
          <label className="flex items-center gap-3 sc-t-subhead"><input type="checkbox" name="paused" value="1" defaultChecked={s.paused} className="w-5 h-5" style={{ accentColor: "var(--sc-tint)" }} />Pause sending</label>
          <label className="block max-w-[10rem]"><span className="sc-field-label">Texts a day, at most</span><input name="daily_cap" type="number" min={0} max={MAX_DAILY_CAP} defaultValue={s.daily_cap} className={input} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="sc-field-label">From</span><input name="start" type="time" defaultValue={s.start} className={input} /></label>
            <label className="block"><span className="sc-field-label">Until</span><input name="end" type="time" defaultValue={s.end} className={input} /></label>
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="sc-field-label">Days</legend>
            {DAYS.map((name, i) => (
              <label key={name} className="flex items-center gap-2 sc-t-subhead"><input type="checkbox" name="days" value={i} defaultChecked={s.days.includes(i)} className="w-5 h-5" style={{ accentColor: "var(--sc-tint)" }} />{name}</label>
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="sc-field-label">Gap, at least (minutes)</span><input name="gap_min" type="number" min={1} max={120} defaultValue={s.gap_min} className={input} /></label>
            <label className="block"><span className="sc-field-label">Gap, at most (minutes)</span><input name="gap_max" type="number" min={1} max={240} defaultValue={s.gap_max} className={input} /></label>
          </div>
          <p className="sc-t-caption adm-muted">New York time. Each gap is a random length between the two. A number that turns out not to be on iMessage is skipped, never sent as a green text, and a reply of &ldquo;stop&rdquo; puts them on the do-not-contact list.</p>
          <button type="submit" className="sc-btn sc-btn-filled sc-btn-block">Save the rules</button>
        </form>
      </Section>

      <Section title="Queue and history" flush>
        {outbox.length === 0 ? <EmptyState>Nothing queued yet. Approve a card with &ldquo;Approve and queue&rdquo;, or &ldquo;Approve all&rdquo;.</EmptyState> : (
          <ul className="adm-divide">
            {outbox.map((o) => (
              <li key={o.id} className="px-4 sm:px-5 py-3 flex flex-col gap-1.5" data-outbox-row>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={STATUS[o.status].tone}>{STATUS[o.status].text}</StatusBadge>
                  <span className="sc-t-footnote adm-muted">{o.sent_at ? `sent ${fmtDateTime(o.sent_at)}` : `queued ${timeAgo(o.created_at, now)}`}{o.hook ? ` · ${o.hook}` : ""}{o.error ? ` · ${o.error}` : ""}</span>
                </div>
                <p className="sc-t-subhead whitespace-pre-line" style={{ overflowWrap: "anywhere" }}>{o.body}</p>
                {o.status === "queued" && (
                  <form method="post" action="/api/admin/card-builder/sender">
                    <input type="hidden" name="action" value="cancel" />
                    <input type="hidden" name="id" value={o.id} />
                    <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Take it out</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Stack>
  );
}
