import Link from "next/link";
import { BackLink } from "../../../_ui/links";
import { PageHeader, Section, Stack } from "../../../_ui/layout";
import { StatusBadge } from "../../../_ui/badges";
import { fmtDateTime } from "../../../_ui/format";
import type { Messages } from "@/lib/prospect-preview/messages";
import { STAGE_LABELS, stageOf } from "@/lib/prospect-preview/pipeline";
import { previewState } from "@/lib/prospect-preview/real-view";
import type { PreviewListRow } from "@/lib/prospect-preview/types";
import SendMessage from "./SendMessage";

// ── Card Builder: the Send screen (server component, no data loading) ───────
// The messages for this prospect (written for them at build time, or the
// templates when none were: lib/prospect-preview/outreach.ts), each with a button
// that opens the founder's OWN Messages or Mail app. SwiftCard sends nothing.
// page.tsx loads the preview and writes the messages; this draws them, so
// tests/render can measure the real markup.

const DONE: Record<string, string> = { sent: "Marked as sent.", unsent: "Cleared. It shows as not sent again." };

export default function SendView({ p, messages, now, senderKnown, done, error }: {
  p: PreviewListRow;
  messages: Messages;
  now: number;
  /** We know the founder's name (their own SwiftCard profile has one). */
  senderKnown: boolean;
  done: string | null;
  error: string | null;
}) {
  const here = `/admin/card-builder/send/${p.id}`;
  const post = `/api/admin/card-builder/${p.id}`;
  const live = previewState(p, now) === "live";
  const noLink = p.status === "draft"
    ? "This one has the link in it, and a draft's link doesn't open. Publish the preview first."
    : "This one has the link in it, and the link doesn't open right now. Publish the preview again first.";

  return (
    <Stack>
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader
        title={`Send to ${p.owner_name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {[p.owner_title, p.office_name].filter(Boolean).join(" · ")}
            <StatusBadge tone="tint">{STAGE_LABELS[stageOf(p)]}</StatusBadge>
          </span>
        }
      />

      {done && DONE[done] && <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" role="status">{DONE[done]}</p>}
      {(error || done === "failed") && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">{error ?? "That didn't work. Try again in a minute."}</p>}

      <p className="adm-callout-warn sc-t-footnote rounded-xl px-4 py-3">
        These go from your own phone number and your own inbox. Each button opens your Messages or Mail app with the words filled in; you press send there. Change any wording here first.
        {!senderKnown && !messages.written && " Your SwiftCard profile has no name, so the messages say “the founder of SwiftCard”: add your name before sending."}
      </p>
      {messages.written
        ? <p className="adm-callout-good sc-t-footnote rounded-xl px-4 py-3" data-written>Written for {p.office_name} when the card was built. To change the saved wording, use Messages on the <Link className="adm-link" href={`/admin/card-builder/edit/${p.id}#pp-messages`}>edit screen</Link>.</p>
        : <p className="adm-callout-warn sc-t-footnote rounded-xl px-4 py-3" data-templates>Nothing was written for this prospect, so these are the standard wording. Run /build-card on them to have each one written for {p.office_name}.</p>}
      {!messages.specific && (
        <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" data-generic-messages>
          <span className="font-semibold">These could go to any office.</span> This preview has no hook, so the messages say nothing true about {p.office_name} in particular. <Link className="adm-link" href={`/admin/card-builder/edit/${p.id}`}>Add the hook</Link> before you send, or rewrite them here.
        </p>
      )}
      {!live && (
        <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" data-not-live>
          {p.status === "draft" ? "This preview is still a draft." : "This preview's link doesn't open right now."} The first text can go; the two with the link can&apos;t until it is published. <Link className="adm-link" href={`/admin/card-builder/edit/${p.id}`}>Open the edit screen</Link>
        </p>
      )}

      <Section title="1. First text, no link" hint={`To ${p.phone}. Asks if they want it. ${p.asked_at ? `Sent ${fmtDateTime(p.asked_at)}.` : "Not sent yet."}`}>
        <SendMessage id={p.id} kind="ask" to={p.phone} body={messages.ask} button="Open Messages" blocked={null} />
      </Section>

      <Section title="2. Text with the link" hint={`To ${p.phone}. ${p.sent_at && p.sent_channel === "text" ? `Sent ${fmtDateTime(p.sent_at)}.` : "Not sent yet."}`}>
        <SendMessage id={p.id} kind="text" to={p.phone} body={messages.text} button="Open Messages" blocked={live ? null : noLink} />
      </Section>

      <Section title="3. Email with the link" hint={p.email ? `To ${p.email}. ${p.sent_at && p.sent_channel === "email" ? `Sent ${fmtDateTime(p.sent_at)}.` : "Not sent yet."}` : "No email address on this preview."}>
        <SendMessage id={p.id} kind="email" to={p.email ?? ""} subject={messages.email.subject} body={messages.email.body} button="Open Mail"
          blocked={!p.email ? "Add their email on the edit screen to send this one." : live ? null : noLink} />
      </Section>

      <Section title="4. Nudge: link not opened" hint={`To ${p.phone}. For a link that went out two days ago and hasn't been opened. ${p.nudge_no_view_at ? `Sent ${fmtDateTime(p.nudge_no_view_at)}.` : "Not sent yet."}`}>
        <SendMessage id={p.id} kind="nudge_no_view" to={p.phone} body={messages.nudge_no_view} button="Open Messages" blocked={live ? null : noLink} />
      </Section>

      <Section title="5. Nudge: looked, didn't pick up" hint={`To ${p.phone}. For after you called and got no answer. ${p.nudge_viewed_at ? `Sent ${fmtDateTime(p.nudge_viewed_at)}.` : "Not sent yet."}`}>
        <SendMessage id={p.id} kind="nudge_viewed" to={p.phone} body={messages.nudge_viewed} button="Open Messages" blocked={live ? null : "This one is for after they have looked at their card. Publish the preview first."} />
      </Section>

      <Section title="Sent it another way?" hint="If you sent a message without these buttons, or pressed one and didn't send, set it straight here.">
        <div className="flex flex-wrap gap-2">
          {(["ask", "text", "email"] as const).map((kind) => (
            <form key={kind} method="post" action={post}>
              <input type="hidden" name="action" value="sent" />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="back" value={here} />
              <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray" disabled={kind !== "ask" && !live}>
                {kind === "ask" ? "Mark first text sent" : kind === "text" ? "Mark link sent by text" : "Mark link sent by email"}
              </button>
            </form>
          ))}
          {(p.asked_at || p.sent_at) && (
            <form method="post" action={post}>
              <input type="hidden" name="action" value="unsent" />
              <input type="hidden" name="back" value={here} />
              <button type="submit" className="sc-btn sc-btn-sm sc-btn-plain adm-bad">Nothing was sent</button>
            </form>
          )}
        </div>
      </Section>
    </Stack>
  );
}
