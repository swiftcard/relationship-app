import Link from "next/link";
import EnablePushButton from "@/components/EnablePushButton";
import { PageHeader, Section, Stack } from "../_ui/layout";
import { EmptyState } from "../_ui/states";
import { StatusBadge } from "../_ui/badges";
import { Icon } from "../_ui/icons";
import { fmtDate, fmtDateTime, timeAgo } from "../_ui/format";
import { telHref } from "@/lib/prospect-preview/input";
import { followUps, STAGE_LABELS, STAGES, stageCounts, stageOf, type Stage } from "@/lib/prospect-preview/pipeline";
import { previewState } from "@/lib/prospect-preview/real-view";
import type { PreviewList } from "@/lib/prospect-preview/store";
import { BUYER_ROLES, BUYER_ROLE_LABELS, DEFAULT_BRAND_PRIMARY, DEFAULT_BRAND_SECONDARY, DEFAULT_EXPIRY_DAYS, MAX_TEAM_MEMBERS, type PreviewListRow } from "@/lib/prospect-preview/types";
import CalledBox from "./CalledBox";
import CopyPreviewLink from "./CopyPreviewLink";

// ── Card Builder (server component, no data loading) ────────────────────────
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="sc-field-label">{label}</span>
      {children}
      {hint && <span className="sc-t-caption adm-muted block mt-1">{hint}</span>}
    </label>
  );
}

const input = "sc-field w-full px-3 py-2";

function CreateForm() {
  return (
    <form method="post" action="/api/admin/card-builder" className="grid gap-4 sm:grid-cols-2">
      <Field label="Office name"><input name="office_name" required maxLength={120} className={input} autoComplete="off" /></Field>
      <Field label="Owner's name"><input name="owner_name" required maxLength={80} className={input} autoComplete="off" /></Field>
      <Field label="Owner's title"><input name="owner_title" maxLength={80} className={input} placeholder="Broker / Owner" autoComplete="off" /></Field>
      <Field label="Their role" hint="Only the person in charge of the team or office: they are the one who can buy for everyone.">
        <select name="buyer_role" required defaultValue="" className={input}>
          <option value="" disabled>Choose…</option>
          {BUYER_ROLES.map((r) => <option key={r} value={r}>{BUYER_ROLE_LABELS[r]}</option>)}
        </select>
      </Field>
      <Field label="Owner's phone" hint="The alert tells you to call this number."><input name="phone" type="tel" required maxLength={40} className={input} autoComplete="off" /></Field>
      <Field label="Owner's email"><input name="email" type="email" maxLength={160} className={input} autoComplete="off" /></Field>
      <Field label="Logo address" hint="A full https:// link to their logo image. Leave empty to use their initials."><input name="logo_url" type="url" maxLength={600} className={input} placeholder="https://" autoComplete="off" /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Brand color"><input name="brand_primary" type="color" defaultValue={DEFAULT_BRAND_PRIMARY} className="sc-field w-full h-11 p-1" /></Field>
        <Field label="Accent color"><input name="brand_secondary" type="color" defaultValue={DEFAULT_BRAND_SECONDARY} className="sc-field w-full h-11 p-1" /></Field>
      </div>
      <Field label="Link stays up for (days)"><input name="expires_days" type="number" min={1} max={90} defaultValue={DEFAULT_EXPIRY_DAYS} className={input} /></Field>
      <div className="sm:col-span-2">
        <Field label="Team members" hint={`One per line: Name, Title. Up to ${MAX_TEAM_MEMBERS}. Each gets a card in the "Your team" strip.`}>
          <textarea name="team_members" rows={4} className={input} placeholder={"Dana Whitfield, Senior Agent\nMarcus Lee, Office Manager"} />
        </Field>
      </div>
      <details className="sm:col-span-2">
        <summary className="adm-link sc-t-footnote cursor-pointer">More options</summary>
        <div className="grid gap-4 sm:grid-cols-2 mt-3">
          <Field label="Link name" hint="Leave empty and one is made from the office name, with a random ending so it can't be guessed.">
            <input name="slug" maxLength={64} className={input} autoComplete="off" />
          </Field>
          <Field label="Lead ID" hint="Only if this prospect came from the agents' leads.">
            <input name="crew_lead_id" maxLength={40} className={input} autoComplete="off" />
          </Field>
        </div>
      </details>
      <div className="sm:col-span-2">
        <button type="submit" className="sc-btn sc-btn-filled"><Icon name="plus" className="w-4 h-4" />Create draft</button>
      </div>
    </form>
  );
}

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
      {r.status === "paused" ? <StatusBadge tone="neutral">Paused</StatusBadge> : r.status === "live" && state === "expired" ? <StatusBadge tone="bad">Expired</StatusBadge> : null}
    </>
  );
}

