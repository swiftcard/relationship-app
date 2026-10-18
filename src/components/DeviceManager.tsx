"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { releaseDevice } from "@/lib/device-sign-out";
import { DEVICE_LIMIT } from "@/lib/device";

export type DeviceRow = {
  device_id: string;
  label: string | null;
  is_native: boolean;
  first_seen: string;
  last_seen: string;
};

/**
 * The device list, and the wall a third device hits.
 *
 * Two states, one component, because they are the same list:
 *
 *   • NORMAL — reached from Settings. Shows the devices on the account, with
 *     this one marked, and lets any of them be signed out.
 *   • BLOCKED (`full`) — the proxy sent a third device here. The current device
 *     is NOT in the list (it never got a slot), so every row shown is one that
 *     can be freed. The instant one is, the proxy lets this device in: denials
 *     are never cached, so there is no "wait a minute" between doing what the
 *     page asks and it working.
 */
export default function DeviceManager({
  devices,
  currentDeviceId,
  full,
}: {
  devices: DeviceRow[];
  currentDeviceId: string | null;
  full: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(devices);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Read the clock ONCE, not on every render. "Active now" drifting mid-render
  // makes the component impure, and a relative timestamp that silently changes
  // between renders is a real source of hydration mismatches.
  const [now] = useState(() => Date.now());

  async function remove(deviceId: string) {
    setBusy(deviceId);
    setError("");
    try {
      const res = await fetch("/api/devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError("Could not sign that device out. Try again in a moment.");
        return;
      }
      if (body.removedSelf) {
        // Signing THIS device out. The route already ended the server session
        // and dropped the cookies; this clears the browser client's in-memory
        // copy too, so nothing is left believing it is still signed in, and
        // refresh() makes the server re-render /login with no session.
        // The full shared release (lib/device-sign-out) — this path used to
        // skip it, leaving the push binding, person-scoped state and cached
        // screens behind, so Back brought this account's dashboard up for the
        // next person (isolation audit 2026-09-24). Then a HARD navigation.
        await releaseDevice();
        window.location.replace("/login");
        return;
      }
      setRows((r) => r.filter((d) => d.device_id !== deviceId));
      if (full) {
        // A slot is free — go where they were trying to go.
        //
        // This has to be a REAL navigation, not router.replace(). Getting here
        // means the proxy already answered /dashboard with a redirect to this
        // page, and the App Router cached that answer: a client-side replace
        // consults the cache, is told "/dashboard sends you to /settings/devices",
        // and silently does nothing. Measured — the DELETE returned 200, the row
        // was gone, and the page just sat there. window.location.replace() skips
        // the client cache and asks the server again, which now says yes.
        //
        // The lint rule prefers router.push for internal routes; it is right in
        // general and wrong here, for exactly the reason above.
        window.location.replace("/dashboard");
        return;
      } else {
        router.refresh();
      }
    } catch {
      setError("Could not sign that device out. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const when = (iso: string) => {
    const d = new Date(iso);
    const mins = Math.round((now - d.getTime()) / 60000);
    if (mins < 2) return "Active now";
    if (mins < 60) return `${mins} minutes ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="max-w-md mx-auto w-full">
      {full ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-4 mb-5">
          <p className="text-white font-bold text-[1.0625rem] leading-tight">
            You&apos;re signed in on {DEVICE_LIMIT} devices already
          </p>
          <p className="text-gray-300 text-[0.875rem] leading-snug mt-1.5">
            SwiftCard allows {DEVICE_LIMIT} at a time. Sign one of these out and this
            device will take its place — no need to sign in again.
          </p>
        </div>
      ) : (
        <p className="text-gray-400 text-[0.875rem] leading-snug mb-5">
          You can be signed in on {DEVICE_LIMIT} devices at a time. Every tab and window of
          the same browser counts as one.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-gray-400 text-[0.875rem]">No other devices are signed in.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((d) => {
            const isCurrent = d.device_id === currentDeviceId;
            // is_native only marks the iOS shell. A phone BROWSER is still a
            // phone, and showing it a monitor icon is the kind of small wrong
            // detail that makes a security screen feel untrustworthy.
            const handheld = d.is_native || /iPhone|iPad|Android/i.test(d.label ?? "");
            return (
              <li
                key={d.device_id}
                className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3.5 flex items-center gap-3"
              >
                <span className="shrink-0 w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-gray-300">
                  {handheld ? (
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <rect x="6" y="2.5" width="12" height="19" rx="3" />
                      <path d="M11 18.5h2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <rect x="2.5" y="4" width="19" height="13" rx="2.5" />
                      <path d="M8 20.5h8" strokeLinecap="round" />
                    </svg>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-white text-[0.9375rem] font-semibold truncate">
                    {d.label || "Unknown device"}
                    {isCurrent && (
                      <span className="ml-2 align-middle text-[0.625rem] font-bold tracking-wide text-emerald-300 bg-emerald-500/15 border border-emerald-400/25 rounded-full px-1.5 py-0.5">
                        THIS DEVICE
                      </span>
                    )}
                  </span>
                  <span className="block text-gray-400 text-[0.75rem] mt-0.5">{when(d.last_seen)}</span>
                </span>

                <button
                  type="button"
                  onClick={() => remove(d.device_id)}
                  disabled={busy !== null}
                  className="shrink-0 px-3 py-2 rounded-full text-[0.8125rem] font-semibold text-gray-200 bg-gray-800 border border-transparent hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {busy === d.device_id ? "…" : "Sign out"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="text-red-300 text-[0.8125rem] mt-4">{error}</p>}
    </div>
  );
}
