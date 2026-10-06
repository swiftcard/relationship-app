"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { officeNotificationPath } from "@/lib/office-notification-links";

// The /office/admin team-inbox bell. A DISTINCT component from the personal
// NotificationBell: it polls /api/office/notifications (office_notifications
// table, keyed by office_id) and never touches /api/notifications (the personal
// per-user bell). Same interaction model, purple accent to match the console.

type OfficeNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function OfficeNotificationBell({
  initialNotifications,
}: {
  initialNotifications: OfficeNotification[];
}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState<"markAll" | "clearRead" | null>(null);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  const unread = notifications.filter((n) => !n.read).length;
  const readCount = notifications.filter((n) => n.read).length;

  // Poll for fresh team activity while the panel is closed.
  useEffect(() => {
    const poll = async () => {
      if (openRef.current) return;
      // Nobody is looking: a backgrounded tab kept polling forever. The
      // visibility listener below polls the moment it comes back, so this
      // costs nothing but the requests nobody was waiting for. Same guard
      // NotificationBell uses.
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/office/notifications");
        if (!res.ok) return;
        const fresh: OfficeNotification[] = await res.json();
        setNotifications((prev) => {
          // Server truth wins whenever ANYTHING differs — same fix as the
          // main NotificationBell (2026-08-26): the old new-ids-only guard
          // left this bell showing stale unread rows after a mark-all-read
          // made elsewhere. Poll only runs while the panel is closed, so no
          // optimistic update can be clobbered.
          const sig = (list: OfficeNotification[]) => list.map((n) => `${n.id}:${n.read ? 1 : 0}`).join(",");
          return sig(fresh) === sig(prev) ? prev : fresh;
        });
      } catch { /* ignore */ }
    };
    poll(); // now, not in 30s — opening the console is when admins check
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
    const idsToRevert = notifications.filter((n) => !n.read).map((n) => n.id);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      const res = await fetch("/api/office/notifications", { method: "PATCH" });
      if (!res.ok) throw new Error("failed");
    } catch {
      const revertSet = new Set(idsToRevert);
      setNotifications((prev) => prev.map((n) => (revertSet.has(n.id) ? { ...n, read: false } : n)));
    } finally {
      setBulkPending(null);
    }
  }

  async function setRead(id: string, read: boolean) {
    if (pendingIds.has(id)) return;
    setPendingIds((s) => new Set(s).add(id));
    const previousRead = notifications.find((n) => n.id === id)?.read;
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read } : n)));
    try {
      const res = await fetch("/api/office/notifications", {
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

  // Tapping a row opens the screen it is about (the same one its push opens)
  // and counts as reading it. The read is sent with keepalive so the
  // navigation cannot cancel it.
  function openRow(n: OfficeNotification) {
    setOpen(false);
    if (n.read) return;
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    fetch("/api/office/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id, read: true }),
      keepalive: true,
    }).catch(() => {});
  }

  async function dismiss(id: string) {
    if (pendingIds.has(id)) return;
    setPendingIds((s) => new Set(s).add(id));
    const removed = notifications.find((n) => n.id === id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      const res = await fetch("/api/office/notifications", {
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

  async function clearRead() {
    if (bulkPending) return;
    setBulkPending("clearRead");
    const removed = notifications.filter((n) => n.read);
    setNotifications((prev) => prev.filter((n) => !n.read));
    try {
      const res = await fetch("/api/office/notifications", {
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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        data-tour="admin-team-bell"
        className="relative p-1.5 text-gray-400 hover:text-white transition-colors"
        aria-label="Team notifications"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-purple-500 text-white text-[0.5625rem] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          {/* PORTALED to document.body for the same reason as the personal bell:
              this sits inside the backdrop-blur admin header, which becomes the
              containing block for `fixed` children — so in place this click-away
              layer only covered the header strip and clicks on the page below
              never closed the panel. */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          {/* Centred on the page, like the personal bell (owner, 2026-09-29). */}
          <div
            role="dialog"
            aria-label="Team notifications"
            className="sc-drop-in fixed z-[61] left-0 right-0 mx-auto top-[calc(env(safe-area-inset-top)+86px)] w-[min(360px,calc(100vw-1.5rem))] max-h-[70vh] bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col"
            style={{ transformOrigin: "top center" }}
          >
            <div className="relative flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">Team notifications</p>
                <p className="text-[0.625rem] text-gray-500">Important updates about your team</p>
              </div>
              <div className="flex items-center gap-3">
                {unread > 0 && (
                  <button
                    onClick={markAllRead}
                    disabled={bulkPending !== null}
                    className="text-xs text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-gray-400 text-sm">No team updates yet</p>
                  <p className="text-gray-600 text-xs mt-1">Who joins, a teammate&apos;s first lead, leads with no follow-up, team milestones and your team&apos;s week show up here. Your own card&apos;s notifications stay in the bell on your dashboard.</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className={`group px-4 py-3 transition-colors ${n.read ? "" : "bg-purple-950/40"}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.read ? "bg-gray-700" : "bg-purple-500"}`} />
                      {/* The whole text block is the link. Titles WRAP: a
                          truncated "Your team passed 1,000 card vie…" hid the
                          one word that said what happened. */}
                      <Link
                        href={officeNotificationPath(n.type)}
                        onClick={() => openRow(n)}
                        className="min-w-0 flex-1 rounded-md -m-1 p-1 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-500"
                      >
                        <p className="text-white text-xs font-semibold leading-snug break-words">{n.title}</p>
                        {n.body && <p className="text-gray-400 text-xs mt-0.5 leading-relaxed break-words">{n.body}</p>}
                        <p suppressHydrationWarning className="text-gray-500 text-[0.6875rem] mt-1 truncate">{timeAgo(n.created_at)}</p>
                      </Link>
                      <button
                        onClick={() => setRead(n.id, !n.read)}
                        disabled={pendingIds.has(n.id)}
                        title={n.read ? "Mark as unread" : "Mark as read"}
                        aria-label={n.read ? "Mark as unread" : "Mark as read"}
                        className={`shrink-0 text-[0.625rem] font-medium px-2 py-0.5 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          n.read
                            ? "border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500"
                            : "border-purple-700 bg-purple-600/15 text-purple-300 hover:bg-purple-600/25"
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
                ))
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
