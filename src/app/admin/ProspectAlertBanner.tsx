"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// ── "They're looking at their card right now" ───────────────────────────────
// A large banner across the top of every admin page while a prospect is on
// the preview card staff sent them (owner, 2026-11-11: "if I have the admin
// portal open, also show a large banner … with the owner's name and a Call
// button"). The phone push and the desktop notification are sent by the server
// (lib/prospect-preview/alert.ts); this is the third place the same alert
// shows, for the admin already looking at the screen.
//
// It asks /api/admin/card-builder/alerts every 10 seconds, and ONLY while this
// tab is visible: a hidden tab asks nothing, and catches up the moment it is
// looked at again. A banner goes away when it is dismissed, when the prospect
// is marked "called", or 15 minutes after the view.
//
// The chime is a short tone made here (no audio file). Browsers only let a
// page make sound after it has been clicked at least once, so on a tab that
// was never touched the banner appears silently; the desktop notification's
// own sound still plays.

export type BannerAlert = { view_id: string; preview_id: string; owner_name: string; office_name: string; phone: string; viewed_at: string };

const POLL_MS = 10_000;
const DISMISSED_KEY = "sc_prospect_alerts_dismissed";

const telHref = (phone: string) => `tel:${phone.trim().startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}`;

function readDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-50) : [];
  } catch {
    return [];
  }
}

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const at = ctx.currentTime;
    for (const [i, hz] of [880, 1175, 880, 1175].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.25, at + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.22 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at + i * 0.22);
      osc.stop(at + i * 0.22 + 0.21);
    }
    setTimeout(() => void ctx.close().catch(() => {}), 1500);
  } catch { /* no sound is not a failure */ }
}

export default function ProspectAlertBanner() {
  const [alerts, setAlerts] = useState<BannerAlert[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const heard = useRef<Set<string>>(new Set());

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/card-builder/alerts", { cache: "no-store" });
      if (!res.ok) return;
      const next = ((await res.json()) as { alerts?: BannerAlert[] }).alerts ?? [];
      const gone = new Set(readDismissed());
      const fresh = next.filter((a) => !gone.has(a.view_id) && !heard.current.has(a.view_id));
      for (const a of next) heard.current.add(a.view_id);
      setDismissed([...gone]);
      setAlerts(next);
      if (fresh.length) chime();
    } catch { /* offline: the next tick tries again */ }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      void check();
      timer = setInterval(() => void check(), POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  const dismiss = (id: string) => {
    const next = [...new Set([...readDismissed(), id])].slice(-50);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* this tab only */ }
    setDismissed(next);
  };

  const showing = alerts.filter((a) => !dismissed.includes(a.view_id));
  if (!showing.length) return null;

  return (
    <div className="adm-prospect-banner sticky top-14 lg:top-0 z-30" role="alert" aria-live="assertive">
      {showing.map((a) => (
        <div key={a.view_id} className="adm-prospect-alert px-4 sm:px-6 lg:px-10 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="sc-t-title2 font-bold">{a.owner_name} is viewing their card</p>
            <p className="sc-t-subhead opacity-90 truncate">{a.office_name} · {a.phone}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a href={telHref(a.phone)} className="adm-prospect-call sc-btn sc-btn-lg">Call {a.phone}</a>
            <Link href={`/admin/card-builder/call/${a.preview_id}`} className="adm-prospect-more sc-btn sc-btn-sm">Details</Link>
            <button type="button" onClick={() => dismiss(a.view_id)} className="adm-prospect-more sc-btn sc-btn-sm">Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