const SCREEN_LABEL = { call: "Call screen", send: "Send", edit: "Edit" } as const;

function FollowUps({ rows, now }: { rows: PreviewListRow[]; now: number }) {
  const list = followUps(rows, now);
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!list.length) return <EmptyState>Nobody to chase today.</EmptyState>;
  return (
    <ul className="adm-divide">
      {list.map((f) => {
        const r = byId.get(f.id)!;
        return (
          <li key={f.id} className="px-4 sm:px-5 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-follow-up={f.kind}>
            <p className="sc-t-subhead min-w-0">
              <span className="font-semibold">{r.owner_name}</span><span className="adm-muted"> · {r.office_name}</span>
              <span className="block adm-muted">{f.why} {f.next}</span>
            </p>
            <Link href={`/admin/card-builder/${f.screen}/${r.id}`} className="sc-btn sc-btn-sm sc-btn-gray shrink-0 self-start sm:self-auto">{SCREEN_LABEL[f.screen]}</Link>
          </li>
        );
      })}
    </ul>
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

export default function CardBuilderView({ list, appUrl, now, made, error, done, calendarSet }: {
  list: PreviewList;
  appUrl: string;
  /** The time the page was made (server), so the view stays pure. */
  now: number;
  made: string | null;
  error: string | null;
  done: string | null;
  calendarSet: boolean;
}) {
  const linkOf = (slug: string) => `${appUrl}/p/${slug}`;
  const outcome = done ? DONE[done] ?? null : null;
  return (
    <Stack>
      <PageHeader title="Card Builder" description="Build a preview card for a prospect, send them the link, and get told the moment they look at it." />

      {made && /^[a-z0-9-]{3,64}$/.test(made) && (
        <div className="adm-callout-good rounded-xl px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" role="status">
          <p className="sc-t-subhead min-w-0 break-all"><span className="font-semibold">Preview ready.</span> {linkOf(made)}</p>
          <CopyPreviewLink link={linkOf(made)} filled />
        </div>
      )}
      {error && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">{error}</p>}
      {outcome && <p className={`${outcome.ok ? "adm-callout-good" : "adm-callout-danger"} sc-t-subhead rounded-xl px-4 py-3`} role="status">{outcome.text}</p>}
      {!calendarSet && (
        <p className="adm-callout-warn sc-t-footnote rounded-xl px-4 py-3">
          The button on every preview opens the SwiftCard demo booking page for now. To send prospects to your own calendar instead, set PROSPECT_CALENDAR_URL.
        </p>
      )}

      {!list.ready && list.reason === "not_set_up" ? (
        <Section title="Not set up yet">
          <p className="sc-t-subhead">Card Builder&apos;s storage hasn&apos;t been created. Whoever set up SwiftCard needs to run <span className="font-semibold">supabase/prospect-previews.sql</span> once in the Supabase SQL editor, then this page fills in.</p>
        </Section>
      ) : (
        <>
          {list.ready && list.rows.length > 0 && (
            <>
              <StageCounts rows={list.rows} />
              <Section title="Follow up today" hint="Viewed but not reached comes first. Then links sent a day ago and not opened, first texts with no reply, and calls with no outcome." flush>
                <FollowUps rows={list.rows} now={now} />
              </Section>
            </>
          )}

          <Section title="New preview" hint="Starts as a draft. The next screen has every other field (headshot, address, website, social links, sources) and the Publish button.">
            <CreateForm />
          </Section>

          <Section title="Previews" hint="Most recently viewed first. A view only counts when a person really looked: not a link preview, not a bot, not you." flush>
            {!list.ready ? (
              <EmptyState>The previews couldn&apos;t be loaded just now. Refresh in a minute.</EmptyState>
            ) : list.rows.length === 0 ? (
              <EmptyState>No previews yet. Create one above.</EmptyState>
            ) : (
              <ul className="adm-divide">
                {list.rows.map((r) => <Row key={r.id} r={r} link={linkOf(r.slug)} now={now} />)}
              </ul>
            )}
          </Section>

          <Section title="Alerts" hint="When a prospect looks, every admin gets a push that says who, with the number to call. It comes at any hour.">
            <div className="space-y-3">
              <p className="sc-t-subhead">Turn notifications on in each place you want the alert: in the SwiftCard app on your phone, and here in this browser on your computer. On a computer it stays on screen until you click it.</p>
              <EnablePushButton />
              <p className="sc-t-footnote adm-muted">Your own visits never count or alert: any browser signed in as an admin is ignored, and so is a device marked as internal in Website › Settings. To test, open a preview link on a phone that isn&apos;t signed in to SwiftCard.</p>
            </div>
          </Section>
        </>
      )}
    </Stack>
  );
}
