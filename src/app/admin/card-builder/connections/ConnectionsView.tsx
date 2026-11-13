import { BackLink } from "../../_ui/links";
import { PageHeader, Section, Stack } from "../../_ui/layout";
import { fmtDateTime } from "../../_ui/format";
import type { UploadMeta } from "@/lib/prospect-preview/desk";
import type { OwnerBackground } from "@/lib/prospect-preview/warm";

// ── Card Builder: your LinkedIn connections (server component) ──────────────
// The owner uploads their own Connections.csv. Each prospect is then checked
// for someone the owner already knows at that office ("Warm path"), and the
// first text leads with it. Private and admin only: the rows live in a table
// no browser key can read, and the file itself is never kept. SwiftCard never
// signs in to LinkedIn or sends anything there.

const DONE: Record<string, string> = { background: "Saved.", cleared: "Your connections were removed." };
const input = "sc-field w-full px-3 py-2";

export default function ConnectionsView({ meta, background, done, error, n }: { meta: UploadMeta; background: OwnerBackground; done: string | null; error: string | null; n: string | null }) {
  const post = "/api/admin/card-builder/connections";
  return (
    <Stack className="max-w-xl mx-auto w-full">
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader title="Warm paths" description="Upload your LinkedIn connections, and every prospect is checked for someone you already know there." />

      {done === "uploaded" && <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" role="status">{n} connections saved. Prospects with someone you know now show a Warm path.</p>}
      {done && DONE[done] && <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" role="status">{DONE[done]}</p>}
      {error && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">{error}</p>}

      <Section title="Your connections" hint={meta.count ? `${meta.count} connections on file${meta.at ? `, uploaded ${fmtDateTime(meta.at)}` : ""}. A new upload replaces them.` : "None uploaded yet."}>
        <form method="post" action={post} encType="multipart/form-data" className="flex flex-col gap-3" data-upload-form>
          <input type="hidden" name="action" value="upload" />
          <input type="file" name="file" accept=".csv,text/csv" required aria-label="Connections.csv" className="sc-t-subhead" />
          <button type="submit" className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block">Upload Connections.csv</button>
        </form>
        <p className="sc-t-footnote adm-muted mt-3">On LinkedIn: Settings › Data privacy › Get a copy of your data › Connections. LinkedIn emails you a file called Connections.csv.</p>
        <p className="sc-t-footnote adm-muted mt-2">Private: only SwiftCard admins can see these, the file is read once and not kept, and nothing here signs in to LinkedIn.</p>
        {meta.count > 0 && (
          <details className="mt-3">
            <summary className="sc-btn sc-btn-sm sc-btn-plain adm-bad list-none cursor-pointer">Remove my connections</summary>
            <form method="post" action={post} className="mt-2">
              <input type="hidden" name="action" value="clear" />
              <button type="submit" className="sc-btn sc-btn-sm sc-btn-destructive">Yes, remove them all</button>
            </form>
          </details>
        )}
      </Section>

      <Section title="Your schools and past employers" hint="One per line. When a prospect's public bio shows the same one, it is flagged as a warm path. The export doesn't include these, so they come from you.">
        <form method="post" action={post} className="flex flex-col gap-3" data-background-form>
          <input type="hidden" name="action" value="background" />
          <label className="block"><span className="sc-field-label">Schools</span><textarea name="schools" rows={3} defaultValue={background.schools.join("\n")} className={input} /></label>
          <label className="block"><span className="sc-field-label">Past employers</span><textarea name="employers" rows={3} defaultValue={background.employers.join("\n")} className={input} /></label>
          <div><button type="submit" className="sc-btn sc-btn-gray">Save</button></div>
        </form>
      </Section>
    </Stack>
  );
}
