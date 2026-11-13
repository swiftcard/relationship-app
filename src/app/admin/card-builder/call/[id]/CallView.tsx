import Link from "next/link";
import { BackLink } from "../../../_ui/links";
import { Section, Stack } from "../../../_ui/layout";
import { StatusBadge } from "../../../_ui/badges";
import { Icon } from "../../../_ui/icons";
import { fmtDateTime, timeAgo } from "../../../_ui/format";
import { CALL_OUTCOME_LABELS, CALL_OUTCOMES, isCallOutcome, type CallBrief } from "@/lib/prospect-preview/call";
import { telHref } from "@/lib/prospect-preview/input";
import { isOutcomeStage, STAGE_LABELS, stageOf } from "@/lib/prospect-preview/pipeline";
import { previewState } from "@/lib/prospect-preview/real-view";
import type { PreviewListRow } from "@/lib/prospect-preview/types";
import CalledBox from "../../CalledBox";

// ── The Call screen (server component, no data loading) ─────────────────────
// Where the "[Owner] is viewing their card" alert lands. A notification can't
// open the dialer itself: the iOS and Android apps only follow swiftcard.me
// links from a notification, and every tap is meant to land in the app. So it
// lands here: one big Call button, then everything needed for the first
// thirty seconds of the call, then the buttons that record how it went.
// page.tsx loads the preview and writes the brief (lib/prospect-preview/call.ts).

const DONE: Record<string, string> = { saved: "Saved.", logged: "Logged." };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex gap-3"><dt className="adm-faint w-28 shrink-0">{label}</dt><dd className="min-w-0" style={{ overflowWrap: "anywhere" }}>{children}</dd></div>;
}

