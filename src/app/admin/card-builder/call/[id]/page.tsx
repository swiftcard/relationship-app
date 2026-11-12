import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { telHref, UUID_RE } from "@/lib/prospect-preview/input";
import { previewState } from "@/lib/prospect-preview/real-view";
import { getPreviewById } from "@/lib/prospect-preview/store";
import { BackLink } from "../../../_ui/links";
import { Section, Stack } from "../../../_ui/layout";
import { Icon } from "../../../_ui/icons";
import { fmtDateTime, timeAgo } from "../../../_ui/format";
import CalledBox from "../../CalledBox";

export const metadata = { title: "Call — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── The Call screen ─────────────────────────────────────────────────────────
// Where the "[Owner] is viewing their card" alert lands. A notification can't
// open the dialer itself: the iOS and Android apps only follow swiftcard.me
// links from a notification, and every tap is meant to land in the app. So it
// lands here, and this page is one big Call button.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default async function CallScreen({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await requireAdmin())) notFound();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const p = await getPreviewById(id);
  if (!p) notFound();

  const now = new Date().getTime();
  const live = previewState(p, now) === "live";
  const here = `/admin/card-builder/call/${p.id}`;
  return (
    <Stack>
      <BackLink href="/admin/card-builder">Card Builder</BackLink>

      {sp.done === "saved" && <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" role="status">Saved.</p>}
      {sp.done === "failed" && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">That didn&apos;t save. Try again in a minute.</p>}

      <Section>
        <div className="flex flex-col items-center text-center gap-1 py-2">
          <p className="sc-t-footnote adm-muted">{p.last_viewed_at ? `Looked at their card ${timeAgo(p.last_viewed_at, now)}` : "Hasn't opened their card yet"}</p>
          <h1 className="sc-t-title1">{p.owner_name}</h1>
          <p className="sc-t-subhead adm-muted">{[p.owner_title, p.office_name].filter(Boolean).join(" · ")}</p>
          <a href={telHref(p.phone)} data-call className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block mt-5 max-w-md">
            <Icon name="phone" className="w-5 h-5" />Call {p.phone}
          </a>
          {p.email && <a href={`mailto:${p.email}`} className="adm-link sc-t-subhead mt-3 break-all">{p.email}</a>}
        </div>
      </Section>

      <Section title="After the call">
        <form method="post" action={`/api/admin/card-builder/${p.id}`} className="flex flex-col gap-3">
          <input type="hidden" name="action" value="call" />
          <input type="hidden" name="back" value={here} />
          <CalledBox called={p.called} who={p.owner_name} />
          <textarea name="notes" defaultValue={p.notes ?? ""} maxLength={2000} rows={3} placeholder="Notes from the call" aria-label={`Notes about ${p.owner_name}`} className="sc-field w-full px-3 py-2" />
          <div><button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Save</button></div>
        </form>
      </Section>

      <Section title="Their preview">
        <dl className="sc-t-subhead space-y-1.5">
          <div className="flex gap-3"><dt className="adm-faint w-28 shrink-0">Real views</dt><dd>{p.views}{p.devices > 1 ? ` (from ${p.devices} devices)` : ""}</dd></div>
          <div className="flex gap-3"><dt className="adm-faint w-28 shrink-0">Last viewed</dt><dd>{p.last_viewed_at ? fmtDateTime(p.last_viewed_at) : "Not yet"}</dd></div>
          <div className="flex gap-3"><dt className="adm-faint w-28 shrink-0">Team strip</dt><dd>{p.team_strip_scrolled ? "Looked through the team" : "Not scrolled"}</dd></div>
          <div className="flex gap-3"><dt className="adm-faint w-28 shrink-0">Link</dt><dd className="min-w-0 break-all">{live ? <a className="adm-link" href={`${APP_URL}/p/${p.slug}`} target="_blank" rel="noopener noreferrer">{`${APP_URL}/p/${p.slug}`}</a> : "No longer opens (expired or paused)"}</dd></div>
        </dl>
      </Section>
    </Stack>
  );
}
