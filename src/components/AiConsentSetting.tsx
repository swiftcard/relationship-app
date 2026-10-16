"use client";

import { useEffect, useState } from "react";
import { useIsNativeApp } from "@/lib/platform";
import type { AiConsent } from "@/lib/ai-consent";

/**
 * The standing on/off switch for AI features, in Settings → Notifications and
 * preferences. Exists because the consent dialog's 403 message and the
 * declined state both say "turn it back on in Settings" — a claim that used to
 * point at nothing. App Review 5.1.2(i) asks for permission; permission that
 * can never be revisited isn't a real control.
 *
 * Native-only, like the dialog itself: the web has never been asked, so a web
 * account has nothing to manage here (an explicit decline made in the app is
 * still honoured everywhere server-side). Renders and fetches nothing on web.
 */
export default function AiConsentSetting() {
  const native = useIsNativeApp();
  const [consent, setConsent] = useState<AiConsent | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/ai-consent");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setConsent(data.consent);
        setProvider(data.provider);
      } catch {
        /* row simply doesn't render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [native]);

  // Hidden on web, while loading, and when no AI provider is configured
  // (nothing to consent to).
  if (!native || !consent || !provider) return null;

  const on = consent === "accepted";

  async function setDecision(decision: "accepted" | "declined") {
    setSaving(true);
    setConsent(decision);
    try {
      await fetch("/api/account/ai-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
    } catch {
      /* optimistic state stands; stored on the next successful toggle */
    }
    setSaving(false);
  }

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">AI features</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">
            {on
              ? `Card scans, follow-up drafts (with the contact's details and your own profile text), card-design rebuilds and assistant questions are sent to ${provider} to produce the result, and to no one else.`
              : `Off. Nothing is sent to ${provider}; everything else in SwiftCard keeps working.`}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="AI features"
          disabled={saving}
          onClick={() => setDecision(on ? "declined" : "accepted")}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? "bg-[var(--sc-green)]" : "bg-[var(--sc-fill-3)]"}`}
        >
          <span
            aria-hidden
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.06)] transition-all ${on ? "left-6" : "left-1"}`}
          />
        </button>
      </div>
    </div>
  );
}
