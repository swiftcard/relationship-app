"use client";

import { useRef, useState } from "react";
import { detectNativeApp } from "@/lib/platform";
import { LINKEDIN_ABOUT_MAX, LINKEDIN_BIO_SHORT, tidyBioLocally } from "@/lib/linkedin-bio";

// "Use LinkedIn bio" — sits under the Bio box in the card editor, the new-card
// wizard and the homepage SwiftLink builder, next to where "Suggest my profile
// picture" does the same job for the headshot.
//
// It can't pull the About the way the photo is pulled: LinkedIn's sign-in
// returns name, photo and email only, and nothing else about a member is open
// to apps. So it asks for a paste — with a link straight to their own profile —
// and shortens a long About to a card-sized bio (AI when available, a local
// cleanup otherwise; the button always ends with a filled bio). Undo puts back
// whatever was in the box before.
//
// Every control is type="button" and there is no <form> here: this renders
// inside the card editor's form, and before hydration a submit would post it.

type Props = {
  /** Fill the bio box. */
  onApply: (bio: string) => void;
  /** What the box holds now — restored by Undo. */
  currentBio: string;
  /** "site" = the homepage builders' dark shell; "app" = the app's forms. */
  tone?: "app" | "site";
};

type State = "idle" | "open" | "working";

// The member's own profile, whoever they are signed in as on LinkedIn.
const LINKEDIN_PROFILE = "https://www.linkedin.com/in/me/";

async function openLinkedInSheet(): Promise<void> {
  // The app: the in-app sheet, swiped away to land back on the unsaved form.
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: LINKEDIN_PROFILE, presentationStyle: "popover" });
  } catch {
    window.open(LINKEDIN_PROFILE, "_blank", "noopener,noreferrer");
  }
}

function LinkedInGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

export default function LinkedInBioImport({ onApply, currentBio, tone = "app" }: Props) {
  const [state, setState] = useState<State>("idle");
  const [pasted, setPasted] = useState("");
  // The bio before the last fill, for Undo. null = nothing to undo.
  const [before, setBefore] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Set by Cancel: a shortening already in flight must not fill the box.
  const cancelled = useRef(false);
  const site = tone === "site";

  async function shorten(text: string): Promise<string> {
    const local = tidyBioLocally(text);
    if (local.length <= LINKEDIN_BIO_SHORT) return local;
    const ctl = new AbortController();
    abort.current = ctl;
    const timer = setTimeout(() => ctl.abort(), 20_000);
    try {
      const res = await fetch("/api/ai/tidy-bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, LINKEDIN_ABOUT_MAX) }),
        signal: ctl.signal,
      });
      const data = (await res.json().catch(() => ({}))) as { bio?: unknown };
      if (res.ok && typeof data.bio === "string" && data.bio.trim()) return data.bio.trim();
    } catch { /* offline, timed out or cancelled — the local cleanup below */ }
    finally {
      clearTimeout(timer);
      abort.current = null;
    }
    return local;
  }

  async function use() {
    const text = pasted.trim();
    if (!text) return;
    cancelled.current = false;
    setState("working");
    const bio = await shorten(text);
    // Cancelled while it worked — leave the box alone.
    if (cancelled.current || !bio) return;
    setBefore(currentBio);
    onApply(bio);
    setPasted("");
    setState("idle");
  }

  function cancel() {
    cancelled.current = true;
    abort.current?.abort();
    setPasted("");
    setState("idle");
  }

  function undo() {
    if (before === null) return;
    onApply(before);
    setBefore(null);
  }

  const muted = site ? "text-white/60" : "text-gray-400";
  const linkBtn = "inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors";

  if (state === "idle") {
    return (
      <div className="mt-2">
        <button type="button" onClick={() => { setBefore(null); setState("open"); }} className={linkBtn}>
          <LinkedInGlyph className="w-3.5 h-3.5" />
          Use LinkedIn bio
        </button>
        {before !== null && (
          <p className="text-[0.6875rem] text-emerald-400 mt-1" role="status">
            Bio filled from LinkedIn — edit it any way you like.{" "}
            <button type="button" onClick={undo} className="font-medium text-blue-400 hover:text-blue-300 underline underline-offset-2">
              Undo
            </button>
          </p>
        )}
      </div>
    );
  }

  const working = state === "working";
  return (
    <div
      className={`mt-2 rounded-xl border p-3 ${site ? "border-white/10 bg-white/[0.04]" : "border-gray-700/60 bg-gray-800/40"}`}
    >
      <p className={`text-[0.6875rem] leading-snug ${muted}`}>
        Copy the <strong className={site ? "text-white/85" : "text-gray-200"}>About</strong> section from your LinkedIn profile and paste it here.{" "}
        <a
          href={LINKEDIN_PROFILE}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (!detectNativeApp()) return;
            e.preventDefault();
            void openLinkedInSheet();
          }}
          className="inline-flex items-center gap-1 font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
        >
          <LinkedInGlyph className="w-3 h-3" />
          Open my LinkedIn&nbsp;↗
        </a>
      </p>
      <textarea
        aria-label="Your LinkedIn About"
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        maxLength={LINKEDIN_ABOUT_MAX}
        rows={4}
        autoFocus
        disabled={working}
        placeholder="Paste your LinkedIn About here"
        className={`mt-2 w-full resize-none rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-60 ${
          site
            ? "bg-[#15171F] border border-white/10 text-white placeholder-white/30"
            : "bg-gray-900 border border-gray-700 text-white placeholder-gray-600"
        }`}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={use}
          disabled={working || !pasted.trim()}
          className="text-xs bg-[#0A66C2] hover:bg-[#0956a5] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-3 py-1.5 rounded-full transition-colors"
        >
          {working ? "Shortening…" : "Use this"}
        </button>
        <button type="button" onClick={cancel} className={`text-[0.6875rem] ${site ? "text-white/50 hover:text-white/80" : "text-gray-500 hover:text-gray-300"}`}>
          Cancel
        </button>
        {pasted.trim().length > LINKEDIN_BIO_SHORT && !working && (
          <span className={`ml-auto text-[0.625rem] ${muted}`}>We&apos;ll shorten it to fit.</span>
        )}
      </div>
    </div>
  );
}
