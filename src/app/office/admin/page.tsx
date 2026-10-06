import Link from "next/link";
import CreateOfficeForm from "@/components/CreateOfficeForm";
import { requireOfficeAdmin } from "@/lib/office-admin-guard";
import { getTeamOverview, computeSetupProgress } from "@/lib/office-team";
import { getOfficeBrand } from "@/lib/office-brand";
import { PLAN_LIMITS } from "@/lib/plan";
import { PageHead } from "@/components/office/OfficeUI";
import { AddMemberButton } from "@/components/office/TeamActions";
import TeamList from "@/components/office/TeamList";
import AdminTourButton from "@/components/office/AdminTourButton";
import { ownLiveHref } from "@/lib/self-pass";

export const metadata = { title: "Team — Admin — SwiftCard" };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// The "▲ X% vs last month" trend line was removed here the same day it was
// removed from the Pro dashboard (owner request 2026-08-26): the counts stay,
// the per-tile percentage comparison goes.
function BigStat({ label, value, explainer, sub }: {
  label: string;
  value: string;
  explainer: string;
  sub?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-4">
      <p className="text-xs text-gray-500">{label}</p>
      <div className="flex items-baseline gap-2 mt-1 flex-wrap">
        <p className="text-[1.75rem] font-bold text-white tabular-nums leading-none">{value}</p>
        {sub && <span className="text-xs text-gray-600 font-medium">{sub}</span>}
      </div>
      <p className="text-[0.6875rem] text-gray-600 mt-1.5 leading-snug">{explainer}</p>
    </div>
  );
}

