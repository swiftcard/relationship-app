import Link from "next/link";
import { BackLink } from "../../_ui/links";
import { PageHeader, Section, Stack } from "../../_ui/layout";
import { EmptyState } from "../../_ui/states";
import { StatusBadge } from "../../_ui/badges";
import { fmtDateTime, timeAgo } from "../../_ui/format";
import { GV_LIMIT_NOTE, googleVoiceHref, googleVoiceQueue, googleVoiceSent, NUMBER_BLOCK_TEXT, type NumberBlock, type SendWith } from "@/lib/prospect-preview/google-voice";
import { openerMessage, openerText } from "@/lib/prospect-preview/opener";
import type { PreviewList } from "@/lib/prospect-preview/store";
import type { PreviewListRow } from "@/lib/prospect-preview/types";
import GoogleVoiceButton from "../GoogleVoiceButton";
import CopyText from "../CopyText";

// ── Card Builder: Send from Google Voice (server component, no data loading) ─
// Owner, 2026-11-17: Google Voice as a second way to send openers, sent by
// hand, one tap each, the way the LinkedIn button works. The prospects here
// were approved in a Google Voice batch (or switched to it one by one, or
// their number isn't on iMessage); none of them is ever in the Mac's outbox.
// SwiftCard never drives Google Voice: each tap copies the words and opens
// Google Voice on the number, and the owner presses send there.
//
// Below the list: what went from Google Voice lately, each with "They said
// stop", because the Mac can't see replies that come to Google Voice.
// page.tsx loads the list; this draws it, so tests/render can measure it.

const DONE: Record<string, { ok: boolean; text: string }> = {
  stopped: { ok: true, text: "On the do-not-contact list. Nothing more goes to that number, and anything queued for it was taken back." },
  send_imessage: { ok: true, text: "That one goes by iMessage now: it's back on the Approve screen, where you can queue it for your Mac." },
  sent: { ok: true, text: "Marked as sent." },
  failed: { ok: false, text: "That didn't work. Try again in a minute." },
};

const BACK = "/admin/card-builder/google-voice";

function StopButton({ r }: { r: PreviewListRow }) {
  return (
    <form method="post" action={`/api/admin/card-builder/${r.id}`}>
      <input type="hidden" name="action" value="stop" />
      <input type="hidden" name="back" value={BACK} />
      <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray" data-said-stop>They said stop</button>
    </form>
  );
}

