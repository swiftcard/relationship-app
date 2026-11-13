import Link from "next/link";
import EnablePushButton from "@/components/EnablePushButton";
import { PageHeader, Section, Stack } from "../_ui/layout";
import { EmptyState } from "../_ui/states";
import { StatusBadge } from "../_ui/badges";
import { Icon } from "../_ui/icons";
import { fmtDate, fmtDateTime, timeAgo } from "../_ui/format";
import { telHref } from "@/lib/prospect-preview/input";
import { STAT_LABELS, type BatchBrief, type MessageStat } from "@/lib/prospect-preview/learn";
import { approvalQueue, followUps, STAGE_LABELS, STAGES, stageCounts, stageOf, type Stage } from "@/lib/prospect-preview/pipeline";
import { assessQuality } from "@/lib/prospect-preview/quality";
import { previewState } from "@/lib/prospect-preview/real-view";
import type { PreviewList } from "@/lib/prospect-preview/store";
import type { PreviewListRow } from "@/lib/prospect-preview/types";
import CalledBox from "./CalledBox";
import CopyPreviewLink from "./CopyPreviewLink";

// ── Card Builder (server component, no data loading) ────────────────────────
// Phone first, three buttons (owner, 2026-11-13: "one clear action per
// screen"): Approve, Call and follow up, Add, each with its count. The latest
// batch's brief sits above them while it has drafts waiting. Everything else
// (the stage counts, every preview, what's working) is under Details; warm
// paths and the alert settings are under More. The create form moved to Add
// and the follow-up list to its own screen.
// page.tsx loads the list; this draws it, so tests/render can measure the real
// markup with fixtures. Every action is a plain <form method="post"> to
// /api/admin/card-builder…, so it works before hydration. Delete is two steps
// (a <details> that opens the form), so one stray tap can't remove a preview a
// prospect is holding the link to.

const DONE: Record<string, { ok: boolean; text: string }> = {
  saved: { ok: true, text: "Saved." },
  deleted: { ok: true, text: "Preview deleted. Its link no longer opens." },
  failed: { ok: false, text: "That didn't work. Try again in a minute." },
};

const STAGE_TONE: Record<Stage, "good" | "bad" | "warn" | "neutral" | "tint"> = {
  draft: "warn", ready: "neutral", sent: "neutral", viewed: "tint", called: "tint", meeting_booked: "good", won: "good", lost: "bad",
};

/** Where the prospect is, and (separately) whether their link still opens. */
function statusBadge(r: PreviewListRow, now: number) {
  const stage = stageOf(r);
  const state = previewState(r, now);
  return (
    <>
      <StatusBadge tone={STAGE_TONE[stage]}>{STAGE_LABELS[stage]}</StatusBadge>
      {/* A draft that could have been written for any office can't move to Ready. */}
      {stage === "draft" && !assessQuality(r).mayPublish && <StatusBadge tone="bad">Too generic</StatusBadge>}
      {r.status === "paused" ? <StatusBadge tone="neutral">Paused</StatusBadge> : r.status === "live" && state === "expired" ? <StatusBadge tone="bad">Expired</StatusBadge> : null}
    </>
  );
}

function StageCounts({ rows }: { rows: PreviewListRow[] }) {
  const counts = stageCounts(rows);
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2" aria-label="Previews at each stage" data-stage-counts>
      {STAGES.map((s) => (
        <li key={s} className="adm-card rounded-xl px-3 py-2.5 min-w-0" data-stage={s}>
          <p className="sc-t-title2 font-semibold tabular-nums">{counts[s]}</p>
          <p className="sc-t-caption adm-muted truncate">{STAGE_LABELS[s]}</p>
        </li>
      ))}
    </ul>
  );
}

