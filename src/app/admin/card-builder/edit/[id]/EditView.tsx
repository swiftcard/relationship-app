import Link from "next/link";
import { BackLink } from "../../../_ui/links";
import { PageHeader, Section, Stack } from "../../../_ui/layout";
import { StatusBadge } from "../../../_ui/badges";
import { Icon } from "../../../_ui/icons";
import { fmtDate } from "../../../_ui/format";
import { formatTeam } from "@/lib/prospect-preview/input";
import { previewState } from "@/lib/prospect-preview/real-view";
import { assessQuality } from "@/lib/prospect-preview/quality";
import {
  BUYER_ROLES, BUYER_ROLE_LABELS, CURRENT_TOOLS, CURRENT_TOOL_LABELS, HOOK_ANGLES, HOOK_ANGLE_LABELS, MAX_SPECIFICS, MAX_TEAM_MEMBERS, MIN_SPECIFICS,
  SOCIAL_KEYS, SOCIAL_LABELS, SOURCE_FIELDS, SOURCE_LABELS, SPECIFIC_KINDS, SPECIFIC_LABELS, type ProspectPreview,
} from "@/lib/prospect-preview/types";
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
  override_on: "Override on. This preview can be published as it is.",
  override_off: "Override removed.",
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
  const q = assessQuality(p);
  const rows = Array.from({ length: MAX_SPECIFICS }, (_, i) => p.specifics[i] ?? null);

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
      {done === "held" && (
        <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" role="alert" data-held>
          <span className="font-semibold">Saved, but not published.</span> This draft is too generic to send. Fix what the checklist below marks, or override it there.
        </p>
      )}

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

      <Section
        title={`Personalization: ${q.score} of 100`}
        hint="Would this preview, and the messages written from it, make sense for any other office? If so it isn't ready."
        id="pp-quality"
      >
        {q.tooGeneric ? (
          <p className="adm-callout-danger sc-t-subhead rounded-xl px-4 py-3" data-too-generic>
            <span className="font-semibold">Too generic.</span>{" "}
            {p.quality_override
              ? "You overrode this, so it can be published as it is."
              : "It can't be published until the items marked Needed are fixed, or you override it."}
          </p>
        ) : (
          <p className="adm-callout-good sc-t-subhead rounded-xl px-4 py-3" data-specific-enough>Specific enough to send.</p>
        )}
        <ul className="mt-3 space-y-2.5" data-quality-checks>
          {q.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-3" data-check={c.key} data-ok={c.ok ? "yes" : "no"}>
              <span className="shrink-0 w-[4.5rem]">
                <StatusBadge tone={c.ok ? "good" : c.required ? "bad" : "neutral"}>{c.ok ? "Done" : c.required ? "Needed" : "Missing"}</StatusBadge>
              </span>
              <span className="min-w-0 sc-t-subhead" style={{ overflowWrap: "anywhere" }}>
                <span className="font-medium">{c.label}</span>
                <span className="adm-muted"> · {c.earned} of {c.points}</span>
                {c.fix && <span className="adm-muted block sc-t-footnote mt-0.5">{c.fix}</span>}
              </span>
            </li>
          ))}
        </ul>
        {(q.tooGeneric || p.quality_override) && (
          <form method="post" action={post} className="mt-4 flex flex-wrap items-center gap-2" data-override>
            <input type="hidden" name="action" value="override" />
            <input type="hidden" name="on" value={p.quality_override ? "0" : "1"} />
            <input type="hidden" name="back" value={here} />
            <button type="submit" className="sc-btn sc-btn-sm sc-btn-gray">{p.quality_override ? "Remove my override" : "Override: let me publish it as it is"}</button>
            <span className="sc-t-caption adm-muted">Only you can do this, here. Save your changes first: this button doesn&apos;t save the form below.</span>
          </form>
        )}
      </Section>

      <form method="post" action={post} id="pp-edit">
        <input type="hidden" name="back" value={here} />
        <Stack>
          <Section title="The owner" hint="The person who can say yes for the whole office.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner's name" flag={flag("owner_name")}><input name="owner_name" required maxLength={80} defaultValue={p.owner_name} className={input} autoComplete="off" /></Field>
              <Field label="Owner's title" hint="Exactly as they write it." flag={flag("owner_title")}><input name="owner_title" maxLength={80} defaultValue={p.owner_title ?? ""} className={input} autoComplete="off" /></Field>
              <Field label="Owner's phone" hint="The alert tells you to call this number." flag={flag("phone")}><input name="phone" type="tel" required maxLength={40} defaultValue={p.phone} className={input} autoComplete="off" /></Field>
              <Field label="Owner's email" flag={flag("email")}><input name="email" type="email" maxLength={160} defaultValue={p.email ?? ""} className={input} autoComplete="off" /></Field>
              <div className="sm:col-span-2">
                <Field label="License line" hint="Only if they show one, exactly as they show it: Licensed Real Estate Broker; NMLS #123456. Printed after their title on the card." flag={flag("license")}>
                  <input name="license" maxLength={80} defaultValue={p.license ?? ""} className={input} autoComplete="off" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Headshot address" hint="Only a picture from their own business website or brokerage profile, and name that page under Sources. Leave empty otherwise." flag={flag("headshot_url")}>
                  <input name="headshot_url" type="url" maxLength={600} defaultValue={p.headshot_url ?? ""} className={input} placeholder="https://" autoComplete="off" />
                </Field>
              </div>
            </div>
          </Section>

          <Section title="Why this person" hint="Shown on the Call screen. A preview is only built for someone who can buy for the whole office.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Their role" flag={flag("buyer_role")}>
                <select name="buyer_role" required defaultValue={p.buyer_role ?? ""} className={input}>
                  <option value="" disabled>Choose…</option>
                  {BUYER_ROLES.map((r) => <option key={r} value={r}>{BUYER_ROLE_LABELS[r]}</option>)}
                </select>
              </Field>
              <Field label="Team size" hint="People in the office or on the team. Leave empty if you don't know." flag={flag("team_size")}>
                <input name="team_size" type="number" min={1} max={10000} defaultValue={p.team_size ?? ""} className={input} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Why they decide" hint="One sentence, from the source: &quot;Listed as Broker of Record and owner on the About page.&quot;">
                  <input name="buyer_reason" maxLength={240} defaultValue={p.buyer_reason ?? ""} className={input} autoComplete="off" />
                </Field>
              </div>
            </div>
          </Section>

          <Section
            title="Specifics"
            hint={`True, checkable things about this office beyond its name, logo and location. At least ${MIN_SPECIFICS}, each with the page it is on and a date: the day it happened, or the day you read it.`}
          >
            <ul className="space-y-4" data-specifics>
              {rows.map((sp, i) => (
                <li key={i} className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)]" data-specific-row>
                  <select name={`spec_kind_${i}`} defaultValue={sp?.kind ?? "listing"} aria-label={`Kind of specific ${i + 1}`} className="sc-field sc-field-fit px-3 py-2 text-sm w-full">
                    {SPECIFIC_KINDS.map((k) => <option key={k} value={k}>{SPECIFIC_LABELS[k]}</option>)}
                  </select>
                  <input name={`spec_text_${i}`} maxLength={240} defaultValue={sp?.text ?? ""} placeholder={i === 0 ? "Listing at 412 4th St, Park Slope, $2.15M" : `Specific ${i + 1}`} aria-label={`Specific ${i + 1}`} className="sc-field sc-field-fit px-3 py-2 text-sm min-w-0 w-full" autoComplete="off" />
                  <input name={`spec_date_${i}`} type="date" defaultValue={sp?.dated ?? ""} aria-label={`Date of specific ${i + 1}`} className="sc-field sc-field-fit px-3 py-2 text-sm w-full" />
                  <div className="flex flex-wrap items-center gap-3 min-w-0">
                    <input name={`spec_src_${i}`} type="url" maxLength={600} defaultValue={sp?.source_url ?? ""} placeholder="https:// where it was found" aria-label={`Source for specific ${i + 1}`} className="sc-field sc-field-fit px-3 py-2 text-sm min-w-0 flex-1 basis-48" autoComplete="off" />
                    <label className="inline-flex items-center gap-2 sc-t-footnote min-h-[32px]">
                      <input type="checkbox" name={`spec_unc_${i}`} defaultChecked={!!sp?.uncertain} className="w-4 h-4" style={{ accentColor: "var(--sc-tint)" }} />Uncertain
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="The hook" hint="One specific, and why it matters to them. Every text, the email and the call opener lead with it. &quot;You cover Park Slope&quot; is not a hook.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="The fact" hint="Finishes the sentence &quot;I saw …&quot;: all 8 of your agents list their own cell number on your site." flag={flag("detail")}>
                  <input name="detail" maxLength={200} defaultValue={p.detail ?? ""} className={input} autoComplete="off" />
                </Field>
              </div>
              <Field label="Built on" hint="Which of the specifics above it comes from.">
                <select name="hook_specific" defaultValue={p.hook_specific ?? ""} className={input}>
                  <option value="">Choose…</option>
                  {rows.map((sp, i) => <option key={i} value={i}>{`${i + 1}. ${sp ? sp.text.slice(0, 60) : "(empty row)"}`}</option>)}
                </select>
              </Field>
              <Field label="Leads to" hint="What SwiftCard does about it.">
                <select name="hook_angle" defaultValue={p.hook_angle ?? ""} className={input}>
                  <option value="">Choose…</option>
                  {HOOK_ANGLES.map((a) => <option key={a} value={a}>{HOOK_ANGLE_LABELS[a]}</option>)}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Why it matters to them" hint="One full sentence, said to them: When one of them moves on, the clients who saved that number go with them.">
                  <input name="hook_why" maxLength={280} defaultValue={p.hook_why ?? ""} className={input} autoComplete="off" />
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
                <Field label="Tagline" hint="Their own line about themselves, as they write it. Shown under their name on the preview." flag={flag("specialty")}>
                  <input name="specialty" maxLength={140} defaultValue={p.specialty ?? ""} className={input} autoComplete="off" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Logo address" hint="A full https:// link to their logo image. Leave empty to use their initials." flag={flag("logo_url")}>
                  <input name="logo_url" type="url" maxLength={600} defaultValue={p.logo_url ?? ""} className={input} placeholder="https://" autoComplete="off" />
                </Field>
              </div>
              <Field label="Type feel" hint="Match their own site and logo.">
                <select name="type_feel" defaultValue={p.type_feel ?? "sans"} className={input}>
                  <option value="sans">Sans-serif (clean, modern)</option>
                  <option value="serif">Serif (classic, like a printed card)</option>
                </select>
              </Field>
              <Field label="What they use today" hint="To share contact details. A competitor doesn't rule them out; it changes what you say on the call." flag={flag("current_tool")}>
                <select name="current_tool" defaultValue={p.current_tool ?? ""} className={input}>
                  <option value="">Not checked yet</option>
                  {CURRENT_TOOLS.map((t) => <option key={t} value={t}>{CURRENT_TOOL_LABELS[t]}</option>)}
                </select>
              </Field>
              <Field label="Brand color" flag={flag("colors")}><input name="brand_primary" type="color" defaultValue={p.brand_primary} className="sc-field w-full h-11 p-1" /></Field>
              <Field label="Accent color"><input name="brand_secondary" type="color" defaultValue={p.brand_secondary} className="sc-field w-full h-11 p-1" /></Field>
            </div>
          </Section>

          <Section title="Team" hint={`Each gets a card in the "Your team" strip. Up to ${MAX_TEAM_MEMBERS}.`}>
            <Field label="Team members" hint="One per line: Name, Title, then (if you have it) the https:// address of their picture. Use each person's real title. If their site gives none, use their license type or leave it off. Never invent one." flag={flag("team_members")}>
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
