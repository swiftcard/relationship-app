"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import CardScopePicker, { ScopeChooser, scopeChoiceReady, scopeChoiceValue, type ScopeChoice, type ScopeCard, type Scope } from "@/components/CardScopePicker";
import { PlanGate } from "@/components/PlanGate";
import { IapProPill, IapProLock, Lock, Spark } from "@/components/NativePaywall";
import { detectNativeApp } from "@/lib/platform";

/**
 * Start an integration's OAuth, correctly for wherever we are.
 *
 * On the web a plain link is right. In the iOS shell it is NOT: the connect
 * route 302s to accounts.google.com, which is absent from capacitor.config's
 * allowNavigation, so the shell hands the whole flow to Safari. The user grants
 * access there, Google returns to swiftcard.me IN SAFARI, and they end up on
 * the website reading "Connected" while the app behind it still says "Connect".
 *
 * `?native=1` makes the callback finish at a swiftcard:// URL that re-opens the
 * app, and @capacitor/browser runs the round trip in an in-app sheet that
 * shares Safari's cookies — so an already-signed-in Google user just taps
 * Allow. Same fix as the LinkedIn headshot import.
 */
async function openConnect(href: string): Promise<void> {
  if (!detectNativeApp()) {
    window.location.href = href;
    return;
  }
  const sep = href.includes("?") ? "&" : "?";
  let url = new URL(`${href}${sep}native=1`, window.location.origin).toString();
  // The system-browser sheet has no app cookies — carry the session across
  // as a short-lived signed token (lib/connect-user.ts).
  try {
    const r = await fetch("/api/integrations/handoff", { method: "POST" });
    if (r.ok) {
      const { h } = (await r.json()) as { h?: string };
      if (h) url += `&h=${encodeURIComponent(h)}`;
    }
  } catch { /* fall through — the sheet will show sign-in instead of a dead tap */ }
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "fullscreen" });
  } catch {
    // Plugin missing (older shell build) — degrades to the old Safari hand-off
    // rather than a dead button.
    window.location.href = url;
  }
}

// Names every destination the list below offers. It used to name three of the
// six, so the iPhone paywall told someone tapping Salesforce that Pro unlocks
// "Zapier, Google Contacts, and HubSpot" — not the thing they tapped.
const INTEGRATIONS_NATIVE_COPY =
  "Pro feature — Salesforce, GoHighLevel, Pipedrive, HubSpot, Google Contacts and Zapier are only available on the Pro plan";

type Integration = "google" | "hubspot" | "pipedrive" | "highlevel" | "salesforce";

type Props = {
  googleConnected: boolean;
  hubspotConnected: boolean;
  pipedriveConnected: boolean;
  highlevelConnected: boolean;
  salesforceConnected?: boolean;
  googleSyncError?: string | null;
  hubspotSyncError?: string | null;
  pipedriveSyncError?: string | null;
  highlevelSyncError?: string | null;
  salesforceSyncError?: string | null;
  /**
   * CRMs the OFFICE OWNER has connected, for a sub-user. Empty for everyone
   * else. Drives the notice explaining that their leads already have a
   * destination — see where it renders.
   */
  teamCrmNames?: string[];
  /**
   * The Office OWNER. Their connections also receive every team member's
   * leads (unless a member connects their own), which the card picker — it
   * lists only the owner's cards — can't show. One line says so.
   */
  isOfficeOwner?: boolean;
  isPro: boolean;
  /**
   * The account's cards, for the per-card scope picker. Integrations are
   * per-ACCOUNT, so without scoping every card feeds the same CRM — connect an
   * employer's GoHighLevel and a personal card's contacts land in it too.
   * Empty/one card means there is nothing to choose and no picker renders.
   */
  cards?: ScopeCard[];
  /** Current scope per provider. null (or missing) = all cards. */
  scopes?: Partial<Record<Integration, Scope>>;
};

