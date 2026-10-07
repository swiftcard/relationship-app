"use client";

import { useState } from "react";
import { track } from "@/lib/events";

// ── The preference centre ───────────────────────────────────────────────────
//
// ONE page. Every interaction happens here: no navigation, no modal, no
// interstitial, no second screen. The full opt-out is reachable in exactly two
// clicks from the footer link — open the panel, press "No thanks, unsubscribe
// me" — with no login, no form field, no CAPTCHA and no countdown.
//
// If you are tempted to add a step, a confirmation, or to move the unsubscribe
// link behind a "more options" disclosure: that is the thing this component
// exists to prevent. See docs/EMAIL-PREFERENCE-CENTER.md.

export type Prefs = {
  lead_tips: boolean;
  product_updates: boolean;
  digest: boolean;
  digest_frequency: "weekly" | "monthly";
  promotions: boolean;
  paused_until: string | null;
  marketing_opt_out: boolean;
};

// Only emails that are actually SENT get a switch (2026-10-06 notification
// audit). The lead-tips and weekly-digest rows were listed here with no
// sender anywhere in the product — a promise nobody kept.
// Their stored flags stay in Prefs so nothing breaks; bring a row back the day
// its email exists.
const CATEGORIES: { key: keyof Prefs; label: string; frequency: string }[] = [
  { key: "product_updates", label: "Product updates", frequency: "1× a month" },
  { key: "promotions", label: "Offers and promotions", frequency: "Occasional" },
];

const REASONS = ["Too many emails", "Not useful", "Didn't sign up", "Other"];

const INK = "#0f172a";
const MUTED = "#64748b";
const BLUE = "#1D4ED8";
const LINE = "#E4DDD4";

