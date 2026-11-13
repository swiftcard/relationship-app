import Link from "next/link";
import { BackLink } from "../../_ui/links";
import { PageHeader, Section, Stack } from "../../_ui/layout";
import { EmptyState } from "../../_ui/states";
import { Icon } from "../../_ui/icons";
import { telHref } from "@/lib/prospect-preview/input";
import { smsHref } from "@/lib/prospect-preview/messages";
import { resolveOutreach } from "@/lib/prospect-preview/outreach";
import { followUps } from "@/lib/prospect-preview/pipeline";
import type { PreviewList } from "@/lib/prospect-preview/store";
import type { PreviewListRow } from "@/lib/prospect-preview/types";
import LinkedInButton from "../LinkedInButton";
import OneTapSend from "../OneTapSend";

// ── Card Builder: Call and follow up (server component, no data loading) ────
// Who needs something from the owner today, most urgent first, each with the
// words already written (for that prospect when /build-card wrote them, the
// standard wording otherwise) and ONE tap: Call, or open their own Messages,
// or copy the LinkedIn message and open the profile. Nothing is sent for them.
// page.tsx loads the list; this draws it, so tests/render can measure it.

const SCREEN_LABEL = { call: "Call screen", send: "All messages", edit: "Edit" } as const;
const SEND_LABEL = { ask: "Send first text", text: "Text the link", nudge_no_view: "Send nudge", nudge_viewed: "Text them" } as const;

function FollowUps({ rows, now, linkOf, sender }: { rows: PreviewListRow[]; now: number; linkOf: (slug: string) => string; sender: string | null }) {
  const list = followUps(rows, now);
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!list.length) return <EmptyState>Nobody to chase today.</EmptyState>;
  return (
    <ul className="adm-divide">
      {list.map((f) => {
        const r = byId.get(f.id)!;
        const m = f.send || f.voicemail ? resolveOutreach(r, { link: linkOf(r.slug), sender }) : null;
        const words = !m || !f.send ? null : f.send === "ask" ? m.ask : f.send === "text" ? m.text : f.send === "linkedin_dm" ? m.linkedin?.dm || null : m[f.send];
        return (
          <li key={`${f.id}-${f.kind}`} className="px-4 sm:px-5 py-4 flex flex-col gap-3" data-follow-up={f.kind}>
            <p className="sc-t-subhead min-w-0">
              <span className="font-semibold">{r.owner_name}</span><span className="adm-muted"> · {r.office_name}</span>
              <span className="block adm-muted">{f.why} {f.next}</span>
            </p>
            {f.send && words && <p className="sc-t-footnote adm-muted whitespace-pre-line" style={{ overflowWrap: "anywhere" }} data-follow-words={f.send}>{words}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {f.send === "linkedin_dm" && words && r.linkedin_url && <LinkedInButton id={r.id} kind="linkedin_dm" words={words} profile={r.linkedin_url} className="sc-btn sc-btn-filled">Copy and open LinkedIn</LinkedInButton>}
              {f.send && f.send !== "linkedin_dm" && words && <OneTapSend id={r.id} kind={f.send} href={smsHref(r.phone, words)} className="sc-btn sc-btn-filled">{SEND_LABEL[f.send]}</OneTapSend>}
              {f.voicemail && <a href={telHref(r.phone)} className="sc-btn sc-btn-filled" data-follow-call><Icon name="phone" className="w-4 h-4" />Call {r.owner_name.split(/\s+/)[0]}</a>}
              <Link href={`/admin/card-builder/${f.screen}/${r.id}`} className="sc-btn sc-btn-gray">{SCREEN_LABEL[f.screen]}</Link>
            </div>
            {f.voicemail && m && (
              <details>
                <summary className="adm-link sc-t-footnote cursor-pointer">Voicemail script</summary>
                <p className="sc-t-footnote adm-muted mt-1" style={{ overflowWrap: "anywhere" }} data-follow-voicemail>{m.voicemail}</p>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function FollowUpView({ list, appUrl, now, sender }: { list: PreviewList; appUrl: string; now: number; sender: string | null }) {
  const linkOf = (slug: string) => `${appUrl}/p/${slug}`;
  return (
    <Stack className="max-w-xl mx-auto w-full">
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader title="Call and follow up" description="Most urgent first. Each one has its words ready: one tap calls, or opens your own Messages or LinkedIn." />
      <Section title="Today" hint="Viewed but not reached comes first. Then accepted LinkedIn requests, links sent two days ago and not opened, first texts with no reply, and calls with no outcome." flush id="follow-ups">
        {list.ready ? <FollowUps rows={list.rows} now={now} linkOf={linkOf} sender={sender} /> : <EmptyState>The list couldn&apos;t be loaded just now. Refresh in a minute.</EmptyState>}
      </Section>
    </Stack>
  );
}
