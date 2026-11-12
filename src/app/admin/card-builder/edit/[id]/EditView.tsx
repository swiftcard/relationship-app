import Link from "next/link";
import { BackLink } from "../../../_ui/links";
import { PageHeader, Section, Stack } from "../../../_ui/layout";
import { StatusBadge } from "../../../_ui/badges";
import { Icon } from "../../../_ui/icons";
import { fmtDate } from "../../../_ui/format";
import { formatTeam } from "@/lib/prospect-preview/input";
import { previewState } from "@/lib/prospect-preview/real-view";
import { MAX_TEAM_MEMBERS, SOCIAL_KEYS, SOCIAL_LABELS, SOURCE_FIELDS, SOURCE_LABELS, type ProspectPreview } from "@/lib/prospect-preview/types";
import CopyPreviewLink from "../../CopyPreviewLink";

// ── Card Builder: the edit screen (server component, no data loading) ───────
// Every field of one preview, the page each researched fact came from, and
// the buttons that publish it. page.tsx loads the preview; this draws it, so
// tests/render can measure the real markup with a fixture.
//
// One plain <form method="post"> with two submit buttons (Save / Publish), so
// it works before hydration. A refusal saves nothing and comes back as ?error=.

const DONE: Record<string, string> = {
  created: "Draft created. Nobody outside SwiftCard can open it until you publish it.",
  saved: "Saved.",
  published: "Published. The link opens now.",
  unpublished: "Back to a draft. The link no longer opens.",
  colors: "Colors read. Check them on the preview.",
};

const input = "sc-field w-full px-3 py-2";

function Field({ label, hint, children, flag }: { label: string; hint?: string; children: React.ReactNode; flag?: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="sc-field-label">{label}{flag && <span className="adm-bad font-semibold"> · check this</span>}</span>
      {children}
      {hint && <span className="sc-t-caption adm-muted block mt-1">{hint}</span>}
    </label>
  );
}