function Row({ r, link, now }: { r: PreviewListRow; link: string; now: number }) {
  const live = previewState(r, now) === "live";
  return (
    <li className="px-4 sm:px-5 py-4" data-preview-row>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="sc-t-headline">{r.owner_name}</p>
            <span className="sc-t-subhead adm-muted">{[r.owner_title, r.office_name].filter(Boolean).join(" · ")}</span>
            {statusBadge(r, now)}
          </div>
          <p className="sc-t-subhead mt-1.5">
            <span className="font-semibold">{r.views === 1 ? "1 real view" : `${r.views} real views`}</span>
            <span className="adm-muted">
              {r.last_viewed_at ? ` · last viewed ${timeAgo(r.last_viewed_at, now)} (${fmtDateTime(r.last_viewed_at)})` : " · never opened"}
              {r.devices > 1 ? ` · ${r.devices} devices` : ""}
              {r.team_strip_scrolled ? " · looked through the team" : ""}
            </span>
          </p>
          <p className="sc-t-footnote adm-muted mt-1 break-all">
            <a className="adm-link" href={telHref(r.phone)}>{r.phone}</a>
            {r.email ? <> · <a className="adm-link" href={`mailto:${r.email}`}>{r.email}</a></> : null}
            {" · "}{r.status === "draft" ? "not published yet" : live ? `link expires ${fmtDate(r.expires_at, now)}` : r.status === "paused" ? "link paused" : `link expired ${fmtDate(r.expires_at, now)}`}
            {r.team_members.length ? ` · ${r.team_members.length} on the team` : ""}
            {r.sent_at ? ` · link sent by ${r.sent_channel === "email" ? "email" : "text"} ${timeAgo(r.sent_at, now)}` : r.asked_at ? ` · asked ${timeAgo(r.asked_at, now)}` : ""}
          </p>
          <form method="post" action={`/api/admin/card-builder/${r.id}`} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="hidden" name="action" value="call" />
            <CalledBox called={r.called} who={r.owner_name} />
            <input name="notes" defaultValue={r.notes ?? ""} maxLength={2000} placeholder="Notes from the call" aria-label={`Notes about ${r.owner_name}`} className="sc-field sc-field-fit px-3 py-2 text-sm min-w-0 flex-1" />
            <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Save</button>
          </form>
          {r.called && r.called_at && <p className="sc-t-caption adm-faint mt-1">Called {fmtDateTime(r.called_at)}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end lg:max-w-[20rem]">
          {live && <CopyPreviewLink link={link} />}
          {live
            ? <a href={link} target="_blank" rel="noopener noreferrer" className="sc-btn sc-btn-sm sc-btn-plain"><Icon name="external" className="w-4 h-4" />Open</a>
            : <Link href={`/admin/card-builder/preview/${r.id}`} className="sc-btn sc-btn-sm sc-btn-plain"><Icon name="external" className="w-4 h-4" />Look</Link>}
          <Link href={`/admin/card-builder/send/${r.id}`} className="sc-btn sc-btn-sm sc-btn-plain" data-send-link>Send</Link>
          <Link href={`/admin/card-builder/edit/${r.id}`} className="sc-btn sc-btn-sm sc-btn-plain" data-edit>{r.status === "draft" ? "Edit and publish" : "Edit"}</Link>
          <Link href={`/admin/card-builder/call/${r.id}`} className="sc-btn sc-btn-sm sc-btn-plain"><Icon name="phone" className="w-4 h-4" />Call screen</Link>
          {/* Full width at every size: the confirm button opens on its own
              line, inside the column, instead of pushing past the screen edge. */}
          <details className="w-full lg:text-right">
            <summary className="sc-btn sc-btn-sm sc-btn-plain adm-bad list-none cursor-pointer">Delete</summary>
            <form method="post" action={`/api/admin/card-builder/${r.id}`} className="mt-2">
              <input type="hidden" name="action" value="delete" />
              <button type="submit" className="sc-btn sc-btn-sm sc-btn-destructive">Yes, delete it</button>
            </form>
          </details>
        </div>
      </div>
    </li>
  );
}

function BigButton({ href, count, label, hint, primary }: { href: string; count: number; label: string; hint: string; primary: boolean }) {
  return (
    <Link href={href} className={`adm-card rounded-2xl px-4 py-4 flex items-center gap-4 min-h-[88px] ${primary ? "adm-big-on" : ""}`} data-big={label}>
      <span className="sc-t-title1 font-semibold tabular-nums shrink-0 w-12 text-center" data-count>{count}</span>
      <span className="min-w-0">
        <span className="sc-t-headline block">{label}</span>
        <span className="sc-t-footnote adm-muted block">{hint}</span>
      </span>
    </Link>
  );
}

/** "Ready to approve": the last batch's drafts, best score first, and who was skipped and why. */
function Brief({ b }: { b: BatchBrief }) {
  const n = b.ready.length;
  return (
    <Section title={b.finished ? (n ? "Ready to approve" : "Batch finished") : "Batch running"} hint={`“${b.label}”${b.finished ? "" : `: ${b.built} built so far`}`} id="batch-brief">
      <div className="flex flex-col gap-3 min-w-0" data-brief>
        {n > 0 ? (
          <>
            <p className="sc-t-subhead"><span className="font-semibold">{n === 1 ? "1 draft" : `${n} drafts`}</span> waiting for you, best first:</p>
            <ol className="sc-t-subhead space-y-1 min-w-0 w-full" data-brief-ready>
              {b.ready.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3 min-w-0">
                  <span className="min-w-0 truncate">{r.office}<span className="adm-muted"> · {r.owner}</span></span>
                  <span className="shrink-0 tabular-nums">{r.score}{r.tooGeneric ? <span className="adm-bad"> · too generic</span> : null}</span>
                </li>
              ))}
            </ol>
            {n > 5 && <p className="sc-t-footnote adm-muted">And {n - 5} more.</p>}
          </>
        ) : (
          <p className="sc-t-subhead adm-muted">{b.finished ? (b.built ? "All of its drafts have been dealt with." : "It built no drafts.") : "Drafts appear here as each one is finished."}</p>
        )}
        {b.skippedCount > 0 && (
          <p className="sc-t-footnote adm-muted" data-brief-skipped>
            <span className="font-semibold">{b.skippedCount} skipped:</span> {b.skipped.map((g) => `${g.reason} (${g.offices.length})`).join("; ")}.
          </p>
        )}
        {n > 0 && <Link href="/admin/card-builder/approve" className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block">Approve them</Link>}
      </div>
    </Section>
  );
}

