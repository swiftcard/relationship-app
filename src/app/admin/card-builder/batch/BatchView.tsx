import { BackLink } from "../../_ui/links";
import { PageHeader, Section, Stack } from "../../_ui/layout";
import { EmptyState } from "../../_ui/states";
import { StatusBadge } from "../../_ui/badges";
import { fmtDateTime, timeAgo } from "../../_ui/format";
import { MAX_BATCH } from "@/lib/prospect-preview/batch-input";
import type { Batch } from "@/lib/prospect-preview/learn";
import { macIsOn, type MacStatus } from "@/lib/prospect-preview/outbox";

// ── Card Builder: New batch (server component, no data loading) ─────────────
// Owner, 2026-11-16: "enter a target or a CSV and a count (up to 100), then
// run now or run overnight". The Mac agent picks the batch up and runs
// /build-batch on it ten at a time; drafts land in Approve as each is done.
// Prospects with no mobile number or nothing specific to say are flagged in
// the batch's list, never padded.

const DONE: Record<string, string> = {
  now: "Batch requested. Your Mac starts it within a minute, and drafts appear in Approve as each one is finished.",
  tonight: "Batch requested for tonight. Your Mac starts it at 11pm; you get one push when the drafts are ready.",
  canceled: "Batch taken back.",
};

const input = "sc-field w-full px-3 py-2";

function statusOf(b: Batch, now: number): { tone: "good" | "warn" | "neutral" | "tint"; text: string } {
  if (b.status === "finished") return { tone: "good", text: "Finished" };
  if (b.status === "running") return { tone: "tint", text: "Running" };
  return b.run_after && Date.parse(b.run_after) > now ? { tone: "neutral", text: `Starts ${fmtDateTime(b.run_after)}` } : { tone: "warn", text: "Waiting for your Mac" };
}

/** "no mobile number (3), nothing specific to say (2)". */
function flags(b: Batch): string[] {
  const out = new Map<string, number>();
  for (const i of b.items) if (i.outcome !== "built" && i.reason) out.set(i.reason, (out.get(i.reason) ?? 0) + 1);
  return [...out.entries()].sort((a, c) => c[1] - a[1]).map(([r, n]) => `${r} (${n})`);
}

export default function BatchView({ batches, mac, now, done, error }: { batches: Batch[]; mac: MacStatus; now: number; done: string | null; error: string | null }) {
  const on = macIsOn(mac, now);
  return (
    <Stack className="max-w-xl mx-auto w-full">
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader title="New batch" description={`Up to ${MAX_BATCH} prospects at a time: each gets a card, three to five checked facts and an opening text, waiting for you in Approve. Nothing is sent until you approve it.`} />

      {done && DONE[done] && <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" role="status">{DONE[done]}</p>}
      {error && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">{error}</p>}
      <p className={`${on ? "adm-callout-good" : "adm-callout-warn"} sc-t-footnote rounded-xl px-3 py-2`} data-mac>
        {on ? <>Your Mac is on{mac.note ? `: ${mac.note}` : "."}</> : <>Your Mac hasn&apos;t checked in{mac.at ? ` since ${timeAgo(mac.at, now)}` : " yet"}. Batches wait until it does: open it, or see the setup steps in the Card Builder Mac guide.</>}
      </p>

      <Section title="Who to find">
        <form method="post" action="/api/admin/card-builder/batches" encType="multipart/form-data" className="flex flex-col gap-4" data-new-batch>
          <input type="hidden" name="action" value="new" />
          <label className="block min-w-0">
            <span className="sc-field-label">Target</span>
            <input name="target" maxLength={200} className={input} placeholder="realtors in Great Neck" />
            <span className="sc-t-caption adm-muted block mt-1">Who and where: &ldquo;mortgage teams in Manhattan&rdquo;, &ldquo;brokerages in Park Slope&rdquo;. The cards go to whoever runs each team or office.</span>
          </label>
          <label className="block min-w-0">
            <span className="sc-field-label">Or a CSV</span>
            <input type="file" name="csv" accept=".csv,text/csv" className="sc-t-subhead block w-full" />
            <span className="sc-t-caption adm-muted block mt-1">One prospect per row: name, company, city, phone, email, link. With a file, the count is its rows.</span>
          </label>
          <label className="block min-w-0 max-w-[10rem]">
            <span className="sc-field-label">How many</span>
            <input name="count" type="number" inputMode="numeric" min={1} max={MAX_BATCH} defaultValue={25} className={input} />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="sc-field-label">When</legend>
            <label className="flex items-center gap-3 sc-t-subhead"><input type="radio" name="when" value="now" defaultChecked className="w-5 h-5" style={{ accentColor: "var(--sc-tint)" }} />Run now</label>
            <label className="flex items-center gap-3 sc-t-subhead"><input type="radio" name="when" value="tonight" className="w-5 h-5" style={{ accentColor: "var(--sc-tint)" }} />Run overnight (ready by 8am)</label>
          </fieldset>
          <button type="submit" className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block">Start the batch</button>
        </form>
      </Section>

      <Section title="Batches" flush>
        {batches.length === 0 ? <EmptyState>No batches yet.</EmptyState> : (
          <ul className="adm-divide">
            {batches.map((b) => {
              const s = statusOf(b, now);
              const built = b.items.filter((i) => i.outcome === "built").length;
              const f = flags(b);
              return (
                <li key={b.id} className="px-4 sm:px-5 py-3 flex flex-col gap-1.5" data-batch-row>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="sc-t-headline min-w-0" style={{ overflowWrap: "anywhere" }}>{b.label}</p>
                    <StatusBadge tone={s.tone}>{s.text}</StatusBadge>
                  </div>
                  <p className="sc-t-footnote adm-muted">{built} of {b.wanted ?? "?"} built · asked {timeAgo(b.created_at, now)}{b.error ? ` · ${b.error}` : ""}</p>
                  {f.length > 0 && <p className="sc-t-footnote" data-flags><span className="font-semibold">Flagged, not built:</span> {f.join("; ")}</p>}
                  {b.status === "requested" && (
                    <form method="post" action="/api/admin/card-builder/batches">
                      <input type="hidden" name="action" value="cancel" />
                      <input type="hidden" name="id" value={b.id} />
                      <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Take it back</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </Stack>
  );
}
