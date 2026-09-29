"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ACTIVE_KEY = "swiftcard_active_card";

type Card = {
  id: string;
  username: string;
  name: string | null;
  title: string | null;
  label?: string | null;
  is_offline?: boolean | null;
};

export default function ManageCards({
  cards,
  canDelete = true,
  canRestore = true,
}: {
  cards: Card[];
  /**
   * False for office SUB-USERS: the card belongs to the company, and they have
   * never had a delete control, so they see their card's status here but
   * cannot remove it. (They edit it from the dashboard's My Cards, like
   * everyone else.)
   */
  canDelete?: boolean;
  /**
   * False for office sub-users: a company card's online/offline state is the
   * admin's (PATCH refuses it for an office card), so "Bring online" could only
   * ever fail. They're told who turned it off instead.
   */
  canRestore?: boolean;
}) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which card is asking "are you sure?".
   *
   * Deletion used to go through a native confirm(). That is technically two
   * steps, but it is a browser chrome dialog: it can't show the card you're
   * about to lose, its text is unstyled and truncated on some phones, and on
   * iOS it can be suppressed entirely by "block dialogs" — which would have
   * deleted the card with no prompt at all. This is an in-page step instead,
   * scoped to the row you pressed.
   */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // An offline card is invisible everywhere the owner would look for it — the
  // public page 404s, and so do its QR, NFC tag and wallet pass — while the
  // dashboard still lists it as though it were fine. Being removed from a team
  // turns cards off, so this is the state an ex-employee lands in, and until
  // now nothing in the product told them or offered them a way out.
  async function handleRestore(card: Card) {
    setRestoringId(card.id);
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_offline: false }),
      });
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
      setRestoringId(null);
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't bring the card back online. Try again.");
      setRestoringId(null);
      return;
    }
    setRestoringId(null);
    router.refresh();
  }

  async function handleDelete(card: Card) {
    setConfirmingId(null);
    setDeletingId(card.id);
    setError(null);

    let res: Response;
    try {
      res = await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
      setDeletingId(null);
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't delete the card. Try again.");
      setDeletingId(null);
      return;
    }

    try {
      if (localStorage.getItem(ACTIVE_KEY) === card.username) localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }

    setDeletingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {cards.length === 0 && (
        <p className="text-gray-600 text-xs">You don&apos;t have any cards yet.</p>
      )}

      {cards.map((card) => {
        const label = card.label || card.name || card.username;
        const confirming = confirmingId === card.id;
        const busy = deletingId === card.id;
        return (
        <div
          key={card.id}
          className={`bg-gray-900 border rounded-2xl transition-colors ${
            confirming ? "border-red-500/40" : "border-gray-800"
          }`}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-lg bg-gray-700 text-gray-300 flex items-center justify-center text-xs font-bold shrink-0">
              {label[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium truncate">
                {label}
                {card.is_offline === true && (
                  <span className="ml-2 align-middle text-[0.625rem] font-semibold uppercase tracking-wide text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                    Offline
                  </span>
                )}
              </p>
              <p className="text-gray-500 text-xs truncate">
                {card.is_offline === true
                  ? canRestore
                    ? "Hidden from visitors — your QR and NFC tag won't open it"
                    : "Your team admin took this card offline — ask them to turn it back on"
                  : `/${card.username}${card.name ? ` · ${card.name}` : ""}`}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {card.is_offline === true && canRestore && (
                <button
                  type="button"
                  onClick={() => handleRestore(card)}
                  disabled={restoringId === card.id}
                  className="text-xs font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-50 transition-colors"
                >
                  {restoringId === card.id ? "Turning on…" : "Bring online"}
                </button>
              )}
              {/* No Edit here any more: each card in the dashboard's My Cards
                  has its own Edit button (owner, 2026-09-29). */}
              {canDelete && (
              <button
                type="button"
                // Step ONE. This no longer deletes anything — it opens the
                // panel below, and pressing it again closes it, so the control
                // that armed the delete is also the one that disarms it.
                onClick={() => { setError(null); setConfirmingId(confirming ? null : card.id); }}
                disabled={busy}
                aria-expanded={confirming}
                className={`text-xs disabled:opacity-50 transition-colors ${
                  confirming ? "text-gray-400 hover:text-white" : "text-red-400 hover:text-red-300"
                }`}
              >
                {busy ? "Deleting…" : confirming ? "Cancel" : "Delete"}
              </button>
              )}
            </div>
          </div>

          {/* Step TWO. Named, so nobody confirms the wrong row, and honest about
              what goes with it: DELETE /api/cards/[id] purges the card's leads
              and their message and reminder history, because everything is
              keyed by USERNAME and leaving the rows behind would hand them to
              whoever registers the freed slug next. */}
          {canDelete && confirming && (
            <div className="border-t border-red-500/25 bg-red-500/[0.05] px-4 py-3 rounded-b-2xl">
              <p className="text-white text-xs font-semibold">
                Delete &ldquo;{label}&rdquo; <span className="text-gray-400 font-normal">/{card.username}</span>?
              </p>
              <p className="text-gray-400 text-[0.6875rem] leading-relaxed mt-1">
                This also permanently deletes every contact this card captured, along with their
                message and reminder history. It can&apos;t be undone. To keep them,{" "}
                <Link href="/contacts" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">
                  export them from Contacts
                </Link>{" "}
                first.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => handleDelete(card)}
                  disabled={busy}
                  className="flex-1 sm:flex-none min-w-[150px] bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  {busy ? "Deleting…" : "Yes, delete permanently"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  disabled={busy}
                  className="flex-1 sm:flex-none min-w-[110px] border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  Go back
                </button>
              </div>
            </div>
          )}
        </div>
        );
      })}

      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
