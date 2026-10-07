"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useDisplayClock } from "@/components/DisplayClock";
import { relativeTime, shortDate, shortDateTime } from "@/lib/relative-time";
// Client-safe modules only: lib/office-contact-detail (the server half) is
// reached through a TYPE import, which the compiler erases.
import { FOLLOW_UP_COPY, type FollowUpState } from "@/lib/lead-followup";
import {
  buildContactTimeline,
  deliveryLabel,
  describeArrival,
  firstName,
  type OfficeContactDetail,
} from "@/lib/office-contact-timeline";

// ── One contact, opened from the admin console ───────────────────────────────
// Owner, 2026-10-07: click a contact and see when they were added, how, which
// teammate they belong to, and the activity and messages between that teammate
// and them. Same shell as the Team tab's person drawer (TeamList), so the
// console has one way of opening "the details of a thing".
//
// READ-ONLY, like the table it opens from. The teammate's private notes are
// never sent here (lib/office-contact-detail doesn't select them).

// The follow-up badge's colours, shared with the Contacts table.
export const FOLLOW_UP_TONE: Record<FollowUpState, string> = {
  none: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  running: "bg-green-500/10 text-green-400 border-green-500/20",
  paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  done: "bg-blue-500/10 text-blue-300 border-blue-500/20",
};
export const FOLLOW_UP_DOT: Record<FollowUpState, string> = {
  none: "bg-gray-500",
  running: "bg-green-400",
  paused: "bg-amber-400",
  done: "bg-blue-400",
};

export function FollowUpBadge({ state }: { state: FollowUpState | undefined }) {
  // Fall back rather than throw: `followUp` is derived server-side, and a
  // missing derived field must never take the whole list down.
  const s = state ?? "none";
  const fu = FOLLOW_UP_COPY[s] ?? FOLLOW_UP_COPY.none;
  return (
    <span
      title={fu.hint}
      className={`inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full border ${FOLLOW_UP_TONE[s] ?? FOLLOW_UP_TONE.none}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${FOLLOW_UP_DOT[s] ?? FOLLOW_UP_DOT.none}`} aria-hidden="true" />
      {fu.label}
    </span>
  );
}

/** A plain click opens in place; a modified click is the browser's (new tab, etc.). */
export function isPlainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

const SECTION = "text-[0.625rem] font-semibold text-gray-500 uppercase tracking-wider mb-1.5";

