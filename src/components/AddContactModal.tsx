"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { scanBusinessCard, ProRequiredError, AiConsentRequiredError } from "@/lib/scan-card";
import { PlanGate } from "@/components/PlanGate";

export default function AddContactModal({
  cardOwner,
  onAdded,
}: {
  /** Username of the card the contact should be attached to (the selected card). */
  cardOwner?: string;
  /** Called with the new lead so a client list can insert it instantly (contacts page). */
  onAdded?: (lead: unknown) => void;
} = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", notes: "", where_met: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [atLimit, setAtLimit] = useState(false);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "error" | "pro">("idle");
  const [scanMsg, setScanMsg] = useState("");
  const [scanned, setScanned] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function set(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function reset() {
    setForm({ name: "", email: "", phone: "", company: "", notes: "", where_met: "" });
    setError("");
    setAtLimit(false);
    setScanState("idle");
    setScanMsg("");
    setScanned(false);
  }

  // Scan a business card → auto-fill name/company/email/phone. The user still
  // adds "where you met" and notes. Same robust helper as the dashboard scanner
  // (compresses huge phone photos + times out so it never hangs).
  async function handleScan(file: File) {
    setScanState("scanning");
    setScanMsg("");
    if (fileRef.current) fileRef.current.value = "";
    try {
      const d = await scanBusinessCard(file);
      setForm((prev) => ({
        ...prev,
        name: d.name || prev.name,
        email: d.email || prev.email,
        phone: d.phone || prev.phone,
        company: d.company || prev.company,
      }));
      setScanned(true);
      setScanState("idle");
    } catch (err) {
      if (err instanceof AiConsentRequiredError) { setScanState("error"); setScanMsg(err.message); }
      else if (err instanceof ProRequiredError) { setScanState("pro"); setScanMsg(err.message); }
      else if (err instanceof DOMException && err.name === "AbortError") { setScanState("error"); setScanMsg("That took too long — try a clearer photo."); }
      else { setScanState("error"); setScanMsg("Couldn't read that card. Try a clear, well-lit photo."); }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError("");
    setAtLimit(false);
    try {
      const res = await fetch("/api/leads/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, card_owner: cardOwner }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Contact cap reached → show an upgrade prompt instead of a raw error.
        if (res.status === 402 || data.error === "limit") setAtLimit(true);
        setError(data.message || data.error || "Something went wrong.");
        setSaving(false);
        return;
      }
      setOpen(false);
      reset();
      // On the contacts page, insert into the client list instantly; on the
      // dashboard (no callback), refresh the server data.
      if (onAdded) onAdded(data.lead);
      else router.refresh();
    } catch {
      setError("Network error. Please try again.");
    }
    setSaving(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        // whitespace-nowrap: in a narrow header row "Add contact" broke to two
        // lines INSIDE the button — which doubled its height and read as an
        // oversized blue block rather than a small action.
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors whitespace-nowrap shrink-0"
        style={{ background: "#1D4ED8", color: "#fff" }}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M8 2a1 1 0 011 1v4h4a1 1 0 110 2H9v4a1 1 0 11-2 0V9H3a1 1 0 110-2h4V3a1 1 0 011-1z"/>
        </svg>
        Add contact
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] sm:pb-0">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setOpen(false); reset(); }} />

          {/* Modal */}
          <div className="relative w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div>
                <h2 className="text-white font-bold text-base">Add contact</h2>
                <p className="text-gray-500 text-xs mt-0.5">Manually add someone to your contacts</p>
              </div>
              <button
                onClick={() => { setOpen(false); reset(); }}
                className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3">
                  <path d="M1 1l10 10M11 1L1 11"/>
                </svg>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 overflow-y-auto">
              {/* Scan a business card — auto-fills the fields below */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleScan(f); }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={scanState === "scanning"}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                {scanState === "scanning" ? (
                  <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Reading card…</>
                ) : (
                  <>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>
                    Scan a business card
                  </>
                )}
              </button>
              {scanned && scanState === "idle" && (
                <p className="text-emerald-400 text-[0.6875rem] text-center">✓ Filled from the card — add where you met &amp; notes below.</p>
              )}
              {scanState === "error" && <p className="text-amber-400 text-[0.6875rem] text-center">{scanMsg}</p>}
              {scanState === "pro" && (
                <PlanGate
                  feature="scanner"
                  nativeCopy="Pro feature — The card scanner is only available on the Pro plan"
                >
                  <p className="text-[0.6875rem] text-center text-blue-300">{scanMsg} <Link href="/upgrade" className="font-semibold underline">Upgrade →</Link></p>
                </PlanGate>
              )}
              <div className="flex items-center gap-2 py-0.5">
                <div className="flex-1 h-px bg-gray-800" />
                <span className="text-gray-600 text-[0.625rem] uppercase tracking-wide">or enter manually</span>
                <div className="flex-1 h-px bg-gray-800" />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Full name *</label>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Sarah Williams"
                  className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="sarah@acme.com"
                    className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 font-medium block mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="(555) 000-0000"
                    className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Company</label>
                <input
                  value={form.company}
                  onChange={(e) => set("company", e.target.value)}
                  placeholder="Acme Corp"
                  className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Where you met</label>
                <input
                  value={form.where_met}
                  onChange={(e) => set("where_met", e.target.value)}
                  placeholder="e.g. NAR Conference, booth #42"
                  className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="What you discussed, next steps…"
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {error && !atLimit && <p className="text-red-400 text-xs">{error}</p>}
              {atLimit && (
                <PlanGate
                  feature="leads-cap"
                  nativeCopy="Pro feature — You've used your 5 free leads this month. Unlimited leads are only available on the Pro plan"
                >
                  <div className="rounded-xl px-3 py-2.5 bg-blue-950/40 border border-blue-800/40">
                    <p className="text-blue-200 text-xs">{error}</p>
                    <Link href="/upgrade" className="inline-block mt-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300">Upgrade to Pro · keep capturing every lead →</Link>
                  </div>
                </PlanGate>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setOpen(false); reset(); }}
                  className="flex-1 text-sm font-semibold py-2.5 rounded-xl bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 text-sm font-semibold py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
                >
                  {saving ? "Saving…" : "Add contact"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