export default function GoogleVoiceView({ list, appUrl, now, done, error, ctx }: {
  list: PreviewList;
  appUrl: string;
  /** The time the page was made (server), so the view stays pure. */
  now: number;
  done: string | null;
  error: string | null;
  ctx: { batchSendWith: ReadonlyMap<string, SendWith>; blocks: ReadonlyMap<string, NumberBlock>; gvToday: number; gvCap: number };
}) {
  const outcome = done ? DONE[done] ?? null : null;
  const rows = list.ready ? list.rows : [];
  const toSend = googleVoiceQueue(rows, { batchSendWith: ctx.batchSendWith, blocks: ctx.blocks, now, hasOpener: (r) => !!openerText(r.openers) });
  const sent = googleVoiceSent(rows, now);
  const capped = ctx.gvToday >= ctx.gvCap;
  return (
    <Stack className="max-w-xl mx-auto w-full">
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader title="Send from Google Voice" description="Approved prospects whose opener goes from your Google Voice number. One tap copies the text with its link and opens Google Voice on their number: paste it and press send there." />

      {outcome && <p className={`${outcome.ok ? "adm-callout-good" : "adm-callout-danger"} sc-t-subhead rounded-xl px-4 py-3`} role="status">{outcome.text}</p>}
      {error && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">{error}</p>}

      <div className="grid grid-cols-2 gap-2" data-gv-counts>
        <div className="adm-card rounded-xl px-3 py-2.5 min-w-0">
          <p className="sc-t-headline tabular-nums truncate" data-gv-today>{ctx.gvToday} of {ctx.gvCap}</p>
          <p className="sc-t-caption adm-muted truncate">Sent from Google Voice today</p>
        </div>
        <div className="adm-card rounded-xl px-3 py-2.5 min-w-0">
          <p className="sc-t-headline tabular-nums truncate">{toSend.length}</p>
          <p className="sc-t-caption adm-muted truncate">Waiting to send</p>
        </div>
      </div>
      <p className={`${capped ? "adm-callout-warn" : "adm-card"} sc-t-footnote rounded-xl px-3 py-2`} data-gv-note>
        {capped ? "Today's cap is reached: the rest wait for tomorrow. " : ""}{GV_LIMIT_NOTE} <Link className="adm-link" href="/admin/card-builder/sender#gv-cap">Change the daily number</Link>
      </p>

      {!list.ready ? (
        <EmptyState>The list couldn&apos;t be loaded just now. Refresh in a minute.</EmptyState>
      ) : (
        <>
          <section aria-labelledby="gv-send" className="flex flex-col gap-3">
            <h2 id="gv-send" className="sc-t-headline">To send ({toSend.length})</h2>
            {toSend.length === 0 ? (
              <EmptyState>Nobody waiting. Prospects from a batch set to Google Voice land here once you approve them.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {toSend.map((r) => {
                  const words = openerMessage(openerText(r.openers)!, `${appUrl}/p/${r.slug}`);
                  return (
                    <li key={r.id} id={`gv-${r.id}`} className="adm-card px-4 py-4 flex flex-col gap-3" data-gv-row>
                      <div className="min-w-0">
                        <p className="sc-t-headline" style={{ overflowWrap: "anywhere" }}>{r.owner_name}</p>
                        <p className="sc-t-subhead adm-muted" style={{ overflowWrap: "anywhere" }}>{[r.office_name, r.phone].filter(Boolean).join(" · ")}</p>
                      </div>
                      <p className="sc-t-subhead whitespace-pre-line" style={{ overflowWrap: "anywhere" }} data-gv-words>{words}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <GoogleVoiceButton id={r.id} words={words} href={googleVoiceHref(r.phone)} disabled={capped} className="sc-btn sc-btn-filled sc-btn-block" />
                        <CopyText text={words} />
                      </div>
                      <form method="post" action={`/api/admin/card-builder/${r.id}`}>
                        <input type="hidden" name="action" value="send_with" />
                        <input type="hidden" name="value" value="imessage" />
                        <input type="hidden" name="back" value={BACK} />
                        <button type="submit" className="adm-link sc-t-footnote" data-switch-way="imessage">Send this one by iMessage (my Mac) instead</button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Section title={`Sent from Google Voice (${sent.length})`} hint="The last 14 days. Replies come to Google Voice, where your Mac can't see them: if someone says stop, tap They said stop so they're never texted again." flush>
            {sent.length === 0 ? <EmptyState>Nothing sent from Google Voice yet.</EmptyState> : (
              <ul className="adm-divide">
                {sent.map((r) => {
                  const block = ctx.blocks.get(r.id);
                  return (
                    <li key={r.id} className="px-4 sm:px-5 py-3 flex flex-col gap-1.5" data-gv-sent>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="sc-t-subhead font-semibold min-w-0" style={{ overflowWrap: "anywhere" }}>{r.owner_name}</p>
                        {r.views > 0 ? <StatusBadge tone="tint">Opened</StatusBadge> : null}
                        {block === "do_not_contact" ? <StatusBadge tone="bad">Do not contact</StatusBadge> : null}
                      </div>
                      <p className="sc-t-footnote adm-muted" style={{ overflowWrap: "anywhere" }}>{r.office_name} · {r.phone} · sent {timeAgo(r.sent_at!, now)} ({fmtDateTime(r.sent_at!)})</p>
                      <div className="flex flex-wrap items-center gap-2">
                        {block === "do_not_contact" ? <span className="sc-t-caption adm-muted">{NUMBER_BLOCK_TEXT.do_not_contact}</span> : <StopButton r={r} />}
                        <Link href={`/admin/card-builder/call/${r.id}`} className="sc-btn sc-btn-sm sc-btn-gray">Call screen</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </>
      )}
    </Stack>
  );
}
