"use client";

import { useState } from "react";
import Link from "next/link";
import { PLAN_LIMITS } from "@/lib/plan";

const PLANS = [
  { id: "free", label: "Free", color: "#6b7280", blurb: "The starter experience." },
  { id: "pro", label: "Pro", color: "#60a5fa", blurb: "The main paid plan." },
  { id: "enterprise", label: "Office", color: "#c084fc", blurb: "Teams & multiple seats." },
];

// Feature matrix — what to expect on each plan when you test it. The Free
// numbers read from PLAN_LIMITS (the enforced source of truth) rather than
// being typed here: this table had drifted to "25" contacts and "3 total"
// drafts, neither of which the product has done for a long time.
const FEATURES: { label: string; free: string; pro: string; office: string }[] = [
  { label: "Cards", free: String(PLAN_LIMITS.FREE_CARD_LIMIT), pro: "Unlimited", office: "Unlimited" },
  { label: "Contacts / leads", free: `${PLAN_LIMITS.FREE_LEADS_PER_MONTH}/month`, pro: "Unlimited", office: "Unlimited" },
  { label: "Swift Links buttons", free: String(PLAN_LIMITS.FREE_MAX_LINKS), pro: "Unlimited", office: "Unlimited" },
  { label: "AI-written follow-ups", free: "— (starter wording)", pro: "✓", office: "✓" },
  { label: "AI card scanner", free: "—", pro: "✓", office: "✓" },
  { label: "Custom card designer", free: "—", pro: "✓", office: "✓" },
  { label: "Automated follow-ups", free: "Email only", pro: "Email + text", office: "Email + text" },
  { label: "CRM integrations", free: "—", pro: "✓", office: "✓" },
  { label: "Swift Signature", free: "✓", pro: "✓", office: "✓" },
  { label: "“Made with swiftcard.me” on Swift Links", free: "Shown", pro: "Removed", office: "Removed" },
  { label: "Team / office seats", free: "—", pro: "—", office: "✓" },
];

const PLAN_KEY: Record<string, "free" | "pro" | "office"> = { free: "free", pro: "pro", enterprise: "office" };

export default function PlansClient({ userId, email, initialPlan }: { userId: string; email: string; initialPlan: string }) {
  const [plan, setPlan] = useState(initialPlan);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function setTo(next: string, label: string) {
    setSaving(next);
    setMsg(null);
    const res = await fetch("/api/admin/set-plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, plan: next }),
    });
    setSaving(null);
    if (res.ok) {
      setPlan(next);
      setMsg(`✓ Your account is now on ${label}. Open the dashboard (below) to experience it — refresh if it's already open.`);
    } else {
      setMsg("Couldn't switch plan. Try again.");
    }
  }

  const currentKey = PLAN_KEY[plan] ?? "free";
  const currentLabel = PLANS.find((p) => p.id === plan)?.label ?? "Free";

  return (
    <div className="max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Plan sandbox</h1>
          <p className="text-gray-500 text-sm mt-1">Switch <span className="text-gray-300">{email}</span> between plans to test each experience instantly.</p>
        </div>

        {/* Current plan */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-4 flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wide">Your account is currently on</p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: PLANS.find((p) => p.id === plan)?.color }}>{currentLabel}</p>
          </div>
          <span className="text-[0.625rem] font-bold px-3 py-1 rounded-full" style={{ background: (PLANS.find((p) => p.id === plan)?.color ?? "#6b7280") + "22", color: PLANS.find((p) => p.id === plan)?.color }}>{currentLabel}</span>
        </div>

        {/* Switcher */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {PLANS.map((p) => {
            const active = p.id === plan;
            return (
              <button key={p.id} type="button" onClick={() => setTo(p.id, p.label)} disabled={saving !== null}
                className={`text-left rounded-2xl border p-5 transition-all disabled:opacity-60 ${active ? "border-2" : "border-gray-800 hover:border-gray-600 bg-gray-900"}`}
                style={active ? { borderColor: p.color, background: p.color + "12" } : undefined}>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-lg" style={{ color: p.color }}>{p.label}</p>
                  {active && <span className="text-[0.625rem] font-semibold text-gray-400">CURRENT</span>}
                </div>
                <p className="text-gray-500 text-xs mt-1">{p.blurb}</p>
                <p className="mt-3 text-xs font-semibold" style={{ color: active ? "#9ca3af" : p.color }}>
                  {saving === p.id ? "Switching…" : active ? "Active" : `Switch to ${p.label} →`}
                </p>
              </button>
            );
          })}
        </div>

        {msg && <p className="text-sm text-green-400 bg-green-950/30 border border-green-800/40 rounded-xl px-4 py-3 mb-6">{msg}</p>}

        {/* Test links */}
        <div className="flex flex-wrap gap-2 mb-8">
          <a href="/dashboard" target="_blank" rel="noopener noreferrer" className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-full transition-colors">Open dashboard as {currentLabel} ↗</a>
          <Link href="/cards/new" className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-semibold px-4 py-2 rounded-full transition-colors">Create a card</Link>
          <a href="/pricing" target="_blank" rel="noopener noreferrer" className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-semibold px-4 py-2 rounded-full transition-colors">View pricing ↗</a>
        </div>

        {/* Feature matrix */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800"><p className="text-white font-semibold text-sm">What each plan unlocks</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-gray-800">
                  <th className="text-left px-5 py-2.5 font-medium">Feature</th>
                  {(["free", "pro", "office"] as const).map((k) => (
                    <th key={k} className={`text-center px-4 py-2.5 font-semibold ${currentKey === k ? "text-white" : "text-gray-500"}`}>
                      {k === "free" ? "Free" : k === "pro" ? "Pro" : "Office"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {FEATURES.map((f) => (
                  <tr key={f.label}>
                    <td className="px-5 py-2.5 text-gray-300">{f.label}</td>
                    <td className={`text-center px-4 py-2.5 ${currentKey === "free" ? "text-white font-semibold" : "text-gray-500"}`}>{f.free}</td>
                    <td className={`text-center px-4 py-2.5 ${currentKey === "pro" ? "text-white font-semibold" : "text-gray-500"}`}>{f.pro}</td>
                    <td className={`text-center px-4 py-2.5 ${currentKey === "office" ? "text-white font-semibold" : "text-gray-500"}`}>{f.office}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-gray-600 text-[0.6875rem] mt-4">Note: this changes your real account&apos;s plan flag (no charge). Set yourself back to your preferred plan when you&apos;re done testing.</p>
    </div>
  );
}