export default function CallView({ p, brief, voicemail, appUrl, now, done }: {
  p: PreviewListRow; brief: CallBrief;
  /** What to say after the beep (written for this prospect, or the template). */
  voicemail?: string | null;
  appUrl: string; now: number; done: string | null;
}) {
  const live = previewState(p, now) === "live";
  const here = `/admin/card-builder/call/${p.id}`;
  const post = `/api/admin/card-builder/${p.id}`;
  const stage = stageOf(p);
  const detailSource = p.sources.detail?.url || null;

  return (
    <Stack>
      <BackLink href="/admin/card-builder">Card Builder</BackLink>

      {done && DONE[done] && <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" role="status">{DONE[done]}</p>}
      {done === "failed" && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">That didn&apos;t save. Try again in a minute.</p>}

      <Section>
        <div className="flex flex-col items-center text-center gap-1 py-2">
          <p className="sc-t-footnote adm-muted">{p.last_viewed_at ? `Looked at their card ${timeAgo(p.last_viewed_at, now)}` : "Hasn't opened their card yet"}</p>
          <h1 className="sc-t-title1">{p.owner_name}</h1>
          <p className="sc-t-subhead adm-muted">{[p.owner_title, p.office_name].filter(Boolean).join(" · ")}</p>
          <div className="mt-1"><StatusBadge tone="tint">{STAGE_LABELS[stage]}</StatusBadge></div>
          <a href={telHref(p.phone)} data-call className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block mt-4 max-w-md">
            <Icon name="phone" className="w-5 h-5" />Call {p.phone}
          </a>
          {p.sources.phone?.note && <p className="sc-t-caption adm-muted mt-1">{p.sources.phone.note}</p>}
          {p.email && <a href={`mailto:${p.email}`} className="adm-link sc-t-subhead mt-3 break-all">{p.email}</a>}
        </div>
      </Section>

      <Section title="Before you dial" id="pp-brief">
        <dl className="sc-t-subhead space-y-1.5">
          <Fact label="Decides because">{brief.whyBuyer ?? <span className="adm-bad">Not recorded. Confirm they run the office before you pitch.</span>}</Fact>
          <Fact label="Team size">{brief.teamSize ? `${brief.teamSize} people` : "Not known"}{p.team_members.length ? ` (${p.team_members.length} have a card on the preview)` : ""}</Fact>
          <Fact label="The hook">
            {p.detail ?? <span className="adm-bad">None recorded. Don&apos;t open with a compliment: find one true thing first.</span>}
            {p.detail && detailSource ? <> · <a className="adm-link" href={detailSource} target="_blank" rel="noopener noreferrer">source</a></> : null}
            {brief.angle && <span className="adm-muted block">Leads to: {brief.angle.toLowerCase()}</span>}
          </Fact>
          <Fact label="Uses today">{brief.currentTool ?? "Not checked"}</Fact>
          {p.specifics.length > 0 && (
            <Fact label="Also true">
              <ul className="space-y-1" data-specifics>
                {p.specifics.map((sp, i) => (
                  <li key={i}>
                    {sp.text}{sp.dated ? <span className="adm-muted"> ({sp.dated})</span> : null}
                    {sp.source_url ? <> · <a className="adm-link" href={sp.source_url} target="_blank" rel="noopener noreferrer">source</a></> : null}
                    {sp.uncertain ? <span className="adm-bad"> · uncertain</span> : null}
                  </li>
                ))}
              </ul>
            </Fact>
          )}
          <Fact label="Views">{p.views === 0 ? "None yet" : `${p.views}${p.devices > 1 ? ` from ${p.devices} devices` : ""}, last ${p.last_viewed_at ? fmtDateTime(p.last_viewed_at) : ""}`}</Fact>
          <Fact label="Team strip">{p.views === 0 ? "—" : p.team_strip_scrolled ? "Scrolled through the team's cards" : "Didn't scroll the team's cards"}</Fact>
        </dl>
      </Section>

      <Section title="Open with" hint={brief.written ? `Written for ${p.office_name}. Say it your way.` : "A suggestion. Say it your way."}>
        {!brief.specific && <p className="adm-callout-danger sc-t-footnote rounded-xl px-4 py-3 mb-3" data-generic-opener>This opener could be said to any office: the preview has no hook. Add one on the edit screen, or open with something true from the list above.</p>}
        <p className="sc-t-body" data-opener>{brief.opener}</p>
      </Section>

      {voicemail && (
        <Section title="If you get voicemail" hint="Then tap “Left a voicemail” below, and the follow-up text is ready on Card Builder.">
          <p className="sc-t-body" data-voicemail>{voicemail}</p>
        </Section>
      )}

      <Section title="If they say" flush>
        <ul className="adm-divide">
          {brief.objections.map((o) => (
            <li key={o.they} className="px-4 sm:px-5 py-3" data-objection>
              <p className="sc-t-subhead font-semibold">&ldquo;{o.they}&rdquo;</p>
              <p className="sc-t-subhead mt-1">{o.you}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="How did it go?" hint={isCallOutcome(p.call_outcome) && p.call_outcome_at ? `Last logged: ${CALL_OUTCOME_LABELS[p.call_outcome]}, ${fmtDateTime(p.call_outcome_at)}.` : "One tap logs it and moves the stage."}>
        <div className="flex flex-wrap gap-2" data-outcomes>
          {CALL_OUTCOMES.map((o) => (
            <form key={o} method="post" action={post}>
              <input type="hidden" name="action" value="outcome" />
              <input type="hidden" name="outcome" value={o} />
              <input type="hidden" name="back" value={here} />
              <button type="submit" className={`sc-btn sc-btn-sm ${o === "meeting_booked" || o === "won" ? "sc-btn-filled" : "sc-btn-gray"}`}>{CALL_OUTCOME_LABELS[o]}</button>
            </form>
          ))}
          {isOutcomeStage(p.stage) && (
            <form method="post" action={post}>
              <input type="hidden" name="action" value="reopen" />
              <input type="hidden" name="back" value={here} />
              <button type="submit" className="sc-btn sc-btn-sm sc-btn-plain">Reopen</button>
            </form>
          )}
        </div>
        <form method="post" action={post} className="flex flex-col gap-3 mt-4">
          <input type="hidden" name="action" value="call" />
          <input type="hidden" name="back" value={here} />
          <CalledBox called={p.called} who={p.owner_name} />
          <textarea name="notes" defaultValue={p.notes ?? ""} maxLength={2000} rows={3} placeholder="Notes from the call" aria-label={`Notes about ${p.owner_name}`} className="sc-field w-full px-3 py-2" />
          <div><button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Save notes</button></div>
        </form>
      </Section>

      <Section title="Their preview">
        <div className="flex flex-wrap gap-2">
          {live
            ? <a className="sc-btn sc-btn-sm sc-btn-gray" href={`${appUrl}/p/${p.slug}`} target="_blank" rel="noopener noreferrer">Open their link</a>
            : <Link className="sc-btn sc-btn-sm sc-btn-gray" href={`/admin/card-builder/preview/${p.id}`}>Look at it (link not open)</Link>}
          <Link className="sc-btn sc-btn-sm sc-btn-plain" href={`/admin/card-builder/send/${p.id}`}>Send</Link>
          <Link className="sc-btn sc-btn-sm sc-btn-plain" href={`/admin/card-builder/edit/${p.id}`}>Edit</Link>
        </div>
      </Section>
    </Stack>
  );
}
