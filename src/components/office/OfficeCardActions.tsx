"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The admin's controls for ONE team card: edit the employee's personal details,
// or take the card offline. Company fields and the look aren't editable here on
// purpose — they're set once on the Branding page for the whole team instead of
// card by card.

type Card = {
  id: string;
  username: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_offline: boolean;
};

export default function OfficeCardActions({ card, appUrl }: { card: Card; appUrl: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(card.is_offline);
  // Taking a teammate's card offline is destructive to everything they have
  // handed out — the same shape as deleting a card, so it uses the same
  // two-step in-page confirmation ManageCards uses, for the same reasons its
  // comment records: a native confirm() is browser chrome that cannot show
  // WHOSE card is about to go dark, is unstyled, truncates its second line on
  // some phones, and on iOS can be suppressed outright by "block dialogs" —
  // which would have taken the card offline with no prompt at all
  // (audit 2026-09-29).
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState({
    name: card.name ?? "",
    title: card.title ?? "",
    email: card.email ?? "",
    phone: card.phone ?? "",
  });

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/office/cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't update that card.");
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update that card.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (await patch(draft)) {
      setEditing(false);
      router.refresh();
    }
  }

  async function setOfflineTo(next: boolean) {
    setConfirming(false);
    if (await patch({ is_offline: next })) {
      setOffline(next);
      router.refresh();
    }
  }

  // Bringing a card BACK online restores service and needs no confirmation;
  // only taking it down does.
  function toggleOffline() {
    if (offline) { void setOfflineTo(false); return; }
    setConfirming((c) => !c);
  }

  return (
    <div>
      {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-3">{err}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`${appUrl}/${card.username}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3.5 py-2 rounded-full transition-colors"
        >
          View card ↗
        </a>
        <button
          onClick={() => setEditing((e) => !e)}
          className="text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-3.5 py-2 rounded-full transition-colors"
        >
          {editing ? "Cancel" : "Edit details"}
        </button>
        <button
          onClick={toggleOffline}
          disabled={busy}
          className={`text-xs font-semibold px-3.5 py-2 rounded-full transition-colors disabled:opacity-50 ${
            offline
              ? "text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/15"
              : "text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15"
          }`}
        >
          {offline ? "Bring back online" : confirming ? "Cancel" : "Take offline"}
        </button>
      </div>

      {/* Step two — named, so nobody switches off the wrong person's card. */}
      {confirming && (
        <div className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/[0.05] px-4 py-3">
          <p className="text-white text-xs font-semibold">
            Take {card.name || card.username}&apos;s card offline?
          </p>
          <p className="text-gray-400 text-[0.6875rem] leading-relaxed mt-1">
            Their public page, QR code, NFC card and wallet pass all stop working. Nothing is deleted —
            their contacts and history are kept, and you can bring it back online any time.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              onClick={() => { void setOfflineTo(true); }}
              disabled={busy}
              className="flex-1 sm:flex-none min-w-[150px] bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {busy ? "Taking offline…" : "Yes, take it offline"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="flex-1 sm:flex-none min-w-[110px] border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="mt-4 bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([["name", "Name"], ["title", "Title"], ["email", "Email"], ["phone", "Phone"]] as const).map(([k, label]) => (
              <label key={k} className="block">
                <span className="text-xs font-medium text-gray-500">{label}</span>
                <input
                  value={draft[k]}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  className="mt-1 w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={save}
              disabled={busy}
              className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <p className="text-[0.6875rem] text-gray-600">
              Company logo, office number, fax, website and the design are set on the Branding page.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