function Step({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-px ${
          done ? "bg-green-500/15 text-green-400" : "bg-gray-800 text-gray-500"
        }`}
        aria-hidden="true"
      >
        {done ? "✓" : n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export default async function OfficeTeamPage() {
  const { userId, office, officeId, ownerId, caps, isOwner: viewerIsOwner } = await requireOfficeAdmin();

  // On Office but no office row yet → the one thing to do is name the team.
  if (!office || !officeId || !ownerId) {
    return (
      <div className="max-w-md mx-auto pt-6">
        <CreateOfficeForm />
      </div>
    );
  }

  const seatCap = (office.seats as number | null) ?? PLAN_LIMITS.OFFICE_MIN_SEATS;

  const [overview, brand] = await Promise.all([
    getTeamOverview(officeId, ownerId, seatCap).catch(() => null),
    getOfficeBrand(officeId).catch(() => null),
  ]);

  const people = overview?.people ?? [];
  const invites = overview?.invites ?? [];
  const seats = overview?.stats.seats;

  const setup = computeSetupProgress({
    // Ticked only once an admin has SAVED Branding: the brand is auto-filled
    // from the owner's first card, so it existed (and this showed done) before
    // anyone had opened the page (2026-09-16 audit).
    hasBrand: !!brand && (office.brand_locks as { saved?: boolean } | null)?.saved === true,
    memberRowCount: people.filter((p) => !p.isOwner).length + invites.length,
    liveEmployeeCards: people.filter((p) => !p.isOwner && p.liveCards > 0).length,
  });

  const activation = overview?.stats.activation;
  const hasRows = people.length > 0 || invites.length > 0;

  return (
    <div>
      <div className="mb-3">
        <AdminTourButton />
      </div>
      <PageHead
        title="Your team"
        desc="Everyone with a company card — their cards, views and contacts in one place."
        action={
          <div data-tour="admin-add-member" className="flex items-center gap-3">
            {seats && (
              <span className="text-xs text-gray-500 whitespace-nowrap hidden sm:block">
                <span className="text-gray-300 font-semibold tabular-nums">{seats.used} of {seats.purchased}</span> seats in use
              </span>
            )}
            {caps.canInvite && <AddMemberButton canManageSeats={caps.canManageSeats} />}
          </div>
        }
      />
      {seats && (
        <p className="text-xs text-gray-500 -mt-2 mb-5 sm:hidden">
          <span className="text-gray-300 font-semibold tabular-nums">{seats.used} of {seats.purchased}</span> seats in use
        </p>
      )}

      {/* Setup checklist — derived from durable facts, so once all three are done
          it never renders again. */}
      {!setup.allDone && (
        <div className="bg-gray-900 border border-purple-500/20 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between gap-3 mb-1">
            <p className="text-sm font-bold text-white">Let&apos;s get your team set up</p>
            <span className="text-[0.6875rem] font-semibold text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full shrink-0 tabular-nums">
              {setup.completed} of {setup.total} completed
            </span>
          </div>
          <div className="h-1 rounded-full bg-gray-800 overflow-hidden mb-4" role="presentation">
            <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: `${(setup.completed / setup.total) * 100}%` }} />
          </div>
          <ol className="space-y-3">
            <Step n={1} done={setup.brandingDone}>
              {setup.brandingDone ? (
                <span className="text-sm text-gray-500 line-through">Set up your company branding</span>
              ) : (
                <>
                  <Link href="/office/admin/branding" className="text-sm font-semibold text-purple-400 hover:text-purple-300 transition-colors">
                    Set up your company branding →
                  </Link>
                  <span className="block text-[0.6875rem] text-gray-600 mt-0.5">Your logo, company name and card design — every card uses it.</span>
                </>
              )}
            </Step>
            <Step n={2} done={setup.invitedDone}>
              {setup.invitedDone ? (
                <span className="text-sm text-gray-500 line-through">Invite your first team member</span>
              ) : caps.canInvite ? (
                <>
                  <AddMemberButton canManageSeats={caps.canManageSeats} label="Invite your first team member →" variant="link" />
                  <span className="block text-[0.6875rem] text-gray-600 mt-0.5">They get an email and build their card in about two minutes.</span>
                </>
              ) : (
                <span className="text-sm text-gray-400">Invite your first team member</span>
              )}
            </Step>
            <Step n={3} done={setup.cardLiveDone}>
              <span className={`text-sm ${setup.cardLiveDone ? "text-gray-500 line-through" : "text-gray-400"}`}>
                Get your first employee card live
              </span>
              {!setup.cardLiveDone && (
                <span className="block text-[0.6875rem] text-gray-600 mt-0.5">
                  This checks off as soon as someone you invited finishes their card.
                </span>
              )}
            </Step>
          </ol>
        </div>
      )}

      {/* The four numbers. */}
      {overview && hasRows && (
        <div data-tour="admin-stats" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <BigStat
            label="Leads captured this month"
            value={overview.stats.leadsThisMonth.current.toLocaleString("en-US")}
            explainer="People who shared their info with your team"
          />
          <BigStat
            label="Card views this month"
            value={overview.stats.viewsThisMonth.current.toLocaleString("en-US")}
            explainer="Times someone opened one of your team's cards"
          />
          <BigStat
            label="Team activation rate"
            value={activation?.pct != null ? `${activation.pct}%` : "—"}
            sub={activation && activation.invited > 0 ? `${activation.activated} of ${activation.invited}` : undefined}
            explainer={
              activation && activation.invited > 0
                ? "People you invited who have a live card up"
                : "Invite someone and this shows how many finished their card"
            }
          />
          <BigStat
            label="Seats in use"
            value={seats ? `${seats.used}` : "—"}
            sub={seats ? `of ${seats.purchased}` : undefined}
            explainer={
              seats && seats.available > 0
                ? `You're paying for ${seats.available} seat${seats.available === 1 ? "" : "s"} nobody is using`
                : "Every seat you're paying for is being used"
            }
          />
        </div>
      )}

      {/* One list: members and pending invitations together. */}
      <div data-tour="admin-team-list">
        {hasRows ? (
          <TeamList
            people={people}
            invites={invites}
            appUrl={APP_URL}
            // The viewer's OWN row opens through lib/self-pass, so looking at
            // their own card from here is never counted as a view.
            self={selfLive(people, userId)}
            caps={{ canInvite: caps.canInvite, canRemove: caps.canRemove, canManageCards: caps.canManageCards, canManageSeats: caps.canManageSeats, viewerIsOwner }}
          />
        ) : (
          setup.allDone && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
              <p className="text-gray-400 text-sm mb-1">Your team is empty right now.</p>
              <p className="text-gray-600 text-xs mb-4">Invite someone and their card shows up here.</p>
              {caps.canInvite && <AddMemberButton canManageSeats={caps.canManageSeats} />}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** The viewer's own row in the team list, if they have a card there. */
function selfLive(people: { userId: string; username: string }[], userId: string) {
  const me = people.find((p) => p.userId === userId);
  if (!me?.username) return undefined;
  return { userId, href: ownLiveHref(userId, `${APP_URL}/${me.username}`, APP_URL) };
}
