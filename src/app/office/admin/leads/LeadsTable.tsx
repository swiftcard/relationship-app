"use client";

import { useMemo, useState } from "react";
import { relativeTime } from "@/lib/relative-time";
import { useDisplayClock } from "@/components/DisplayClock";
// The status vocabulary comes from lib/lead-status, NOT lib/office-leads:
// office-leads reaches for the service-role database client, and importing a
// value from it here would put that module on this client bundle's path.
// OfficeLead stays a TYPE import, which the compiler erases entirely.
import { FOLLOW_UP_COPY, FOLLOW_UP_STATES, type FollowUpState } from "@/lib/lead-followup";
import type { OfficeLead } from "@/lib/office-leads";
import DownloadLink from "@/components/DownloadLink";

// Client-side filter + search over the (already server-authorized) team leads.
// Filtering in the browser keeps it instant with zero round-trips, and the
// filters operate on what is LOADED — so the header states the exact total and
// how much of it is on screen, and "Load more" brings the rest in. Anything
// bigger than someone wants to scroll has Export, which takes every lead
// regardless of what is loaded.
//
// NOTHING ON THIS TABLE IS EDITABLE. It used to carry a CRM status — New /
// Contacted / Closed / Not interested — with a "Mark contacted" button, and the
// owner asked what it connected to (2026-09-11). Nothing: two of the four
// statuses had no writer anywhere in the product, and the one this button set
// appeared on no other screen, least of all the Contacts panel belonging to the
// teammate who would do the contacting. The column now shows the contact's
// follow-up state, which is derived from what their automations are actually
// doing (lib/lead-followup.ts) and is the same thing that teammate sees.

type Row = OfficeLead & { pending?: boolean; failed?: boolean };

// The badge's colours, kept beside the copy they belong to.
const FOLLOW_UP_TONE: Record<FollowUpState, string> = {
  none: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  running: "bg-green-500/10 text-green-400 border-green-500/20",
  paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  done: "bg-blue-500/10 text-blue-300 border-blue-500/20",
};
const FOLLOW_UP_DOT: Record<FollowUpState, string> = {
  none: "bg-gray-500",
  running: "bg-green-400",
  paused: "bg-amber-400",
  done: "bg-blue-400",
};

