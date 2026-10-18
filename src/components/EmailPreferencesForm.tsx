"use client";

import { useState } from "react";

type Props = {
  initialMarketing: boolean;
  initialReceipts: boolean;
  /** False for an Office member whose seat the owner pays for — they are never
   *  billed, so a receipts switch controls mail that cannot reach them. Their
   *  stored value is still submitted untouched, so hiding the row never
   *  rewrites a preference. See canSeeBilling() in lib/office-roles. */
  showReceipts?: boolean;
};

export default function EmailPreferencesForm({ initialMarketing, initialReceipts, showReceipts = true }: Props) {
  const [marketing, setMarketing] = useState(initialMarketing);
  const [receipts, setReceipts] = useState(initialReceipts);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/email-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketing_emails: marketing, receipt_emails: receipts }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Was: silently keep the toggles and stop showing "Saving…". The user
      // saw a flicker and assumed it saved — on the screen that decides
      // whether we may email them, which is the worst place to guess.
      setError("Couldn't save your preferences — please try again.");
    }
    setSaving(false);
  }

  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{ background: "var(--sc-bg-elevated, #fff)", border: "1px solid transparent", boxShadow: "var(--sc-shadow-card)" }}
    >
      <Toggle
        label="Marketing emails"
        description="New features, tips, and occasional promotions"
        checked={marketing}
        onChange={setMarketing}
      />
      {showReceipts && (
        <Toggle
          label="Payment receipts"
          description="Confirmation emails when you're billed"
          checked={receipts}
          onChange={setReceipts}
        />
      )}

      <button
        onClick={save}
        disabled={saving}
        className="w-full py-2.5 rounded-full text-sm font-semibold transition-colors"
        style={{ background: "var(--sc-tint, #1D4ED8)", color: "#fff", opacity: saving ? 0.6 : 1 }}
      >
        {saved ? "Saved!" : saving ? "Saving…" : "Save preferences"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-center" style={{ color: "var(--sc-red, #B91C1C)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--sc-label, #0f172a)" }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--sc-label-muted, #64748b)" }}>{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="shrink-0 w-12 h-7 rounded-full transition-colors relative mt-0.5"
        style={{ background: checked ? "var(--sc-green, #1D4ED8)" : "var(--sc-fill-3, #E4DDD4)" }}
        aria-checked={checked}
        role="switch"
        // The row's heading is the switch's name. Without it VoiceOver read
        // "switch, on" with no idea what it switches, and Voice Control had
        // nothing to match "turn on <label>" against.
        aria-label={label}
        type="button"
      >
        <span
          className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.06)] transition-transform"
          style={{ left: checked ? "calc(100% - 26px)" : "2px" }}
        />
      </button>
    </div>
  );
}