export default function ContactDrawer({
  contactId,
  initial,
  closeHref,
  onClose,
}: {
  contactId: string;
  /** Loaded on the server for a ?contact= link, so it opens already filled. */
  initial?: OfficeContactDetail | null;
  /** Where the close control goes when it is followed as a link (before hydration). */
  closeHref: string;
  onClose: () => void;
}) {
  const clock = useDisplayClock();
  const [detail, setDetail] = useState<OfficeContactDetail | null>(initial && initial.id === contactId ? initial : null);
  const [failure, setFailure] = useState<null | "missing" | "error">(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (detail) return;
    let live = true;
    fetch(`/api/office/contacts/${encodeURIComponent(contactId)}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404) {
          if (live) setFailure("missing");
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as OfficeContactDetail;
        if (live) setDetail(d);
      })
      .catch(() => {
        if (live) setFailure("error");
      });
    return () => {
      live = false;
    };
  }, [contactId, attempt, detail]);

  // Escape closes, like every other sheet in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function close(e: MouseEvent<HTMLAnchorElement>) {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={detail ? `${detail.name} details` : "Contact details"}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      {/* Safe area: a fixed sheet opens flush with the physical top of the
          screen, under the clock and the Dynamic Island in the app shells.
          Same remedy as the Team drawer. */}
      <aside
        className="relative w-full sm:max-w-md bg-gray-900 border-l border-gray-800 h-full overflow-y-auto px-5"
        style={{
          paddingTop: "calc(1.25rem + env(safe-area-inset-top))",
          paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <p className="text-white font-bold break-words">{detail?.name ?? "Contact"}</p>
            {detail?.company && <p className="text-gray-500 text-xs break-words">{detail.company}</p>}
          </div>
          {/* A link, not a button: before hydration a button does nothing,
              and this has to close the sheet from the first paint. */}
          <a href={closeHref} onClick={close} aria-label="Close" className="text-gray-500 hover:text-white text-2xl leading-none px-1 shrink-0">
            ×
          </a>
        </div>

        {!detail ? (
          failure === "missing" ? (
            <p className="text-gray-400 text-sm">This contact isn&apos;t part of your team&apos;s contacts any more.</p>
          ) : failure === "error" ? (
            <div>
              <p className="text-gray-400 text-sm">Couldn&apos;t load this contact just now.</p>
              <button
                onClick={() => {
                  setFailure(null);
                  setAttempt((n) => n + 1);
                }}
                className="mt-3 text-xs font-semibold text-gray-300 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
              >
                Try again
              </button>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Loading…</p>
          )
        ) : (
          <ContactBody detail={detail} now={clock.now} timeZone={clock.timeZone} />
        )}
      </aside>
    </div>
  );
}

function ContactBody({ detail: d, now, timeZone }: { detail: OfficeContactDetail; now: number; timeZone: string | undefined }) {
  const clock = { now, timeZone };
  const arrival = describeArrival(d);
  const timeline = buildContactTimeline(d);
  const teammate = d.owner.isFormer ? "this teammate" : firstName(d.owner.name, "this teammate");
  const facts = [
    ["Email", d.email],
    ["Phone", d.phone],
    ["Location", d.location],
  ].filter(([, v]) => !!v) as [string, string][];

  return (
    <div>
      {facts.length > 0 && (
        <div className="space-y-1 mb-5">
          {facts.map(([k, v]) => (
            <p key={k} className="text-xs text-gray-400 break-words">
              <span className="text-gray-600">{k}: </span>
              {v}
            </p>
          ))}
        </div>
      )}

      {/* Whose contact this is — the teammate's NAME, never a card address. */}
      <div className="rounded-xl border border-gray-800 bg-gray-950/50 px-3.5 py-3 mb-3">
        <p className={SECTION}>Belongs to</p>
        <p className="text-sm text-white">{d.owner.name}</p>
        {d.owner.userId && !d.owner.isFormer && (
          <Link href={`/office/admin/analytics/${d.owner.userId}`} className="inline-block mt-1 text-xs font-semibold text-gray-400 hover:text-white transition-colors">
            See {teammate}&apos;s analytics →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 mb-5">
        <div className="rounded-xl border border-gray-800 bg-gray-950/50 px-3.5 py-3">
          <p className={SECTION}>Added</p>
          <p className="text-sm text-white">{shortDateTime(d.createdAt, clock.timeZone)}</p>
          <p className="text-[0.6875rem] text-gray-500 mt-0.5">{relativeTime(d.createdAt, clock.now)}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-950/50 px-3.5 py-3">
          <p className={SECTION}>How they were added</p>
          <p className="text-sm text-white">{arrival.title}</p>
          {arrival.via && <p className="text-[0.6875rem] text-gray-500 mt-0.5">{d.source === "manual" || d.source === "scanner" || d.source === "imported" ? arrival.via : `Via ${arrival.via}`}</p>}
        </div>
      </div>

      <p className={SECTION}>Follow-up</p>
      <div className="mb-5">
        <FollowUpBadge state={d.followUp} />
        {d.upcomingSteps.length > 0 && (
          <div className="mt-2 space-y-1">
            {d.upcomingSteps.map((s, i) => (
              <p key={i} className="text-xs text-gray-400">
                {s.channel === "sms" ? "Text" : "Email"} · {s.paused ? "paused" : `sends ${shortDate(s.sendsAt, clock.timeZone)}`}
              </p>
            ))}
          </div>
        )}
      </div>

      <p className={SECTION}>Activity &amp; messages</p>
      {d.history.hiddenBecause === "owner_private" && (
        <p className="text-[0.6875rem] text-gray-500 mb-3">
          Messages and activity on {teammate}&apos;s own contacts are visible only to {teammate}.
        </p>
      )}
      {d.history.hiddenBecause === "no_record" && (
        <p className="text-[0.6875rem] text-gray-500 mb-3">
          Messages and activity aren&apos;t shown: there&apos;s no record of when {teammate} was on the team.
        </p>
      )}
      {d.history.from && (
        <p className="text-[0.6875rem] text-gray-500 mb-3">
          Shown from when {teammate} joined the team ({shortDate(d.history.from, clock.timeZone)}). Anything before that stays private to them.
        </p>
      )}
      {d.history.until && (
        <p className="text-[0.6875rem] text-gray-500 mb-3">
          History stops when they left the team ({shortDate(d.history.until, clock.timeZone)}).
        </p>
      )}

      <div className="space-y-3">
        {timeline.map((it) => {
          if (it.kind === "out") {
            const sms = it.channel === "sms";
            const status = deliveryLabel(it.status);
            return (
              <div key={it.key} className="flex flex-col items-end">
                <div className={`max-w-[85%] text-white rounded-2xl rounded-br-md px-3.5 py-2.5 text-[0.8125rem] whitespace-pre-wrap break-words leading-relaxed ${sms ? "bg-emerald-600" : "bg-blue-600"}`}>
                  {it.body}
                </div>
                <span className="text-gray-600 text-[0.625rem] mt-1 pr-1 flex flex-wrap justify-end items-center gap-1.5">
                  <span>{it.who}</span>
                  <span className={`px-1.5 py-px rounded font-semibold ${sms ? "bg-emerald-900/50 text-emerald-300" : "bg-blue-900/50 text-blue-300"}`}>
                    {sms ? "Text" : "Email"}
                  </span>
                  <span className={status.tone}>
                    {status.text} · {shortDateTime(it.at, clock.timeZone)}
                  </span>
                </span>
              </div>
            );
          }
          if (it.kind === "in") {
            return (
              <div key={it.key} className="flex flex-col items-start">
                <div className="max-w-[85%] bg-gray-800 text-gray-200 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[0.8125rem] whitespace-pre-wrap break-words leading-relaxed">
                  {it.body}
                </div>
                <span className="text-gray-600 text-[0.625rem] mt-1 pl-1">
                  {it.who} · {shortDateTime(it.at, clock.timeZone)}
                </span>
              </div>
            );
          }
          return (
            <div key={it.key} className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs text-gray-300 shrink-0">{it.icon}</div>
              <div className="min-w-0 flex-1">
                <p className="text-gray-300 text-[0.8125rem] leading-snug break-words">
                  {it.text}
                  {it.via && <span className="text-[0.625rem] text-blue-400 whitespace-nowrap"> · via {it.via}</span>}
                </p>
                <p className="text-gray-600 text-[0.625rem] mt-0.5">{shortDateTime(it.at, clock.timeZone)}</p>
              </div>
            </div>
          );
        })}
        {d.history.shown && timeline.length === 1 && (
          <p className="text-[0.6875rem] text-gray-600">Nothing since — no messages, visits or downloads yet.</p>
        )}
      </div>

      <p className="text-[0.6875rem] text-gray-600 mt-6 pt-4 border-t border-gray-800">
        Read-only. {d.owner.isFormer ? "Their" : `${teammate}'s`} private notes on this contact are never shown here.
      </p>
    </div>
  );
}
