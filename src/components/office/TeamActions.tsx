"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsNativeApp } from "@/lib/platform";
import { canOfferExternalPurchase, openExternalPurchase } from "@/lib/external-purchase";
import { track } from "@/lib/events";

// ── Team-tab actions: add a member, manage an invite, remove a member ───────
// Written for an owner who has never used a dashboard: one action per button,
// plain words, the price stated before anything is charged, and a clear
// "what will happen" before anything destructive.

type SeatInfo = {
  seats: number;
  interval: "monthly" | "annual" | null;
  perSeatCents: number | null;
  nextSeatProrationCents: number | null;
  nextSeatTotalCents: number | null;
  billable: boolean;
  usage: { purchased: number; used: number; available: number };
};

function usd(cents: number): string {
  return `$${(Math.round(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function perWord(interval: SeatInfo["interval"]): string {
  return interval === "annual" ? "year" : "month";
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      {/* Bottom sheet on phones: the sheet sits on the physical bottom edge, so
          without this its last row ("Send invite") sat inside the home-
          indicator strip under viewport-fit=cover. env() is 0 on desktop. */}
      <div className="relative w-full sm:max-w-md bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-base">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white text-xl leading-none px-1">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        try { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* older browsers */ }
      }}
      className="w-full text-xs font-semibold text-gray-300 bg-gray-800 hover:bg-gray-700 px-4 py-2.5 rounded-full transition-colors"
    >
      {copied ? "Link copied ✓" : label}
    </button>
  );
}

// ── Add team member ──────────────────────────────────────────────────────────
// One smooth action: email in → invite out. When seats are full, the SAME modal
// offers to buy the seat (price stated) and sends the invite in the same click.

export function AddMemberButton({ canManageSeats, label, variant = "button" }: {
  canManageSeats: boolean;
  label?: string;
  variant?: "button" | "link" | "small";
}) {
  const router = useRouter();
  const native = useIsNativeApp();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "invite" | "seat">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; inviteUrl: string | null } | null>(null);
  // Set when the invite bounced off a full office: we show the one-click
  // "add a seat & send" path instead of a dead end.
  const [needsSeat, setNeedsSeat] = useState(false);
  const [seatInfo, setSeatInfo] = useState<SeatInfo | null>(null);
  const [seatLoading, setSeatLoading] = useState(false);
  // Whether this build can leave the app for a purchase. Read after mount for
  // the same reason `native` is: the plugin lives on `window`, so touching it
  // during render would disagree with the server HTML. Fails closed — an older
  // shell without the plugin keeps the remove-a-member copy rather than showing
  // a button that would do nothing.
  const [canLinkOut, setCanLinkOut] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window-only value, hydration-safe by design
    setCanLinkOut(canOfferExternalPurchase());
  }, []);

  useEffect(() => {
    if (!open) return;
    // Ignore a resolved fetch after close, and after a newer one started.
    let live = true;
    (async () => {
      // Pre-fetch seat pricing + the real prorated quote, so the upsell can
      // state the actual amount instantly instead of after a spinner.
      try {
        const res = await fetch("/api/stripe/subscription/seats");
        const next = res.ok ? await res.json() : null;
        if (live) setSeatInfo(next);
      } catch {
        if (live) setSeatInfo(null);
      } finally {
        if (live) setSeatLoading(false);
      }
    })();
    return () => { live = false; };
  }, [open]);

  function reset() {
    setOpen(false); setEmail(""); setName(""); setBusy(null);
    setError(null); setDone(null); setNeedsSeat(false);
  }

  function openModal() {
    reset();
    setSeatLoading(true); // set here, not in the effect — see the lint rule on
    setSeatInfo(null);    // synchronous setState inside an effect body.
    setOpen(true);
  }

  async function sendInvite(prefix?: string): Promise<"ok" | "no_seats" | "error"> {
    const res = await fetch("/api/office/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      track("employee_invited", { variant: json.resent ? "resent" : "new" });
      // The route tells us whether delivery actually succeeded, and nothing
      // read it — so a failed send still rendered "Invite sent ✓" and the
      // admin burned a paid seat for 14 days believing it had gone out. The
      // seat IS reserved either way; only the email may have failed, so say
      // exactly that and lean on the copy-link fallback below (which this
      // branch already renders from inviteToken).
      const base =
        json.emailSent === false
          ? `Seat reserved for ${email.trim()}, but we couldn't deliver the email — send them the link below.`
          : json.resent
            ? `${email.trim()} already had an invite — we've sent it again ✓`
            : `Invite sent to ${email.trim()} ✓`;
      setDone({
        message: prefix ? `${prefix} ${base}` : base,
        inviteUrl: json.inviteToken ? `${window.location.origin}/join/${json.inviteToken}` : null,
      });
      router.refresh();
      return "ok";
    }
    if (res.status === 409 && json.error === "no_seats") return "no_seats";
    setError(json.message ?? json.error ?? "Couldn't send the invite. Please try again.");
    return "error";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy("invite"); setError(null);
    try {
      const r = await sendInvite();
      if (r === "no_seats") setNeedsSeat(true);
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function addSeatAndInvite() {
    if (!seatInfo || busy) return;
    setBusy("seat"); setError(null);
    try {
      const res = await fetch("/api/stripe/subscription/seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seats: seatInfo.seats + 1 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.message ?? json.error ?? "Couldn't add the seat. Your card was not charged — please try again.");
        return;
      }
      track("office_seat_added", { seats: json.seats, plan: "office" });
      const r = await sendInvite("Seat added and");
      if (r === "ok") setNeedsSeat(false);
      else if (r !== "error") {
        // The seat purchase went through but the invite didn't — say exactly
        // that, so they know to retry the (free) invite, not the payment.
        setError("Your new seat was added, but the invite didn't send. Press \"Send invite\" to try again — you won't be charged twice.");
        setNeedsSeat(false);
      }
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const firstName = name.trim() ? name.trim().split(/\s+/)[0] : email.split("@")[0] || "them";
  const seatPrice = seatInfo?.perSeatCents != null ? `${usd(seatInfo.perSeatCents)}/${perWord(seatInfo.interval)}` : null;

  const cls =
    variant === "link"
      ? "text-sm font-semibold text-purple-400 hover:text-purple-300 transition-colors"
      : variant === "small"
        ? "text-[0.6875rem] font-semibold text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-full transition-colors shrink-0"
        : "bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors shrink-0";

  return (
    <>
      <button onClick={openModal} className={cls}>
        {label ?? "+ Add team member"}
      </button>

      {open && (
        <Modal title="Add a team member" onClose={reset}>
          {done ? (
            <div>
              <p className="text-green-400 text-sm font-semibold mb-1">{done.message}</p>
              <p className="text-gray-500 text-xs mb-4">
                They&apos;ll get an email with a link to create their card. It takes them about two minutes. Tell them to check their spam folder too.
              </p>
              <div className="space-y-2">
                {done.inviteUrl && <CopyRow value={done.inviteUrl} label="Copy invite link" />}
                <button
                  onClick={() => { setDone(null); setEmail(""); setName(""); setError(null); }}
                  className="w-full text-xs font-semibold text-gray-300 bg-gray-800 hover:bg-gray-700 px-4 py-2.5 rounded-full transition-colors"
                >
                  Add another team member
                </button>
                <button
                  onClick={reset}
                  className="w-full text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 px-4 py-2.5 rounded-full transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : needsSeat ? (
            <div>
              <p className="text-gray-300 text-sm mb-3">
                {/* A delegated admin can't read seat counts (403), and "All your
                    of your seats" read as a typo. */}
                {(seatInfo?.usage?.purchased ?? seatInfo?.seats) != null
                  ? `All ${seatInfo?.usage?.purchased ?? seatInfo?.seats} of your seats are being used.`
                  : "All of your seats are being used."}
                {/* App Store 3.1.1: the seat price + one-tap purchase never renders on native. */}
                {!native && canManageSeats && seatInfo?.billable && seatPrice
                  ? ` Add another seat for ${seatPrice} and invite ${firstName}?`
                  : ""}
              </p>
              {!native && canManageSeats && seatInfo?.billable && seatPrice ? (
                <>
                  <dl className="rounded-xl border border-gray-800 bg-gray-950/50 px-3.5 py-3 mb-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-gray-500 text-xs">New seat</dt>
                      <dd className="text-gray-300 text-xs font-semibold">{seatPrice}</dd>
                    </div>
                    {seatInfo.nextSeatProrationCents != null && (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-gray-500 text-xs">Charged today</dt>
                        <dd className="text-white text-xs font-semibold">{usd(seatInfo.nextSeatProrationCents)}</dd>
                      </div>
                    )}
                    {seatInfo.nextSeatTotalCents != null && (
                      <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-gray-800">
                        <dt className="text-gray-500 text-xs">New total</dt>
                        <dd className="text-white text-xs font-semibold">
                          {usd(seatInfo.nextSeatTotalCents)}/{perWord(seatInfo.interval)}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {seatInfo.nextSeatProrationCents == null && (
                    <p className="text-gray-600 text-[0.6875rem] mb-3">
                      You&apos;ll be charged a smaller, partial amount today for the rest of this billing period.
                    </p>
                  )}
                  {/* Explicit, unmistakable authorization statement directly above
                      the pay button — the exact charge + the new recurring amount,
                      to the card already on file, before any money moves. */}
                  <p className="text-gray-400 text-[0.6875rem] leading-relaxed mb-3">
                    By continuing, you authorize SwiftCard to charge your card on file{" "}
                    <span className="font-semibold text-white">
                      {seatInfo.nextSeatProrationCents != null ? usd(seatInfo.nextSeatProrationCents) : "the prorated amount"}
                    </span>{" "}
                    today
                    {seatInfo.nextSeatTotalCents != null && (
                      <> and <span className="font-semibold text-white">{usd(seatInfo.nextSeatTotalCents)}/{perWord(seatInfo.interval)}</span> going forward</>
                    )}
                    . Cancel or change seats anytime in Settings → Plan and billing.
                  </p>
                  {error && <p className="text-red-400 text-xs mb-3" role="alert">{error}</p>}
                  <button
                    onClick={addSeatAndInvite}
                    disabled={busy !== null}
                    className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-full transition-colors"
                  >
                    {busy === "seat"
                      ? "Charging your card…"
                      : seatInfo.nextSeatProrationCents != null
                        ? `Pay ${usd(seatInfo.nextSeatProrationCents)} & add seat`
                        : "Pay & add seat"}
                  </button>
                  <button onClick={() => setNeedsSeat(false)} disabled={busy !== null}
                    className="w-full text-gray-500 hover:text-gray-300 text-xs py-2 mt-1 transition-colors disabled:opacity-50">
                    Go back
                  </button>
                </>
              ) : (
                <>
                  <p className="text-gray-500 text-xs mb-4">
                    {canManageSeats
                      ? native
                        ? canLinkOut
                          // Native, US storefront: a seat can be bought — just not
                          // in here. No price and no charge inside the app
                          // (3.1.1); the button leaves for the default browser,
                          // which is the allowance the 1.0.0 rejection named.
                          ? "You can add a seat from your account on the web, then send this invite again."
                          // No plugin (older shell): the only thing that works
                          // in-app, stated plainly rather than a dead button.
                          : "Remove an existing team member to free up a seat, then send this invite again."
                        : "Your plan doesn't support adding seats from here — manage seats from Settings → Plan and billing."
                      : "Ask the account owner to add a seat, then send this invite again."}
                  </p>
                  {native && canManageSeats && canLinkOut && (
                    <button
                      onClick={() => { void openExternalPurchase("/settings/flows?billing=1#billing"); }}
                      className="w-full bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold py-2.5 rounded-full transition-colors mb-1"
                    >
                      Add a seat on swiftcard.me
                    </button>
                  )}
                  <button onClick={() => setNeedsSeat(false)}
                    className="w-full text-gray-300 bg-gray-800 hover:bg-gray-700 text-sm font-semibold py-2.5 rounded-full transition-colors">
                    Go back
                  </button>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={submit}>
              <p className="text-gray-500 text-xs mb-4">
                We&apos;ll email them a link to create their own company card. You only need their email.
              </p>
              <label className="block mb-3">
                <span className="text-xs font-medium text-gray-400">Their email</span>
                <input
                  type="email" required autoFocus value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dana@company.com"
                  className="mt-1 w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </label>
              <label className="block mb-4">
                <span className="text-xs font-medium text-gray-400">Their name <span className="text-gray-600 font-normal">(optional)</span></span>
                <input
                  type="text" value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dana Lee"
                  className="mt-1 w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </label>
              {error && <p className="text-red-400 text-xs mb-3" role="alert">{error}</p>}
              <button
                type="submit"
                disabled={busy !== null || seatLoading || !email.trim()}
                className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-full transition-colors"
              >
                {busy === "invite" ? "Sending…" : seatLoading ? "Checking your seats…" : "Send invite"}
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

// ── Pending-invite row actions ────────────────────────────────────────────────

export function InviteRowActions({ memberId, name, email, inviteUrl }: {
  memberId: string;
  name?: string | null;
  email: string;
  inviteUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "remind" | "retract">(null);
  const [note, setNote] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [copied, setCopied] = useState(false);
  const who = (name || email.split("@")[0] || "them").split(/\s+/)[0];

  // "Remind" re-sends the invite email (and restarts the 14-day window) — a
  // nudge for the invitee to accept. The seat stays reserved either way.
  async function remind() {
    if (busy) return;
    setBusy("remind"); setNote(null);
    try {
      const res = await fetch("/api/office/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Resend to the same email; name is already stored so the row keeps it.
        body: JSON.stringify({ email }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        // Same unread `emailSent` as the add path. This one is worse: the add
        // path at least renders a copyable link on success, so a silent
        // delivery failure there is recoverable by accident. Here the admin
        // saw "Reminder sent ✓" and had nothing else to try.
        if (j.emailSent === false) {
          setNote(
            j.inviteToken
              ? `We couldn't deliver the email. Send them this link instead: ${window.location.origin}/join/${j.inviteToken}`
              : "We couldn't deliver the reminder email. Try again shortly.",
          );
        } else {
          setNote("Reminder sent ✓");
        }
        router.refresh();
      } else {
        setNote(j.message ?? j.error ?? "Couldn't send the reminder — try again.");
      }
    } catch {
      setNote("Couldn't reach the server — try again.");
    } finally {
      setBusy(null);
    }
  }

  // "Retract" cancels the pending invite and FREES the seat it was holding.
  async function retract() {
    if (busy) return;
    setBusy("retract"); setNote(null);
    try {
      const res = await fetch(`/api/office/members?id=${memberId}`, { method: "DELETE" });
      if (res.ok) { setNote("Invitation retracted — seat freed ✓"); router.refresh(); }
      else setNote("Couldn't retract — try again.");
    } catch {
      setNote("Couldn't reach the server — try again.");
    } finally {
      setBusy(null);
      setManaging(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap justify-end">
      {managing ? (
        <>
          <span className="text-[0.6875rem] text-gray-400">Retract {who}&apos;s invite &amp; free the seat?</span>
          <button onClick={retract} disabled={busy !== null}
            className="text-[0.6875rem] font-semibold text-red-300 bg-red-500/10 hover:bg-red-500/15 px-2 py-1 rounded-full disabled:opacity-50">
            {busy === "retract" ? "…" : "Yes, retract"}
          </button>
          {inviteUrl && (
            <button
              onClick={() => {
                try { navigator.clipboard?.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* older browsers */ }
              }}
              className="text-[0.6875rem] font-semibold text-gray-400 hover:text-gray-200 px-1.5 py-1 transition-colors"
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
          )}
          <button onClick={() => setManaging(false)} className="text-[0.6875rem] text-gray-500 hover:text-gray-300 px-1">Keep</button>
        </>
      ) : (
        <>
          <button onClick={remind} disabled={busy !== null}
            className="text-[0.6875rem] font-semibold text-purple-300 hover:text-purple-200 bg-purple-500/10 hover:bg-purple-500/15 px-2.5 py-1 rounded-full transition-colors disabled:opacity-50">
            {busy === "remind" ? "Sending…" : "Remind"}
          </button>
          <button onClick={() => setManaging(true)} disabled={busy !== null}
            className="text-[0.6875rem] font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded-full transition-colors disabled:opacity-50">
            Manage
          </button>
        </>
      )}
      {note && <span className="text-[0.6875rem] text-gray-500 w-full text-right lg:w-auto">{note}</span>}
    </span>
  );
}

// ── Remove from team ─────────────────────────────────────────────────────────
// Two-step: a plain-language confirmation of exactly what happens, then (for
// someone who can manage seats) a follow-up choice about the now-empty seat.

export function RemoveMemberButton({ memberId, personName, canManageSeats, onPersonPage = false }: {
  memberId: string;
  personName: string;
  canManageSeats: boolean;
  /** Rendered on /office/admin/team/[id] — the page of the person being
   *  removed. Refreshing it after the removal rendered a 404 (they are no
   *  longer on the team), which also unmounted the "lower my bill" step. There
   *  the dialogs stay put and closing them returns to the Team page. */
  onPersonPage?: boolean;
}) {
  const router = useRouter();
  const refresh = () => { if (!onPersonPage) router.refresh(); };
  const close = () => { setStep("idle"); if (onPersonPage) router.push("/office/admin"); };
  const [step, setStep] = useState<"idle" | "confirm" | "seat" | "done">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seatInfo, setSeatInfo] = useState<SeatInfo | null>(null);
  const [seatNote, setSeatNote] = useState<string | null>(null);
  const first = personName.split(/\s+/)[0] || "They";
  // In the iOS shell the follow-up seat step is a billing surface (seat price +
  // "lower my bill" subscription change) — skip straight to "done" there, the
  // same posture as AddMemberButton's native path. Web is unchanged.
  const native = useIsNativeApp();

  async function remove() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/office/members?id=${memberId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Couldn't remove them — please try again.");
        return;
      }
      if (canManageSeats && !native) {
        const info = await fetch("/api/stripe/subscription/seats")
          .then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (info?.billable && info.perSeatCents != null && info.seats > (info.usage?.used ?? 1)) {
          setSeatInfo(info);
          setStep("seat");
          refresh();
          return;
        }
      }
      setStep("done");
      refresh();
    } catch {
      setError("Couldn't reach the server — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function dropSeat() {
    if (!seatInfo || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/stripe/subscription/seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seats: seatInfo.seats - 1 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Couldn't remove the seat — you can also do this later from Settings → Plan and billing.");
        return;
      }
      setSeatNote(
        j.mode === "scheduled" || j.scheduledSeats != null
          ? "Done ✓ Your bill goes down at your next renewal — you keep the seat until then."
          : "Seat removed ✓",
      );
      setStep("done");
      refresh();
    } catch {
      setError("Couldn't reach the server — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setStep("confirm"); setError(null); }}
        className="text-xs font-semibold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/15 px-3.5 py-2 rounded-full transition-colors"
      >
        Remove from team
      </button>

      {step === "confirm" && (
        <Modal title={`Remove ${first} from your team?`} onClose={() => !busy && setStep("idle")}>
          <p className="text-gray-300 text-sm mb-4 leading-relaxed">
            {first}&apos;s company cards will be turned off and your company branding comes off them.{" "}
            {first} moves to their own plan — Free, or their own Pro if they pay for it — and loses
            access to your team. The contacts {first} captured stay with your company. {first} keeps
            the cards and can bring them back online in Settings → Cards and sharing. Their seat stays
            yours for your next hire.
          </p>
          {error && <p className="text-red-400 text-xs mb-3" role="alert">{error}</p>}
          <button onClick={remove} disabled={busy}
            className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-full transition-colors">
            {busy ? "Removing…" : `Remove ${first}`}
          </button>
          <button onClick={() => setStep("idle")} disabled={busy}
            className="w-full text-gray-500 hover:text-gray-300 text-xs py-2 mt-1 transition-colors disabled:opacity-50">
            Never mind
          </button>
        </Modal>
      )}

      {step === "seat" && seatInfo && (
        <Modal title={`${first} was removed ✓`} onClose={() => !busy && close()}>
          <p className="text-gray-300 text-sm mb-1.5">You now have one unused paid seat.</p>
          <p className="text-gray-500 text-xs mb-4">
            You&apos;re paying {seatInfo.perSeatCents != null ? usd(seatInfo.perSeatCents) : ""}/{perWord(seatInfo.interval)} for it.
          </p>
          {error && <p className="text-red-400 text-xs mb-3" role="alert">{error}</p>}
          <button onClick={dropSeat} disabled={busy}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-full transition-colors">
            {busy ? "Updating…" : "Remove the seat and lower my bill"}
          </button>
          <button onClick={close} disabled={busy}
            className="w-full text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 text-sm font-semibold py-2.5 rounded-full mt-2 transition-colors disabled:opacity-50">
            Keep the seat for my next hire
          </button>
        </Modal>
      )}

      {step === "done" && (
        <Modal title="All set ✓" onClose={close}>
          <p className="text-gray-400 text-sm mb-4">{seatNote ?? `${first} was removed from your team.`}</p>
          <button onClick={() => { setStep("idle"); window.location.href = "/office/admin"; }}
            className="w-full bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold py-2.5 rounded-full transition-colors">
            Back to my team
          </button>
        </Modal>
      )}
    </>
  );
}

// ── Delete a member's account (owner only) ──────────────────────────────────
// Owner decision, 2026-09-23: a team member cannot delete their own account;
// only the admin of the Office plan can. This removes them from the team
// exactly like "Remove from team", then deletes their SwiftCard account the
// same way a self-delete does (hidden now, reopenable for 30 days, then gone).
// Behind a typed confirmation, because unlike removal it takes the whole
// account, not just the seat. The server re-checks that the caller is the owner.
export function DeleteMemberAccountButton({ memberId, personName, onPersonPage = false }: {
  memberId: string;
  personName: string;
  onPersonPage?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const first = personName.split(/\s+/)[0] || "this person";

  async function del() {
    if (busy || typed.trim().toUpperCase() !== "DELETE") return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/office/members/delete-account?id=${encodeURIComponent(memberId)}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Couldn't delete the account — please try again.");
        return;
      }
      setDone(true);
      if (!onPersonPage) router.refresh();
    } catch {
      setError("Couldn't reach the server — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false); setTyped(""); setError(null);
    if (done) {
      setDone(false);
      if (onPersonPage) router.push("/office/admin");
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setError(null); }}
        className="text-xs font-semibold text-red-400 hover:text-red-300 px-3.5 py-2 rounded-full transition-colors"
      >
        Delete account
      </button>

      {open && (
        <Modal title={done ? "Account deleted ✓" : `Delete ${first}'s account?`} onClose={() => !busy && close()}>
          {done ? (
            <>
              <p className="text-gray-400 text-sm mb-4">
                {first} was removed from your team and their SwiftCard account was deleted. We emailed them; they can reopen it within 30 days.
              </p>
              <button onClick={close}
                className="w-full bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold py-2.5 rounded-full transition-colors">
                Back to my team
              </button>
            </>
          ) : (
            <>
              <ul className="text-gray-300 text-sm mb-4 leading-relaxed space-y-1.5 list-disc pl-4">
                <li>{first} is removed from your team and their seat is freed. The contacts they captured stay with your company.</li>
                <li>Their SwiftCard account is deleted: their cards, Swift Links page, contacts and history disappear now, and are permanently removed after 30 days.</li>
                <li>Any subscription they pay for themselves is stopped.</li>
                <li>We email them, and they can reopen the account within 30 days by signing in.</li>
              </ul>
              <label htmlFor="del-confirm" className="block text-xs text-gray-400 mb-1.5">Type <strong className="text-white">DELETE</strong> to confirm</label>
              <input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
                className="w-full rounded-xl bg-gray-950 border border-gray-800 text-sm text-white px-3.5 py-2.5 mb-3 focus:outline-none focus:border-gray-600" />
              {error && <p className="text-red-400 text-xs mb-3" role="alert">{error}</p>}
              <button onClick={del} disabled={busy || typed.trim().toUpperCase() !== "DELETE"}
                className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-bold py-2.5 rounded-full transition-colors">
                {busy ? "Deleting…" : `Delete ${first}'s account`}
              </button>
              <button onClick={close} disabled={busy}
                className="w-full text-gray-500 hover:text-gray-300 text-xs py-2 mt-1 transition-colors disabled:opacity-50">
                Never mind
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
