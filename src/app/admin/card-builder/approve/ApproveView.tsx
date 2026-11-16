import Link from "next/link";
import CardScaler from "@/components/CardScaler";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { BackLink } from "../../_ui/links";
import { PageHeader, Section, Stack } from "../../_ui/layout";
import { EmptyState } from "../../_ui/states";
import { StatusBadge } from "../../_ui/badges";
import { ownerCard, paddedLogoSrc } from "@/lib/prospect-preview/card";
import { hookLines, mailtoHref, smsHref, type Messages } from "@/lib/prospect-preview/messages";
import { resolveOutreach } from "@/lib/prospect-preview/outreach";
import { approvalQueue } from "@/lib/prospect-preview/pipeline";
import { assessQuality, isVerified, type Quality } from "@/lib/prospect-preview/quality";
import type { PreviewList } from "@/lib/prospect-preview/store";
import { SOURCE_FIELDS, SOURCE_LABELS, WARM_LABELS, type PreviewListRow } from "@/lib/prospect-preview/types";
import { warmPathFor, type Connection } from "@/lib/prospect-preview/warm";
import LinkedInButton from "../LinkedInButton";
import OneTapSend from "../OneTapSend";
import CopyText from "../CopyText";
import { OPENER_HOOK_LABELS, openerMessage, openerText, scoreTotal } from "@/lib/prospect-preview/opener";
import { QUEUE_RESULT_TEXT, type QueueResult } from "@/lib/prospect-preview/outbox";
import type { FailedJob } from "@/lib/card-builder-jobs/jobs";

// ── Card Builder: the Approve queue (server component, no data loading) ─────
// Built for a phone held in one hand (owner, 2026-11-13: "AI does the work and
// I only approve and answer alerts"). One card per prospect: what their card
// looks like, the score, the facts with where each came from, and the words
// that will go out. Three buttons: Approve and publish, Edit, Skip.
//
// Approving publishes and NOTHING ELSE. The prospect hears from us only when
// the owner then taps the send button, which opens their own Messages or Mail
// with the words filled in; they press send there, from their own number.
// page.tsx loads the list; this draws it, so tests/render can measure it.

