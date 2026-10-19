"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Shown for the few seconds between Stripe sending the buyer back and Stripe's
// webhook actually giving them the plan. Re-asks the server, backing off;
// the page redirects on its own the moment the plan is there.
export default function AwaitingPlan({ planName, fallbackHref }: {
  planName: string;
  /** The plan HAS landed but a follow-up (the office row) hasn't: after 20s
   *  stop waiting and continue; /office/admin handles a missing office itself.
   *  Without this a failed insert meant spinning forever. */
  fallbackHref?: string;
}) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    // Every 2 s while the webhook normally lands, then backing off, and done
    // after about three minutes (audit P-08). It used to re-ask every 2 s for
    // as long as the tab stayed open — each a sign-in check, a database read
    // and a Stripe call — so one webhook outage became 30 Stripe reads a
    // minute per waiting buyer. By then the note below offers a refresh.
    const STEPS = [2000, 2000, 2000, 2000, 2000, 4000, 4000, 8000, 8000, 15000, 15000, 30000, 30000, 30000, 30000];
    let i = 0;
    let tick: ReturnType<typeof setTimeout> | null = null;
    const next = () => {
      if (i >= STEPS.length) return;
      tick = setTimeout(() => { router.refresh(); next(); }, STEPS[i++]);
    };
    next();
    const late = setTimeout(() => setSlow(true), 45000);
    const giveUp = fallbackHref ? setTimeout(() => router.push(fallbackHref), 20000) : null;
    return () => { if (tick) clearTimeout(tick); clearTimeout(late); if (giveUp) clearTimeout(giveUp); };
  }, [router, fallbackHref]);

  return (
    <main className="sc-app min-h-screen bg-gray-950 flex items-center justify-center px-5">
      <div className="max-w-sm text-center">
        <div className="h-9 w-9 mx-auto mb-5 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" />
        <h1 className="text-white font-bold text-xl">Setting up your {planName} plan…</h1>
        <p className="text-gray-400 text-sm mt-2 leading-relaxed">
          {/* Not "Your payment went through": most Pro checkouts start a free
              trial and charge $0.00 today. */}
          Checkout is complete. This usually takes a few seconds — please keep this page open.
        </p>
        {slow && (
          <p className="text-gray-500 text-xs mt-5 leading-relaxed">
            Still confirming with our payment provider. You can safely{" "}
            <button type="button" onClick={() => window.location.reload()} className="text-blue-400 underline">refresh</button>
            {" "}— you won&apos;t be charged twice. If it still hasn&apos;t finished,{" "}
            <Link href="/contact" className="text-blue-400 underline">contact us</Link> and we&apos;ll sort it out.
          </p>
        )}
      </div>
    </main>
  );
}
