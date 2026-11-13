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
import { SOURCE_FIELDS, SOURCE_LABELS, type PreviewListRow } from "@/lib/prospect-preview/types";
import OneTapSend from "../OneTapSend";

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
  skipped: { ok: true, text: "Skipped. It stays a draft, under Skipped at the bottom." },
  unskipped: { ok: true, text: "Back in the queue." },
  sent: { ok: true, text: "Marked as sent." },
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

function AllWords({ m, opener }: { m: Messages; opener: string | null }) {
  return (
    <div className="flex flex-col gap-3" data-messages>
      {!m.written && <p className="adm-callout-warn sc-t-footnote rounded-xl px-3 py-2">Standard wording: nothing was written for this prospect.</p>}
      <Words label="First text, no link" extra={`${m.ask.length} characters`}>{m.ask}</Words>
      <Words label="Text with the link" extra={`${m.text.length} characters`}>{m.text}</Words>
      <details>
        <summary className="adm-link sc-t-footnote cursor-pointer">Email, call opener, voicemail and nudges</summary>
        <div className="flex flex-col gap-3 mt-3">
          <Words label="Email" extra={m.email.subject}>{m.email.body}</Words>
          {opener && <Words label="Call opener">{opener}</Words>}
          <Words label="Voicemail">{m.voicemail}</Words>
          <Words label="Nudge: no view after 2 days">{m.nudge_no_view}</Words>
          <Words label="Nudge: viewed, didn't pick up">{m.nudge_viewed}</Words>
        </div>
      </details>
    </div>
  );
}

function Prospect({ r, appUrl, sender, mode, highlight }: { r: PreviewListRow; appUrl: string; sender: string | null; mode: "waiting" | "send"; highlight: boolean }) {
  const q = assessQuality(r);
  const m = resolveOutreach(r, { link: `${appUrl}/p/${r.slug}`, sender });
  const post = `/api/admin/card-builder/${r.id}`;
  const back = "/admin/card-builder/approve";
  const first = firstName(r.owner_name);
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
      </div>

      {mode === "send" && (
        <div className="flex flex-col gap-2" data-send-now>
          <OneTapSend id={r.id} kind="ask" href={smsHref(r.phone, m.ask)} className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block">Text {first}: open Messages</OneTapSend>
          <div className="grid grid-cols-2 gap-2">
            <OneTapSend id={r.id} kind="text" href={smsHref(r.phone, m.text)} className="sc-btn sc-btn-gray sc-btn-block">Text the link</OneTapSend>
            {r.email
              ? <OneTapSend id={r.id} kind="email" href={mailtoHref(r.email, m.email.subject, m.email.body)} className="sc-btn sc-btn-gray sc-btn-block">Open Mail</OneTapSend>
              : <Link href={`/admin/card-builder/send/${r.id}`} className="sc-btn sc-btn-gray sc-btn-block">Send screen</Link>}
          </div>
          <p className="sc-t-caption adm-muted">Opens your own Messages or Mail with the words filled in, and marks it sent here. You press send there. To change the wording first, use the <Link className="adm-link" href={`/admin/card-builder/send/${r.id}`}>Send screen</Link>.</p>
        </div>
      )}

      <Thumb r={r} />
      <Facts r={r} q={q} />
      <AllWords m={m} opener={r.outreach?.call_opener || null} />

      {mode === "waiting" && (
        <div className="flex flex-col gap-2" data-decide>
          {q.mayPublish ? (
            <form method="post" action={post}>
              <input type="hidden" name="action" value="approve" />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block" data-approve>Approve and publish</button>
            </form>
          ) : (
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

export default function ApproveView({ list, appUrl, now, sender, done, error, about }: {
  list: PreviewList;
  appUrl: string;
  /** The time the page was made (server), so the view stays pure. */
  now: number;
  sender: string | null;
  done: string | null;
  error: string | null;
  /** The preview the last button was about. */
  about: string | null;
}) {
  const outcome = done ? DONE[done] ?? null : null;
  const queue = list.ready ? approvalQueue(list.rows, now) : null;
  return (
    <Stack className="max-w-xl mx-auto w-full">
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader title="Approve" description="Each draft, ready to read. Approve it and the next tap opens your Messages with the first text. Nothing is ever sent for you." />

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
                {queue.send.map((r) => <Prospect key={r.id} r={r} appUrl={appUrl} sender={sender} mode="send" highlight={about === r.id} />)}
              </ul>
            </section>
          )}

          <section aria-labelledby="ap-wait" className="flex flex-col gap-3">
            <h2 id="ap-wait" className="sc-t-headline">Waiting for you ({queue.waiting.length})</h2>
            {queue.waiting.length === 0 ? (
              <EmptyState>No drafts to approve. Run /build-card or /build-batch to line some up.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-4">
                {queue.waiting.map((r) => <Prospect key={r.id} r={r} appUrl={appUrl} sender={sender} mode="waiting" highlight={about === r.id} />)}
              </ul>
            )}
          </section>

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
