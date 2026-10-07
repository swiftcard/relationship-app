"use client";

import { setAppBadge } from "@/lib/app-badge";
import { Fragment, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import NotificationBody from "@/components/NotificationBody";
import SeeWhoLink from "@/components/SeeWhoLink";
import { useIsNativeApp } from "@/lib/platform";
import { NATIVE_BODY_REMAP, NATIVE_HIDDEN_TYPES } from "@/lib/native-notification-copy";
import PushAskCallout, { usePushAsk } from "@/components/PushAskCallout";
import { pickAskCandidate } from "@/lib/push-ask";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
  // Which card this notification belongs to (username slug). Null/absent for
  // account-level notifications (referrals etc.) and legacy rows.
  card_owner?: string | null;
  /** The known contact this row is about (paid accounts; api/notifications). */
  lead_id?: string | null;
};

// Rows about a contact open Contacts: the contact itself when the row knows
// who (lead_id — withheld on Free for a blurred name), else that card's
// contacts.
const CONTACT_TYPES = new Set(["new_lead", "contact_saved", "card_viewed", "lead_reply", "contact_returned", "contact_engaged"]);

// "X is back" rows about a KNOWN contact. Their device was matched to that
// contact, and a match can be wrong (a shared laptop, a forwarded link), so
// these rows carry "Wrong person?" (/api/leads/[id]/wrong-person). It lived in
// the dashboard's Notifications list until that went with Quick Contacts
// (owner, 2026-09-29) and moved here, the one list left. Only with a lead_id:
// on Free a blurred name arrives without one, and there is nothing to unbind.
const NAMED_RETURN_TYPES = new Set(["contact_returned", "contact_engaged"]);

function contactHref(n: Notification): string {
  const card = n.card_owner ? `card=${encodeURIComponent(n.card_owner)}` : "";
  if (n.lead_id) return `/contacts?${card ? `${card}&` : ""}lead=${encodeURIComponent(n.lead_id)}`;
  return card ? `/contacts?${card}` : "/contacts";
}

// Referral rows open the Refer a friend section, where the Claim button is.
// "Congratulations — … Tap here and it comes off your next bill" was a row
// that could not be tapped (2026-10-02 notification audit). Hidden in the app
// either way (referral_claim, below).
const REFERRAL_ROW_TYPES = new Set(["referral_claim", "referral_progress"]);

