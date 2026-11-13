import { BackLink } from "../../_ui/links";
import { PageHeader, Section, Stack } from "../../_ui/layout";
import { EmptyState } from "../../_ui/states";
import { Icon } from "../../_ui/icons";
import { timeAgo } from "../../_ui/format";
import type { QueueItem } from "@/lib/prospect-preview/desk";
import { BUYER_ROLES, BUYER_ROLE_LABELS, DEFAULT_BRAND_PRIMARY, DEFAULT_BRAND_SECONDARY, DEFAULT_EXPIRY_DAYS, MAX_TEAM_MEMBERS } from "@/lib/prospect-preview/types";

// ── Card Builder: Add (server component, no data loading) ───────────────────
// One job: drop in who to build a card for. A name and a city, a link, or
// notes, typed on a phone. Nothing is built or sent by adding: the next /build
// run (now, or tonight) researches each one and leaves a draft in Approve.
// Building one entirely by hand is still here, folded away.
// page.tsx loads the queue; this draws it, so tests/render can measure it.

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


export default function AddView({ queue, now, done, error, n }: {
  queue: QueueItem[];
  now: number;
  done: string | null;
  error: string | null;
  /** How many were just added. */
  n: string | null;
}) {
  return (
    <Stack className="max-w-xl mx-auto w-full">
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader title="Add" description="Drop in who to build a card for. The next run researches each one and leaves a draft for you to approve." />

      {done === "queued" && <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" role="status">Added {n === "1" ? "1 prospect" : `${n ?? ""} prospects`} to the queue.</p>}
      {done === "removed" && <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" role="status">Removed.</p>}
      {error && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">{error}</p>}

      <Section title="Queue" hint="One per line: a name and a city, or a link to their website, Zillow, LinkedIn or Instagram.">
        <form method="post" action="/api/admin/card-builder/queue" className="flex flex-col gap-3" data-queue-form>
          <input type="hidden" name="action" value="add" />
          <textarea name="lines" rows={4} className={input} aria-label="Names or links, one per line" placeholder={"Harbor Realty Group, Brooklyn\nhttps://www.zillow.com/profile/…"} />
          <details>
            <summary className="adm-link sc-t-footnote cursor-pointer">Or paste notes about one prospect</summary>
            <textarea name="notes" rows={5} className={`${input} mt-2`} aria-label="Notes about one prospect" placeholder="Dana Whitfield owns Harbor Realty in Brooklyn Heights. 14 agents. Met her at the REBNY mixer. Cell 718…" />
            <span className="sc-t-caption adm-muted block mt-1">What you write here counts as confirmed by you.</span>
          </details>
          <button type="submit" className="sc-btn sc-btn-filled sc-btn-lg sc-btn-block"><Icon name="plus" className="w-4 h-4" />Add to the queue</button>
        </form>
      </Section>

      <Section title={`Waiting to be built (${queue.length})`} hint="Type /build tonight in Claude Code and these are drafts by 8am. /build now builds them right away." flush>
        {queue.length === 0 ? (
          <EmptyState>Nothing in the queue.</EmptyState>
        ) : (
          <ul className="adm-divide">
            {queue.map((q) => (
              <li key={q.id} className="px-4 sm:px-5 py-3 flex items-start justify-between gap-3" data-queued>
                <p className="sc-t-subhead min-w-0 whitespace-pre-line" style={{ overflowWrap: "anywhere" }}>
                  {q.input.length > 160 ? `${q.input.slice(0, 160)}…` : q.input}
                  <span className="adm-muted block sc-t-caption">{q.is_notes ? "Your notes · " : ""}added {timeAgo(q.created_at, now)}</span>
                </p>
                <form method="post" action="/api/admin/card-builder/queue" className="shrink-0">
                  <input type="hidden" name="action" value="remove" />
                  <input type="hidden" name="id" value={q.id} />
                  <button type="submit" className="sc-btn sc-btn-sm sc-btn-plain adm-bad" aria-label="Remove from the queue">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <details data-by-hand>
        <summary className="adm-link sc-t-subhead cursor-pointer">Build one by hand instead</summary>
        <div className="mt-3">
          <Section title="New preview" hint="Starts as a draft. The next screen has every other field (headshot, address, website, social links, sources) and the Publish button.">
            <CreateForm />
          </Section>
        </div>
      </details>
    </Stack>
  );
}