const DONE: Record<string, { ok: boolean; text: string }> = {
  approved: { ok: true, text: "Published. The link opens for 14 days. Nothing has been sent: tap the button on their card to send the first text." },
  saved: { ok: true, text: "Saved." },
  accepted: { ok: true, text: "Marked as accepted. The message for them is under Call and follow up." },
  skipped: { ok: true, text: "Skipped. It stays a draft, under Skipped at the bottom." },
  unskipped: { ok: true, text: "Back in the queue." },
  sent: { ok: true, text: "Marked as sent." },
  approved_queued: { ok: true, text: "Published and scheduled for 9 AM their time. Your Mac then texts it from your number, in your sending hours." },
  queued: { ok: true, text: "Scheduled for 9 AM their time. Your Mac then texts it from your number, in your sending hours." },
  retried: { ok: true, text: "Trying it again. It runs within 5 minutes." },
  held: { ok: false, text: "Not published: that draft is too generic. Open Edit to see what it needs." },
  failed: { ok: false, text: "That didn't work. Try again in a minute." },
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/**
 * Their card as they will see it, small. Not wrapped in a link: the card
 * template has links of its own inside it, and a link inside a link is closed
 * early by the browser, which lets the 460px card spill across the screen.
 */
function Thumb({ r }: { r: PreviewListRow }) {
  return (
    <div className="mx-auto w-full max-w-[17.5rem]" data-thumb>
      <div inert className="pointer-events-none select-none">
        <CardScaler>
          <LogoFirst data={ownerCard(r, paddedLogoSrc(r, true))} />
        </CardScaler>
      </div>
      <Link href={`/admin/card-builder/preview/${r.id}`} className="adm-link sc-t-footnote block text-center mt-2">See the whole preview</Link>
    </div>
  );
}

function Words({ label, children, extra }: { label: string; children: string; extra?: string }) {
  return (
    <div data-words>
      <p className="sc-t-caption adm-faint uppercase tracking-wide">{label}{extra ? <span className="normal-case tracking-normal"> · {extra}</span> : null}</p>
      <p className="sc-t-subhead mt-1 whitespace-pre-line" style={{ overflowWrap: "anywhere" }}>{children}</p>
    </div>
  );
}

function Facts({ r, q }: { r: PreviewListRow; q: Quality }) {
  const hook = hookLines(r);
  const unsure = SOURCE_FIELDS.filter((k) => r.sources[k]?.uncertain);
  const missing = q.checks.filter((c) => !c.ok);
  return (
    <div className="flex flex-col gap-3">
      {hook && <p className="sc-t-subhead" data-hook><span className="font-semibold">The hook: </span>{hook.saw} {hook.why}</p>}
      {r.specifics.length > 0 && (
        <ul className="space-y-1.5 sc-t-subhead" data-specifics>
          {r.specifics.map((sp, i) => (
            <li key={i} style={{ overflowWrap: "anywhere" }}>
              {sp.text}{sp.dated ? <span className="adm-muted"> ({sp.dated})</span> : null}
              {sp.source_url ? <> · <a className="adm-link" href={sp.source_url} target="_blank" rel="noopener noreferrer">source</a></> : null}
              {sp.owner ? <span className="adm-muted"> · confirmed by you</span> : null}
              {!isVerified(sp) ? <span className="adm-bad"> · not verified</span> : null}
            </li>
          ))}
        </ul>
      )}
      {(unsure.length > 0 || missing.length > 0) && (
        <details data-unconfirmed>
          <summary className="adm-link sc-t-footnote cursor-pointer">Couldn&apos;t confirm or left out ({unsure.length + missing.length})</summary>
          <ul className="mt-1.5 space-y-1 sc-t-footnote adm-muted">
            {unsure.map((k) => <li key={k}><span className="adm-bad">Uncertain:</span> {SOURCE_LABELS[k]}{r.sources[k]?.note ? ` (${r.sources[k]!.note})` : ""}</li>)}
            {missing.map((c) => <li key={c.key}>{c.required ? <span className="adm-bad">Needed: </span> : "Missing: "}{c.label}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A flag the owner should see before sending: the number can't take an iMessage, or hasn't been checked. */
function phoneFlag(r: PreviewListRow): string | null {
  if (r.not_imessage_at) return "Not on iMessage: your Mac couldn't deliver to this number. Call, or use the email.";
  if (r.phone_kind === "office") return "No mobile number: this is an office line, so it can't get a text.";
  if (!r.phone_kind) return "Number not checked yet: it's checked when you queue it.";
  if (r.phone_kind === "unknown") return "Couldn't tell if this is a mobile (it may be a Google Voice line).";
  return null;
}

/**
 * The opening text: the one that goes, editable, the runner-up one tap away,
 * and every version with its hook and its scores. Owner, 2026-11-16: "the
 * opening text is the most important part of the whole system".
 */
function Opener({ r, link }: { r: PreviewListRow; link: string }) {
  const o = r.openers;
  const text = openerText(o);
  if (!o || !text) return <p className="adm-callout-warn sc-t-footnote rounded-xl px-3 py-2" data-no-opener>No opening text was written for them yet. Run /build-card on them again, or write one on the edit screen&apos;s messages.</p>;
  const post = `/api/admin/card-builder/${r.id}`;
  const best = o.candidates[o.pick];
  const alt = o.alt !== null ? o.candidates[o.alt] : null;
  const flag = phoneFlag(r);
  return (
    <div className="flex flex-col gap-2" data-opener>
      <p className="sc-t-caption adm-faint uppercase tracking-wide">Opening text<span className="normal-case tracking-normal"> · {OPENER_HOOK_LABELS[best.hook].toLowerCase()} · {o.edited ? "your edit" : `${scoreTotal(best)} of 30`} · {text.length} characters, then the link</span></p>
      <form method="post" action={post} className="flex flex-col gap-2">
        <input type="hidden" name="action" value="opener" />
        <input type="hidden" name="back" value="/admin/card-builder/approve" />
        <textarea name="text" defaultValue={text} rows={4} maxLength={400} aria-label={`Opening text for ${r.owner_name}`} className="sc-field w-full px-3 py-2 sc-t-subhead" />
        <p className="sc-t-footnote adm-muted break-all">then, on its own line: {link}</p>
        <button type="submit" className="adm-link sc-t-footnote self-start">Save my edit</button>
      </form>
      {flag && <p className="adm-callout-warn sc-t-footnote rounded-xl px-3 py-2" data-phone-flag>{flag}</p>}
      {alt && (
        <form method="post" action={post} className="adm-card rounded-xl px-3 py-2.5 flex flex-col gap-1.5" data-opener-alt>
          <input type="hidden" name="action" value="opener_pick" />
          <input type="hidden" name="i" value={o.alt ?? ""} />
          <input type="hidden" name="back" value="/admin/card-builder/approve" />
          <span className="sc-t-caption adm-muted">Runner-up · {OPENER_HOOK_LABELS[alt.hook].toLowerCase()} · {scoreTotal(alt)} of 30</span>
          <span className="sc-t-subhead" style={{ overflowWrap: "anywhere" }}>{alt.text}</span>
          <button type="submit" className="adm-link sc-t-footnote self-start">Use this one instead</button>
        </form>
      )}
      <details>
        <summary className="adm-link sc-t-footnote cursor-pointer">All {o.candidates.length} versions, with scores</summary>
        <ol className="mt-2 flex flex-col gap-2">
          {o.candidates.map((c, i) => (
            <li key={i} className="sc-t-footnote" style={{ overflowWrap: "anywhere" }}>
              <span className="adm-muted">{OPENER_HOOK_LABELS[c.hook]} · specific {c.scores.specificity}, human {c.scores.human}, curiosity {c.scores.curiosity} = {scoreTotal(c)}{i === o.pick ? " · default" : ""}</span>
              <br />{c.text}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

/**
 * `pickForm`: the id of the Approve form these radio buttons belong to, when
 * there are two versions of the first text to choose between.
 */
function AllWords({ m, opener, pickForm }: { m: Messages; opener: string | null; pickForm?: string }) {
  return (
    <div className="flex flex-col gap-3" data-messages>
      {!m.written && <p className="adm-callout-warn sc-t-footnote rounded-xl px-3 py-2">Standard wording: nothing was written for this prospect.</p>}
      {m.versions && pickForm ? (
        <fieldset className="flex flex-col gap-2" data-versions>
          <legend className="sc-t-caption adm-faint uppercase tracking-wide">First text, no link · pick one</legend>
          {(["a", "b"] as const).map((v) => (
            <label key={v} className="adm-card rounded-xl px-3 py-2.5 flex items-start gap-3 cursor-pointer">
              <input type="radio" name="pick" value={v} form={pickForm} defaultChecked={m.versions!.picked === v} className="mt-1 w-5 h-5 shrink-0" style={{ accentColor: "var(--sc-tint)" }} />
              <span className="sc-t-subhead min-w-0" style={{ overflowWrap: "anywhere" }}>
                <span className="sc-t-caption adm-muted block">Version {v.toUpperCase()} · {m.versions![v].length} characters</span>
                {m.versions![v]}
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <Words label="First text, no link" extra={`${m.versions ? `version ${m.versions.picked.toUpperCase()} · ` : ""}${m.ask.length} characters`}>{m.ask}</Words>
      )}
      <Words label="Text with the link" extra={`${m.text.length} characters`}>{m.text}</Words>
      <details>
        <summary className="adm-link sc-t-footnote cursor-pointer">Email, call opener, voicemail and nudges</summary>
        <div className="flex flex-col gap-3 mt-3">
          <Words label="Email" extra={m.email.subject}>{m.email.body}</Words>
          {opener && <Words label="Call opener">{opener}</Words>}
          <Words label="Voicemail">{m.voicemail}</Words>
          <Words label="Nudge: no view after 2 days">{m.nudge_no_view}</Words>
          <Words label="Nudge: viewed, didn't pick up">{m.nudge_viewed}</Words>
          {m.linkedin?.note && <Words label="LinkedIn connection note" extra={`${m.linkedin.note.length} characters`}>{m.linkedin.note}</Words>}
          {m.linkedin?.dm && <Words label="LinkedIn message after they accept">{m.linkedin.dm}</Words>}
        </div>
      </details>
    </div>
  );
}

function Prospect({ r, appUrl, sender, mode, highlight, connections }: { r: PreviewListRow; appUrl: string; sender: string | null; mode: "waiting" | "send"; highlight: boolean; connections: Connection[] }) {
  const warm = warmPathFor(r, connections);
  const formId = `ap-${r.id}`;
  const q = assessQuality(r);
  const m = resolveOutreach(r, { link: `${appUrl}/p/${r.slug}`, sender });
  const post = `/api/admin/card-builder/${r.id}`;
  const back = "/admin/card-builder/approve";
  const first = firstName(r.owner_name);
  const link = `${appUrl}/p/${r.slug}`;
  return (
    <li id={`p-${r.id}`} className="adm-card px-4 py-4 flex flex-col gap-4 scroll-mt-4" data-approve-card={mode} {...(highlight ? { "data-just-now": "" } : {})}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="sc-t-headline min-w-0" style={{ overflowWrap: "anywhere" }}>{r.owner_name}</h2>
          <StatusBadge tone={q.tooGeneric ? "bad" : "good"}>{q.score} of 100</StatusBadge>
          {q.tooGeneric && <StatusBadge tone="bad">{r.quality_override ? "Too generic, overridden" : "Too generic"}</StatusBadge>}
          {mode === "send" && <StatusBadge tone="good">Published</StatusBadge>}
        </div>
        <p className="sc-t-subhead adm-muted" style={{ overflowWrap: "anywhere" }}>{[r.owner_title, r.office_name].filter(Boolean).join(" · ")}</p>
        {warm && (
          <p className="adm-callout-good sc-t-footnote rounded-xl px-3 py-2 mt-2" data-warm>
            <span className="font-semibold">Warm path: {WARM_LABELS[warm.kind].toLowerCase()}.</span> {warm.text}
            {warm.source_url ? <> · <a className="adm-link" href={warm.source_url} target="_blank" rel="noopener noreferrer">source</a></> : null}
          </p>
        )}
      </div>

      {mode === "send" && openerText(r.openers) && (
        <div className="flex flex-col gap-2" data-send-opener>
          <div className="grid grid-cols-2 gap-2">
            <OneTapSend id={r.id} kind="opener" href={smsHref(r.phone, openerMessage(openerText(r.openers)!, link))} className="sc-btn sc-btn-filled sc-btn-block">Send from my phone</OneTapSend>
            <CopyText text={openerMessage(openerText(r.openers)!, link)} />
          </div>
          {r.phone_kind !== "office" && !r.not_imessage_at && (
            <form method="post" action={post}>
              <input type="hidden" name="action" value="queue" />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="sc-btn sc-btn-gray sc-btn-block" data-queue>Queue for my Mac to send</button>
            </form>
          )}
        </div>
      )}
      {mode === "send" && (
        <details open={!openerText(r.openers)} data-send-other>
        <summary className="adm-link sc-t-footnote cursor-pointer">{openerText(r.openers) ? "Other ways to send: two texts, email, LinkedIn" : "Send"}</summary>
        <div className="flex flex-col gap-2 mt-2" data-send-now>
          <OneTapSend id={r.id} kind="ask" href={smsHref(r.phone, m.ask)} className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block">Text {first}: open Messages</OneTapSend>
          <div className="grid grid-cols-2 gap-2">
            <OneTapSend id={r.id} kind="text" href={smsHref(r.phone, m.text)} className="sc-btn sc-btn-gray sc-btn-block">Text the link</OneTapSend>
            {r.email
              ? <OneTapSend id={r.id} kind="email" href={mailtoHref(r.email, m.email.subject, m.email.body)} className="sc-btn sc-btn-gray sc-btn-block">Open Mail</OneTapSend>
              : <Link href={`/admin/card-builder/send/${r.id}`} className="sc-btn sc-btn-gray sc-btn-block">Send screen</Link>}
          </div>
          {m.linkedin?.note && r.linkedin_url && (
            <div className="grid grid-cols-2 gap-2" data-linkedin-row>
              <LinkedInButton id={r.id} kind="linkedin_note" words={m.linkedin.note} profile={r.linkedin_url} className="sc-btn sc-btn-gray sc-btn-block">LinkedIn</LinkedInButton>
              {r.linkedin_sent_at && !r.linkedin_accepted_at ? (
                <form method="post" action={post}>
                  <input type="hidden" name="action" value="linkedin_accepted" />
                  <input type="hidden" name="back" value={back} />
                  <button type="submit" className="sc-btn sc-btn-gray sc-btn-block" data-accepted>They accepted</button>
                </form>
              ) : <span className="sc-t-caption adm-muted self-center">{r.linkedin_accepted_at ? "Accepted. Their message is under Call and follow up." : "Copies the note and opens their profile."}</span>}
            </div>
          )}
          {m.versions && (
            <form method="post" action={post}>
              <input type="hidden" name="action" value="pick" />
              <input type="hidden" name="pick" value={m.versions.picked === "a" ? "b" : "a"} />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="adm-link sc-t-footnote" data-switch-version>Use version {m.versions.picked === "a" ? "B" : "A"} of the first text instead</button>
            </form>
          )}
          <p className="sc-t-caption adm-muted">Opens your own Messages or Mail with the words filled in, and marks it sent here. You press send there. To change the wording first, use the <Link className="adm-link" href={`/admin/card-builder/send/${r.id}`}>Send screen</Link>.</p>
        </div>
        </details>
      )}

      <Thumb r={r} />
      <Facts r={r} q={q} />
      <Opener r={r} link={link} />
      <AllWords m={m} opener={r.outreach?.call_opener || null} pickForm={mode === "waiting" && q.mayPublish ? formId : undefined} />

      {mode === "waiting" && (
        <div className="flex flex-col gap-2" data-decide>
          {q.mayPublish ? (
            <form method="post" action={post} id={formId}>
              <input type="hidden" name="action" value="approve" />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block" data-approve>Approve and publish</button>
            </form>
          ) : null}
          {q.mayPublish && openerText(r.openers) && r.phone_kind !== "office" && !r.not_imessage_at ? (
            <form method="post" action={post}>
              <input type="hidden" name="action" value="approve" />
              <input type="hidden" name="queue" value="1" />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="sc-btn sc-btn-gray sc-btn-block" data-approve-queue>Approve and queue the text</button>
            </form>
          ) : null}
          {q.mayPublish ? null : (
            <p className="adm-callout-danger sc-t-footnote rounded-xl px-3 py-2" data-held>
              <span className="font-semibold">Can&apos;t be approved yet.</span> {q.blockers.length === 1 ? "One thing is" : `${q.blockers.length} things are`} missing. Edit shows what, and has the override.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/admin/card-builder/edit/${r.id}`} className="sc-btn sc-btn-gray sc-btn-block" data-edit>Edit</Link>
            <form method="post" action={post}>
              <input type="hidden" name="action" value="skip" />
              <input type="hidden" name="on" value="1" />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="sc-btn sc-btn-gray sc-btn-block" data-skip>Skip</button>
            </form>
          </div>
          {q.mayPublish && <p className="sc-t-caption adm-muted">Approving opens their link for 14 days. It sends nothing.</p>}
        </div>
      )}
    </li>
  );
}

const TALLY_TEXT: Record<string, string> = { ...QUEUE_RESULT_TEXT, too_generic: "Too generic to publish" };
/** "queued:12,not_mobile:2" → "12 queued for your Mac. Not queued: 2, their number isn't a mobile…" */
export function tallyText(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split(",").map((p) => p.split(":")).filter(([k, n]) => k && Number(n) > 0).map(([k, n]) => [k, Number(n)] as const);
  if (!parts.length) return "Nothing was waiting that could be approved.";
  const queued = parts.find(([k]) => k === "queued")?.[1] ?? 0;
  const rest = parts.filter(([k]) => k !== "queued").map(([k, n]) => `${n}: ${(TALLY_TEXT[k as QueueResult] ?? k).replace(/\.$/, "").toLowerCase()}`);
  return [`${queued} published and queued for your Mac.`, rest.length ? `Left as they were: ${rest.join("; ")}.` : ""].filter(Boolean).join(" ");
}

export default function ApproveView({ list, appUrl, now, sender, done, error, about, connections = [], tally = null, failed = [] }: {
  list: PreviewList;
  appUrl: string;
  /** The time the page was made (server), so the view stays pure. */
  now: number;
  sender: string | null;
  done: string | null;
  error: string | null;
  /** The preview the last button was about. */
  about: string | null;
  /** The owner's own LinkedIn connections, for warm paths. */
  connections?: Connection[];
  /** After "Approve all": what happened to each draft, counted. */
  tally?: string | null;
  /** Prospects the server's batch run gave up on after its retries, with why. */
  failed?: FailedJob[];
}) {
  const outcome = done === "all" ? { ok: true, text: tallyText(tally) ?? "Done." } : done ? DONE[done] ?? null : null;
  const queue = list.ready ? approvalQueue(list.rows, now) : null;
  return (
    <Stack className="max-w-xl mx-auto w-full">
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader title="Approve" description="Each draft, ready to read, with the opening text it gets. Approve it, then send the text from your phone or queue it for your Mac. Nothing is sent until you say so." />

      {outcome && <p className={`${outcome.ok ? "adm-callout-good" : "adm-callout-danger"} sc-t-subhead rounded-xl px-4 py-3`} role={outcome.ok ? "status" : "alert"}>{outcome.text}</p>}
      {error && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">{error}</p>}

      {!queue ? (
        <EmptyState>The previews couldn&apos;t be loaded just now. Refresh in a minute.</EmptyState>
      ) : (
        <>
          {queue.send.length > 0 && (
            <section aria-labelledby="ap-send" className="flex flex-col gap-3">
              <h2 id="ap-send" className="sc-t-headline">Approved: send the first text ({queue.send.length})</h2>
              <ul className="flex flex-col gap-4">
                {queue.send.map((r) => <Prospect key={r.id} r={r} appUrl={appUrl} sender={sender} mode="send" highlight={about === r.id} connections={connections} />)}
              </ul>
            </section>
          )}

          <section aria-labelledby="ap-wait" className="flex flex-col gap-3">
            <h2 id="ap-wait" className="sc-t-headline">Waiting for you ({queue.waiting.length})</h2>
            {(() => {
              const ready = queue.waiting.filter((r) => assessQuality(r).mayPublish && openerText(r.openers)).length;
              return ready > 1 ? (
                <details className="adm-card rounded-xl px-3 py-2.5" data-approve-all>
                  <summary className="sc-t-subhead font-semibold cursor-pointer">Approve all {ready}</summary>
                  <p className="sc-t-footnote adm-muted mt-2">Publishes every draft below that passes the check and has an opening text, and schedules each text for 9 AM in the prospect&apos;s time zone. Your Mac then sends them from your number in your sending hours, a few minutes apart, up to your daily cap. Office lines and numbers not on iMessage are left for you.</p>
                  <form method="post" action="/api/admin/card-builder/approve-all" className="mt-2">
                    <button type="submit" className="sc-btn sc-btn-filled sc-btn-block">Yes, approve and queue all {ready}</button>
                  </form>
                </details>
              ) : null;
            })()}
            {queue.waiting.length === 0 ? (
              <EmptyState>No drafts to approve. Run /build-card or /build-batch to line some up.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-4">
                {queue.waiting.map((r) => <Prospect key={r.id} r={r} appUrl={appUrl} sender={sender} mode="waiting" highlight={about === r.id} connections={connections} />)}
              </ul>
            )}
          </section>

          {failed.length > 0 && (
            <Section title={`Couldn't be built (${failed.length})`} hint="The batch run tried each of these four times. The reason is below; Try again runs it once more." flush>
              <ul className="adm-divide">
                {failed.map((j) => (
                  <li key={j.id} className="px-4 sm:px-5 py-3 flex flex-col gap-1.5" data-failed-job>
                    <p className="sc-t-subhead min-w-0" style={{ overflowWrap: "anywhere" }}><span className="font-semibold">{j.input ?? "Finding offices"}</span>{j.batch_label ? <span className="adm-muted"> · {j.batch_label}</span> : null}</p>
                    <p className="sc-t-footnote adm-muted" style={{ overflowWrap: "anywhere" }}>{j.last_error ?? "No reason was recorded."}</p>
                    <form method="post" action="/api/admin/card-builder/jobs">
                      <input type="hidden" name="action" value="retry" />
                      <input type="hidden" name="id" value={j.id} />
                      <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Try again</button>
                    </form>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {queue.skipped.length > 0 && (
            <Section title={`Skipped (${queue.skipped.length})`} hint="Still drafts. Nobody outside SwiftCard can open them." flush>
              <ul className="adm-divide">
                {queue.skipped.map((r) => (
                  <li key={r.id} className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3" data-skipped>
                    <p className="sc-t-subhead min-w-0" style={{ overflowWrap: "anywhere" }}><span className="font-semibold">{r.owner_name}</span><span className="adm-muted"> · {r.office_name}</span></p>
                    <form method="post" action={`/api/admin/card-builder/${r.id}`} className="shrink-0">
                      <input type="hidden" name="action" value="skip" />
                      <input type="hidden" name="on" value="0" />
                      <input type="hidden" name="back" value="/admin/card-builder/approve" />
                      <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Put back</button>
                    </form>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </Stack>
  );
}