function IntegrationCard({
  name,
  description,
  logo,
  connected: initialConnected,
  syncError,
  connectUrl,
  disconnectUrl,
  isPro,
  flashStatus,
  proGated = true,
  scopeSlot,
  cards,
}: {
  name: string;
  description: string;
  logo: React.ReactNode;
  connected: boolean;
  syncError?: string | null;
  connectUrl: string;
  disconnectUrl: string;
  isPro: boolean;
  flashStatus?: string | null;
  /** When false the card ignores plan gating (available to all signed-in users).
      LinkedIn photo import is a card-building aid, not a Pro CRM sync. */
  proGated?: boolean;
  /** Per-card scope control, rendered only while connected. A slot rather than
      data props so this component stays presentational and both card variants
      share one picker. */
  scopeSlot?: React.ReactNode;
  /** The account's cards, for the REQUIRED pre-connect scope choice. */
  cards?: ScopeCard[];
}) {
  // Treat a non-Pro-gated card as always "unlocked" regardless of plan.
  const unlocked = isPro || !proGated;
  const [connected, setConnected] = useState(initialConnected);
  const [disconnecting, setDisconnecting] = useState(false);
  // Pre-connect scope. Connecting is NOT allowed until the user has actively
  // chosen all-cards vs only-these (owner order 2026-08-27) — so Connect first
  // opens this chooser, and Continue stays disabled while mode is "unset".
  // Single-card accounts skip it: there is nothing to choose.
  // Only CRM destinations (the proGated cards) sync leads — LinkedIn photo
  // import has no scope to choose.
  const askScope = (cards?.length ?? 0) > 1 && proGated;
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState<ScopeChoice>({ mode: "unset", ids: [] });

  function connectHref(): string {
    const v = scopeChoiceValue(choice);
    const sep = connectUrl.includes("?") ? "&" : "?";
    return `${connectUrl}${sep}cards=${v === null ? "all" : v.join(",")}`;
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await fetch(disconnectUrl, { method: "DELETE" });
      setConnected(false);
    } catch { /* ignore */ } finally {
      setDisconnecting(false);
    }
  }

  const needsReconnect = connected && !!syncError;

  return (
    <div className={`bg-[#EDE5D8] border rounded-2xl px-5 py-4 shadow-sm ${!unlocked ? "opacity-60" : ""}`}
      style={{ borderColor: needsReconnect ? "#fcd34d" : connected ? "#86efac" : "#D4C8B8" }}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#F0EBE1] border border-[#D4C8B8] flex items-center justify-center shrink-0">
          {logo}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-slate-900 font-semibold text-sm">{name}</p>
            {needsReconnect ? (
              <span className="text-xs bg-amber-100 text-amber-700 font-medium px-2 py-0.5 rounded-full">Reconnect needed</span>
            ) : connected ? (
              <span className="text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full">Connected</span>
            ) : null}
          </div>
          <p className="text-slate-400 text-xs mt-0.5">{description}</p>
        </div>

        {unlocked ? (
          needsReconnect ? (
            <a
              href={connectUrl}
              onClick={(e) => { e.preventDefault(); void openConnect(connectUrl); }}
              className="text-xs bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 py-1.5 rounded-full transition-colors shrink-0"
            >
              Reconnect
            </a>
          ) : connected ? (
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors font-medium shrink-0"
            >
              {disconnecting ? "..." : "Disconnect"}
            </button>
          ) : (
            <a
              href={connectUrl}
              onClick={(e) => {
                e.preventDefault();
                if (askScope) { setChoosing((v) => !v); return; }
                void openConnect(connectUrl);
              }}
              className="text-xs bg-[#1D4ED8] hover:bg-[#1740C4] text-white font-semibold px-3 py-1.5 rounded-full transition-colors shrink-0"
            >
              Connect
            </a>
          )
        ) : (
          <PlanGate
            feature="integration-google"
            nativeCopy={INTEGRATIONS_NATIVE_COPY}
            nativeContent={<span className="shrink-0"><IapProLock /></span>}
          >
            <Link href="/upgrade" title="Get Pro to connect this integration" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#D4C8B8] bg-[#F0EBE1] px-2 py-1 text-[0.6875rem] font-semibold text-slate-500 transition-colors hover:border-[#1D4ED8] hover:text-[#1D4ED8]"><Lock className="h-2.5 w-2.5" />Pro</Link>
          </PlanGate>
        )}
      </div>

      {needsReconnect && (
        <p className="text-xs text-amber-700 mt-2">{syncError}</p>
      )}
      {unlocked && !connected && choosing && (
        <div className="mt-3 pt-3 border-t border-[#D4C8B8]/60 space-y-2">
          <ScopeChooser
            group={`preconnect-${connectUrl}`}
            targetName={name}
            cards={cards ?? []}
            value={choice}
            onChange={setChoice}
          />
          <div className="flex items-center gap-3 pt-0.5">
            <button
              onClick={() => void openConnect(connectHref())}
              disabled={!scopeChoiceReady(choice)}
              className="bg-[#1D4ED8] hover:bg-[#1740C4] disabled:opacity-50 text-white font-semibold px-4 py-1.5 rounded-full text-xs transition-colors"
            >
              Continue to {name}
            </button>
            <button
              onClick={() => setChoosing(false)}
              className="text-slate-400 hover:text-slate-600 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* Only once there's a live connection: choosing which cards feed a
          destination that doesn't exist yet would be configuring nothing. */}
      {unlocked && connected && scopeSlot}
      {flashStatus === "connected" && (
        <p className="text-xs text-green-600 font-medium mt-2">Successfully connected!</p>
      )}
      {flashStatus === "unconfigured" && (
        <p className="text-xs text-amber-600 font-medium mt-2">This integration isn&apos;t switched on yet — check back soon.</p>
      )}
      {flashStatus === "error" && (
        <p className="text-xs text-red-500 mt-2">Connection failed. Check your app credentials and try again.</p>
      )}
    </div>
  );
}

const HUBSPOT_LOGO = (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#ff7a59">
    <path d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.268-1.978V3.04A2.2 2.2 0 0 0 17.236.84h-.065a2.2 2.2 0 0 0-2.197 2.2v.066a2.198 2.198 0 0 0 1.268 1.978V7.93a6.232 6.232 0 0 0-2.962 1.303L5.85 3.845a2.44 2.44 0 0 0 .085-.624 2.451 2.451 0 1 0-2.451 2.45c.463 0 .894-.13 1.263-.353l7.36 5.32a6.232 6.232 0 0 0-.005 7.024l-2.24 2.24a1.944 1.944 0 0 0-.568-.088 1.96 1.96 0 1 0 1.96 1.96 1.944 1.944 0 0 0-.088-.568l2.215-2.215a6.248 6.248 0 1 0 4.723-11.06zm-.892 9.338a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2z"/>
  </svg>
);

const PIPEDRIVE_LOGO = (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#017737" aria-hidden="true">
    <path d="M13.1 3.2c-1.79 0-3.02.79-3.71 1.68-.04-.5-.36-1.44-1.93-1.44H5.09v3.02h1.1c.24 0 .32.08.32.32v14.02h3.36v-6.06c0-.29-.02-.53-.03-.63.63.75 1.79 1.52 3.45 1.52 3.13 0 5.35-2.45 5.35-6.26 0-3.86-2.09-6.17-5.54-6.17zm-.72 9.6c-1.9 0-2.79-1.78-2.79-3.4 0-2.55 1.4-3.44 2.72-3.44 1.63 0 2.75 1.36 2.75 3.42 0 2.15-1.27 3.42-2.68 3.42z"/>
  </svg>
);

const HIGHLEVEL_LOGO = (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#2a9d8f" aria-hidden="true">
    <path d="M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3 6.9 3.8-6.9 3.8-6.9-3.8L12 4.3zM5 9.4l6 3.3v6.6l-6-3.3V9.4zm8 9.9v-6.6l6-3.3v6.6l-6 3.3z"/>
  </svg>
);

// HubSpot connects with a pasted service key / private-app token (see the /token
// route for why) instead of the OAuth redirect the other cards use, so it
// gets its own small form in place of a plain Connect link.
// Paste-a-token integrations (HubSpot, Pipedrive — HighLevel next) are the same
// card with different words. Generalised rather than copied: this file would
// otherwise hold three then four identical 145-line components, which is the
// same trap the sync files fell into, where one fix landed in one copy and not
// the other. Every HubSpot value below is passed in verbatim from the call
// site, so its rendering is byte-for-byte what it was.
function TokenCard({
  provider,
  title,
  description,
  logo,
  saveEndpoint,
  disconnectEndpoint,
  tokenLabel,
  placeholder,
  help,
  extra,
  connected: initialConnected,
  syncError,
  isPro,
  flashStatus,
  scopeSlot,
  cards,
}: {
  provider: string;
  title: string;
  description: string;
  logo: React.ReactNode;
  /**
   * POST here to save. Kept SEPARATE from disconnectEndpoint because HubSpot
   * splits them: POST lives at /hubspot/token and DELETE at /hubspot, and those
   * routes export only their own verb. Collapsing them into one prop sent
   * DELETE to a route with no DELETE handler — a 405 that the disconnect
   * catch swallowed, so the card flipped to "disconnected" while the row stayed
   * in the database and leads kept syncing. Providers that serve both verbs
   * from one path simply pass the same value twice.
   */
  saveEndpoint: string;
  disconnectEndpoint: string;
  tokenLabel: string;
  placeholder: string;
  help: React.ReactNode;
  /**
   * Second value some providers need alongside the token. HighLevel is the
   * case: a Private Integration token isn't scoped to a sub-account, so the
   * Location ID has to be supplied too. Omitted for everyone else.
   */
  extra?: { label: string; placeholder: string };
  connected: boolean;
  syncError?: string | null;
  isPro: boolean;
  flashStatus?: string | null;
  /** Per-card scope control — see IntegrationCard's copy of this prop. */
  scopeSlot?: React.ReactNode;
  /** The account's cards, for the REQUIRED pre-connect scope choice. */
  cards?: ScopeCard[];
}) {
  const [connected, setConnected] = useState(initialConnected);
  const [showForm, setShowForm] = useState(!initialConnected);
  const [token, setToken] = useState("");
  const [extraValue, setExtraValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "disconnecting">("idle");
  const [error, setError] = useState<string | null>(null);
  // Pre-connect scope (owner order 2026-08-27): a first-time connect on a
  // multi-card account must actively choose all-cards vs only-these before
  // Save unlocks. Reconnects (already connected) keep their stored scope and
  // don't re-ask.
  const askScope = (cards?.length ?? 0) > 1 && !initialConnected;
  const [choice, setChoice] = useState<ScopeChoice>({ mode: "unset", ids: [] });

  const needsReconnect = connected && !!syncError;

  // Both values are required when a provider needs a second one — saving with
  // only the token would store a connection that fails on every lead.
  const canSave = !!token.trim() && (!extra || !!extraValue.trim()) && (!askScope || scopeChoiceReady(choice));

  async function save() {
    if (!canSave) return;
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch(saveEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          ...(extra ? { extra: extraValue } : {}),
          // Only a first-time connect sends a scope — see askScope above.
          ...(askScope ? { card_ids: scopeChoiceValue(choice) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Couldn't connect. Try again.");
        setStatus("error");
        return;
      }
      setConnected(true);
      setShowForm(false);
      setToken("");
      setExtraValue("");
      setStatus("idle");
    } catch {
      setError("Couldn't reach SwiftCard. Try again.");
      setStatus("error");
    }
  }

  async function disconnect() {
    setStatus("disconnecting");
    try {
      await fetch(disconnectEndpoint, { method: "DELETE" });
      setConnected(false);
      setShowForm(true);
    } catch { /* ignore */ } finally {
      setStatus("idle");
    }
  }

  return (
    <div className={`bg-[#EDE5D8] border rounded-2xl px-5 py-4 shadow-sm ${!isPro ? "opacity-60" : ""}`}
      style={{ borderColor: needsReconnect ? "#fcd34d" : connected ? "#86efac" : "#D4C8B8" }}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#F0EBE1] border border-[#D4C8B8] flex items-center justify-center shrink-0">
          {logo}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-slate-900 font-semibold text-sm">{title}</p>
            {needsReconnect ? (
              <span className="text-xs bg-amber-100 text-amber-700 font-medium px-2 py-0.5 rounded-full">Reconnect needed</span>
            ) : connected ? (
              <span className="text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full">Connected</span>
            ) : null}
          </div>
          <p className="text-slate-400 text-xs mt-0.5">{description}</p>
        </div>

        {!isPro ? (
          <PlanGate
            feature={`integration-${provider}`}
            nativeCopy={INTEGRATIONS_NATIVE_COPY}
            nativeContent={<span className="shrink-0"><IapProLock /></span>}
          >
            <Link href="/upgrade" title="Get Pro to connect this integration" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#D4C8B8] bg-[#F0EBE1] px-2 py-1 text-[0.6875rem] font-semibold text-slate-500 transition-colors hover:border-[#1D4ED8] hover:text-[#1D4ED8]"><Lock className="h-2.5 w-2.5" />Pro</Link>
          </PlanGate>
        ) : connected && !showForm ? (
          <button
            onClick={disconnect}
            disabled={status === "disconnecting"}
            className="text-xs text-slate-400 hover:text-red-500 transition-colors font-medium shrink-0"
          >
            {status === "disconnecting" ? "..." : "Disconnect"}
          </button>
        ) : !connected && !showForm ? (
          <button onClick={() => setShowForm(true)} className="text-xs bg-[#1D4ED8] hover:bg-[#1740C4] text-white font-semibold px-3 py-1.5 rounded-full transition-colors shrink-0">
            Connect
          </button>
        ) : null}
      </div>

      {isPro && needsReconnect && !showForm && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-amber-700">{syncError}</p>
          <button onClick={() => setShowForm(true)} className="text-xs bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 py-1.5 rounded-full transition-colors shrink-0">
            Reconnect
          </button>
        </div>
      )}

      {isPro && showForm && (
        <div className="mt-3 space-y-2">
          <label className="text-xs text-slate-500 block">{tokenLabel}</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={placeholder}
              className="flex-1 min-w-0 bg-[#FAF7F2] border border-[#D4C8B8] text-slate-900 placeholder-slate-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#1D4ED8] transition-colors"
            />
            <button
              onClick={save}
              disabled={!canSave || status === "saving"}
              className="shrink-0 bg-[#1D4ED8] hover:bg-[#1740C4] disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-full text-sm transition-colors"
            >
              {status === "saving" ? "Checking…" : "Save"}
            </button>
          </div>
          {extra && (
            <>
              <label className="text-xs text-slate-500 block pt-1">{extra.label}</label>
              <input
                type="text"
                value={extraValue}
                onChange={(e) => setExtraValue(e.target.value)}
                placeholder={extra.placeholder}
                className="w-full bg-[#FAF7F2] border border-[#D4C8B8] text-slate-900 placeholder-slate-400 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#1D4ED8] transition-colors"
              />
            </>
          )}
          {askScope && !connected && (
            <div className="pt-2 pb-1">
              <ScopeChooser
                group={`preconnect-${provider}`}
                targetName={title}
                cards={cards ?? []}
                value={choice}
                onChange={setChoice}
              />
            </div>
          )}
          <p className="text-slate-400 text-[0.6875rem] leading-relaxed">{help}</p>
          {connected && (
            <button onClick={() => { setShowForm(false); setError(null); }} className="text-slate-400 hover:text-slate-600 text-xs font-medium transition-colors">
              Cancel
            </button>
          )}
          {error && <p className="text-red-500 text-xs">{error}</p>}
        </div>
      )}

      {/* Same rule as IntegrationCard: only once a connection exists, and not
          while the token form is open — the form is already the focus there. */}
      {isPro && connected && !showForm && scopeSlot}

      {flashStatus === "connected" && (
        <p className="text-xs text-green-600 font-medium mt-2">Successfully connected!</p>
      )}
    </div>
  );
}

/**
 * ONE offer, at the top of the list.
 *
 * Owner, 2026-09-11: "I feel like if I was a free user, this would look so
 * annoying... my goal is to try getting them to upgrade to Pro but still enjoy
 * our app." Five identical buttons down a list is nagging; one card that says
 * plainly what Pro unlocks here, above five calm rows, is an offer. The rows
 * below keep a small padlock that opens the same paywall, so nothing is
 * further away than it was — there is just one voice instead of five.
 *
 * No prices on either platform: the native sheet shows Apple's own, and the
 * web card sends people to /upgrade, which owns that wording.
 */
function CrmProCard() {
  return (
    <div className="rounded-2xl border border-[#D4C8B8] bg-[#F5F0E6] px-5 py-4">
      <div className="flex items-start gap-3">
        <span
          className="sc-dark-sheet mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: "var(--rd-aurora)" }}
        >
          <Spark className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Send your leads straight to your CRM</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Pro connects Salesforce, HubSpot, Pipedrive, GoHighLevel and Google Contacts, so every
            contact you capture lands where you already work — no copy-paste, no exports.
          </p>
          <div className="mt-3">
            <PlanGate
              feature="integrations-crm"
              nativeCopy={INTEGRATIONS_NATIVE_COPY}
              nativeContent={<IapProPill />}
            >
              <Link
                href="/upgrade"
                className="sc-dark-sheet inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold text-white transition-transform active:scale-[0.98]"
                style={{ background: "var(--rd-aurora)" }}
              >
                <Spark className="h-3 w-3" />
                Get Pro
              </Link>
            </PlanGate>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsSettings({ googleConnected, hubspotConnected, pipedriveConnected, highlevelConnected, salesforceConnected, googleSyncError, hubspotSyncError, pipedriveSyncError, highlevelSyncError, salesforceSyncError, teamCrmNames = [], isOfficeOwner = false, isPro, cards = [], scopes = {} }: Props) {
  const searchParams = useSearchParams();
  const [flashIntegration, setFlashIntegration] = useState<Integration | null>(null);
  const [flashStatus, setFlashStatus] = useState<string | null>(null);

  useEffect(() => {
    const integration = searchParams.get("integration") as Integration | null;
    const status = searchParams.get("status");
    if (integration && status) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of OAuth callback query params
      setFlashIntegration(integration);
      setFlashStatus(status);
      setTimeout(() => { setFlashIntegration(null); setFlashStatus(null); }, 5000);
    }
  }, [searchParams]);

  // One card means there is exactly one answer, so the control would be a
  // question with no alternatives — every single-card account (most of them)
  // sees the integrations list exactly as it was.
  const scopeFor = (provider: Integration, name: string) =>
    cards.length > 1 ? (
      <CardScopePicker
        target={provider}
        targetName={name}
        cards={cards}
        initialScope={scopes[provider] ?? null}
      />
    ) : undefined;

  // Order is by how often they're actually used, not alphabetical or
  // chronological: GoHighLevel and Pipedrive lead because they're the common
  // choice for this audience, then HubSpot, with Google Contacts last — it's an
  // address book rather than a CRM, so it's the odd one out in this group.
  return (
    <div className="space-y-3">
      {/* An Office sub-user's leads already have a destination: with no
          connection of their own they inherit the office owner's. Saying so is
          the whole point — otherwise this section reads as "nothing is set up",
          and connecting something here quietly diverts their leads away from
          the agency's CRM, which is usually company property. The last sentence
          is the important one: the override is per-CRM, so connecting a
          DIFFERENT tool adds a destination rather than replacing the team's. */}
      {teamCrmNames.length > 0 && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4">
          <p className="text-blue-900 text-sm font-semibold">
            Your team already sends contacts to {teamCrmNames.join(" and ")}
          </p>
          <p className="text-blue-800/80 text-xs mt-1 leading-relaxed">
            Your admin set this up — your contacts go there automatically and there&apos;s nothing
            for you to do. Connect one below only if you want your own copy somewhere else;
            connecting the same CRM sends to yours instead of the team&apos;s.
          </p>
        </div>
      )}

      {/* The owner's side of the same rule. Their card picker below only lists
          their own cards, so without this line an owner who picked "only my
          work card" would reasonably assume their team's leads were excluded
          too — they are not, and should not be: the agency CRM is the point. */}
      {isOfficeOwner && isPro && (
        <p className="text-slate-500 text-xs leading-relaxed px-1">
          Your team&apos;s leads go to the CRMs and Zapier webhook you connect here too — each member&apos;s contacts
          arrive with their name on them. A member who connects their own copy of a CRM sends
          to theirs instead.
        </p>
      )}

      {!isPro && <CrmProCard />}

      <IntegrationCard
        name="Salesforce"
        description="New leads are created as Salesforce Leads — source, meeting context and tags included"
        logo={
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="#00A1E0">
            <path d="M10.01 5.86c.77-.8 1.85-1.3 3.04-1.3 1.58 0 2.96.88 3.69 2.19a5.1 5.1 0 012.09-.45c2.85 0 5.17 2.33 5.17 5.21s-2.32 5.21-5.17 5.21c-.35 0-.69-.03-1.02-.1a3.77 3.77 0 01-3.3 1.94c-.58 0-1.12-.13-1.61-.36a4.3 4.3 0 01-4 2.7 4.31 4.31 0 01-4.06-2.87 4 4 0 01-.83.09A4.01 4.01 0 010 14.11a4.03 4.03 0 012-3.49 4.63 4.63 0 014.35-6.22c1.48 0 2.8.7 3.66 1.46z"/>
          </svg>
        }
        connected={!!salesforceConnected}
        syncError={salesforceSyncError ?? null}
        connectUrl="/api/integrations/salesforce/connect"
        disconnectUrl="/api/integrations/salesforce"
        isPro={isPro}
        flashStatus={flashIntegration === "salesforce" ? flashStatus : null}
        scopeSlot={scopeFor("salesforce", "Salesforce")}
        cards={cards}
      />

      <TokenCard
        provider="highlevel"
        title="GoHighLevel"
        description="New leads are added to your sub-account and tagged, so your existing workflows run"
        logo={HIGHLEVEL_LOGO}
        saveEndpoint="/api/integrations/highlevel/token"
        disconnectEndpoint="/api/integrations/highlevel/token"
        tokenLabel="Private Integration token"
        placeholder="pit-..."
        extra={{ label: "Location ID (sub-account)", placeholder: "e.g. ve9EPM428h8vShlRW1KT" }}
        help={
          <>
            In HighLevel: Settings → Private Integrations → Create new Integration → tick{" "}
            <code className="text-slate-600">contacts.write</code> and{" "}
            <code className="text-slate-600">locations.readonly</code> → copy the token. Your Location ID is
            the long code in the browser address bar while you&apos;re inside that sub-account, right
            after <code className="text-slate-600">/location/</code>.
          </>
        }
        connected={highlevelConnected}
        syncError={highlevelSyncError}
        isPro={isPro}
        flashStatus={flashIntegration === "highlevel" ? flashStatus : null}
        scopeSlot={scopeFor("highlevel", "GoHighLevel")}
        cards={cards}
      />

      <TokenCard
        provider="pipedrive"
        title="Pipedrive"
        description="New leads become Pipedrive people, with a note on where you met them"
        logo={PIPEDRIVE_LOGO}
        saveEndpoint="/api/integrations/pipedrive/token"
        disconnectEndpoint="/api/integrations/pipedrive/token"
        tokenLabel="Pipedrive personal API token"
        placeholder="Paste your API token"
        help={
          <>
            In Pipedrive: click your name (top right) → Company settings → Personal preferences →{" "}
            <code className="text-slate-600">API</code> → copy your personal API token here. If it&apos;s
            not there, your Pipedrive admin may have API access switched off for your permission set.
          </>
        }
        connected={pipedriveConnected}
        syncError={pipedriveSyncError}
        isPro={isPro}
        flashStatus={flashIntegration === "pipedrive" ? flashStatus : null}
        scopeSlot={scopeFor("pipedrive", "Pipedrive")}
        cards={cards}
      />

      <TokenCard
        provider="hubspot"
        title="HubSpot"
        description="New leads are automatically created as HubSpot contacts"
        logo={HUBSPOT_LOGO}
        saveEndpoint="/api/integrations/hubspot/token"
        disconnectEndpoint="/api/integrations/hubspot"
        tokenLabel="HubSpot service key"
        placeholder="pat-na1-..."
        // HubSpot stops creating legacy Private Apps on 2026-09-28 (new
        // accounts) / 2026-10-26 (existing). Service Keys replace them with
        // the same pat- Bearer token, so only this copy changed. An existing
        // private-app token still pastes here fine.
        help={
          <>
            In HubSpot: Settings → Integrations → Service Keys → Create service key → grant the{" "}
            <code className="text-slate-600">crm.objects.contacts.read</code> and{" "}
            <code className="text-slate-600">crm.objects.contacts.write</code> scopes → copy the key here. Already
            have a private app token? That works too.
          </>
        }
        connected={hubspotConnected}
        syncError={hubspotSyncError}
        isPro={isPro}
        flashStatus={flashIntegration === "hubspot" ? flashStatus : null}
        scopeSlot={scopeFor("hubspot", "HubSpot")}
        cards={cards}
      />

      <IntegrationCard
        name="Google Contacts"
        description="New leads are saved straight to your Google Contacts"
        logo={
          <svg viewBox="0 0 24 24" className="w-5 h-5">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        }
        connected={googleConnected}
        syncError={googleSyncError}
        connectUrl="/api/integrations/google/connect"
        disconnectUrl="/api/integrations/google"
        isPro={isPro}
        flashStatus={flashIntegration === "google" ? flashStatus : null}
        scopeSlot={scopeFor("google", "Google Contacts")}
        cards={cards}
      />
    </div>
  );
}