export default function PreferenceCenter({
  token, initial, initialPaused = false,
}: { token: string; initial: Prefs; initialPaused?: boolean }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(initial.marketing_opt_out);
  const [reasonGiven, setReasonGiven] = useState(false);
  // Whether the account is paused is decided by the SERVER (it has the clock and
  // the row); this only tracks what the person does on this page. Comparing
  // paused_until to Date.now() during render is impure and React flags it.
  const [paused, setPaused] = useState(initialPaused);
  const [pausedUntil, setPausedUntil] = useState<string | null>(initial.paused_until);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/email/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong — please try again.");
        return null;
      }
      if (data.preferences) setPrefs(data.preferences as Prefs);
      return data;
    } catch {
      setError("Couldn't reach SwiftCard — please try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  // ── Done state ────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="w-full max-w-md rounded-2xl p-8" style={{ background: "#fff", border: `1px solid ${LINE}` }}>
        <h1 className="text-xl font-bold mb-2" style={{ color: INK }}>You&apos;re unsubscribed.</h1>
        <p className="text-sm" style={{ color: MUTED }}>
          You&apos;ll still receive account and lead notifications.
        </p>

        {/* Optional. Nothing is gated behind answering, and there is no
            required field — the opt-out already happened. */}
        {!reasonGiven && (
          <div className="mt-7 pt-6" style={{ borderTop: `1px solid ${LINE}` }}>
            <p className="text-sm mb-3" style={{ color: INK }}>Mind telling us why? One tap, totally optional.</p>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={!!busy}
                  onClick={async () => {
                    const ok = await post("reason", { reason: r });
                    if (ok) {
                      setReasonGiven(true);
                      track("email_unsubscribe_reason_given", { variant: r });
                    }
                  }}
                  className="text-sm rounded-full px-4 py-2 transition-colors disabled:opacity-50"
                  style={{ border: `1px solid ${LINE}`, color: INK, background: "#fff" }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
        {reasonGiven && <p className="mt-6 text-sm" style={{ color: MUTED }}>Thank you — that helps.</p>}
        {error && <p role="alert" className="mt-4 text-sm" style={{ color: "#B91C1C" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl p-6 sm:p-8" style={{ background: "#fff", border: `1px solid ${LINE}` }}>
      <h1 className="text-xl font-bold" style={{ color: INK }}>Choose what you want from SwiftCard.</h1>
      <p className="text-sm mt-1.5" style={{ color: MUTED }}>
        Change these any time. Account and lead notifications are separate and always sent.
      </p>

      {paused && (
        <p className="text-sm mt-4 rounded-xl px-3 py-2" style={{ background: "#FDF6E7", color: "#7A4E00" }}>
          Paused until {pausedUntil ? new Date(pausedUntil).toLocaleDateString() : "next month"}.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {CATEGORIES.map((c) => (
          <Row
            key={c.key}
            label={c.label}
            frequency={c.frequency}
            checked={prefs[c.key] as boolean}
            onChange={(v) => setPrefs((p) => ({ ...p, [c.key]: v }))}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={!!busy}
        onClick={async () => {
          const ok = await post("save", { preferences: prefs });
          if (ok) {
            setPaused(false);
            setPausedUntil(null);
            setNote("Saved.");
            track("email_preferences_saved");
            setTimeout(() => setNote(null), 2500);
          }
        }}
        className="mt-6 w-full rounded-full py-3 text-sm font-semibold transition-colors disabled:opacity-60"
        style={{ background: BLUE, color: "#fff" }}
      >
        {busy === "save" ? "Saving…" : "Save preferences"}
      </button>

      <button
        type="button"
        disabled={!!busy}
        onClick={async () => {
          const ok = await post("pause");
          if (ok) {
            setPaused(true);
            setPausedUntil((ok.preferences as Prefs | undefined)?.paused_until ?? null);
            setNote("Paused for 30 days.");
            track("email_paused_30d");
          }
        }}
        className="mt-2.5 w-full rounded-full py-3 text-sm font-semibold transition-colors disabled:opacity-60"
        style={{ background: "#fff", color: INK, border: `1px solid ${LINE}` }}
      >
        {busy === "pause" ? "Pausing…" : "Pause everything for 30 days"}
      </button>

      {note && <p className="mt-3 text-sm text-center" style={{ color: MUTED }}>{note}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-center" style={{ color: "#B91C1C" }}>{error}</p>}

      {/* THE UNSUBSCRIBE LINK.
          Body-size (14px, the same as everything else here), full-contrast ink,
          underlined, and directly beneath the buttons — it sits inside the first
          viewport on a 375px screen. It must never be shrunk, greyed out, or
          pushed below the fold; that is what regulators and Gmail both read as
          a dark pattern, and tests/email-preference-center.test.ts pins it. */}
      <div className="mt-6 pt-5 text-center" style={{ borderTop: `1px solid ${LINE}` }}>
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="text-sm underline"
          style={{ color: INK }}
        >
          Unsubscribe from all marketing emails
        </button>
      </div>

      {panelOpen && (
        <div className="mt-4 rounded-xl p-4" style={{ background: "#F8FAFC", border: `1px solid ${LINE}` }}>
          <p className="text-sm font-semibold" style={{ color: INK }}>
            Before you go, would a break work instead?
          </p>
          <div className="mt-3 space-y-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={async () => {
                const ok = await post("pause");
                if (ok) {
                  setPaused(true);
                  setPausedUntil((ok.preferences as Prefs | undefined)?.paused_until ?? null);
                  setPanelOpen(false);
                  setNote("Paused for 30 days.");
                  track("email_paused_30d");
                }
              }}
              className="w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ background: "#fff", color: INK, border: `1px solid ${LINE}` }}
            >
              Pause 30 days
            </button>
            {/* Second and final click. No confirmation, no "are you sure". */}
            <button
              type="button"
              disabled={!!busy}
              onClick={async () => {
                const ok = await post("unsubscribe");
                if (ok) {
                  setDone(true);
                  track("email_full_unsubscribe", { variant: "footer" });
                }
              }}
              className="w-full rounded-full py-2.5 text-sm font-semibold disabled:opacity-60"
              style={{ background: BLUE, color: "#fff" }}
            >
              {busy === "unsubscribe" ? "Unsubscribing…" : "No thanks, unsubscribe me"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label, frequency, checked, onChange,
}: { label: string; frequency: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: INK }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: MUTED }}>{frequency}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="shrink-0 w-11 h-6 rounded-full transition-colors relative mt-0.5"
        style={{ background: checked ? BLUE : LINE }}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
          style={{ left: checked ? "calc(100% - 22px)" : "2px" }}
        />
      </button>
    </div>
  );
}