export default function EditView({ p, appUrl, now, done, error }: {
  p: ProspectPreview;
  appUrl: string;
  now: number;
  done: string | null;
  error: string | null;
}) {
  const here = `/admin/card-builder/edit/${p.id}`;
  const post = `/api/admin/card-builder/${p.id}`;
  const link = `${appUrl}/p/${p.slug}`;
  const state = previewState(p, now);
  const live = state === "live";
  const unsure = SOURCE_FIELDS.filter((k) => p.sources[k]?.uncertain);
  const flag = (k: (typeof SOURCE_FIELDS)[number]) => !!p.sources[k]?.uncertain;

  return (
    <Stack>
      <BackLink href="/admin/card-builder">Card Builder</BackLink>
      <PageHeader
        title={p.owner_name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {[p.owner_title, p.office_name].filter(Boolean).join(" · ")}
            {p.status === "draft" ? <StatusBadge tone="warn">Draft</StatusBadge>
              : p.status === "paused" ? <StatusBadge tone="neutral">Paused</StatusBadge>
              : state === "expired" ? <StatusBadge tone="bad">Expired</StatusBadge>
              : <StatusBadge tone="good">Published</StatusBadge>}
          </span>
        }
        actions={
          <Link href={`/admin/card-builder/preview/${p.id}`} className="sc-btn sc-btn-sm sc-btn-gray"><Icon name="external" className="w-4 h-4" />See it as they will</Link>
        }
      />

      {done && DONE[done] && <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" role="status">{DONE[done]}</p>}
      {done === "failed" && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">That didn&apos;t work. Try again in a minute.</p>}
      {error && <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert">{error} Nothing was saved.</p>}

      {live ? (
        <div className="adm-callout-good rounded-xl px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="sc-t-subhead min-w-0 break-all"><span className="font-semibold">Link opens until {fmtDate(p.expires_at, now)}.</span> {link}</p>
          <CopyPreviewLink link={link} filled />
        </div>
      ) : (
        <p className="adm-callout-warn sc-t-subhead rounded-xl px-4 py-3" data-not-public>
          {p.status === "draft" ? "This is a draft. Its link doesn't open for anyone outside SwiftCard until you publish it." : "This link doesn't open right now. Publish it to start a fresh 14 days."}
        </p>
      )}

      {unsure.length > 0 && (
        <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" data-uncertain>
          <span className="font-semibold">Check before you publish:</span> {unsure.map((k) => SOURCE_LABELS[k]).join(", ")}. {unsure.length === 1 ? "It was" : "They were"} marked uncertain when researched.
        </p>
      )}

      <form method="post" action={post} id="pp-edit">
        <input type="hidden" name="back" value={here} />
        <Stack>
          <Section title="The owner" hint="The person who can say yes for the whole office.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner's name" flag={flag("owner_name")}><input name="owner_name" required maxLength={80} defaultValue={p.owner_name} className={input} autoComplete="off" /></Field>
              <Field label="Owner's title" flag={flag("owner_title")}><input name="owner_title" maxLength={80} defaultValue={p.owner_title ?? ""} className={input} autoComplete="off" /></Field>
              <Field label="Owner's phone" hint="The alert tells you to call this number." flag={flag("phone")}><input name="phone" type="tel" required maxLength={40} defaultValue={p.phone} className={input} autoComplete="off" /></Field>
              <Field label="Owner's email" flag={flag("email")}><input name="email" type="email" maxLength={160} defaultValue={p.email ?? ""} className={input} autoComplete="off" /></Field>
              <div className="sm:col-span-2">
                <Field label="Headshot address" hint="Only a picture from their own business website or brokerage profile, and name that page under Sources. Leave empty otherwise." flag={flag("headshot_url")}>
                  <input name="headshot_url" type="url" maxLength={600} defaultValue={p.headshot_url ?? ""} className={input} placeholder="https://" autoComplete="off" />
                </Field>
              </div>
            </div>
          </Section>

          <Section title="The office">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Office name"><input name="office_name" required maxLength={120} defaultValue={p.office_name} className={input} autoComplete="off" /></Field>
              <Field label="Website" flag={flag("website")}><input name="website" type="url" maxLength={600} defaultValue={p.website ?? ""} className={input} placeholder="https://" autoComplete="off" /></Field>
              <div className="sm:col-span-2">
                <Field label="Office address" flag={flag("address")}><input name="address" maxLength={200} defaultValue={p.address ?? ""} className={input} autoComplete="off" /></Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Specialty" hint="One line under their name on the preview: what this office is known for." flag={flag("specialty")}>
                  <input name="specialty" maxLength={140} defaultValue={p.specialty ?? ""} className={input} autoComplete="off" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Logo address" hint="A full https:// link to their logo image. Leave empty to use their initials." flag={flag("logo_url")}>
                  <input name="logo_url" type="url" maxLength={600} defaultValue={p.logo_url ?? ""} className={input} placeholder="https://" autoComplete="off" />
                </Field>
              </div>
              <Field label="Brand color" flag={flag("colors")}><input name="brand_primary" type="color" defaultValue={p.brand_primary} className="sc-field w-full h-11 p-1" /></Field>
              <Field label="Accent color"><input name="brand_secondary" type="color" defaultValue={p.brand_secondary} className="sc-field w-full h-11 p-1" /></Field>
            </div>
          </Section>

          <Section title="Team" hint={`Each gets a card in the "Your team" strip. Up to ${MAX_TEAM_MEMBERS}.`}>
            <Field label="Team members" hint="One per line: Name, Title, then (if you have it) the https:// address of their picture." flag={flag("team_members")}>
              <textarea name="team_members" rows={6} defaultValue={formatTeam(p.team_members)} className={input} />
            </Field>
          </Section>

          <Section title="Social links" hint="Full https:// addresses. The preview names them; it doesn't link to them.">
            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIAL_KEYS.map((k) => (
                <Field key={k} label={SOCIAL_LABELS[k]}><input name={`social_${k}`} type="url" maxLength={600} defaultValue={p.social_links[k] ?? ""} className={input} placeholder="https://" autoComplete="off" /></Field>
              ))}
            </div>
          </Section>

          <Section title="Sources" hint="The page each fact came from. Tick Uncertain for anything that wasn't confirmed; it is flagged above until you clear it." flush>
            <ul className="adm-divide">
              {SOURCE_FIELDS.map((k) => {
                const s = p.sources[k];
                return (
                  <li key={k} className="px-4 sm:px-5 py-3 grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center" data-source-row>
                    <p className="sc-t-subhead font-medium">{SOURCE_LABELS[k]}{s?.uncertain && <span className="adm-bad"> · uncertain</span>}</p>
                    <input name={`src_${k}`} type="url" maxLength={600} defaultValue={s?.url ?? ""} placeholder="https:// where it was found" aria-label={`Source for ${SOURCE_LABELS[k]}`} className="sc-field sc-field-fit px-3 py-2 text-sm min-w-0 w-full" autoComplete="off" />
                    <input name={`note_${k}`} maxLength={200} defaultValue={s?.note ?? ""} placeholder="Note" aria-label={`Note about ${SOURCE_LABELS[k]}`} className="sc-field sc-field-fit px-3 py-2 text-sm min-w-0 w-full" autoComplete="off" />
                    <label className="inline-flex items-center gap-2 sc-t-footnote min-h-[32px]">
                      <input type="checkbox" name={`unc_${k}`} defaultChecked={!!s?.uncertain} className="w-4 h-4" style={{ accentColor: "var(--sc-tint)" }} />Uncertain
                    </label>
                  </li>
                );
              })}
            </ul>
          </Section>

          <div className="flex flex-wrap items-center gap-2" data-edit-actions>
            <button type="submit" name="action" value="save" className={`sc-btn ${live ? "sc-btn-filled" : "sc-btn-gray"}`}>{live ? "Save" : "Save draft"}</button>
            {!live && <button type="submit" name="action" value="publish" className="sc-btn sc-btn-filled" data-publish>Save and publish</button>}
          </div>
        </Stack>
      </form>

      <Section title="More">
        <div className="flex flex-wrap items-start gap-2">
          <form method="post" action={post}>
            <input type="hidden" name="action" value="colors" />
            <input type="hidden" name="back" value={here} />
            <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Read colors from the saved logo</button>
          </form>
          {p.status === "live" && (
            <form method="post" action={post}>
              <input type="hidden" name="action" value="unpublish" />
              <input type="hidden" name="back" value={here} />
              <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">Back to draft</button>
            </form>
          )}
          <details>
            <summary className="sc-btn sc-btn-sm sc-btn-plain adm-bad list-none cursor-pointer">Delete</summary>
            <form method="post" action={post} className="mt-2">
              <input type="hidden" name="action" value="delete" />
              <input type="hidden" name="back" value={here} />
              <button type="submit" className="sc-btn sc-btn-sm sc-btn-destructive">Yes, delete it</button>
            </form>
          </details>
        </div>
        <p className="sc-t-caption adm-muted mt-2">Reading colors uses the logo address as last saved (or the website&apos;s theme color when there is no logo). Save first if you just changed it.</p>
      </Section>
    </Stack>
  );
}