/** Where tapping this row goes, or null for a row that is just information. */
function rowHref(n: Notification): string | null {
  if (CONTACT_TYPES.has(n.type)) return contactHref(n);
  if (REFERRAL_ROW_TYPES.has(n.type)) return "/grow#refer";
  return null;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationBell({
  initialNotifications,
  cardLabels,
}: {
  initialNotifications: Notification[];
  // username → display label, for the per-card tag on each notification.
  cardLabels?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  // Per-item in-flight ids (Read/Unread + dismiss) and a bulk-action flag
  // (Mark all read / Clear read) — disables the triggering control while its
  // request is outstanding (prevents a double-tap firing duplicate requests)
  // and reverts the optimistic update if the request actually fails, instead
  // of silently leaving a stale "read"/dismissed state on a dropped request.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState<"markAll" | "clearRead" | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // "Get notifications like this on your phone" — under ONE row at most (the
  // newest unread new contact / reply / contact download), only while the
  // dropdown is open, and only when the rules in lib/push-ask.ts allow it.
  // Inside the iPhone app, the same rows the dashboard list hides or rewords
  // (lib/native-notification-copy — App Review 3.1.1). The web is unchanged.
  const isNative = useIsNativeApp();
  const shown = isNative
    ? notifications
        .filter((n) => n.type !== "referral_claim" && !NATIVE_HIDDEN_TYPES.has(n.type))
        .map((n) => (NATIVE_BODY_REMAP[n.type] ? { ...n, body: NATIVE_BODY_REMAP[n.type] } : n))
    : notifications;
  const unread = shown.filter((n) => !n.read).length;
  const readCount = shown.filter((n) => n.read).length;
  // The app icon's red number follows the bell: reading here clears it
  // (lib/app-badge; a no-op on the web and on app builds before 1.0.6).
  useEffect(() => {
    if (isNative) setAppBadge(unread);
  }, [isNative, unread]);
  const askId = pickAskCandidate(shown);
  const ask = usePushAsk("bell", askId, open);

  useEffect(() => {
    const poll = async () => {
      if (openRef.current) return;
      // Nobody is looking: a backgrounded tab kept polling forever. The
      // visibility listener below polls the moment it comes back, so this
      // costs nothing but the requests nobody was waiting for.
      if (document.visibilityState === "hidden") return;
      try {
        // The bell watches EVERY card (no ?card= scope) — activity on any card
        // shows here, tagged with that card's name.
        const res = await fetch("/api/notifications");
        if (!res.ok) return;
        const fresh: Notification[] = await res.json();
        setNotifications((prev) => {
          // Server truth wins whenever ANYTHING differs — id set, order, or a
          // read flag. The old guard only replaced state on NEW ids, so a
          // "mark all read" done on another device
          // left this bell showing stale unread rows until the next genuinely
          // new notification arrived — reads seemed to "come back". The poll
          // only runs while the panel is closed, so no local optimistic
          // update can be clobbered here.
          // Title and body too: a visit's row is UPGRADED in place (a view
          // becomes "…shared their info", a milestone, a link tap) with the
          // same id and read flag, and an account that just went Pro gets the
          // same rows back with the place and name no longer blocked out.
          // Comparing ids alone kept the stale words — blurred places and a
          // "See who and where" on a paid account — until a full reload.
          const sig = (list: Notification[]) => list.map((n) => `${n.id}:${n.read ? 1 : 0}:${n.title}:${n.body ?? ""}`).join("\n");
          return sig(fresh) === sig(prev) ? prev : fresh;
        });
      } catch { /* ignore */ }
    };

    // Poll NOW, not in 30 seconds. The interval alone meant opening the app —
    // which is exactly when someone checks whether their card was viewed —
    // showed whatever was true up to half a minute ago, and a push that had
    // already buzzed the phone led to a bell that still looked empty.
    poll();

    // And again whenever the app comes back to the foreground. In the iOS
    // shell a backgrounded webview's timers are suspended, so without this the
    // first thing a returning user sees is stale by however long they were
    // away.
    // Returning to the app fires BOTH visibilitychange and focus, which was two
    // identical requests per return; one poll per 2s is plenty.
    let lastReturnPoll = 0;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastReturnPoll < 2000) return;
      lastReturnPoll = now;
      poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    const id = setInterval(poll, 30000);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  async function markAllRead() {
    if (bulkPending) return;
    setBulkPending("markAll");
    // Revert only the ids THIS action actually flipped (the ones unread at
    // the moment it started) — not a snapshot/restore of the whole list,
    // which would also undo a different notification's dismiss/read-toggle
    // that independently succeeded while this request was in flight (code
    // review — same reasoning as the setRead/dismiss fix above).
    const idsToRevert = notifications.filter((n) => !n.read).map((n) => n.id);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      const res = await fetch("/api/notifications", { method: "PATCH" });
      if (!res.ok) throw new Error("failed");
    } catch {
      const revertSet = new Set(idsToRevert);
      setNotifications((prev) => prev.map((n) => (revertSet.has(n.id) ? { ...n, read: false } : n)));
    } finally {
      setBulkPending(null);
    }
  }

  // Toggle ONE notification read/unread — the badge only drops when the user
  // explicitly marks items read (individually here, or in bulk above).
  // Reverts only THIS notification's own prior state on failure — snapshotting
  // and restoring the whole list would clobber a DIFFERENT notification's
  // change that succeeded while this one was still in flight (code review).
  async function setRead(id: string, read: boolean) {
    if (pendingIds.has(id)) return;
    setPendingIds((s) => new Set(s).add(id));
    const previousRead = notifications.find((n) => n.id === id)?.read;
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read } : n)));
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, read }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      if (previousRead !== undefined) {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: previousRead } : n)));
      }
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  // Remove a single notification for good (not just mark it read). Reverts by
  // re-inserting only THIS notification (in its original time order) on
  // failure — same reasoning as setRead above.
  async function dismiss(id: string) {
    if (pendingIds.has(id)) return;
    setPendingIds((s) => new Set(s).add(id));
    const removed = notifications.find((n) => n.id === id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      const res = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      if (removed) {
        setNotifications((prev) =>
          [...prev, removed].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        );
      }
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  // "Wrong person?" → Confirm. Optimistic like dismiss: the row goes at once
  // and comes back — saying so — if the request fails. The route unbinds the
  // browser(s) from that contact and deletes this notification.
  const [wrongAsked, setWrongAsked] = useState<string | null>(null);
  const [wrongFailed, setWrongFailed] = useState<string | null>(null);
  async function markWrongPerson(n: Notification) {
    if (!n.lead_id || pendingIds.has(n.id)) return;
    setWrongAsked(null);
    setWrongFailed(null);
    setPendingIds((s) => new Set(s).add(n.id));
    setNotifications((prev) => prev.filter((x) => x.id !== n.id));
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(n.lead_id)}/wrong-person`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: n.id }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setNotifications((prev) =>
        [...prev, n].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      );
      setWrongFailed(n.id);
    } finally {
      setPendingIds((s) => { const x = new Set(s); x.delete(n.id); return x; });
    }
  }

  // Clear out everything already read in one tap.
  async function clearRead() {
    if (bulkPending) return;
    setBulkPending("clearRead");
    // Revert by re-inserting only the specific notifications THIS action
    // removed, not a snapshot/restore of the whole list — same reasoning as
    // markAllRead above.
    const removed = notifications.filter((n) => n.read);
    setNotifications((prev) => prev.filter((n) => !n.read));
    try {
      const res = await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setNotifications((prev) =>
        [...prev, ...removed].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      );
    } finally {
      setBulkPending(null);
    }
  }

  function handleOpen() {
    // Just open/close. Notifications stay UNREAD (and the badge stays) until the
    // user explicitly marks them read or dismisses them — opening no longer
    // silently clears everything. A half-finished "Wrong person?" (or its error)
    // never greets someone who reopens the bell later.
    setWrongAsked(null);
    setWrongFailed(null);
    setOpen((v) => !v);
  }

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        className="relative p-1.5 text-gray-400 hover:text-white transition-colors"
        aria-label="Notifications"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[0.5625rem] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          {/* Backdrop — click anywhere outside to close.
              PORTALED to document.body: this bell sits inside a backdrop-blur
              nav bar, and backdrop-filter makes that bar the containing block
              for `fixed` descendants — so rendered in place this "full screen"
              layer was only as tall as the ~56px nav, leaving clicks on the page
              below to fall through to whatever was under the cursor instead of
              closing the panel. The dropdown is portaled with it so both keep
              measuring against the real viewport. */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />

          {/* Dropdown menu — pinned to the VIEWPORT (below the nav bar),
              CENTRED on the page (owner, 2026-09-29: this is the notification
              centre now that the dashboard's list is gone). Anchoring it to the
              bell pushed its left side off-screen on phones; it then sat
              against the right edge, off-centre on a phone and at the far right
              of a computer. left-0 right-0 mx-auto centres it without a
              transform, which the drop-in animation owns — so it grows from
              its top centre, not the corner. */}
          <div
            role="dialog"
            aria-label="Notifications"
            className="sc-drop-in fixed z-[61] left-0 right-0 mx-auto top-[calc(env(safe-area-inset-top)+4.25rem)] w-[min(360px,calc(100vw-1.5rem))] max-h-[70vh] bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col"
            style={{ transformOrigin: "top center" }}
          >

            <div className="relative flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
              <p className="text-sm font-bold text-white">Notifications</p>
              <div className="flex items-center gap-3">
                {unread > 0 && (
                  <button
                    onClick={markAllRead}
                    disabled={bulkPending !== null}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bulkPending === "markAll" ? "Marking…" : "Mark all read"}
                  </button>
                )}
                {readCount > 0 && (
                  <button
                    onClick={clearRead}
                    disabled={bulkPending !== null}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bulkPending === "clearRead" ? "Clearing…" : "Clear read"}
                  </button>
                )}
                <button onClick={() => setOpen(false)} aria-label="Close" className="text-gray-500 hover:text-white transition-colors text-lg leading-none -mr-0.5">✕</button>
              </div>
            </div>

            <div className="overflow-y-auto divide-y divide-gray-800">
              {shown.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-gray-400 text-sm">No notifications yet</p>
                  <p className="text-gray-600 text-xs mt-1">You&apos;ll see new leads here</p>
                </div>
              ) : (
                shown.map((n) => (
                  <Fragment key={n.id}>
                  {/* border-b-0 when the reminder hangs under this row: the
                      list's divider would otherwise cut the row from it. */}
                  <div className={`group px-4 py-3 transition-colors ${n.read ? "" : "bg-blue-950"} ${n.id === askId && ask.show ? "border-b-0" : ""}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.read ? "bg-gray-700" : "bg-blue-500"}`} />
                      {/* Opening a row is reading it: it used to stay unread
                          (and counted on the badge) after you had gone to it,
                          unlike the team inbox, which marks on tap. */}
                      <div
                        className={`min-w-0 flex-1 ${rowHref(n) ? "cursor-pointer" : ""}`}
                        onClick={rowHref(n) ? () => { if (!n.read) void setRead(n.id, true); setOpen(false); router.push(rowHref(n)!); } : undefined}
                        role={rowHref(n) ? "button" : undefined}
                      >
                        <p className="text-white text-xs font-semibold truncate"><NotificationBody text={n.title} /></p>
                        {/* Same renderer as the dashboard list: on a Free
                            account the place a view came from arrives blocked
                            out from the server, and this blurs what is left. */}
                        {n.body && <p className="text-gray-400 text-xs mt-0.5 leading-relaxed"><NotificationBody text={n.body} /></p>}
                        <SeeWhoLink text={`${n.title} ${n.body ?? ""}`} />
                        {NAMED_RETURN_TYPES.has(n.type) && n.lead_id && (
                          wrongAsked === n.id ? (
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[0.6875rem]">
                              <span className="text-gray-400">Not them? We&apos;ll stop recognising that device.</span>
                              <button type="button" onClick={(e) => { e.stopPropagation(); markWrongPerson(n); }} className="font-semibold text-blue-400 hover:text-blue-300">Confirm</button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); setWrongAsked(null); }} className="text-gray-500 hover:text-gray-300">Cancel</button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setWrongAsked(n.id); }}
                              className="mt-1.5 text-[0.6875rem] text-gray-500 hover:text-gray-300 underline underline-offset-2"
                            >
                              Wrong person?
                            </button>
                          )
                        )}
                        {wrongFailed === n.id && (
                          <p role="status" className="mt-1 text-[0.6875rem] text-red-400">Couldn&apos;t do that just now — try again.</p>
                        )}
                        {/* Meta line: card tag + time — chip lives here so the
                            title keeps full width on narrow phones. */}
                        <div className="flex items-center gap-2 mt-1 min-w-0">
                          {/* Only worth a chip when there is a card to tell it
                              apart from: one-card accounts saw their own name
                              on every row. A slug that isn't theirs (a team
                              card) still gets one. */}
                          {n.card_owner && (!cardLabels || Object.keys(cardLabels).length > 1 || !(n.card_owner in cardLabels)) && (
                            <span className="shrink-0 text-[0.5625rem] font-bold px-1.5 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400 max-w-[130px] truncate" title={`Card: ${cardLabels?.[n.card_owner] ?? n.card_owner}`}>
                              {cardLabels?.[n.card_owner] ?? n.card_owner}
                            </span>
                          )}
                          {/* Relative time is clock-dependent: if the minute ticks
                              between SSR and hydration the strings differ (React
                              #418). The drift is cosmetic, so suppress it. */}
                          <p suppressHydrationWarning className="text-gray-500 text-[0.6875rem] truncate">{timeAgo(n.created_at)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setRead(n.id, !n.read)}
                        disabled={pendingIds.has(n.id)}
                        title={n.read ? "Mark as unread" : "Mark as read"}
                        aria-label={n.read ? "Mark as unread" : "Mark as read"}
                        className={`shrink-0 text-[0.625rem] font-medium px-2 py-0.5 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          n.read
                            ? "border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500"
                            : "border-blue-700 bg-blue-600/15 text-blue-300 hover:bg-blue-600/25"
                        }`}
                      >
                        {n.read ? "Unread" : "Read"}
                      </button>
                      <button
                        onClick={() => dismiss(n.id)}
                        disabled={pendingIds.has(n.id)}
                        aria-label="Dismiss notification"
                        title="Dismiss"
                        className="shrink-0 -mt-0.5 -mr-1 p-1 text-gray-600 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {n.id === askId && <PushAskCallout ask={ask} />}
                  </Fragment>
                ))
              )}
            </div>
            {/* No "View all notifications" footer: the dashboard list it opened
                went with Quick Contacts (owner, 2026-09-29) — this IS the list. */}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
