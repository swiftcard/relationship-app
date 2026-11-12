import CardScaler from "@/components/CardScaler";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import { cardPageTheme } from "@/lib/card-page-theme";
import { HOUSE_TEMPLATE, initialsOf, memberCard, ownerCard } from "@/lib/prospect-preview/card";
import { SOCIAL_KEYS, SOCIAL_LABELS, type ProspectPreview } from "@/lib/prospect-preview/types";

// ── /p/<slug>, the markup (server component, no data loading) ───────────────
// page.tsx loads the preview; this draws it, so tests/render can measure the
// real page with a fixture.
//
// In order: the owner (their picture when we have it, their office and what it
// is known for), the owner's card, the "Your team" strip, a small picture of the
// notification they would get, ONE button, and a one-line credit. Nothing
// else, on purpose: no pricing, no feature list, no sign-up (owner's brief).
// The cards are real card templates wearing the prospect's logo and colours,
// held `inert`: a picture of a card, so its phone and email can't be tapped
// by accident on the way to the button.
//
// Colours are fixed (not the app's theme tokens): this is a page a stranger
// opens from a text message, and it must look the same on every device.

const INK = "#141B26";
const MUTED = "#5B6472";

/** A round picture of a person, or their initials when we have none. */
function Face({ src, name, size }: { src?: string | null; name: string; size: number }) {
  const box = { width: size, height: size };
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" className="rounded-full object-cover shrink-0" style={{ ...box, background: "rgba(20,27,38,0.08)" }} data-face />
  ) : (
    <span aria-hidden className="rounded-full shrink-0 inline-flex items-center justify-center font-semibold" style={{ ...box, fontSize: size * 0.36, background: "rgba(20,27,38,0.08)", color: MUTED }}>{initialsOf(name)}</span>
  );
}

/** ["Instagram", "LinkedIn", "Zillow"] → "Instagram, LinkedIn and Zillow". */
const sentenceList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function Card({ data }: { data: ReturnType<typeof ownerCard> }) {
  return (
    <div inert className="pointer-events-none select-none">
      <CardScaler>
        <LogoFirst data={data} />
      </CardScaler>
    </div>
  );
}

export default function PreviewView({ preview, calendarUrl }: { preview: ProspectPreview; calendarUrl: string }) {
  const theme = cardPageTheme(preview.brand_primary, HOUSE_TEMPLATE);
  const first = preview.owner_name.split(/\s+/)[0] || preview.owner_name;
  const team = preview.team_members;
  const external = /^https:/.test(calendarUrl);
  const faces = team.some((m) => m.headshot);
  // Named, not linked: the page has one thing to tap, and it is the button.
  const found = SOCIAL_KEYS.filter((k) => preview.social_links[k]).map((k) => SOCIAL_LABELS[k]);

  return (
    <main className="min-h-screen w-full flex flex-col items-center px-4 pt-8 pb-10" style={{ background: theme.pageBackground, color: INK }}>
      <div className="w-full max-w-sm flex flex-col gap-7">
        <header className="text-center flex flex-col items-center">
          {preview.headshot_url && <div className="mb-3" data-owner-face><Face src={preview.headshot_url} name={preview.owner_name} size={72} /></div>}
          <p className="text-sm font-medium" style={{ color: MUTED }}>{preview.office_name}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{first}, this is your card</h1>
          {preview.specialty && <p className="mt-1.5 text-sm" style={{ color: MUTED, overflowWrap: "anywhere" }} data-specialty>{preview.specialty}</p>}
        </header>

        <section aria-label={`${preview.owner_name}'s card`} data-owner-card>
          <Card data={ownerCard(preview)} />
          {found.length > 0 && (
            <p className="mt-3 text-center text-xs" style={{ color: MUTED }} data-socials>Your card links to your {sentenceList(found)}.</p>
          )}
        </section>

        {team.length > 0 && (
          <section aria-labelledby="pp-team">
            <h2 id="pp-team" className="text-base font-bold tracking-tight">Your team</h2>
            {/* Bleeds to the screen's edges so the next card peeks in and the
                row reads as something to swipe. */}
            <ul data-team-strip className="mt-3 -mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2" style={{ scrollbarWidth: "none" }}>
              {team.map((m, i) => (
                <li key={`${m.name}-${i}`} className="w-[260px] shrink-0 snap-start" aria-label={m.title ? `${m.name}, ${m.title}` : m.name}>
                  <Card data={memberCard(preview, m)} />
                  {faces && (
                    <div className="mt-2 flex items-center gap-2 min-w-0" data-member-face>
                      <Face src={m.headshot} name={m.name} size={32} />
                      <p className="min-w-0 text-xs leading-tight">
                        <span className="block font-semibold truncate">{m.name}</span>
                        {m.title && <span className="block truncate" style={{ color: MUTED }}>{m.title}</span>}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="pp-notice">
          <h2 id="pp-notice" className="text-sm font-medium" style={{ color: MUTED }}>When someone opens your card, you&apos;ll know:</h2>
          <div className="mt-2 flex items-start gap-3 rounded-2xl px-3.5 py-3" style={{ background: "rgba(255,255,255,0.92)", boxShadow: "0 1px 2px rgba(20,27,38,0.06), 0 8px 24px rgba(20,27,38,0.08)" }} data-mock-notification>
            <SwiftCardIcon size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold truncate">Card viewed</p>
                <p className="text-xs shrink-0" style={{ color: MUTED }}>now</p>
              </div>
              <p className="text-sm" style={{ color: MUTED }}>Someone viewed your card on iPhone.</p>
            </div>
          </div>
        </section>

        <a
          href={calendarUrl}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          data-claim
          className="block w-full text-center rounded-2xl px-5 py-4 text-base font-semibold"
          style={{ background: theme.accent, color: theme.accentText }}
        >
          Claim your team&apos;s cards, 15-min setup call
        </a>

        <p className="text-center text-xs" style={{ color: MUTED }}>Preview made by SwiftCard.</p>
      </div>
    </main>
  );
}
