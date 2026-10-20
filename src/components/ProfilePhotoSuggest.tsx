"use client";

import { useEffect, useState } from "react";
import { detectNativeApp } from "@/lib/platform";
import {
  startLinkedInPhoto,
  takeGuestLinkedInStatus,
  LINKEDIN_RELAY_PATH,
  LINKEDIN_STATUS_EVENT,
} from "@/lib/linkedin-photo-return";

/**
 * Start the LinkedIn photo import, correctly for wherever we are. Every way
 * in carries the page's ticket (lib/linkedin-photo-return): the page picks the
 * photo up by it however it gets control back, so this only has to LEAVE well.
 *
 * In the iOS shell a plain link is wrong: the connect route 302s to
 * linkedin.com, which is absent from capacitor.config's allowNavigation, so the
 * shell hands the whole flow to the system browser and the user ends up on the
 * WEBSITE in Safari. `?native=1` makes the callback finish at a swiftcard://
 * page, and @capacitor/browser runs the round trip in an in-app sheet that
 * shares Safari's cookies — so an already-signed-in LinkedIn user just taps
 * Allow. The page underneath never unloads, so nothing typed is lost.
 *
 * On the web, `sameTab` (every card BUILDER, which keeps its own progress
 * across a page load) hops in this tab and comes back with ?li_photo=. The
 * EDITORS of an existing card or profile hold unsaved edits, so they open
 * LinkedIn in a window of its own (a new tab on a phone) that lands on the
 * relay page and closes; the editor picks the photo up when it is looked at
 * again. If the window is blocked, the hop runs in this tab instead — the
 * ticket still brings the photo back.
 */
async function openLinkedInConnect(opts: { hopHref: string; awayHref: string; sameTab: boolean }): Promise<void> {
  if (detectNativeApp()) {
    const url = new URL(`${opts.hopHref}&native=1`, window.location.origin).toString();
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
    } catch {
      // Plugin missing (older shell build) — the webview navigation still beats
      // doing nothing; it degrades to the old Safari hand-off rather than a
      // dead button.
      window.location.href = url;
    }
    return;
  }

  if (!opts.sameTab) {
    try {
      const away = window.open(opts.awayHref, "swiftcard-linkedin", "width=620,height=760,noopener=no,noreferrer=no");
      if (away) {
        away.focus?.();
        return;
      }
    } catch {
      // Blocked or unavailable — fall through to the navigation below.
    }
  }
  window.location.href = opts.hopHref;
}

/** What to tell the user when an import came back without a photo. */
function oneShotFailure(status: string | null): string | null {
  if (status === "nophoto") return "Your LinkedIn profile doesn't have a photo to import. Upload one instead.";
  if (status === "error") return "LinkedIn didn't finish connecting. Try again, or upload a photo instead.";
  return null;
}

// "Suggest my profile picture" — drops in next to the headshot uploader in the
// card editors. Gathers photo candidates from every outlet we can reach for the
// SIGNED-IN user's own identity:
//   • Google  — the avatar Google handed us at sign-in (no extra consent)
//   • Gravatar — the photo registered for their email
//   • LinkedIn — via the user's own authorized connection (OpenID userinfo)
// Everything is preview-first: a photo is applied ONLY after the user picks it.
// Manual upload is untouched, and an existing photo is never overwritten
// without that choice.
//
// LinkedIn fails safe: when the LinkedIn app isn't configured server-side the
// pages pass linkedinEnabled={false} and that source simply doesn't appear —
// Google/Gravatar still work.
type Props = {
  /** LinkedIn OAuth is configured server-side (env keys present). */
  linkedinEnabled: boolean;
  /** Signed-out visitor building on the marketing site. Google needs a session
   *  so it's unavailable; Gravatar and the web aggregator work from the email
   *  they typed (passed in below), and LinkedIn runs a one-shot photo import
   *  (guest=1 OAuth — no account required, photo returns via ?li_photo=). */
  guest?: boolean;
  /** The email the visitor typed — used ONLY in guest mode. A signed-in user's
   *  lookup always uses their session email, never anything from the client. */
  email?: string | null;
  /** Called with the durable stored image URL once the user confirms. */
  onConfirm: (photoUrl: string) => void;
  /** Same-origin path to return to after the LinkedIn consent screen. */
  returnTo: string;
  /** Which page's LinkedIn photo this is — the same string the page passes to
   *  useLinkedInPhotoPickup, which applies the photo and opens the crop tool. */
  scope: string;
  /** The page keeps its own progress across a page load (the card wizard's
   *  draft) and applies a returning ?li_photo= itself, so LinkedIn can run in
   *  THIS tab, as it does for a guest. Without it (the editors, which hold
   *  unsaved edits) LinkedIn opens in a window of its own and the page stays. */
  photoReturn?: boolean;
  /** Persist the page's progress before the hop. Returning false (the save
   *  failed — storage full or blocked) cancels it: leaving would lose the card.
   *  The page puts the returning photo in its headshot tile with
   *  ImageUpload's adjustKey, which opens it in the crop tool. */
  beforeLeave?: () => boolean;
};

