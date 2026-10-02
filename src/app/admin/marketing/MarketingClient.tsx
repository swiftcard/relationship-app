"use client";

// Marketing: broadcast emails to user segments (with live recipient counts and
// a mandatory-feeling "send test to me" step) + promo code management.

import { useCallback, useEffect, useState } from "react";
import {
  FREE_PERIODS, APPLIES_TO, INTERVAL_TARGETS, DURATIONS, AUDIENCES,
  MAX_DURATION_MONTHS, promoLabel, describePromo, scopeLabel, durationLabel,
} from "@/lib/promo";
import SentEmailsModal from "./SentEmailsModal";

type Counts = { all: number; free: number; pro: number; office: number };
type PromoCode = {
  id: string; code: string; description: string | null; discount_percent: number | null;
  discount_amount: number | null; max_uses: number | null; expires_at: string | null; created_at: string;
  stripe_coupon_id: string | null;
  discount_type: string | null; free_days: number | null;
  uses_count?: number | null;
  plan_target?: string | null;
  applies_to?: string | null; interval_target?: string | null;
  duration?: string | null; duration_months?: number | null;
};
type PromoLogEntry = PromoCode & {
  uses_count: number;
  active: boolean;
  deactivated_at: string | null;
  plan_target: string | null;
  sends: { count: number; first: string | null; last: string | null };
};
type DomainStatus = {
  configured: boolean; exists: boolean; status: string; error?: string;
  tracking?: { open: boolean; click: boolean };
  records: { record: string; name: string; type: string; value: string; ttl?: string; priority?: number; status?: string }[];
};

// Can this code do what it says? Free time is a trial and a grant switches a
// plan on — neither needs Stripe. Money off needs its Stripe coupon; one made
// without it (Stripe refused it at creation) can't take anything off.
function codeReady(p: { discount_type: string | null; stripe_coupon_id?: string | null }): boolean {
  return p.discount_type === "free_time" || p.discount_type === "grant" || !!p.stripe_coupon_id;
}

