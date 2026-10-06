"use client";

import { useEffect, useRef, useState } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import Link from "next/link";
import { scanBusinessCard, ProRequiredError, AiConsentRequiredError, EmptyScanError } from "@/lib/scan-card";
import { PlanGate } from "@/components/PlanGate";
import CardScanCamera from "@/components/CardScanCamera";

export default function AddContactModal({
  cardOwner,
  onAdded,
  variant = "add",
  canScan,
}: {
  /** Username of the card the contact should be attached to (the selected card). */
  cardOwner?: string;
  /** Called with the new lead so the Contacts list can insert it instantly. */
  onAdded: (lead: unknown) => void;
  /**
   * Which trigger to draw. Both open this same modal — the difference is the
   * door people come through.
   *
   * "scan" exists because the business-card scanner had exactly ONE entry point
   * in the entire product: this modal, reached by a button labelled "Add
   * contact" under a subtitle that (until 2026-09-29) said "Manually add
   * someone to your contacts". A headline Pro feature was invisible to anyone
   * who did not already know it was there. Secondary styling on purpose:
   * typing someone in is still the common case, so this sits beside the blue
   * button rather than competing with it.
   */
  variant?: "add" | "scan";
  /**
   * false = this account is on Free. The scanner is Pro, so tapping it says so
   * at once instead of opening the camera, lining the card up, and only then
   * hearing "Pro feature". undefined = unknown → open the camera; the server's
   * 403 is the real gate either way.
   */
  canScan?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", notes: "", where_met: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [atLimit, setAtLimit] = useState(false);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "error" | "blocked" | "pro">("idle");
  const [scanMsg, setScanMsg] = useState("");
  const [scanned, setScanned] = useState(false);
  // The scanner's live camera (CardScanCamera) — over the modal, not instead of it.
  const [camera, setCamera] = useState(false);
  // The photo being read, shown while it reads so the wait has a face.
  const [thumb, setThumb] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Escape closes (same as the × and the backdrop), focus lands in the modal
  // and returns to "Add contact" afterwards. With the camera up, Escape closes
  // only the camera — the person lands back in the form.
  useDialogA11y(open, () => { if (camera) setCamera(false); else { setOpen(false); reset(); } }, panelRef);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (thumb) URL.revokeObjectURL(thumb); }, [thumb]);

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
    setCamera(false);
    setThumb(null);
  }

  // Free → say "Pro" now. Anyone else → the camera.
  function openScanner() {
    if (canScan === false) {
      setScanState("pro");
      setScanMsg(new ProRequiredError().message);
      return;
    }
    setScanState("idle");
    setScanMsg("");
    setCamera(true);
  }

  // Inside the tap, so the browser lets the file picker open.
  function pickPhoto() {
    setCamera(false);
    fileRef.current?.click();
  }

  // Scan a business card → auto-fill name/company/email/phone. The user still
  // adds "where you met" and notes. lib/scan-card compresses huge phone photos
  // and times out, so it never hangs. `prepared` = the camera's crop, already
  // card-sized, which goes up untouched.
  async function handleScan(photo: Blob, prepared = false) {
    setScanState("scanning");
    setScanMsg("");
    setScanned(false);
    if (fileRef.current) fileRef.current.value = "";
    try {
      const d = await scanBusinessCard(photo, { prepared });
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
      // "blocked": AI is switched off — a setting, so no "Try again".
      if (err instanceof AiConsentRequiredError) { setScanState("blocked"); setScanMsg(err.message); }
      else if (err instanceof ProRequiredError) { setScanState("pro"); setScanMsg(err.message); }
      else if (err instanceof EmptyScanError) { setScanState("error"); setScanMsg("Couldn't find contact details on that card. Fill the frame with the card and try again."); }
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
      // The Contacts list inserts it at once — no server round trip.
      onAdded(data.lead);
    } catch {
      setError("Network error. Please try again.");
    }
    setSaving(false);
  }

  return (
    <>
      <button
        // "Scan a card" goes straight to the camera — one tap, not two.
        onClick={() => { setOpen(true); if (variant === "scan") openScanner(); }}
        // whitespace-nowrap: in a narrow header row "Add contact" broke to two
        // lines INSIDE the button — which doubled its height and read as an
        // oversized blue block rather than a small action.
        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors whitespace-nowrap shrink-0 ${
          variant === "scan" ? "border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white" : ""
        }`}
        style={variant === "scan" ? undefined : { background: "#1D4ED8", color: "#fff" }}
      >
        {variant === "scan" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M8 2a1 1 0 011 1v4h4a1 1 0 110 2H9v4a1 1 0 11-2 0V9H3a1 1 0 110-2h4V3a1 1 0 011-1z"/>
          </svg>
        )}
        {variant === "scan" ? "Scan a card" : "Add contact"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pt-[max(1rem,calc(env(safe-area-inset-top)+0.5rem))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] sm:pb-0">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setOpen(false); reset(); }} />

          {/* Modal */}
          <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="add-contact-title" className="relative w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div>
                <h2 id="add-contact-title" className="text-white font-bold text-base">Add contact</h2>
                {/* Said "Manually add someone to your contacts" — directly above
                    the camera button that scans a paper business card, which is
                    the only way into the scanner in the whole product. The
                    sentence told people the one thing this modal does is the one
                    thing it does not only do (audit 2026-09-29). */}
                <p className="text-gray-500 text-xs mt-0.5">Scan a business card, or type their details in</p>
              </div>
              <button
                onClick={() => { setOpen(false); reset(); }}
                aria-label="Close"
                // Same 28px square to look at; the padding around it makes the
                // tap target 44px without moving anything.
                className="w-7 h-7 -m-2 box-content p-2 rounded-lg bg-clip-content bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3 h-3">
                  <path d="M1 1l10 10M11 1L1 11"/>
                </svg>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 overflow-y-auto">
              {/* Scan a business card — auto-fills the fields below. The
                  button opens our own camera (CardScanCamera: a card frame
                  that turns green). This input is the fallback behind its
                  "Choose photo" — no `capture`, so it offers the photo
                  library, which is the point of it. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setThumb(URL.createObjectURL(f)); handleScan(f); }
                }}
              />
              <button
                type="button"
                onClick={openScanner}
                disabled={scanState === "scanning"}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                {scanState === "scanning" ? (
                  <>
                    {thumb
                      // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, nothing for next/image to optimise
                      ? <img src={thumb} alt="" className="h-5 w-[2.2rem] rounded object-cover ring-1 ring-white/40" />
                      : null}
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Reading card…
                  </>
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
              {(scanState === "error" || scanState === "blocked") && (
                <p className="text-amber-400 text-[0.6875rem] text-center">
                  {scanMsg}
                  {scanState === "error" && (
                    <> <button type="button" onClick={openScanner} className="font-semibold underline">Try again</button></>
                  )}
                </p>
              )}
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
                  // Not under the camera: on a phone a focused field behind it
                  // can raise the keyboard over the viewfinder.
                  autoFocus={!camera}
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

          {camera && (
            <CardScanCamera
              onClose={() => setCamera(false)}
              onPickPhoto={pickPhoto}
              onCapture={(photo) => {
                setCamera(false);
                setThumb(URL.createObjectURL(photo));
                handleScan(photo, true);
              }}
            />
          )}
        </div>
      )}
    </>
  );
}