export default function LeadsTable({
  leads,
  total,
  hasMore: initialHasMore,
  initialFollowUp,
}: {
  leads: OfficeLead[];
  /** EXACT number of leads the office has, which may exceed what is loaded. */
  total: number;
  hasMore: boolean;
  /** Opened from a notification about one follow-up state (?followUp=none). */
  initialFollowUp?: FollowUpState;
}) {
  const [rows, setRows] = useState<Row[]>(leads);
  const [person, setPerson] = useState<string>("all");
  const [followUp, setFollowUp] = useState<"all" | FollowUpState>(initialFollowUp ?? "all");
  const [query, setQuery] = useState("");
  // Hydration-safe "x ago" (components/DisplayClock).
  const clock = useDisplayClock();
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // HOW MANY ROWS THE SERVER HAS HANDED OVER — deliberately not rows.length.
  //
  // Leads are ordered newest-first, so leads captured between two page loads
  // push every later row down and the next page repeats rows at the boundary.
  // The de-duplication below drops those repeats, making rows.length SMALLER
  // than the window the server has already served. Using rows.length as the
  // next offset then rewinds by exactly that many rows and re-requests what is
  // already on screen.
  //
  // Nothing is skipped by that — it under-advances, never over-advances — but
  // it can stall completely. Modelled with four leads arriving mid-scroll:
  // with rows.length the list stayed at four rows and FIVE consecutive "Load
  // more" clicks added nothing, because each one asked for the same window it
  // had already de-duplicated away. The button simply looks broken, and it
  // looks broken precisely when the office is busiest. Advancing by what the
  // server actually returned: twelve rows, one wasted click.
  const [serverOffset, setServerOffset] = useState(leads.length);
  // The exact total, refreshed from each page so a long session does not keep
  // quoting the figure from first render.
  const [knownTotal, setKnownTotal] = useState(total);

  // Built from the LOADED rows, so a teammate whose leads are all further down
  // appears in the filter as soon as their first one loads.
  const people = useMemo(
    () => Array.from(new Set(rows.map((l) => l.capturedBy))).sort(),
    [rows],
  );

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/office/leads/list?offset=${serverOffset}`);
      if (!res.ok) throw new Error("failed");
      const page = (await res.json()) as { leads: OfficeLead[]; hasMore: boolean; total: number };
      // De-duplicated on id for DISPLAY; the offset advances by what the
      // server actually returned, so dropping a repeat never rewinds the
      // window and skips the rows behind it.
      setRows((rs) => {
        const seen = new Set(rs.map((r) => r.id));
        return [...rs, ...page.leads.filter((l) => !seen.has(l.id))];
      });
      setServerOffset((o) => o + page.leads.length);
      if (typeof page.total === "number") setKnownTotal(page.total);
      setHasMore(page.hasMore);
    } catch {
      // Keep what is already on screen and offer a retry — never wipe the
      // list because one page failed.
      setLoadError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((l) => {
      if (person !== "all" && l.capturedBy !== person) return false;
      if (followUp !== "all" && l.followUp !== followUp) return false;
      if (q && !l.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, person, followUp, query]);

  return (
    <div>
      {/* How much of the whole is on screen, and the way to get all of it.
          The page used to print "600 so far" forever once the office passed the
          old cap, while the Team tab's per-person counts were uncapped — so the
          two tabs disagreed and neither said why. */}
      {knownTotal > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <p className="text-[0.6875rem] text-gray-500">
            {!hasMore
              ? `All ${knownTotal.toLocaleString()} contact${knownTotal === 1 ? "" : "s"}`
              : `Showing ${rows.length.toLocaleString()} of ${knownTotal.toLocaleString()} contacts`}
            {visible.length !== rows.length && ` · ${visible.length.toLocaleString()} match your filters`}
          </p>
          {/* DownloadLink, not fetch() and not next/link: the browser handles
              the download and the Content-Disposition filename, and inside the
              iOS shell WKWebView cannot save an attachment — DownloadLink
              opens it in the system browser sheet there instead of leaving a
              dead tap. Same component the personal contacts export uses. */}
          <DownloadLink
            href="/api/office/leads/export"
            title="Download every contact your team has captured"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
              <path fillRule="evenodd" d="M8 1a.75.75 0 01.75.75v6.19l1.22-1.22a.75.75 0 111.06 1.06l-2.5 2.5a.75.75 0 01-1.06 0l-2.5-2.5a.75.75 0 111.06-1.06l1.22 1.22V1.75A.75.75 0 018 1zM1.5 10.5a.75.75 0 01.75.75v1.5c0 .138.112.25.25.25h11a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 0113.5 14.5h-11A1.75 1.75 0 01.75 12.75v-1.5a.75.75 0 01.75-.75z" clipRule="evenodd" />
            </svg>
            Export all as CSV
          </DownloadLink>
        </div>
      )}

      {/* Search + filters — plain controls, no jargon. */}
      <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by contact name…"
          aria-label="Search contacts by name"
          className="flex-1 bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
        />
        <select
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          aria-label="Filter by team member"
          className="bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 sm:w-48"
        >
          <option value="all">Everyone on the team</option>
          {people.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value as "all" | FollowUpState)}
          aria-label="Filter by follow-up"
          className="bg-gray-900 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 sm:w-44"
        >
          <option value="all">Any follow-up</option>
          {FOLLOW_UP_STATES.map((st) => (
            <option key={st} value={st}>{FOLLOW_UP_COPY[st].label}</option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-10 text-center">
          <p className="text-gray-400 text-sm">
            {knownTotal === 0
              ? "No contacts yet — they appear here automatically when someone shares their info with any of your team's cards, or a teammate scans or adds one."
              : hasMore
              // Filters only see what is loaded, so "nothing matches" would be
              // a lie while there are still pages to fetch.
              ? "Nothing on this page matches those filters. Load more below, or export everything."
              : "Nothing matches those filters."}
          </p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="hidden lg:grid grid-cols-12 gap-3 px-5 py-2.5 border-b border-gray-800 bg-gray-900/60 text-[0.6875rem] font-semibold text-gray-500 uppercase tracking-wider">
            <p className="col-span-3">Contact</p>
            <p className="col-span-3">Email &amp; phone</p>
            <p className="col-span-2">Captured by</p>
            <p className="col-span-2">Follow-up</p>
            <p className="col-span-2">When</p>
          </div>
          <div className="divide-y divide-gray-800">
            {visible.map((l) => {
              // Fall back rather than throw. `followUp` is derived server-side,
              // so a row without it means a stale payload or an older cached
              // page — and a whole team's lead list going blank over one missing
              // derived field would be a far worse failure than showing "No
              // follow-up" for a moment.
              const state = l.followUp ?? "none";
              const fu = FOLLOW_UP_COPY[state] ?? FOLLOW_UP_COPY.none;
              return (
                <div key={l.id} className="grid grid-cols-12 gap-3 px-5 py-3 items-center">
                  <div className="col-span-12 lg:col-span-3 min-w-0">
                    <p className="text-sm text-white truncate">{l.name}</p>
                  </div>
                  <div className="col-span-12 lg:col-span-3 min-w-0">
                    <p className="text-xs text-gray-400 truncate">{l.email || "No email"}</p>
                    <p className="text-xs text-gray-600 truncate">{l.phone || "No phone"}</p>
                  </div>
                  {/* The person's NAME — never a card URL slug. */}
                  <p className="col-span-6 lg:col-span-2 text-xs text-gray-400 truncate">{l.capturedBy}</p>
                  {/* DERIVED, never set here. The badge says what the contact's
                      own follow-up is doing, which is the same thing the
                      teammate who owns them sees on the contact itself. There
                      is nothing for an admin to mark, so nothing can go stale. */}
                  <div className="col-span-6 lg:col-span-2 min-w-0">
                    <span
                      title={fu.hint}
                      className={`inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full border ${FOLLOW_UP_TONE[state]}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${FOLLOW_UP_DOT[state]}`} aria-hidden="true" />
                      {fu.label}
                    </span>
                  </div>
                  <p className="col-span-6 lg:col-span-2 text-xs text-gray-600 whitespace-nowrap">
                    {relativeTime(l.created_at, clock.now)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Load more. Sits under the table because that is where someone
          scrolling to the bottom looks for it. Disabled rather than hidden
          while a page is in flight, so the button never jumps away from the
          cursor mid-click. */}
      {hasMore && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full sm:w-auto px-5 py-2.5 rounded-full text-xs font-semibold border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
          >
            {loadingMore
              ? "Loading…"
              : `Load more — ${Math.max(0, knownTotal - rows.length).toLocaleString()} to go`}
          </button>
          {loadError && (
            <p className="text-[0.6875rem] text-red-400">
              Couldn&apos;t load more just now. Your list is still here — try again.
            </p>
          )}
        </div>
      )}

      {knownTotal > 0 && (
        <p className="text-[0.6875rem] text-gray-600 mt-3">
          Follow-up is whatever the contact&apos;s own email and text automations are doing — your
          teammate sets those on the contact, and this follows along.
        </p>
      )}
    </div>
  );
}
