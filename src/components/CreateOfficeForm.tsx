"use client";

import { useState } from "react";

export default function CreateOfficeForm() {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setStatus("loading");
    setError("");

    try {
      const res = await fetch("/api/office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }

      // Send a brand-new Office owner to their OWN dashboard first, with the
      // main tour running — dropping them straight into the admin console (what
      // a reload did, since this form renders inside it) skipped the product
      // itself and started them on team management. They reach the admin from
      // the nav when they're ready, and it runs its own tour on first visit.
      // ?tour=1 respects the "already toured" flag, so an existing user who
      // upgrades isn't shown it twice.
      // The admin console, where its own tour runs on first visit; the copy
      // above says to invite the team from there next.
      window.location.assign("/office/admin");
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
      setStatus("error");
    }
  }

  // Dark panel matching the /office/admin shell — this renders inside the
  // admin, and it was the first thing a brand-new Office owner ever saw there.
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 max-w-md mx-auto text-center">
      <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-5">
        <svg className="w-7 h-7 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">Name your team</h2>
      <p className="text-gray-500 text-sm mb-7">
        Usually your company name. You can invite your team from the Admin tab next.
      </p>

      <form onSubmit={handleSubmit} className="text-left space-y-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Company or team name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Plumbing"
            required
            className="w-full sc-field text-white placeholder-gray-600 px-4 py-3 text-sm focus:outline-none transition-colors"
          />
        </div>
        {status === "error" && <p className="text-red-400 text-xs">{error}</p>}
        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold py-3 rounded-full transition-colors text-sm"
        >
          {status === "loading" ? "Setting up…" : "Continue →"}
        </button>
      </form>
    </div>
  );
}
