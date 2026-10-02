"use client";

import { useCallback, useEffect, useState } from "react";
import { PICK_PLAN_BELOW } from "@/lib/promo";

// ── "Have a promo code?" ─────────────────────────────────────────────────────
// THE one promo box, shown wherever a Pro or Office purchase starts on the web:
// the order page (/checkout) and the new account's plan step (/welcome) — and
// in the iPhone app's plan step, which checks the code here and sends it to
// /welcome on swiftcard.me to be used (the `website` prop). Every
// code is entered here and applied by /api/stripe/checkout — Stripe's own
// "Add promotion code" field is off, because it could only ever take money-off
// codes and a free-time code typed there was always "invalid" (owner report
// 2026-09-23). One entry point, one set of rules (lib/promo-check).
//
// The box only CHECKS a code and says what it gives. Nothing is spent until the
// person continues to payment, where the checkout route re-checks it under the
// same rules and refuses (409 promoUnusable) rather than quietly charge full
// price; refuseAtCheckout() shows that refusal with "Continue without the code".

export type PromoPlan = "pro" | "office";
export type PromoInterval = "monthly" | "annual";

export type PromoState =
  | { status: "none" }
  | { status: "checking" }
  | {
      status: "applied"; code: string; label: string; detail: string;
      /** For the app's Pro card (/api/promo/check): the code is for Pro, Apple
       *  can redeem it (an Apple offer code with the same string), and it is
       *  for the annual plan only. */
      forPro?: boolean; apple?: boolean; annualOnly?: boolean;
    }
  | { status: "refused"; code: string; message: string; grant?: boolean; atCheckout?: boolean };

export function usePromoCode({
  plan,
  interval,
  initialCode,
  onCodeChange,
}: {
  /** The purchase the code must fit. null while the plan is still being
   *  chosen (the /welcome chooser) — the code is then checked for validity
   *  only, and the fit is settled when a plan is picked. */
  plan: PromoPlan | null;
  interval: PromoInterval | null;
  /** A code that arrived in the link (/pricing, an email, a cancelled Stripe
   *  visit): checked once so the page says what it gives before anyone pays. */
  initialCode?: string | null;
  /** The applied code changed (null = removed) — for a page that keeps the
   *  code in its URL. */
  onCodeChange?: (code: string | null) => void;
}) {
  const [state, setState] = useState<PromoState>({ status: "none" });
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [granting, setGranting] = useState(false);

  const check = useCallback(async (code: string): Promise<boolean> => {
    setState({ status: "checking" });
    try {
      const res = await fetch("/api/promo/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, ...(plan ? { plan, interval: interval ?? "monthly" } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setState({
          status: "applied", code: data.code, label: data.label, detail: data.detail ?? "",
          forPro: data.forPro !== false, apple: data.apple === true, annualOnly: data.annualOnly === true,
        });
        return true;
      }
      setState({ status: "refused", code, message: data.error || "That code can't be used.", grant: data.grant === true });
      return false;
    } catch {
      setState({ status: "refused", code, message: "Couldn't check that code — check your connection and try again." });
      return false;
    }
  }, [plan, interval]);

  useEffect(() => {
    if (!initialCode) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async check of the code already in the link; the state it sets is the answer
    void check(initialCode);
  }, [initialCode, check]);

  const apply = useCallback(async () => {
    const code = input.trim().toUpperCase();
    if (!code) return;
    if (await check(code)) { onCodeChange?.(code); setInput(""); setOpen(false); }
  }, [input, check, onCodeChange]);

  const remove = useCallback(() => {
    setState({ status: "none" });
    onCodeChange?.(null);
  }, [onCodeChange]);

  // A tester code switches the plan on with no payment at all — the same thing
  // the Pricing page's box does with it.
  const switchOnGrant = useCallback(async (code: string) => {
    setGranting(true);
    try {
      const res = await fetch("/api/promo/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.granted) { window.location.href = "/dashboard"; return; }
      setState({ status: "refused", code, message: data.error || "Couldn't switch that code on." });
    } catch {
      setState({ status: "refused", code, message: "Couldn't reach the server. Try again." });
    } finally {
      setGranting(false);
    }
  }, []);

  // The code stopped applying between the check and the purchase (the last use
  // went, it expired, it's for the other plan, Stripe's own rules).
  const refuseAtCheckout = useCallback((code: string, message: string, grant?: boolean) => {
    setState({ status: "refused", code, message, grant: grant === true, atCheckout: true });
  }, []);

  const appliedCode = state.status === "applied" ? state.code : undefined;
  // The purchase waits on a check, and stops on a code refused at checkout
  // until the person removes it or continues without it — never a silent
  // full price. A code refused when typed was never attached, so it doesn't.
  const blocksPurchase = state.status === "checking" || (state.status === "refused" && state.atCheckout === true);

  return { state, open, setOpen, input, setInput, apply, remove, switchOnGrant, granting, refuseAtCheckout, appliedCode, blocksPurchase };
}

export type PromoCode = ReturnType<typeof usePromoCode>;