export default function MarketingClient() {
  // Broadcast
  const [counts, setCounts] = useState<Counts | null>(null);
  const [optedOut, setOptedOut] = useState(0);
  const [emailReady, setEmailReady] = useState(true);
  const [form, setForm] = useState({ segment: "all", subject: "", headline: "", message: "", ctaLabel: "Open SwiftCard", ctaUrl: "" });
  const [sending, setSending] = useState<"" | "test" | "real">("");
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  // One key per confirm dialog: the server refuses a second campaign with the
  // same key, so a double-click or retried request can't send twice.
  const [sendKey, setSendKey] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  // Promos
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [promosReady, setPromosReady] = useState(true);
  // Every question a code answers (lib/promo): what it gives, how long money
  // off lasts, which plan and billing period it is for, and who may redeem it.
  const EMPTY_PROMO = {
    code: "", description: "",
    discount_type: "free_time",
    free_days: "30", discount_percent: "20", discount_amount: "10",
    duration: "once", duration_months: "3",
    applies_to: "any", interval_target: "any", plan_target: "free",
    max_uses: "", expires_at: "",
  };
  const [promoForm, setPromoForm] = useState(EMPTY_PROMO);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  // Email a promo code to users
  const [promoSend, setPromoSend] = useState<{ code: string; headline: string; message: string; segment: string } | null>(null);
  const [promoSending, setPromoSending] = useState(false);
  const [promoSendResult, setPromoSendResult] = useState<string | null>(null);

  // Promo log popup — every code ever created, active or deactivated
  const [logOpen, setLogOpen] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  const [logCodes, setLogCodes] = useState<PromoLogEntry[] | null>(null);
  const [logUntagged, setLogUntagged] = useState(0);

  // Sending domain (Resend) status
  const [domain, setDomain] = useState<DomainStatus | null>(null);
  const [domainChecking, setDomainChecking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/email-domain").then((r) => r.json()).then(setDomain).catch(() => {});
  }, []);

  async function checkDomain() {
    setDomainChecking(true);
    const res = await fetch("/api/admin/email-domain", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify" }),
    });
    setDomain(await res.json().catch(() => null));
    setDomainChecking(false);
  }

  async function copyVal(key: string, val: string) {
    try { await navigator.clipboard.writeText(val); setCopied(key); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
  }

  async function openPromoLog() {
    setLogOpen(true);
    setLogLoading(true);
    try {
      const res = await fetch("/api/admin/promo-codes/log");
      const d = await res.json();
      if (res.ok) {
        setLogCodes(d.codes ?? []);
        setLogUntagged(d.untaggedSends ?? 0);
      } else {
        setLogCodes([]);
      }
    } catch {
      setLogCodes([]);
    } finally {
      setLogLoading(false);
    }
  }

  async function sendPromoEmail() {
    if (!promoSend) return;
    setPromoSending(true);
    setPromoSendResult(null);
    try {
      const res = await fetch("/api/admin/promo-codes/send", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(promoSend),
      });
      const d = await res.json();
      setPromoSendResult(res.ok
        ? `Sent to ${d.sent} users · ${d.skipped} skipped${d.teamMembersSkipped ? ` · ${d.teamMembersSkipped} team members left out (their company pays for their plan)` : ""}`
        : d.error || "Send failed");
    } catch {
      setPromoSendResult("Network error — please try again.");
    } finally {
      setPromoSending(false);
    }
  }

  useEffect(() => {
    fetch("/api/admin/broadcast")
      .then((r) => r.json())
      .then((d) => {
        if (d.counts) { setCounts(d.counts); setOptedOut(d.optedOut ?? 0); setEmailReady(d.emailTablesReady !== false); }
      })
      .catch(() => {});
  }, []);

  const loadPromos = useCallback(async () => {
    const res = await fetch("/api/admin/promo-codes");
    if (res.ok) {
      const data = await res.json();
      setPromos(data.codes ?? []);
      setPromosReady(true);
    } else {
      setPromosReady(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data fetch on mount
  useEffect(() => { loadPromos(); }, [loadPromos]);

  const recipientCount = counts ? counts[form.segment as keyof Counts] ?? 0 : null;

  async function send(test: boolean) {
    setSending(test ? "test" : "real");
    setResult(null);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ctaUrl: form.ctaUrl || undefined, test, ...(test ? {} : { sendKey }) }),
      });
      const d = await res.json();
      if (res.ok) {
        if (d.duplicate) {
          setResult({ ok: `This email was already sent (${d.sent} delivered) — duplicate click ignored.` });
        } else {
          setResult({
            ok: test
              ? `Test sent to ${d.to} — check your inbox before the real send.`
              : `Sent to ${d.sent} users · ${d.skipped} skipped (unsubscribed or no email)${d.failed ? ` · ${d.failed} failed — see View sent emails` : ""}`,
          });
        }
      } else {
        setResult({ error: d.error || "Send failed" });
      }
    } catch {
      setResult({ error: "Network error — please try again." });
    } finally {
      setSending("");
      setConfirming(false);
    }
  }

  async function createPromo(e: React.FormEvent) {
    e.preventDefault();
    setPromoBusy(true);
    setPromoError(null);
    try {
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...promoForm,
          // Free time is delivered as a TRIAL (trial_period_days) because a
          // Stripe coupon can only express whole months; money off is a coupon.
          free_days: promoForm.discount_type === "free_time" ? Number(promoForm.free_days) : null,
          discount_percent: promoForm.discount_type === "percent" ? Number(promoForm.discount_percent) : null,
          discount_amount: promoForm.discount_type === "fixed" ? Math.round(Number(promoForm.discount_amount) * 100) : null,
          duration_months: promoForm.duration === "repeating" ? Number(promoForm.duration_months) : null,
          max_uses: promoForm.max_uses ? Number(promoForm.max_uses) : null,
          expires_at: promoForm.expires_at || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPromoForm(EMPTY_PROMO);
        // Honest warnings: Stripe rejected the code, or it isn't on Apple yet.
        setPromoError([data.stripeWarning, data.appleWarning].filter(Boolean).join(" ") || null);
        loadPromos();
      } else {
        setPromoError(data.error);
      }
    } catch {
      setPromoError("Network error — please try again.");
    } finally {
      setPromoBusy(false);
    }
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Marketing</h1>
        <p className="text-gray-500 text-sm mt-1">Email your users and run promotions. Always send yourself a test first.</p>
      </div>

      {/* Sending domain status — the one thing that gates real delivery */}
      {domain && (
        <div className={`rounded-2xl border p-5 ${domain.status === "verified" ? "bg-emerald-950/30 border-emerald-800/40" : "bg-amber-950/30 border-amber-800/40"}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="font-semibold text-sm">
              {domain.status === "verified" ? (
                <span className="text-emerald-300">✓ swiftcard.me is verified. Campaigns send from news@swiftcard.me; receipts from billing@, account mail from support@, and card shares from connect@ (see lib/email-senders.ts).</span>
              ) : (
                <span className="text-amber-200">Email domain not verified yet — broadcasts only deliver once swiftcard.me is verified with Resend.</span>
              )}
            </p>
            {domain.status !== "verified" && (
              <button onClick={checkDomain} disabled={domainChecking}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-700/50 border border-amber-600/50 text-amber-100 hover:bg-amber-700 transition-colors disabled:opacity-50">
                {domainChecking ? "Checking…" : "I added the records — check now"}
              </button>
            )}
          </div>
          {domain.status !== "verified" && domain.records.length > 0 && (
            <div className="mt-4">
              <p className="text-amber-200/80 text-xs mb-2">
                Add these records in <b>Namecheap → Domain List → swiftcard.me → Advanced DNS</b>, then click the button above. (Tap any value to copy.)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[0.6875rem]">
                  <thead>
                    <tr className="text-amber-200/60 text-left">
                      <th className="py-1 pr-3 font-medium">Type</th>
                      <th className="py-1 pr-3 font-medium">Host / Name</th>
                      <th className="py-1 pr-3 font-medium">Value</th>
                      <th className="py-1 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-amber-100/90 align-top">
                    {domain.records.map((r, i) => (
                      <tr key={i} className="border-t border-amber-800/30">
                        <td className="py-1.5 pr-3 font-mono">{r.type}{r.priority != null ? ` (prio ${r.priority})` : ""}</td>
                        <td className="py-1.5 pr-3 font-mono cursor-pointer hover:text-white" onClick={() => copyVal(`n${i}`, r.name)}>
                          {r.name} {copied === `n${i}` && <span className="text-emerald-300">✓</span>}
                        </td>
                        <td className="py-1.5 pr-3 font-mono break-all max-w-[340px] cursor-pointer hover:text-white" onClick={() => copyVal(`v${i}`, r.value)}>
                          {r.value.length > 70 ? `${r.value.slice(0, 70)}…` : r.value} {copied === `v${i}` && <span className="text-emerald-300">✓</span>}
                        </td>
                        <td className="py-1.5 font-mono">{r.status ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Off means off: the server turns both back off on every read, so
              this line only ever reads "on" when that PATCH failed. */}
          {domain.tracking && (
            <p className={`text-xs mt-2 ${domain.tracking.open || domain.tracking.click ? "text-red-300" : "text-emerald-200/80"}`}>
              {domain.tracking.open || domain.tracking.click
                ? "Open/click tracking is ON in Resend and could not be turned off — links are being rewritten. Turn both off at resend.com → Domains → swiftcard.me."
                : "Open and click tracking are off — links in every email point straight at swiftcard.me."}
            </p>
          )}
          {domain.error && <p className="text-red-300 text-xs mt-2">{domain.error}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Broadcast composer */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h2 className="text-white font-semibold text-sm">Send email to users</h2>
            <button
              type="button"
              onClick={() => setShowLog(true)}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-full px-3 py-1.5 transition-colors shrink-0"
            >
              View sent emails
            </button>
          </div>
          <p className="text-gray-500 text-xs mb-5">Users who unsubscribed from marketing are skipped automatically; every email includes an unsubscribe link.</p>
          {!emailReady && (
            <p className="text-amber-300 text-xs bg-amber-950/40 border border-amber-800/40 rounded-xl px-3 py-2 mb-4">
              Email preference tables aren&apos;t set up — run <span className="font-mono">supabase/email-system.sql</span> in the Supabase SQL editor so unsubscribes are honored before sending broadcasts.
            </p>
          )}
          <form onSubmit={(e) => { e.preventDefault(); setSendKey(crypto.randomUUID()); setConfirming(true); }} className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Segment</label>
              <select value={form.segment} onChange={(e) => setForm((p) => ({ ...p, segment: e.target.value }))} className={inputCls}>
                <option value="all">All users{counts ? ` (${counts.all})` : ""}</option>
                <option value="free">Free users{counts ? ` (${counts.free})` : ""}</option>
                <option value="pro">Pro + Office{counts ? ` (${counts.pro})` : ""}</option>
                <option value="office">Office only{counts ? ` (${counts.office})` : ""}</option>
              </select>
              {counts && (
                <p className="text-gray-600 text-[0.6875rem] mt-1">
                  ≈ {recipientCount} recipients{optedOut ? ` · ${optedOut} opted out of marketing` : ""}
                </p>
              )}
              {/* A broadcast is a product update and reaches everyone in the
                  segment — team members on a company's Office plan included.
                  An offer belongs in a promo-code send, which leaves them out. */}
              <p className="text-gray-600 text-[0.6875rem] mt-1">
                Broadcasts are product updates and include team members on a company&apos;s Office plan. For an offer or upgrade pitch, send a promo code instead — team members are left out of those automatically.
              </p>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Subject *</label>
              <input type="text" required value={form.subject} onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
                placeholder="🚀 New feature just dropped" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Headline *</label>
              <input type="text" required value={form.headline} onChange={(e) => setForm((p) => ({ ...p, headline: e.target.value }))}
                placeholder="Your digital card just got smarter" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Body *</label>
              <textarea required value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
                rows={5} placeholder="Write a short message to your users…" className={`${inputCls} resize-none`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">CTA button label</label>
                <input type="text" value={form.ctaLabel} onChange={(e) => setForm((p) => ({ ...p, ctaLabel: e.target.value }))}
                  placeholder="Open SwiftCard" className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">CTA URL (optional)</label>
                <input type="url" value={form.ctaUrl} onChange={(e) => setForm((p) => ({ ...p, ctaUrl: e.target.value }))}
                  placeholder="https://swiftcard.me/…" className={inputCls} />
              </div>
            </div>

            {result?.ok && <p className="text-emerald-400 text-sm">{result.ok}</p>}
            {result?.error && <p className="text-red-400 text-sm">{result.error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => send(true)}
                disabled={sending !== "" || !form.subject || !form.headline || !form.message}
                className="flex-1 border border-gray-600 text-gray-200 hover:border-gray-400 disabled:opacity-50 font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                {sending === "test" ? "Sending test…" : "Send test to me"}
              </button>
              <button
                type="submit"
                disabled={sending !== ""}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                Send to segment
              </button>
            </div>
          </form>
        </div>

        {/* Promo codes */}
        <div className="space-y-5">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h2 className="text-white font-semibold text-sm mb-4">Create promo code</h2>
            {!promosReady && (
              <p className="text-amber-300 text-xs bg-amber-950/40 border border-amber-800/40 rounded-xl px-3 py-2 mb-4">
                Promo tables aren&apos;t set up — run <span className="font-mono">supabase/email-system.sql</span> in the Supabase SQL editor.
              </p>
            )}
            <form onSubmit={createPromo} className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Code *</label>
                <div className="flex gap-2">
                  <input type="text" value={promoForm.code} onChange={(e) => setPromoForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                    placeholder="LAUNCH20" required className={`${inputCls} font-mono`} />
                  <button type="button" title="Suggest a code"
                    onClick={() => setPromoForm((p) => ({ ...p, code: `SC${Math.random().toString(36).slice(2, 7).toUpperCase()}` }))}
                    className="shrink-0 px-2.5 rounded-xl border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-xs transition-colors">
                    Suggest
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">What it gives *</label>
                <select value={promoForm.discount_type} onChange={(e) => setPromoForm((p) => ({ ...p, discount_type: e.target.value }))} className={inputCls}>
                  <option value="free_time" className="bg-gray-900">Free time</option>
                  <option value="percent" className="bg-gray-900">Percent off</option>
                  <option value="fixed" className="bg-gray-900">Amount off</option>
                </select>
              </div>

              {/* The offer itself — one control, whichever kind was picked. */}
              {promoForm.discount_type === "free_time" ? (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Free for *</label>
                  <div className="flex gap-2">
                    <select value={FREE_PERIODS.some((f) => String(f.days) === promoForm.free_days) ? promoForm.free_days : "custom"}
                      onChange={(e) => setPromoForm((p) => ({ ...p, free_days: e.target.value === "custom" ? "45" : e.target.value }))}
                      className={inputCls}>
                      {FREE_PERIODS.map((f) => (<option key={f.days} value={String(f.days)} className="bg-gray-900">{f.label}</option>))}
                      <option value="custom" className="bg-gray-900">Custom…</option>
                    </select>
                    {!FREE_PERIODS.some((f) => String(f.days) === promoForm.free_days) && (
                      <input type="number" min="1" max="365" value={promoForm.free_days} aria-label="Days free"
                        onChange={(e) => setPromoForm((p) => ({ ...p, free_days: e.target.value }))}
                        className={`${inputCls} w-24`} />
                    )}
                  </div>
                </div>
              ) : promoForm.discount_type === "percent" ? (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Percent off *</label>
                  <input type="number" min="1" max="100" value={promoForm.discount_percent}
                    onChange={(e) => setPromoForm((p) => ({ ...p, discount_percent: e.target.value }))} className={inputCls} />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Dollars off *</label>
                  <input type="number" min="1" max="100" step="0.01" value={promoForm.discount_amount}
                    onChange={(e) => setPromoForm((p) => ({ ...p, discount_amount: e.target.value }))} className={inputCls} />
                </div>
              )}

              {/* Money off runs for a while; free time is a one-off trial. */}
              {promoForm.discount_type !== "free_time" && (
                <div className={promoForm.duration === "repeating" ? "" : "col-span-2"}>
                  <label className="text-xs text-gray-400 block mb-1">How long it lasts *</label>
                  <select value={promoForm.duration} onChange={(e) => setPromoForm((p) => ({ ...p, duration: e.target.value }))} className={inputCls}>
                    {DURATIONS.map((d) => (<option key={d.id} value={d.id} className="bg-gray-900">{d.label}</option>))}
                  </select>
                </div>
              )}
              {promoForm.discount_type !== "free_time" && promoForm.duration === "repeating" && (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Months *</label>
                  <input type="number" min="1" max={MAX_DURATION_MONTHS} value={promoForm.duration_months}
                    onChange={(e) => setPromoForm((p) => ({ ...p, duration_months: e.target.value }))} className={inputCls} />
                </div>
              )}

              <div>
                <label className="text-xs text-gray-400 block mb-1">Which plan *</label>
                <select value={promoForm.applies_to} onChange={(e) => setPromoForm((p) => ({ ...p, applies_to: e.target.value }))} className={inputCls}>
                  {APPLIES_TO.map((a) => (<option key={a.id} value={a.id} className="bg-gray-900">{a.label}</option>))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Billing period *</label>
                <select value={promoForm.interval_target} onChange={(e) => setPromoForm((p) => ({ ...p, interval_target: e.target.value }))} className={inputCls}>
                  {INTERVAL_TARGETS.map((i) => (<option key={i.id} value={i.id} className="bg-gray-900">{i.label}</option>))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Who can redeem it *</label>
                <select value={promoForm.plan_target} onChange={(e) => setPromoForm((p) => ({ ...p, plan_target: e.target.value }))} className={inputCls}>
                  {AUDIENCES.map((a) => (<option key={a.id} value={a.id} className="bg-gray-900">{a.label}</option>))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="text-xs text-gray-400 block mb-1">Description <span className="text-gray-600">(only you see this)</span></label>
                <input type="text" value={promoForm.description} onChange={(e) => setPromoForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Spring launch — Instagram" className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Total redemptions</label>
                <input type="number" min="1" value={promoForm.max_uses} onChange={(e) => setPromoForm((p) => ({ ...p, max_uses: e.target.value }))}
                  placeholder="Unlimited" className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Expires</label>
                <input type="date" value={promoForm.expires_at} onChange={(e) => setPromoForm((p) => ({ ...p, expires_at: e.target.value }))} className={inputCls} />
              </div>

              {/* Exactly what is about to be created, in the words the customer
                  and the admin list both use. */}
              <div className="col-span-2 rounded-xl border border-gray-800 bg-gray-950/60 px-3.5 py-3">
                <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-gray-500 mb-1">This code will give</p>
                <p className="text-sm text-white">
                  <span className="font-mono font-bold">{promoForm.code || "YOURCODE"}</span>{" — "}
                  {describePromo({
                    discount_type: promoForm.discount_type,
                    free_days: Number(promoForm.free_days),
                    discount_percent: Number(promoForm.discount_percent),
                    discount_amount: Math.round(Number(promoForm.discount_amount) * 100),
                    duration: promoForm.duration,
                    duration_months: Number(promoForm.duration_months),
                    applies_to: promoForm.applies_to,
                    interval_target: promoForm.interval_target,
                    plan_target: promoForm.plan_target,
                    max_uses: promoForm.max_uses ? Number(promoForm.max_uses) : null,
                  })}
                  {promoForm.expires_at ? ` · until ${promoForm.expires_at}` : ""}
                </p>
                <p className="text-[0.6875rem] text-gray-500 mt-1.5">
                  {promoForm.discount_type === "grant"
                    ? "Customers enter it in the promo box on the Pricing page or the order page — it switches the plan on straight away, no card."
                    : "Customers enter every code in the SwiftCard promo box — on the Pricing page, or \"Have a promo code?\" on the order page just before payment. Stripe's payment page has no code field."}
                </p>
              </div>

              {promoError && <p className="col-span-2 text-red-400 text-xs">{promoError}</p>}
              <button type="submit" disabled={promoBusy}
                className="col-span-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 rounded-xl text-sm transition-colors">
                {promoBusy ? "Creating…" : "Create code"}
              </button>
            </form>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
              <p className="text-white font-semibold text-sm">Promo codes ({promos.length})</p>
              <button
                onClick={openPromoLog}
                title="Every code ever created — what it was, when it was sent, and how long it was active"
                className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg px-2.5 py-1 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l3.5 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Log
              </button>
            </div>
            {promos.length === 0 ? (
              <p className="px-5 py-8 text-center text-gray-500 text-sm">No promo codes yet</p>
            ) : (
              <div className="divide-y divide-gray-800/60">
                {promos.map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-5 py-2.5 text-xs gap-3">
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-white bg-gray-800 px-2 py-0.5 rounded">{p.code}</span>
                      <span
                        className={`ml-2 text-[0.5625rem] font-bold px-1.5 py-0.5 rounded-full ${codeReady(p) ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/40 text-red-300"}`}
                        title={codeReady(p)
                          ? "Works in the SwiftCard promo box (Pricing page and the order page)"
                          : "Money off with no Stripe coupon behind it — it can't take anything off. Deactivate it and create it again."}
                      >
                        {codeReady(p) ? "Ready ✓" : "Broken"}
                      </span>
                      {p.description && <span className="text-gray-500 ml-2">{p.description}</span>}
                      {/* The whole offer in words, so a code is never a mystery
                          in the list (owner, 2026-09-17). */}
                      <p className="text-gray-500 mt-1 text-[0.6875rem]">
                        {scopeLabel(p)}{durationLabel(p) ? ` · ${durationLabel(p)}` : ""}
                        {p.max_uses ? ` · ${p.uses_count ?? 0}/${p.max_uses} redeemed` : ` · ${p.uses_count ?? 0} redeemed`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Shared label helper — the admin list and the customer's
                          /pricing box describe a code with the same words. */}
                      <span className="text-green-400 font-semibold">{promoLabel(p)}</span>
                      <span className="text-gray-600">{p.expires_at ? `until ${new Date(p.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "no expiry"}</span>
                      <button
                        onClick={() => { setPromoSend({ code: p.code, headline: `Here's ${promoLabel(p)} on SwiftCard ${p.applies_to === "office" ? "Office" : "Pro"}`, message: `Use the code below to get ${promoLabel(p).toLowerCase()} on ${scopeLabel(p).toLowerCase()}.`, segment: p.plan_target === "pro" ? "pro" : "free" }); setPromoSendResult(null); }}
                        className="text-blue-400 hover:text-blue-300 transition-colors font-semibold">
                        Email to users
                      </button>
                      <button
                        onClick={async () => {
                          // Delete = deactivate everywhere, immediately. It stays
                          // in the Log with its full history.
                          if (!window.confirm(`Deactivate ${p.code}? It stops working for everyone immediately — at checkout, on /pricing, and on Stripe.`)) return;
                          const res = await fetch(`/api/admin/promo-codes?id=${p.id}`, { method: "DELETE" });
                          const d = await res.json().catch(() => ({}));
                          if (d.stripeWarning) setPromoError(d.stripeWarning);
                          loadPromos();
                        }}
                        className="text-gray-600 hover:text-red-400 transition-colors">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Promo log popup — every code ever created, with sends + active window */}
      {logOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center px-4" onClick={(e) => e.target === e.currentTarget && setLogOpen(false)}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
              <div>
                <p className="text-white font-bold">Promo code log</p>
                <p className="text-gray-500 text-xs mt-0.5">Every code ever created — including deactivated ones.</p>
              </div>
              <button onClick={() => setLogOpen(false)} className="text-gray-500 hover:text-white">✕</button>
            </div>

            <div className="overflow-y-auto px-6 py-4">
              {logLoading ? (
                <p className="text-gray-500 text-sm text-center py-10">Loading…</p>
              ) : !logCodes || logCodes.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-10">No promo codes have been created yet.</p>
              ) : (
                <div className="space-y-3">
                  {logCodes.map((c) => {
                    const expired = !!c.expires_at && new Date(c.expires_at) < new Date();
                    const maxed = c.max_uses != null && c.uses_count >= c.max_uses;
                    const status = !c.active ? "Deactivated" : expired ? "Expired" : maxed ? "Max uses reached" : "Active";
                    const statusCls = status === "Active"
                      ? "bg-emerald-900/50 text-emerald-300"
                      : status === "Deactivated"
                        ? "bg-red-950/60 text-red-300"
                        : "bg-amber-950/60 text-amber-300";
                    // How long the code was (or has been) live.
                    const activeEnd = !c.active
                      ? (c.deactivated_at ? new Date(c.deactivated_at) : null)
                      : expired ? new Date(c.expires_at as string) : new Date();
                    const activeDays = activeEnd
                      ? Math.max(0, Math.round((activeEnd.getTime() - new Date(c.created_at).getTime()) / 86400000))
                      : null;
                    const fmt = (iso: string | null) =>
                      iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
                    return (
                      <div key={c.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-white bg-gray-800 px-2 py-0.5 rounded text-xs">{c.code}</span>
                          <span className={`text-[0.5625rem] font-bold px-1.5 py-0.5 rounded-full ${statusCls}`}>{status}</span>
                          <span className="text-green-400 text-xs font-semibold">{promoLabel(c)}</span>
                          {c.description && <span className="text-gray-500 text-xs">· {c.description}</span>}
                        </div>
                        <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-[0.6875rem]">
                          <div>
                            <p className="text-gray-600">Created</p>
                            <p className="text-gray-300">{fmt(c.created_at)}</p>
                          </div>
                          <div>
                            <p className="text-gray-600">{c.active ? "Active for" : "Was active for"}</p>
                            <p className="text-gray-300">
                              {activeDays != null ? `${activeDays} day${activeDays === 1 ? "" : "s"}` : "unknown"}
                              {!c.active && (c.deactivated_at ? ` (off ${fmt(c.deactivated_at)})` : " (deactivation date not recorded)")}
                              {c.active && !expired && " (ongoing)"}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-600">Redemptions</p>
                            <p className="text-gray-300">{c.uses_count}{c.max_uses != null ? ` / ${c.max_uses}` : ""}</p>
                          </div>
                          <div>
                            <p className="text-gray-600">Emailed to users</p>
                            <p className="text-gray-300">
                              {c.sends.count > 0 ? `${c.sends.count} email${c.sends.count === 1 ? "" : "s"} · last ${fmt(c.sends.last)}` : "never"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {logUntagged > 0 && (
                    <p className="text-gray-600 text-[0.6875rem] pt-1">
                      + {logUntagged} older promo email{logUntagged === 1 ? "" : "s"} sent before per-code tracking (not tied to a specific code).
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Email-a-promo-code modal */}
      {promoSend && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center px-4" onClick={(e) => e.target === e.currentTarget && setPromoSend(null)}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-white font-bold">Email code <span className="font-mono text-blue-300">{promoSend.code}</span> to users</p>
              <button onClick={() => setPromoSend(null)} className="text-gray-500 hover:text-white">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Segment</label>
                <select value={promoSend.segment} onChange={(e) => setPromoSend((p) => p && { ...p, segment: e.target.value })} className={inputCls}>
                  <option value="free">Free users{counts ? ` (${counts.free})` : ""}</option>
                  <option value="pro">Pro + Office{counts ? ` (${counts.pro})` : ""}</option>
                  <option value="all">All users{counts ? ` (${counts.all})` : ""}</option>
                </select>
                <p className="text-gray-600 text-[0.6875rem] mt-1">Team members on a company&apos;s Office plan are always left out — their company pays for their plan. So is anyone who already has the plan the code is for: Office owners never get a code, and Pro accounts don&apos;t get a Pro code.</p>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Headline</label>
                <input value={promoSend.headline} onChange={(e) => setPromoSend((p) => p && { ...p, headline: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Message</label>
                <textarea rows={3} value={promoSend.message} onChange={(e) => setPromoSend((p) => p && { ...p, message: e.target.value })} className={`${inputCls} resize-none`} />
              </div>
              {promoSendResult && <p className={`text-sm ${promoSendResult.startsWith("Sent") ? "text-emerald-400" : "text-red-400"}`}>{promoSendResult}</p>}
              <button onClick={sendPromoEmail} disabled={promoSending || !promoSend.headline || !promoSend.message}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {promoSending ? "Sending…" : "Send promo email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sent-emails history */}
      {showLog && <SentEmailsModal onClose={() => setShowLog(false)} />}

      {/* Confirm modal for the real send */}
      {confirming && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center px-4" onClick={(e) => e.target === e.currentTarget && setConfirming(false)}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <p className="text-white font-bold mb-2">Send to {recipientCount ?? "all"} users?</p>
            <p className="text-gray-400 text-sm mb-1">Subject: <span className="text-white">{form.subject}</span></p>
            <p className="text-gray-500 text-xs mb-5">This goes out immediately and can&apos;t be recalled. Did you send yourself a test?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} className="flex-1 border border-gray-700 text-gray-400 hover:border-gray-500 font-semibold py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
              <button onClick={() => send(false)} disabled={sending !== ""}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
                {sending === "real" ? "Sending…" : "Yes, send it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