type Candidate = {
  source: "google" | "gravatar" | "linkedin" | "web";
  label: string;
  photoUrl: string;
};

// LinkedIn's extra states beyond "here's a photo".
type LinkedInState = "off" | "candidate" | "connect" | "reconnect" | "none" | "error";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; candidates: Candidate[]; linkedin: LinkedInState }
  | { kind: "applying"; source: Candidate["source"] }
  | { kind: "error"; message: string };

export default function ProfilePhotoSuggest({ linkedinEnabled, onConfirm, returnTo, scope, guest = false, email, photoReturn = false, beforeLeave }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [applied, setApplied] = useState(false);
  const [smallNote, setSmallNote] = useState(false);
  // LinkedIn runs in this tab (the builders) or in a window of its own (the
  // editors). Either way it is the one-shot photo import — guest=1, the photo
  // stored under this attempt's ticket — for every account: the old account
  // connect needed a second import request, a popup that kept its opener and,
  // in the app, a session hand-off, and each broke on a phone at some point.
  const sameTab = guest || photoReturn;

  // An import that came back without a photo. Success is applied by the page
  // (useLinkedInPhotoPickup); a failure used to come back with nothing said,
  // which looks like the button did nothing. It arrives in the URL (a
  // same-tab return), from the hand-over the homepage builders make before
  // stripping the URL, or — already on screen — as LINKEDIN_STATUS_EVENT.
  useEffect(() => {
    let status: string | null = null;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("integration") === "linkedin" && !sp.has("li_photo")) {
      status = sp.get("status");
      sp.delete("integration"); sp.delete("status");
      window.history.replaceState(null, "", `${window.location.pathname}${sp.size ? `?${sp}` : ""}${window.location.hash}`);
    }
    const message = oneShotFailure(status ?? takeGuestLinkedInStatus());
    if (!message) return;
    const t = setTimeout(() => setState({ kind: "error", message }), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onStatus = (e: Event) => {
      const d = (e as CustomEvent<{ scope: string; status: string }>).detail;
      if (!d || d.scope !== scope) return;
      const message = oneShotFailure(takeGuestLinkedInStatus() ?? d.status);
      if (message) setState({ kind: "error", message });
    };
    window.addEventListener(LINKEDIN_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(LINKEDIN_STATUS_EVENT, onStatus);
  }, [scope]);

  // A guest has no session to attach a LinkedIn token to, and nobody needs
  // one for a photo: the callback copies the consented photo into storage
  // under the ticket and hands it back (?li_photo= too, on a same-tab hop).
  // Nothing is persisted server-side beyond the photo.
  const connectBase = "/api/integrations/linkedin/connect?guest=1";
  const connectHref = `${connectBase}&next=${encodeURIComponent(returnTo)}`;

  /** Every LinkedIn button on this component goes through here. */
  function connectLinkedIn(e?: { preventDefault(): void }) {
    e?.preventDefault();
    // The same-tab hop leaves this page. Never with the card unsaved: a failed
    // save stops here, with the upload button right above as the way forward.
    if (sameTab && beforeLeave && !beforeLeave()) {
      setState({ kind: "error", message: "Couldn't save your card on this device before opening LinkedIn. Upload your photo above instead." });
      return;
    }
    const t = startLinkedInPhoto(scope);
    const relay = `${LINKEDIN_RELAY_PATH}?to=${encodeURIComponent(returnTo)}`;
    void openLinkedInConnect({
      sameTab,
      hopHref: `${connectHref}&t=${t}`,
      awayHref: `${connectBase}&next=${encodeURIComponent(relay)}&t=${t}`,
    });
  }

  async function suggest() {
    setState({ kind: "loading" });
    setApplied(false);
    try {
      // Both sources in parallel; either failing alone must not sink the other.
      const lookupUrl = guest && email
        ? `/api/photo-suggest?email=${encodeURIComponent(email)}`
        : "/api/photo-suggest";
      const [ownRes, liRes] = await Promise.all([
        fetch(lookupUrl).catch(() => null),
        // LinkedIn needs the visitor's own authorized connection — impossible
        // before an account exists, so guests skip it entirely.
        !guest && linkedinEnabled ? fetch("/api/integrations/linkedin").catch(() => null) : Promise.resolve(null),
      ]);

      const candidates: Candidate[] = [];
      if (ownRes?.ok) {
        const data = await ownRes.json() as { candidates?: Candidate[] };
        for (const c of data.candidates ?? []) candidates.push(c);
      }

      // Guests can't have a LinkedIn connection yet, but when the integration
      // is configured we still OFFER it ("connect") — the button walks them
      // through signup + consent and brings the draft along.
      let linkedin: LinkedInState = !linkedinEnabled ? "off" : guest ? "connect" : "error";
      if (liRes) {
        if (liRes.ok) {
          const li = await liRes.json() as { connected?: boolean; photo?: string | null; error?: string };
          if (!li.connected) linkedin = "connect";
          else if (li.photo) {
            linkedin = "candidate";
            candidates.push({ source: "linkedin", label: "Your LinkedIn photo", photoUrl: li.photo });
          } else if (li.error === "revoked_or_no_photo" || li.error === "token_unreadable") linkedin = "reconnect";
          else linkedin = "none";
        } else if (liRes.status === 501) {
          linkedin = "off";
        }
      }

      if (!candidates.length && linkedin === "off") {
        setState({
          kind: "error",
          message: guest
            ? "We couldn't find a photo for that email. Upload one above instead."
            : "We couldn't find a photo on your accounts. Upload one above instead.",
        });
        return;
      }
      setState({ kind: "results", candidates, linkedin });
    } catch {
      setState({ kind: "error", message: "Couldn't look for photos right now. Try again, or upload one instead." });
    }
  }

  async function importPhoto(c: Candidate) {
    setState({ kind: "applying", source: c.source });
    try {
      // Import copies the photo into our storage (source CDN links can expire)
      // and returns a durable URL; the caller saves it with the card on Save.
      const res = c.source === "linkedin"
        ? await fetch("/api/integrations/linkedin", { method: "POST" })
        : await fetch("/api/photo-suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Guests get the bytes back as a data: URL (no account folder to
            // store into yet); it rides in the draft and is uploaded at claim.
            body: JSON.stringify({ source: c.source, ...(guest && email ? { email } : {}) }),
          });
      const data = await res.json().catch(() => ({} as { url?: string; small?: boolean }));
      if (!res.ok || !data.url) {
        setState({ kind: "error", message: "Couldn't import that photo. Try another, or upload it manually." });
        return;
      }
      onConfirm(data.url);
      setApplied(true);
      // LinkedIn only had the thumbnail (we asked for the larger sizes first
      // and sharpened what came back). Say so, once, instead of letting the
      // owner discover it on the card.
      setSmallNote(data.small === true);
      setState({ kind: "idle" });
    } catch {
      setState({ kind: "error", message: "Couldn't import that photo. Try another, or upload it manually." });
    }
  }

  const linkBtn = "inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors";

  return (
    <div className="mt-2">
      {state.kind === "idle" && (
        <>
          <button type="button" onClick={suggest} className={linkBtn}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Suggest my profile picture
          </button>
          {/* Every LinkedIn link carries data-leave-ok: in an editor it opens
              LinkedIn in a window of its own and this page stays, so the
              unsaved-edits guard (UnsavedLeaveGuard) must not hold the tap —
              it did, and "Connect LinkedIn" asked to discard the card instead.
              On a phone, typing/uploading a photo is more friction than
              connecting LinkedIn once and pulling it from there — surface that
              option up front instead of only after clicking Suggest (which
              buries it behind a click + fetch round trip before the "Connect
              LinkedIn" button ever appears). Desktop already has the room to
              discover it via the button above, so this nudge is mobile-only.
              Guests see it too. The words are a real link: as plain text they
              read as a button, and tapping them did nothing (2026-09-29). */}
          {linkedinEnabled && (
            <p className="lg:hidden text-[0.6875rem] text-gray-500 mt-1">
              Tip:{" "}
              <a href={connectHref} onClick={connectLinkedIn} data-leave-ok className="font-medium text-blue-400 hover:text-blue-300 underline underline-offset-2">
                connect your LinkedIn
              </a>{" "}
              and we&apos;ll pull your photo from there automatically.
            </p>
          )}
        </>
      )}

      {applied && state.kind === "idle" && (
        <p className="text-[0.6875rem] text-emerald-400 mt-1">
          Headshot added. It&apos;s saved when you save your card. Not right? Upload your own above.
        </p>
      )}
      {applied && smallNote && state.kind === "idle" && (
        <p className="text-[0.6875rem] text-amber-400 mt-1">
          LinkedIn only shares a small version of your photo, so we sharpened it. A photo from your phone will look crisper. Tap &quot;Adjust&quot; above to reframe it.
        </p>
      )}

      {state.kind === "loading" && (
        <p className="text-xs text-gray-500">
          {guest
            ? "Looking for a headshot registered to your email…"
            : `Looking for your headshot on Google, Gravatar${linkedinEnabled ? ", and LinkedIn" : ""}…`}
        </p>
      )}
      {state.kind === "applying" && <p className="text-xs text-gray-500">Adding your photo…</p>}

      {state.kind === "error" && (
        <p className="text-[0.6875rem] text-gray-500 mt-1">
          {state.message}{" "}
          <button type="button" onClick={suggest} className="text-blue-400 hover:text-blue-300">Retry</button>
        </p>
      )}

      {state.kind === "results" && (
        <div className="mt-1.5 rounded-xl border border-gray-700/60 bg-gray-800/40 p-3">
          {state.candidates.length > 0 ? (
            <>
              <p className="text-[0.6875rem] text-gray-400 mb-2.5">
                {state.candidates.length === 1 ? "We found this photo. It's only used if you choose it:" : "We found these photos. Pick one, or upload your own above:"}
              </p>
              <div className="flex flex-wrap gap-3 mb-1.5">
                {state.candidates.map((c) => (
                  <button
                    key={c.source}
                    type="button"
                    onClick={() => importPhoto(c)}
                    className="group flex flex-col items-center gap-1.5 rounded-xl border border-gray-700 hover:border-blue-500 bg-gray-900/60 px-3 py-2.5 transition-colors"
                    title={`Use ${c.label.toLowerCase()}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.photoUrl} alt={c.label} className="w-16 h-16 rounded-full object-cover bg-gray-900" />
                    <span className="text-[0.625rem] text-gray-400 group-hover:text-white transition-colors">{c.label}</span>
                    <span className="text-[0.625rem] font-semibold text-blue-400">Use this photo</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[0.6875rem] text-gray-400 mb-2">
              {guest ? "No photo found for that email." : "No photo found on your Google account or Gravatar."}
            </p>
          )}

          {state.linkedin === "connect" && (
            <div className="mt-1 pt-2 border-t border-gray-800 flex items-center gap-3 flex-wrap">
              <p className="text-[0.6875rem] text-gray-500">
                Also on LinkedIn? Connect to import your profile photo:
              </p>
              <a
                href={connectHref}
                onClick={connectLinkedIn}
                data-leave-ok
                className="text-xs bg-[#0A66C2] hover:bg-[#0956a5] text-white font-semibold px-3 py-1.5 rounded-full transition-colors"
              >
                Connect LinkedIn
              </a>
            </div>
          )}
          {state.linkedin === "reconnect" && (
            <div className="mt-1 pt-2 border-t border-gray-800 flex items-center gap-3 flex-wrap">
              <p className="text-[0.6875rem] text-amber-300/90">Your LinkedIn permission expired.</p>
              <a
                href={connectHref}
                onClick={connectLinkedIn}
                data-leave-ok
                className="text-xs bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 py-1.5 rounded-full transition-colors"
              >
                Reconnect LinkedIn
              </a>
            </div>
          )}
          {state.linkedin === "none" && (
            <p className="mt-1 pt-2 border-t border-gray-800 text-[0.6875rem] text-gray-500">
              Your LinkedIn profile has no photo we can import.
            </p>
          )}

          <div className="mt-2">
            <button type="button" onClick={() => setState({ kind: "idle" })} className="text-[0.6875rem] text-gray-500 hover:text-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
