import Link from "next/link";
import { PlanBadge, PlanGate } from "@/components/PlanGate";
import type { RecentVisit } from "@/lib/recent-visits";

// "Recent visits" — under the Traffic chart on the dashboard (owner's pick,
// 2026-10-18). Every open of the card or Swift Links in the chart's window,
// newest first: who (when the owner knows them), what it was opened on, where
// it was tapped, how long it stayed, where it came from and what they did.
//
// A SERVER component. "Show more" is a native <details>, so it opens before
// the page hydrates and with no JavaScript at all — nothing here can be a dead
// control (AGENTS.md: everything is interactive before it is hydrated).
//
// FREE: the rows are real (a visit happened, when, on which page, which visit
// it was), the details are not — lib/recent-visits withholds them on the
// server and this draws one fixed-width blurred line in their place, the
// Locations-tab rule. The web upsell is one line; in the iPhone app it is the
// inert badge Apple's rules allow, with no price and no "upgrade".

const FIRST = 5;

export type RecentVisitRow = RecentVisit & { when: string };

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

function Row({ v }: { v: RecentVisitRow }) {
  const page = v.surface === "links" ? "Swift Links" : "Card";
  const visit = v.visitNumber ? `${ordinal(v.visitNumber)} visit` : null;
  const deviceLine = [v.device, v.openedIn, v.from, v.duration].filter(Boolean).join(" · ");
  const network = v.network ? `On the ${v.network} network` : null;
  const whatLine = [network, v.place, visit, ...v.actions].filter(Boolean).join(" · ");
  return (
    <li className="bg-gray-800/40 border border-gray-800 rounded-xl px-3.5 py-2.5 min-w-0">
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <p className="text-gray-100 text-[0.8125rem] font-semibold truncate min-w-0">
          {v.who ?? (
            <span className="inline-flex items-center align-baseline">
              <span aria-hidden className="select-none pointer-events-none blur-[3px] opacity-70">████████</span>
              <span className="sr-only">A contact</span>
            </span>
          )}
          <span className="text-gray-500 font-medium"> · {page}</span>
        </p>
        <p className="text-gray-500 text-[0.6875rem] tabular-nums shrink-0">{v.when}</p>
      </div>
      {v.locked ? (
        <p className="text-gray-400 text-[0.6875rem] mt-0.5 leading-snug">
          <span aria-hidden className="select-none pointer-events-none blur-[3px] opacity-70">██████ · ████████ · ████</span>
          <span className="sr-only">Visit details are hidden</span>
          {visit && <span> · {visit}</span>}
        </p>
      ) : (
        <>
          {deviceLine && <p className="text-gray-400 text-[0.6875rem] mt-0.5 leading-snug break-words">{deviceLine}</p>}
          {whatLine && <p className="text-gray-500 text-[0.6875rem] mt-0.5 leading-snug break-words">{whatLine}</p>}
        </>
      )}
    </li>
  );
}

export default function RecentVisits({ visits, paid }: { visits: RecentVisitRow[]; paid: boolean }) {
  if (!visits.length) return null;
  const first = visits.slice(0, FIRST);
  const rest = visits.slice(FIRST);
  return (
    <div data-testid="recent-visits" className="mt-4 pt-3 border-t border-gray-800/70">
      <p className="text-gray-500 text-[0.6875rem] mb-2">Recent visits</p>
      <ul className="space-y-2">
        {first.map((v) => <Row key={v.id} v={v} />)}
      </ul>
      {rest.length > 0 && (
        <details className="group">
          <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none text-[0.6875rem] font-semibold text-blue-400 hover:text-blue-300 py-2.5 mt-1">
            <span className="group-open:hidden">Show more ({rest.length})</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="space-y-2">
            {rest.map((v) => <Row key={v.id} v={v} />)}
          </ul>
        </details>
      )}
      {!paid && (
        <PlanGate
          feature="analytics-visits"
          nativeCopy="Pro feature — Detailed analytics are only available on the Pro plan"
          nativeContent={
            <div className="flex items-center gap-2 mt-2.5">
              <PlanBadge />
              <p className="text-gray-500 text-[0.6875rem]">Visit details are only available on the Pro plan</p>
            </div>
          }
        >
          <p className="text-gray-500 text-[0.6875rem] mt-2.5 leading-relaxed">
            See the device, app, place and time on page for every visit.{" "}
            <Link href="/upgrade" className="font-semibold text-blue-400 hover:text-blue-300">Upgrade to Pro →</Link>
          </p>
        </PlanGate>
      )}
    </div>
  );
}