export default function PromoCodeBox({
  promo,
  busy = false,
  onContinueWithoutCode,
  website,
  className = "",
}: {
  promo: PromoCode;
  /** The purchase is in flight — "Continue without the code" waits. */
  busy?: boolean;
  /** Retry the purchase with no code, after a refusal at checkout. Not needed
   *  in the app, where nothing is bought through this box. */
  onContinueWithoutCode?: () => void;
  /** The iPhone app (PlanCards' NativePromoCode): the code is used on
   *  swiftcard.me, not here — an applied code gets "Use it on swiftcard.me",
   *  a free-time code "Switch it on at swiftcard.me", and nothing is redeemed
   *  in the app itself (3.1.1). */
  website?: PromoWebsiteHandOff;
  className?: string;
}) {
  const { state, open, setOpen, input, setInput, apply, remove, switchOnGrant, granting } = promo;
  // "Choose that plan below" is the website's chooser talking; in the app the
  // plan is chosen on swiftcard.me.
  const detail = state.status !== "applied" ? "" : website ? state.detail.replace(` ${PICK_PLAN_BELOW}`, "") : state.detail;
  return (
    <div className={className}>
      {state.status === "applied" ? (
        <>
          <div className="flex items-start justify-between gap-3 rounded-xl border border-green-500/30 bg-green-500/10 px-3.5 py-2.5 text-left">
            <div className="min-w-0">
              <p className="text-green-300 text-xs font-semibold">✓ {state.code} — {state.label}</p>
              {detail && <p className="text-emerald-200 text-[0.6875rem] mt-0.5">{/^[A-Z]/.test(detail) ? detail : `Off ${detail}.`}</p>}
            </div>
            <button type="button" onClick={remove} className="shrink-0 text-[0.6875rem] text-gray-400 hover:text-white underline">Remove</button>
          </div>
          {/* A Pro code is used from the Pro card's own button (PlanCards
              NativePro) — one action, not a second button down here. */}
          {website && (website.proCardAbove
            ? <p className="mt-2 text-[0.6875rem] text-gray-400">Added to the Pro plan — tap its button to use it.</p>
            : <WebsiteHandOff code={state.code} label="Use it on swiftcard.me →" website={website} />)}
        </>
      ) : state.status === "refused" ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-left">
          <p className="text-amber-300 text-xs font-semibold">{state.code}: {state.message}</p>
          {state.grant && website && <WebsiteHandOff code={state.code} label="Switch it on at swiftcard.me →" website={website} />}
          <div className="mt-2 flex flex-wrap gap-2">
            {state.grant && !website && (
              <button type="button" onClick={() => switchOnGrant(state.code)} disabled={granting}
                className="text-[0.6875rem] font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 rounded-full">
                {granting ? "Switching it on…" : "Switch it on"}
              </button>
            )}
            {state.atCheckout ? (
              <button type="button" onClick={() => { remove(); onContinueWithoutCode?.(); }} disabled={busy}
                className="text-[0.6875rem] font-semibold text-white bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50 px-3 py-1.5 rounded-full">
                Continue without the code
              </button>
            ) : (
              <>
                <button type="button" onClick={() => { remove(); setOpen(false); }}
                  className="text-[0.6875rem] font-semibold text-white bg-gray-800 border border-gray-700 hover:bg-gray-700 px-3 py-1.5 rounded-full">
                  Remove code
                </button>
                <button type="button" onClick={() => { remove(); setOpen(true); }}
                  className="text-[0.6875rem] font-semibold text-gray-300 hover:text-white underline">
                  Try another code
                </button>
              </>
            )}
          </div>
        </div>
      ) : state.status === "checking" ? (
        <p className="text-gray-500 text-xs">Checking your code…</p>
      ) : open ? (
        // method="post" + action="#": before hydration a bare <form> submits as
        // GET and would put the typed code in the URL.
        <form
          method="post"
          action="#"
          onSubmit={(e) => { e.preventDefault(); void apply(); }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="Promo code"
            aria-label="Promo code"
            autoCapitalize="characters"
            autoComplete="off"
            autoFocus
            className="min-w-0 flex-1 rounded-full bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button type="submit" disabled={!input.trim()}
            className="shrink-0 rounded-full bg-gray-800 border border-gray-700 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
            Apply
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-blue-400 hover:text-blue-300">
          Have a promo code?
        </button>
      )}
    </div>
  );
}

export type PromoWebsiteHandOff = {
  /** Open swiftcard.me in the default browser with this code. */
  open: (code: string) => void;
  /** Opening now. */
  busy: boolean;
  /** The browser didn't open. */
  failed: boolean;
  /** The applied code is for Pro, and the Pro card's button uses it. */
  proCardAbove?: boolean;
};

function WebsiteHandOff({ code, label, website }: { code: string; label: string; website: PromoWebsiteHandOff }) {
  return (
    <div className="mt-3 text-center">
      <button type="button" onClick={() => website.open(code)} disabled={website.busy}
        className="w-full rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-white transition-colors">
        {website.busy ? "Opening swiftcard.me…" : label}
      </button>
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-gray-500" role={website.failed ? "alert" : undefined}>
        {website.failed
          ? "Couldn't open your browser. Go to swiftcard.me, sign in with this account and enter the code there."
          : "Opens swiftcard.me in your browser with the code filled in. Sign in there with this account to use it."}
      </p>
    </div>
  );
}
