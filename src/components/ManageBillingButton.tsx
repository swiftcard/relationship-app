"use client";

import { useState } from "react";
import { useIsNativeApp } from "@/lib/platform";

// Opens the Stripe customer portal on the account's default configuration, so
// what it offers — payment method, invoices, cancellation questions, retention
// coupon, promo codes — is controlled from the Stripe Dashboard rather than
// hardcoded here.
export default function ManageBillingButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Backstop (App Review 3.1.1): the Stripe customer portal must never be
  // reachable from the iOS shell, no matter where this button gets mounted.
  const native = useIsNativeApp();

  async function openPortal() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error || "Couldn't open the billing portal.");
    } catch {
      setError("Couldn't open the billing portal.");
    }
    setLoading(false);
  }

  if (native) return null;

  return (
    <div>
      <button
        type="button"
        onClick={openPortal}
        disabled={loading}
        className="w-full text-center text-xs font-semibold text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full py-2.5 transition-colors disabled:opacity-50"
      >
        {/* Not "Manage subscription & payment": inside the subscription panel
            this sat under a button with exactly that label, so the same words
            opened two different things. This one is the Stripe portal. */}
        {loading ? "Opening…" : "Payment method & invoices"}
      </button>
      {error && <p className="text-red-400 text-xs mt-1.5 text-center">{error}</p>}
    </div>
  );
}
