"use client";

import Link from "next/link";
import { useState } from "react";
import { PlanGate } from "@/components/PlanGate";
import { IapProPill } from "@/components/NativePaywall";

const INTEGRATIONS_NATIVE_COPY =
  "Pro feature — Salesforce, GoHighLevel, Pipedrive, HubSpot, Google Contacts and Zapier are only available on the Pro plan";

type Props = {
  initialNotifications: boolean;
  initialViews: boolean;
  zapierConnected: boolean;
  isPro: boolean;
};

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      style={{ background: on ? "#2563eb" : "#374151" }}
    >
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: on ? "22px" : "2px" }} />
    </button>
  );
}

export default function CrmEventSettings({ initialNotifications, initialViews, zapierConnected, isPro }: Props) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [views, setViews] = useState(initialViews);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = !isPro;
  const needsZapier = isPro && !zapierConnected;

  // Optimistic, and put back if the save didn't land — a switch that shows
  // ON while the server still has it OFF is a switch that lies.
  async function save(next: { notifications: boolean; views: boolean }, prev: { notifications: boolean; views: boolean }) {
    setSaving(true);
    setError(null);
    let failed: string | null = null;
    try {
      const res = await fetch("/api/settings/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        failed = d.message || "Couldn't save. Try again.";
      }
    } catch {
      failed = "Couldn't save. Try again.";
    }
    if (failed) {
      setError(failed);
      setNotifications(prev.notifications);
      setViews(prev.views);
    }
    setSaving(false);
  }

  // On a lapsed account a switch can still be turned OFF — stopping data
  // leaving is never a paid feature — but not back on.
  function toggleNotifications() {
    if (locked && !notifications) return;
    const v = !notifications;
    setNotifications(v);
    save({ notifications: v, views }, { notifications, views });
  }
  function toggleViews() {
    if (locked && !views) return;
    const v = !views;
    setViews(v);
    save({ notifications, views: v }, { notifications, views });
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        {/* Was "Send activity to your CRM", which read as though it controlled
            the CRM cards it sat next to. It doesn't — it only decides what the
            Zapier webhook receives. New leads always go; these are the extras. */}
        <p className="text-gray-100 text-sm font-medium">Also send to Zapier</p>
        {locked && (
          <PlanGate
            feature="integration-crm"
            nativeCopy={INTEGRATIONS_NATIVE_COPY}
            nativeContent={<IapProPill />}
          >
            <Link href="/upgrade" className="text-xs font-semibold text-blue-400 hover:text-blue-300">Pro</Link>
          </PlanGate>
        )}
      </div>
      <p className="text-gray-500 text-xs leading-relaxed mb-4">
        New leads are always sent to the <strong className="text-gray-400">Zapier webhook</strong> above. These add card activity on top of them. Each event carries a <code className="text-gray-400">type</code> field so your Zap can tell them apart.
      </p>

      {needsZapier && (
        <div className="border border-amber-800/40 bg-amber-950/20 rounded-xl px-3 py-2.5 mb-3">
          <p className="text-amber-200 text-xs">Add your Zapier webhook URL above first — that&apos;s where these events are sent.</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-3">
          <div className="min-w-0">
            <p className="text-gray-200 text-sm">Conversation notifications</p>
            <p className="text-gray-600 text-[0.6875rem] mt-0.5">When someone saves your contact or activity happens on a contact.</p>
          </div>
          <Toggle on={notifications} onClick={toggleNotifications} disabled={(locked && !notifications) || saving} />
        </div>

        <div className="flex items-center justify-between gap-3 bg-gray-800/40 border border-gray-800 rounded-xl px-4 py-3">
          <div className="min-w-0">
            <p className="text-gray-200 text-sm">SwiftCard &amp; SwiftLink views</p>
            <p className="text-gray-600 text-[0.6875rem] mt-0.5">Every card and Swift Links view, with location. High-traffic cards use more Zapier tasks.</p>
          </div>
          <Toggle on={views} onClick={toggleViews} disabled={(locked && !views) || saving} />
        </div>
      </div>

      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  );
}