function Stats({ stats }: { stats: MessageStat[] }) {
  if (!stats.length) return <EmptyState>Nothing has been sent yet. Each message you send is counted here, with what happened next.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full sc-t-footnote" data-stats>
        <thead><tr className="adm-muted text-left"><th className="font-medium py-1.5 pr-3">Message</th><th className="font-medium py-1.5 px-2 text-right">Sent</th><th className="font-medium py-1.5 px-2 text-right">Viewed</th><th className="font-medium py-1.5 px-2 text-right">Picked up</th><th className="font-medium py-1.5 pl-2 text-right">Booked</th></tr></thead>
        <tbody>
          {stats.map((s) => (
            <tr key={`${s.message}-${s.variant ?? ""}`}>
              <td className="py-1.5 pr-3">{STAT_LABELS[s.message] ?? s.message}{s.variant ? `, version ${s.variant.toUpperCase()}` : ""}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{s.sent}</td><td className="py-1.5 px-2 text-right tabular-nums">{s.viewed}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{s.picked_up}</td><td className="py-1.5 pl-2 text-right tabular-nums">{s.booked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CardBuilderView({ list, appUrl, now, made, error, done, queueCount = 0, brief = null, stats = [] }: {
  list: PreviewList;
  appUrl: string;
  /** The time the page was made (server), so the view stays pure. */
  now: number;
  made: string | null;
  error: string | null;
  done: string | null;
  /** Prospects waiting in the Add queue for the next /build run. */
  queueCount?: number;
  /** The latest batch, when it still has something to say. */
  brief?: BatchBrief | null;
  /** What happened after each kind of message (lib/prospect-preview/learn). */
  stats?: MessageStat[];
}) {
  const linkOf = (slug: string) => `${appUrl}/p/${slug}`;
  const outcome = done ? DONE[done] ?? null : null;
  const queue = list.ready ? approvalQueue(list.rows, now) : null;
  const toDecide = queue ? queue.waiting.length + queue.send.length : 0;
  const toChase = list.ready ? followUps(list.rows, now).length : 0;
  return (
    <Stack>
      <PageHeader title="Card Builder" description="Approve what was built for you, call who looked, add who is next." />

      {made && /^[a-z0-9-]{3,64}$/.test(made) && (
        <div className="adm-callout-good rounded-xl px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" role="status">
          <p className="sc-t-subhead min-w-0 break-all"><span className="font-semibold">Preview ready.</span> {linkOf(made)}</p>
          <CopyPreviewLink link={linkOf(made)} filled />
        </div>
      )}
      {error && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">{error}</p>}
      {outcome && <p className={`${outcome.ok ? "adm-callout-good" : "adm-callout-danger"} sc-t-subhead rounded-xl px-4 py-3`} role="status">{outcome.text}</p>}

      {!list.ready && list.reason === "not_set_up" ? (
        <Section title="Not set up yet">
          <p className="sc-t-subhead">Card Builder&apos;s storage hasn&apos;t been created. Whoever set up SwiftCard needs to run <span className="font-semibold">supabase/prospect-previews.sql</span> once in the Supabase SQL editor, then this page fills in.</p>
        </Section>
      ) : (
        <>
          {brief && <Brief b={brief} />}

          <nav aria-label="What to do" className="grid gap-3 sm:grid-cols-3" data-big-buttons>
            <BigButton href="/admin/card-builder/approve" count={toDecide} label="Approve" hint={toDecide ? "Drafts to read, and first texts to send" : "Nothing waiting"} primary={toDecide > 0} />
            <BigButton href="/admin/card-builder/follow-up" count={toChase} label="Call and follow up" hint={toChase ? "Each with its words ready" : "Nobody to chase today"} primary={toChase > 0} />
            <BigButton href="/admin/card-builder/add" count={queueCount} label="Add" hint={queueCount ? "In the queue for the next run" : "Names, links or notes"} primary={false} />
          </nav>

          <details data-section="details">
            <summary className="adm-link sc-t-subhead cursor-pointer">Details</summary>
            <div className="mt-4 space-y-6">
              {list.ready && list.rows.length > 0 && <StageCounts rows={list.rows} />}
              <Section title="Previews" hint="Most recently viewed first. A view only counts when a person really looked: not a link preview, not a bot, not you." flush>
                {!list.ready ? (
                  <EmptyState>The previews couldn&apos;t be loaded just now. Refresh in a minute.</EmptyState>
                ) : list.rows.length === 0 ? (
                  <EmptyState>No previews yet. Add one.</EmptyState>
                ) : (
                  <ul className="adm-divide">
                    {list.rows.map((r) => <Row key={r.id} r={r} link={linkOf(r.slug)} now={now} />)}
                  </ul>
                )}
              </Section>
              <Section title="What's working" hint="For each message you sent: how many prospects it went to, and how many of them then viewed their card, picked up, and booked. With only a few sends this is what happened, not proof of what works.">
                <Stats stats={stats} />
              </Section>
            </div>
          </details>

          <details data-section="more">
            <summary className="adm-link sc-t-subhead cursor-pointer">More</summary>
            <div className="mt-4 space-y-6">
              <Section title="Warm paths" hint="Upload your LinkedIn connections, and prospects where you already know someone are flagged.">
                <Link href="/admin/card-builder/connections" className="sc-btn sc-btn-gray">Your LinkedIn connections</Link>
              </Section>
              <Section title="Alerts" hint="When a prospect looks, every admin gets a push that says who, with the number to call. It comes at any hour.">
                <div className="space-y-3">
                  <p className="sc-t-subhead">Turn notifications on in each place you want the alert: in the SwiftCard app on your phone, and here in this browser on your computer. On a computer it stays on screen until you click it.</p>
                  <EnablePushButton />
                  <p className="sc-t-footnote adm-muted">Your own visits never count or alert: any browser signed in as an admin is ignored, and so is a device marked as internal in Website › Settings. To test, open a preview link on a phone that isn&apos;t signed in to SwiftCard.</p>
                </div>
              </Section>
            </div>
          </details>
        </>
      )}
    </Stack>
  );
}
