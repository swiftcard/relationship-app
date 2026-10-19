"use client";

import { useState } from "react";
import { normalizeSlug } from "@/lib/slug";

// Editable card URL (slug). Collapsed it just shows the current URL with a
// "Change" link; expanded it lets the owner set a new slug, with an explicit
// warning that already-shared links/QR codes/Wallet passes stop working (the
// server-side rename migrates all views/leads/analytics to the new slug, so
// data isn't lost — only the old public URL stops resolving).
export default function CardUrlEditor({ cardId, currentSlug }: { cardId: string; currentSlug: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentSlug);
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState("");
  // The slug we successfully renamed TO — shown in the manual-update checklist.
  const [newSlug, setNewSlug] = useState("");

  const normalized = normalizeSlug(value);
  const changed = normalized && normalized !== currentSlug;
  // No "your URL is out of date" prompt here anymore (owner order 2026-08-26):
  // the URL now updates ITSELF when the card's name or company changes (see
  // lib/auto-rename-slug — old links keep working via the _prevSlugs redirect).
  // This editor is only for hand-picking a custom URL.

  async function save() {
    if (!changed || status === "saving") return;
    setStatus("saving");
    setError("");
    try {
      const res = await fetch(`/api/cards/${cardId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: normalized }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Couldn't change the URL. Please try again.");
        setStatus("idle");
        return;
      }
      // Renamed. Everything INSIDE SwiftCard now points at the new slug (the card
      // page, your SwiftLinks page, analytics, and leads all moved server-side).
      // But things you shared OUTSIDE the app still point at the OLD URL — show a
      // checklist of what to re-share manually before reloading.
      setNewSlug(String(data?.slug || normalized));
      setStatus("done");
    } catch {
      setError("Network error — please try again.");
      setStatus("idle");
    }
  }

  if (!open) {
    return (
      <div className="mt-1 space-y-1">
        <p className="text-gray-600 text-xs">
          Card URL: swiftcard.me/{currentSlug}{" "}
          <button type="button" onClick={() => { setOpen(true); setValue(currentSlug); setError(""); }} className="text-blue-400 hover:text-blue-300 font-semibold ml-1">
            Change
          </button>
        </p>
      </div>
    );
  }

  // Post-rename: the internal move is done; walk the owner through the external
  // things they need to re-share by hand, since the old URL no longer resolves.
  if (status === "done") {
    return (
      <div className="mt-2 bg-gray-900 border border-emerald-600/40 rounded-xl p-3 space-y-2">
        <p className="text-emerald-400 text-xs font-semibold">
          Your URL is now swiftcard.me/{newSlug}
        </p>
        <p className="text-gray-400 text-[0.6875rem] leading-relaxed">
          Inside SwiftCard everything already moved to the new URL — your card page, your{" "}
          <span className="text-gray-200">Swift Links page</span> (/{newSlug}), and all your views, leads, and
          analytics. But anything you shared <span className="text-gray-200">outside</span> the app still points at
          your old URL and won&apos;t work, so please update these manually:
        </p>
        <ul className="text-[0.6875rem] text-gray-400 space-y-1 list-disc ml-4">
          <li>Re-download and re-print your <span className="text-gray-200">QR code</span> (the old one is dead).</li>
          <li>Re-add your card to <span className="text-gray-200">Apple Wallet</span> so the pass links to the new URL.</li>
          <li>Re-copy your <span className="text-gray-200">email signature</span> into your email client.</li>
          <li>Re-share your link anywhere you posted it — social bios, texts, DMs, your website.</li>
        </ul>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-1 text-xs font-semibold px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          Got it
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 bg-gray-900 border border-gray-700 rounded-xl p-3 space-y-2">
      <label className="block text-[0.6875rem] font-medium text-gray-400">Card URL</label>
      <div className="flex items-center gap-1.5">
        <span className="text-gray-500 text-xs shrink-0">swiftcard.me/</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="your-name"
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
      </div>
      {normalized && normalized !== value && (
        <p className="text-gray-500 text-[0.6875rem]">Will be saved as <span className="text-gray-300">swiftcard.me/{normalized}</span></p>
      )}
      <p className="text-amber-400/90 text-[0.6875rem] leading-relaxed">
        Heads up: everything inside SwiftCard — your card, your Swift Links page, and all your views, leads &amp;
        analytics — moves to the new URL automatically. But anything already shared with your old URL (QR codes,
        printed cards, Wallet passes, your email signature, links in your social bios) will stop working, so
        you&apos;ll need to re-share those manually. We&apos;ll show you the list right after.
      </p>
      {error && <p className="text-red-400 text-[0.6875rem]">{error}</p>}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={save}
          disabled={!changed || status === "saving"}
          className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors disabled:opacity-40 bg-blue-600 hover:bg-blue-500 text-white"
        >
          {status === "saving" ? "Changing…" : "Change URL"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setValue(currentSlug); setError(""); }}
          disabled={status === "saving"}
          className="text-xs font-semibold px-3 py-1.5 rounded-full text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
