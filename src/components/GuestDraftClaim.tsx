"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearDraft, hasClaimConsent, hasPendingDraft, loadDraft } from "@/lib/guest-draft";

// Mounted on the pages an authenticated user lands on after signing in with a
// pending guest draft (the editor wrappers, dashboard, onboarding). On mount it
// POSTs the localStorage draft to /api/drafts/claim, which creates the real
// `cards` row under the SESSION user, then routes the user into the editor for
// their now-saved card. Everything is idempotent server-side, so a double mount
// (duplicate OAuth callback, refresh, second tab) never duplicates the card.
//
// CROSS-ACCOUNT SAFETY: a draft is claimed ONLY when it carries fresh, explicit
// consent (the guest clicked "Create account / Log in" at the gate for THIS
// draft — see markClaimConsent). Without that, an abandoned draft sitting in
// localStorage would silently attach to whichever account signs in next on this
// browser — a real cross-account data leak. No consent → no-op; the draft stays
// local and the guest can resume it at /cards/new.
//
// THE DRAFT SURVIVES EVERY FAILURE. There is exactly one place the draft is
// cleared: immediately after the server confirms the card exists. A 500, a
// malformed response, a timeout or a dropped connection all leave it exactly
// where it was and show a Try again button. This used to clearDraft() and
// replace() to an empty dashboard on any non-402 failure — so a guest who had
// just spent minutes building a card, and had created an account for the sole
// purpose of saving it, watched it disappear with no message at all. The 402
// branch below was already fixed for this reason; its comment applies word for
// word to every other failure.
type Phase = "hidden" | "saving" | "error";

export default function GuestDraftClaim() {
  const router = useRouter();
  const ranRef = useRef(false);
  const cancelledRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("hidden");

  // Real unmount only stops us routing/setting state afterwards; it never
  // touches the draft.
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const claim = useCallback(async () => {
    const draft = loadDraft();
    if (!draft) {
      setPhase("hidden");
      return;
    }
    setPhase("saving");

    try {
      // No plan is sent any more. The guest has not chosen one yet — that
      // happens on /welcome, now that the account exists — so the card is
      // stored exactly as it was designed and nothing is flattened on a guess.
      // Safe: the public card page re-sanitizes against the REAL plan on every
      // view, so a Free account still SHOWS Free until they either pay or
      // confirm Free (which converts the stored design for good).
      const res = await fetch("/api/drafts/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          payload: draft.payload,
          images: draft.images,
          step: draft.step,
        }),
      });

      const data = await res.json().catch(() => ({} as Record<string, unknown>));

      if (cancelledRef.current) return;

      if (res.status === 401) {
        // Session vanished between landing and claim — send them to log in,
        // KEEPING the draft so nothing is lost. claim=1 so the editor re-runs
        // the claim on the post-auth return (a bare /cards/new never claims).
        const next = encodeURIComponent("/cards/new?claim=1");
        window.location.href = `/login?next=${next}`;
        return;
      }

      if (res.status === 402) {
        // Free card limit reached — this account already has its one card, so
        // this one can't be saved YET.
        //
        // This used to clearDraft() first, which destroyed the card they had
        // just spent minutes building and then dropped them on the marketing
        // pricing page. Their work is the entire reason they're here and the
        // only reason they'd pay; deleting it at the exact moment we ask for
        // money is the worst possible trade. Keep the draft — the editor
        // restores it — and send them to the in-product upgrade screen, since
        // they're signed in and have already chosen SwiftCard.
        //
        // Dropping `claim=1` is what prevents the retry loop the old comment
        // was worried about; discarding the draft was never needed for that.
        router.push("/upgrade?from=claim");
        return;
      }

      if (!res.ok || !data || typeof (data as { id?: unknown }).id !== "string") {
        // Bad payload / invalid draft / server error. The draft stays put and
        // the person is told, rather than being silently emptied out onto a
        // dashboard that says "Let's create your first card".
        setPhase("error");
        return;
      }

      // Success — and ONLY here — the card exists under this account now.
      clearDraft();
      const id = (data as { id: string }).id;
      const slug = (data as { slug?: string }).slug;
      const first = (data as { first?: boolean }).first;
      const designConverted = (data as { designConverted?: boolean }).designConverted;
      if (first) {
        // Brand-new account: send them through onboarding — choose a plan
        // (pay if Pro/Office), turn on notifications, then the dashboard + tour.
        const qs = new URLSearchParams();
        if (slug) qs.set("card", slug);
        if (designConverted) qs.set("designConverted", "1");
        // The plan they picked on /pricing ("Get Office", "Get Pro") rides
        // the builder URL through signup (/cards/new?plan=office&seats=…&claim=1).
        // Hand it to /welcome so they go straight to paying for THAT plan
        // instead of being asked to choose again (owner, 2026-09-16).
        const here = new URLSearchParams(window.location.search);
        const picked = here.get("plan");
        if (picked === "pro" || picked === "office") {
          qs.set("plan", picked);
          for (const k of ["interval", "seats", "promo"]) {
            const v = here.get(k);
            if (v) qs.set(k, v);
          }
        }
        const query = qs.toString();
        router.replace(`/welcome${query ? `?${query}` : ""}`);
      } else {
        router.replace(`/cards/${id}/edit?claimed=1`);
      }
    } catch {
      if (cancelledRef.current) return;
      // Offline, DNS, a dropped connection. The draft is untouched; say so.
      setPhase("error");
    }
  }, [router]);

  useEffect(() => {
    // StrictMode double-invokes effects in dev — guard so we only claim once.
    if (ranRef.current) return;
    if (!hasPendingDraft()) return;
    if (!hasClaimConsent()) return; // never claim without the guest's explicit choice
    ranRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- claim() sets the "saving…" overlay before its first await; this is the one-time claim, guarded by ranRef
    void claim();
  }, [claim]);

  if (phase === "hidden") return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-950/90 backdrop-blur-sm px-5"
      role={phase === "error" ? "alertdialog" : "status"}
      aria-live="polite"
      aria-label={phase === "error" ? "Couldn't save your card" : "Saving your work"}
    >
      {phase === "saving" ? (
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" />
          <p className="text-sm font-medium text-gray-300">Saving your work…</p>
        </div>
      ) : (
        <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6 text-center">
          <h2 className="text-white text-base font-bold">Couldn&apos;t save your card</h2>
          {/* The whole point of this screen: say plainly that the work is still
              here. Someone who has just watched a save fail assumes the worst. */}
          <p className="text-gray-400 text-sm mt-2 leading-relaxed">
            Nothing is lost — your card is still saved on this device. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => { void claim(); }}
            className="mt-5 w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm px-5 py-3 rounded-full transition-colors"
          >
            Try again
          </button>
          {/* Leaves the draft exactly where it is; /cards/new restores it. */}
          <button
            type="button"
            onClick={() => { setPhase("hidden"); router.replace("/cards/new"); }}
            className="mt-3 w-full text-gray-400 hover:text-white text-xs font-medium py-2 transition-colors"
          >
            Back to my card
          </button>
        </div>
      )}
    </div>
  );
}
