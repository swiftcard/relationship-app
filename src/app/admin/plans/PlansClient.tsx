"use client";

import { useState } from "react";
import Link from "next/link";
import { PLAN_LIMITS } from "@/lib/plan";
import { PageHeader, Section, Stack } from "../_ui/layout";
import { PlanBadge } from "../_ui/badges";
import { Icon } from "../_ui/icons";

const PLANS = [
  { id: "free", label: "Free", blurb: "The starter experience." },
  { id: "pro", label: "Pro", blurb: "The main paid plan." },
  { id: "enterprise", label: "Office", blurb: "Teams & multiple seats." },
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
  // A failure is shown as a failure: this message used to be green whatever
  // it said, so "Couldn't switch plan" read like a success.
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function setTo(next: string, label: string) {
    setSaving(next);
    setMsg(null);
    // A dropped connection used to leave every button disabled until a
    // reload (audit F-ADMIN-05).
    try {
      const res = await fetch("/api/admin/set-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plan: next }),
      });
      if (res.ok) {
        setPlan(next);
        setMsg({ ok: true, text: `Your account is now on ${label}. Open the dashboard to try it — refresh it if it's already open.` });
      } else {
        setMsg({ ok: false, text: "Couldn't switch plan. Nothing changed — try again." });
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server. Your plan wasn't changed." });
    } finally {
      setSaving(null);
    }
  }

  const currentKey = PLAN_KEY[plan] ?? "free";
  const currentLabel = PLANS.find((p) => p.id === plan)?.label ?? "Free";

  return (
    <Stack>
      <PageHeader
        title="Sandbox"
        description="Try SwiftCard as a Free, Pro or Office customer on your own account. Nothing is charged."
      />

      <Section
        title="Switch your plan"
        hint={<>Changes the plan on <span className="font-medium" style={{ color: "var(--sc-label)" }}>{email}</span> right away. You&apos;re on <PlanBadge plan={plan} /> now.</>}
      >
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          {PLANS.map((p) => {
            const active = p.id === plan;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setTo(p.id, p.label)}
                disabled={saving !== null || active}
                aria-pressed={active}
                className="adm-inset text-left p-4 sm:p-5 transition-shadow disabled:cursor-default"
                style={active ? { boxShadow: "inset 0 0 0 2px var(--sc-tint)", background: "var(--sc-tint-soft)" } : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="sc-t-headline">{p.label}</span>
                  {active && <span className="sc-badge sc-badge-tint">✓ Current</span>}
                </div>
                <p className="adm-muted sc-t-footnote mt-1">{p.blurb}</p>
                <p className="sc-t-subhead font-semibold mt-3" style={{ color: active ? "var(--sc-label-muted)" : "var(--sc-tint)" }}>
                  {saving === p.id ? "Switching…" : active ? "Active on your account" : `Switch to ${p.label} →`}
                </p>
              </button>
            );
          })}
        </div>
        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={`mt-4 px-4 py-3 sc-t-subhead ${msg.ok ? "adm-callout-good" : "adm-callout-danger"}`}>
            {msg.text}
          </p>
        )}
      </Section>

      <Section title="Try it as this plan" hint="Open the product the way a customer on your current plan sees it.">
        <div className="flex flex-wrap gap-2">
          <a href="/dashboard" target="_blank" rel="noopener noreferrer" className="sc-btn sc-btn-filled sc-btn-sm">
            Open dashboard as {currentLabel} <Icon name="external" className="w-4 h-4" />
          </a>
          <Link href="/cards/new" className="sc-btn sc-btn-gray sc-btn-sm">Create a card</Link>
          <a href="/pricing" target="_blank" rel="noopener noreferrer" className="sc-btn sc-btn-gray sc-btn-sm">
            View pricing <Icon name="external" className="w-4 h-4" />
          </a>
        </div>
      </Section>

      <Section title="What each plan unlocks" hint="Your current plan is highlighted." flush>
        {/* Phone: one feature per row, the three plans side by side under it. */}
        <ul className="sm:hidden adm-divide">
          {FEATURES.map((f) => (
            <li key={f.label} className="px-4 py-3">
              <p className="sc-t-subhead font-medium">{f.label}</p>
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                {(["free", "pro", "office"] as const).map((k) => (
                  <div key={k} className="adm-inset px-2 py-1.5 text-center min-w-0"
                    style={currentKey === k ? { background: "var(--sc-tint-soft)", boxShadow: "inset 0 0 0 1.5px var(--sc-tint)" } : undefined}>
                    <span className="block sc-t-caption adm-muted">{k === "free" ? "Free" : k === "pro" ? "Pro" : "Office"}</span>
                    <span className="block sc-t-footnote font-semibold break-words">{f[k]}</span>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block overflow-x-auto">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Feature</th>
                {(["free", "pro", "office"] as const).map((k) => (
                  <th key={k} style={{ textAlign: "center", ...(currentKey === k ? { color: "var(--sc-tint)" } : {}) }}>
                    {k === "free" ? "Free" : k === "pro" ? "Pro" : "Office"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.label}>
                  <td>{f.label}</td>
                  {(["free", "pro", "office"] as const).map((k) => (
                    <td key={k} className="text-center whitespace-nowrap"
                      style={currentKey === k ? { background: "var(--sc-tint-soft)", fontWeight: 600 } : { color: "var(--sc-label-muted)" }}>
                      {f[k]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="adm-muted sc-t-footnote">
        This changes your real account&apos;s plan flag (no charge). Set yourself back to your preferred plan when you&apos;re done testing.
      </p>
    </Stack>
  );
}
