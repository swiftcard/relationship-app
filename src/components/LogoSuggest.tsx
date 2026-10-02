"use client";

import { useState } from "react";
import type { LogoCandidate, LogoSuggestStatus } from "@/lib/logo-provider";

// Self-contained "suggest my company's official logo" helper. Drops in next to
// the Company-logo uploader: the user types their company name / business email
// (already captured elsewhere in the form) and we offer official logos to PICK
// from — nothing is applied until they click one, and manual upload is untouched.
//
// Fails safe: if the provider isn't configured the API returns not_configured
// and this component renders NOTHING, so there's never a broken button.
type Props = {
  /** Company name to search on (preferred). */
  company?: string | null;
  /** Business email — its domain is used if company is blank. */
  email?: string | null;
  /** Explicit domain to search on, if you have one. */
  domain?: string | null;
  /** Their website — its own logo is offered first, and covers a name miss. */
  website?: string | null;
  /** Called with the chosen logo image URL once the user confirms a candidate. */
  onConfirm: (logoUrl: string) => void;
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; candidates: LogoCandidate[] }
  | { kind: "empty"; status: LogoSuggestStatus }
  | { kind: "hidden" }; // provider not configured — disappear entirely

export default function LogoSuggest({ company, email, domain, website, onConfirm }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [applied, setApplied] = useState<string | null>(null);

  // Pick the best available signal to search on.
  const input = (domain || company || email || "").trim();
  const site = (website || "").trim();

  async function find() {
    if (!input && !site) {
      setState({ kind: "empty", status: "invalid_input" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/logo-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, website: site }),
      });
      // 429 carries its own status the copy already covers — don't flatten a
      // "slow down" into a scarier "something went wrong".
      if (res.status === 429) { setState({ kind: "empty", status: "rate_limited" }); return; }
      if (!res.ok) { setState({ kind: "empty", status: "provider_error" }); return; }
      const data = await res.json() as { status: LogoSuggestStatus; candidates: LogoCandidate[] };
      if (data.status === "not_configured") { setState({ kind: "hidden" }); return; }
      if (data.status === "ok" && data.candidates.length) {
        setState({ kind: "results", candidates: data.candidates });
      } else {
        setState({ kind: "empty", status: data.status });
      }
    } catch {
      setState({ kind: "empty", status: "provider_error" });
    }
  }

  function choose(c: LogoCandidate) {
    onConfirm(c.logoUrl);
    setApplied(c.domain);
    setState({ kind: "idle" });
  }

  if (state.kind === "hidden") return null;

  return (
    <div className="mt-2">
      {(state.kind === "idle" || state.kind === "empty") && (
        <button
          type="button"
          onClick={find}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
            <circle cx="11" cy="11" r="7" strokeLinecap="round" />
            <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
          </svg>
          Suggest my company logo
        </button>
      )}

      {applied && state.kind === "idle" && (
        <p className="text-[0.6875rem] text-emerald-400 mt-1">
          Applied {applied}&apos;s logo. Not right? Upload your own above, or search again.
        </p>
      )}

      {state.kind === "loading" && (
        <p className="text-xs text-gray-500">Searching official logos…</p>
      )}

      {state.kind === "empty" && (
        <p className="text-[0.6875rem] text-gray-500 mt-1">{emptyMessage(state.status)}</p>
      )}

      {state.kind === "results" && (
        <div className="mt-1.5 rounded-xl border border-gray-700/60 bg-gray-800/40 p-2.5">
          <p className="text-[0.6875rem] text-gray-400 mb-2">
            Pick your company — we&apos;ll use its official logo (you can still upload your own):
          </p>
          <div className="space-y-1">
            {state.candidates.map((c) => (
              <button
                key={c.domain}
                type="button"
                onClick={() => choose(c)}
                className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-700/50 transition-colors text-left"
              >
                {/* Provider-hosted logo. onError hides a broken image so a stale
                    URL never shows a browser placeholder. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.logoUrl}
                  alt=""
                  width={28}
                  height={28}
                  className="w-7 h-7 rounded bg-white object-contain shrink-0"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-white truncate">{c.name}</span>
                  <span className="block text-[0.6875rem] text-gray-500 truncate">{c.domain}</span>
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setState({ kind: "idle" })}
            className="text-[0.6875rem] text-gray-500 hover:text-gray-300 mt-2"
          >
            None of these
          </button>
        </div>
      )}
    </div>
  );
}

function emptyMessage(status: LogoSuggestStatus): string {
  switch (status) {
    case "personal_domain":
      return "That looks like a personal email — enter a company name to find its logo.";
    case "invalid_input":
      return "Enter your company name, work email or website first, then try again.";
    case "rate_limited":
      return "Too many lookups right now — try again in a moment.";
    case "no_match":
      return "No official logo found — upload your own above.";
    default:
      return "Couldn't reach the logo service — upload your own above.";
  }
}
