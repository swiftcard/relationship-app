"use client";

import { useState } from "react";

export default function JoinButton({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "joining" | "done" | "declining" | "declined" | "error">("idle");
  const [error, setError] = useState("");
  const [hasPersonalSub, setHasPersonalSub] = useState(false);
  const [personalSubApple, setPersonalSubApple] = useState(false);

  async function handleDecline() {
    setStatus("declining");
    try {
      const res = await fetch("/api/office/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Couldn't decline. Try again.");
        setStatus("error");
        return;
      }
      setStatus("declined");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  async function handleJoin() {
    setStatus("joining");
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        setStatus("error");
        return;
      }
      setStatus("done");
      const personalSub = json.hasPersonalSubscription === true;
      setHasPersonalSub(personalSub);
      setPersonalSubApple(json.personalBilledBy === "apple");
      // Straight into the REAL card builder — the same 4-step wizard everyone
      // uses (Card info → Card design → Socials → Social design). The wizard's
      // ?add=1 path resolves their office context server-side: branding fields
      // (company/logo/website/phone/fax/address) render as "Managed by your
      // organization" and Card design locks when the admin locked it. (Owner
      // decision, Jul 2026 — replaced the old simplified /welcome/team form.)
      //
      // When the joiner still pays for a personal subscription, hold the screen
      // long enough to actually read the money note below — 900ms reads as a
      // flash. The same message also lands in their notification bell (see
      // /api/join), so missing it here isn't losing it.
      // Already have a card (built it before accepting)? It is now the company
      // card — open it to finish, rather than building a second one.
      const next = typeof json.firstCardId === "string" && json.firstCardId
        ? `/cards/${json.firstCardId}/edit?joined=1`
        : "/cards/new?add=1";
      setTimeout(() => { window.location.href = next; }, personalSub ? 6000 : 900);
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div>
        <div className="w-full bg-green-900/30 border border-green-700/50 text-green-300 font-semibold py-3 rounded-full text-sm text-center">
          You&apos;re in! Let&apos;s build your card…
        </div>
        {hasPersonalSub && (personalSubApple ? (
          <p className="mt-3 rounded-xl border border-blue-500/25 bg-blue-500/10 text-blue-200 text-xs px-3.5 py-3 leading-relaxed">
            Heads up: your team seat includes everything in Pro, and you also have your own Pro
            subscription, billed by Apple. It keeps renewing until you cancel it on your iPhone in{" "}
            <span className="font-semibold">Settings → Apple ID → Subscriptions</span>, or keep it in case you
            ever leave the team. We&apos;ve put this in your notifications too.
          </p>
        ) : (
          <p className="mt-3 rounded-xl border border-blue-500/25 bg-blue-500/10 text-blue-200 text-xs px-3.5 py-3 leading-relaxed">
            Heads up: your team seat includes everything in Pro, and you also have your own Pro
            subscription. You can cancel yours in <span className="font-semibold">Settings → Plan and billing</span>,
            or keep it in case you ever leave the team. We&apos;ve put this in your notifications too.
          </p>
        ))}
      </div>
    );
  }

  if (status === "declined") {
    return (
      <div className="w-full bg-gray-800 border border-gray-700 text-gray-300 font-medium py-3 rounded-full text-sm text-center">
        Invitation declined. You can close this page.
      </div>
    );
  }

  return (
    <div>
      {status === "error" && (
        <p className="text-red-400 text-xs text-center mb-3">{error}</p>
      )}
      <button
        onClick={handleJoin}
        disabled={status === "joining" || status === "declining"}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-3 rounded-full transition-colors text-sm"
      >
        {status === "joining" ? "Joining…" : "Accept invitation →"}
      </button>
      <button
        onClick={handleDecline}
        disabled={status === "joining" || status === "declining"}
        className="w-full mt-2 text-gray-500 hover:text-gray-300 disabled:opacity-50 text-xs py-2 transition-colors"
      >
        {status === "declining" ? "Declining…" : "Decline invitation"}
      </button>
    </div>
  );
}
