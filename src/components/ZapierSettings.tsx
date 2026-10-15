"use client";

import Link from "next/link";
import { useState } from "react";
import { PlanGate, GateCopy } from "@/components/PlanGate";
import { IapProLock, Lock } from "@/components/NativePaywall";
import CardScopePicker, { ScopeChooser, scopeChoiceReady, scopeChoiceValue, type ScopeChoice, type ScopeCard, type Scope } from "@/components/CardScopePicker";
import { relativeTime } from "@/lib/relative-time";

const INTEGRATIONS_NATIVE_COPY =
  "Pro feature — Salesforce, GoHighLevel, Pipedrive, HubSpot, Google Contacts and Zapier are only available on the Pro plan";

export default function ZapierSettings({
  initialUrl,
  isPro,
  crmConnected = false,
  cards = [],
  zapierScope = null,
  lastError = null,
  lastSentAt = null,
  waiting = 0,
}: {
  initialUrl: string | null;
  isPro: boolean;
  /** True when a CRM is already connected directly above. Drives the
   *  duplicate-contacts warning — see the note where it renders. */
  crmConnected?: boolean;
  /** The account's cards, for the per-card scope picker. */
  cards?: ScopeCard[];
  /** Which cards currently fire this webhook. null = all cards. */
  zapierScope?: Scope;
  /** Why the last delivery failed (a Zap switched off answers 410), if it did. */
  lastError?: string | null;
  /** When a contact last reached the webhook. */
  lastSentAt?: string | null;
  /** Contacts waiting for the daily retry. */
  waiting?: number;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  // The webhook that is actually SAVED — what delivery status and the scope
  // picker describe. Typing in the field doesn't change it; Save does.
  const [savedUrl, setSavedUrl] = useState(initialUrl ?? "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Pre-connect scope (owner order 2026-08-27): the FIRST save of a webhook on
  // a multi-card account must actively choose all-cards vs only-these. An
  // account with a webhook already saved keeps its stored scope (the picker
  // below handles changes) and isn't re-asked.
  const askScope = cards.length > 1 && !savedUrl;
  const [choice, setChoice] = useState<ScopeChoice>({ mode: "unset", ids: [] });
  // The scope as it is NOW. A first save in this visit sets it from the
  // chooser; the picker below must show that, not the page-load value.
  const [scopeNow, setScopeNow] = useState<Scope>(zapierScope);
  const [test, setTest] = useState<{ state: "idle" | "testing" | "done"; ok?: boolean; message?: string }>({ state: "idle" });
  const [error, setError] = useState<string | null>(lastError);

  async function save(next: string = url) {
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/settings/zapier", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zapier_webhook_url: next,
          ...(askScope && next ? { zapier_card_ids: scopeChoiceValue(choice) } : {}),
        }),
      });
      if (!res.ok) {
        // The server's own words — "Enter a Zapier webhook URL (https://hooks.zapier.com/…)"
        // tells someone what to fix; "Failed to save" told them nothing.
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        setSaveError(d.message || "Couldn't save. Try again.");
        setSaveStatus("error");
        return;
      }
      if (!next) setScopeNow(null);
      else if (askScope) setScopeNow(scopeChoiceValue(choice));
      setSavedUrl(next);
      setUrl(next);
      setError(null); // a new (or removed) webhook starts clean, as the server does
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveError("Couldn't reach SwiftCard. Check your connection and try again.");
      setSaveStatus("error");
    }
  }

  async function sendTest() {
    if (!url) return;
    setTest({ state: "testing" });
    try {
      const res = await fetch("/api/settings/zapier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: url }),
      });
      // `ok` in the BODY is Zapier's answer. The route's own status is 200
      // whether Zapier took the test or not, which is how a switched-off Zap
      // used to show "Sent ✓".
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      setTest({ state: "done", ok: res.ok && !!d.ok, message: d.message || (d.ok ? "Test sent." : "Zapier didn't take the test. Check the URL and that the Zap is on.") });
    } catch {
      setTest({ state: "done", ok: false, message: "Couldn't reach SwiftCard. Check your connection and try again." });
    }
  }

  const removeButton = (
    <button
      type="button"
      onClick={() => save("")}
      disabled={saveStatus === "saving"}
      className="text-xs text-slate-400 hover:text-red-500 transition-colors font-medium shrink-0"
    >
      {saveStatus === "saving" ? "..." : "Remove"}
    </button>
  );

  return (
    <div className={`bg-[#EDE5D8] border border-[#D4C8B8] rounded-2xl px-5 py-5 shadow-sm space-y-4 ${!isPro ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-slate-900 font-semibold text-sm">Zapier Webhook</p>
          <p className="text-slate-400 text-xs">For anything not listed above — send leads to 6,000+ apps</p>
        </div>
        {/* A saved webhook can always be removed — on any plan. Only adding
            one is Pro. */}
        {!isPro && savedUrl ? (
          removeButton
        ) : !isPro ? (
          <PlanGate
            feature="integration-zapier"
            nativeCopy={INTEGRATIONS_NATIVE_COPY}
            nativeContent={<span className="ml-auto"><IapProLock /></span>}
          >
            <Link href="/upgrade" title="Get Pro to connect Zapier" className="ml-auto inline-flex items-center gap-1 rounded-full border border-[#D4C8B8] bg-[#F0EBE1] px-2 py-1 text-[0.6875rem] font-semibold text-slate-500 transition-colors hover:border-[#1D4ED8] hover:text-[#1D4ED8]"><Lock className="h-2.5 w-2.5" />Pro</Link>
          </PlanGate>
        ) : null}
      </div>

      {isPro ? (
        <>
          {/* The trap this prevents: connect HubSpot directly AND point a Zap at
              HubSpot, and every contact arrives twice. Both paths fire on the
              same lead, and nothing else on this page says so. Only shown once
              they've actually done both, so it's a real warning rather than
              noise on an empty form. */}
          {crmConnected && url.trim() && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5">
              <p className="text-amber-800 text-xs leading-relaxed">
                You already have a CRM connected above. If your Zap also creates contacts in that
                same CRM, you&apos;ll get each one twice — use the Zap for other tools instead.
              </p>
            </div>
          )}

          {/* Is it actually receiving? The webhook can be saved and the Zap
              switched off — Zapier then refuses every contact, and this is the
              only place that says so. */}
          {savedUrl && (
            <div className="space-y-1">
              {error && <p className="text-xs text-amber-700">{error}</p>}
              <p className="text-[0.6875rem] text-slate-500">
                {waiting > 0 ? (
                  <>{waiting} contact{waiting === 1 ? "" : "s"} waiting to send — SwiftCard tries again every day</>
                ) : lastSentAt ? (
                  <>Last contact sent <span suppressHydrationWarning>{relativeTime(lastSentAt).toLowerCase()}</span></>
                ) : (
                  <>No contacts sent yet</>
                )}
              </p>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="zapier-url" className="text-xs text-slate-500 block">Webhook URL</label>
              {savedUrl && removeButton}
            </div>
            <input
              id="zapier-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              className="w-full bg-[#FAF7F2] border border-[#D4C8B8] text-slate-900 placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#1D4ED8] transition-colors"
            />
          </div>

          {/* How to get the URL */}
          <div className="bg-[#F0EBE1] rounded-xl px-4 py-3 text-xs text-slate-500 leading-relaxed">
            <p className="font-medium text-slate-700 mb-1">How to set up:</p>
            <p>1. Go to zapier.com → Create Zap</p>
            <p>2. Trigger: <strong>Webhooks by Zapier → Catch Hook</strong></p>
            <p>3. Copy the webhook URL and paste it above</p>
            <p>4. Click <strong>Test</strong> — then in Zapier, click <strong>Test trigger</strong> to pull in the sample</p>
            <p>5. Click <strong>Save</strong> here, and turn the Zap on in Zapier</p>
          </div>

          {/* Payload preview */}
          <details className="group">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 transition-colors list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              Sample payload sent on each new lead
            </summary>
            <pre className="mt-2 bg-slate-900 text-slate-300 rounded-xl p-3 text-xs overflow-x-auto leading-relaxed">{`{
  "type": "lead.created",
  "lead_id": "8f1c2e4a-…",
  "card_id": "3b7d9f10-…",
  "name": "Jane Smith",
  "email": "jane@example.com",
  "phone": "555-0100",
  "company": "Acme Inc",
  "message": "Loved meeting you!",
  "notes": "Interested in a demo next week.",
  "where_met": "Austin Founders Mixer",
  "location": "New York, US",
  "source": "QR code",
  "card_owner": "your-card",
  "card_name": "Your Name",
  "card_url": "https://swiftcard.me/your-card",
  "tags": ["scanned"],
  "created_at": "2026-06-23T..."
}`}</pre>
          </details>

          {askScope && (
            <div className="pt-1">
              <ScopeChooser
                group="preconnect-zapier"
                targetName="Zapier"
                cards={cards}
                value={choice}
                onChange={setChoice}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={sendTest}
              disabled={!url || test.state === "testing"}
              className="flex-1 border border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-40 font-medium py-2.5 rounded-full text-sm transition-colors"
            >
              {test.state === "testing" ? "Sending..." : "Test"}
            </button>
            <button
              onClick={() => save()}
              disabled={saveStatus === "saving" || (askScope && !!url && !scopeChoiceReady(choice))}
              className="flex-1 bg-[#1D4ED8] hover:bg-[#1740C4] disabled:opacity-50 text-white font-semibold py-2.5 rounded-full text-sm transition-colors"
            >
              {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : "Save"}
            </button>
          </div>

          {test.state === "done" && (
            <p role="status" className={`text-xs text-center ${test.ok ? "text-green-700" : "text-red-600"}`}>{test.message}</p>
          )}
          {saveStatus === "error" && saveError && <p className="text-red-500 text-xs text-center">{saveError}</p>}

          {/* Only with a webhook actually saved, and only when there's more than
              one card to choose between. The SAVED url deliberately: the scope
              belongs to the saved webhook, and showing this against half-typed
              text would let someone scope a destination that doesn't exist yet. */}
          {savedUrl && cards.length > 1 && (
            <CardScopePicker key={JSON.stringify(scopeNow)} target="zapier" targetName="Zapier" cards={cards} initialScope={scopeNow} />
          )}
        </>
      ) : savedUrl ? (
        // Lapsed with a webhook still saved: say it's paused, and leave the
        // Remove button above. No upgrade wording — this renders in the app.
        <div className="space-y-1">
          <p className="text-xs text-slate-500">Paused — contacts aren&apos;t being sent to this webhook right now. You can still remove it.</p>
          {saveStatus === "error" && saveError && <p className="text-red-500 text-xs">{saveError}</p>}
        </div>
      ) : (
        <PlanGate
          feature="integration-zapier"
          nativeCopy={INTEGRATIONS_NATIVE_COPY}
          nativeContent={<p className="text-xs text-slate-400"><GateCopy copy={INTEGRATIONS_NATIVE_COPY} /></p>}
        >
          <p className="text-xs text-slate-400">Upgrade to Pro to connect Zapier and automate your lead workflow.</p>
        </PlanGate>
      )}
    </div>
  );
}
