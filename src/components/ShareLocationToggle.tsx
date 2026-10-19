"use client";

import { useEffect, useId, useState } from "react";

// ── "Add my location" on the share-your-info forms ───────────────────────────
//
// Owner, 2026-10-18 (feature 4 of 4): the only way a card owner can ever learn
// EXACTLY where someone was is for that person to choose to say. A web page
// cannot read a phone's GPS without the phone asking its owner first — and
// that is the point: this is an offer the visitor makes, never something taken.
//
//   • OFF by default, and optional: the form sends with or without it.
//   • Tapping it is what makes the phone ask. Nothing is requested on load.
//   • "No" from the phone is a plain sentence and an unticked box — the share
//     still goes through.
//   • The coordinates go only to the card owner they are sharing with
//     (api/leads stores them on that one contact), and only Pro reads them.
//
// The same control on all three forms (the card's "Share your info", the
// share-back sheet after Save Contact, and Swift Links' "Reach out"), so a
// visitor meets one behaviour wherever they share.

export type SharedLocation = { lat: number; lng: number; accuracy: number };

type State = "off" | "asking" | "on" | "denied" | "failed";

/** Past this the phone is guessing from Wi-Fi or a tower, not the person's spot. */
const MAX_ACCURACY_M = 2000;

export default function ShareLocationToggle({
  value,
  onChange,
}: {
  value: SharedLocation | null;
  onChange: (v: SharedLocation | null) => void;
}) {
  // Rendered only where the browser can ask at all. Decided after mount so the
  // server and first client render agree (no geolocation on the server).
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<State>(value ? "on" : "off");
  const ids = useId();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time capability read after mount
    setSupported(typeof navigator !== "undefined" && !!navigator.geolocation && window.isSecureContext !== false);
  }, []);

  if (!supported) return null;

  function toggle() {
    if (state === "asking") return;
    if (state === "on") {
      setState("off");
      onChange(null);
      return;
    }
    setState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !(accuracy > 0) || accuracy > MAX_ACCURACY_M) {
          setState("failed");
          onChange(null);
          return;
        }
        onChange({
          lat: Math.round(latitude * 1e6) / 1e6,
          lng: Math.round(longitude * 1e6) / 1e6,
          accuracy: Math.round(accuracy),
        });
        setState("on");
      },
      (err) => {
        setState(err.code === err.PERMISSION_DENIED ? "denied" : "failed");
        onChange(null);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  }

  const on = state === "on" && !!value;
  // ONE NAME, whatever the state (2026-10-18 review): a switch's on/off is
  // aria-checked, and a name that changed with it ("Location added") was
  // announced as a different control. The changing words are the description.
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={`${ids}-hint ${ids}-status`}
        onClick={toggle}
        disabled={state === "asking"}
        className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-70 ${on ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
      >
        <span
          aria-hidden
          className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${on ? "border-transparent text-white" : "border-gray-300 bg-white"}`}
          style={on ? { background: "var(--sc-accent, #1D4ED8)" } : undefined}
        >
          {on && (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-gray-900 text-sm font-medium">Add my current location</span>
          <span id={`${ids}-hint`} className="block text-gray-500 text-xs mt-0.5 leading-snug">
            {state === "asking"
              ? "Asking your phone…"
              : on
                ? `Added — within about ${value!.accuracy} m. Only the person you're sharing with sees it.`
                : "Optional. Only the person you're sharing with sees it — your phone asks first."}
          </span>
        </span>
      </button>
      {/* Always mounted, so a screen reader announces the message when it
          APPEARS — a live region inserted with its text already in it is
          usually read by nobody. Empty, it takes no space. */}
      <p id={`${ids}-status`} role="status" className="text-gray-500 text-xs mt-1.5 px-1 empty:hidden">
        {state === "denied"
          ? "Location not added — your phone didn't allow it. Your info still sends."
          : state === "failed"
            ? "Couldn't get your location just now. Your info still sends."
            : ""}
      </p>
    </div>
  );
}
