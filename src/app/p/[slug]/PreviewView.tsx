import CardScaler from "@/components/CardScaler";
import LogoFirst from "@/components/card-templates/LogoFirst";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import { cardPageTheme } from "@/lib/card-page-theme";
import { HOUSE_TEMPLATE, memberCard, ownerCard } from "@/lib/prospect-preview/card";
import type { ProspectPreview } from "@/lib/prospect-preview/types";

// ── /p/<slug>, the markup (server component, no data loading) ───────────────
// page.tsx loads the preview; this draws it, so tests/render can measure the
// real page with a fixture.
//
// In order: the owner's card, the "Your team" strip, a small picture of the
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

  return (
    <main className="min-h-screen w-full flex flex-col items-center px-4 pt-8 pb-10" style={{ background: theme.pageBackground, color: INK }}>
      <div className="w-full max-w-sm flex flex-col gap-7">
        <header className="text-center">
          <p className="text-sm font-medium" style={{ color: MUTED }}>{preview.office_name}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{first}, this is your card</h1>
        </header>

        <section aria-label={`${preview.owner_name}'s card`} data-owner-card>
          <Card data={ownerCard(preview)} />
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
