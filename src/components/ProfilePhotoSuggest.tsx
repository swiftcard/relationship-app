"use client";

import { useEffect, useRef, useState } from "react";
import { detectNativeApp } from "@/lib/platform";
import {
  isLinkedInPopup,
  popupConnectUrl,
  newLinkedInNonce,
  takeLinkedInResult,
  takeGuestLinkedInStatus,
  LINKEDIN_MESSAGE,
  LINKEDIN_RESULT_KEY,
  type LinkedInRelayMessage,
} from "@/lib/linkedin-popup";

/**
 * Start the LinkedIn connect, correctly for wherever we are.
 *
 * On the web a plain link is right. In the iOS shell it is NOT: the connect
 * route 302s to linkedin.com, which is absent from capacitor.config's
 * allowNavigation, so the shell hands the whole flow to the system browser —
 * the user authorises in Safari, LinkedIn returns to swiftcard.me in Safari,
 * and they end up looking at the WEBSITE while the app sits untouched behind
 * it with no photo imported.
 *
 * `?native=1` makes the callback finish at a swiftcard:// URL instead, and
 * @capacitor/browser runs the round trip in an in-app sheet that shares
 * Safari's cookies — so an already-signed-in LinkedIn user just taps Allow.
 * This is the same shape the Google/Apple sign-in flows use.
 */
async function openLinkedInConnect(href: string, opts: { guest: boolean; returnTo: string; nonce?: string }): Promise<void> {
  if (detectNativeApp()) {
    const sep = href.includes("?") ? "&" : "?";
    let url = new URL(`${href}${sep}native=1`, window.location.origin).toString();
    // The in-app sheet has NONE of the app's cookies, so the connect route
    // never saw a session and sent every signed-in user to the website's
    // sign-in page instead of LinkedIn ("it glitches out to the website" —
    // owner, 2026-09-22). Carry the session across as the same short-lived
    // signed token the CRM connects use (lib/connect-user.ts). A guest has no
    // session to carry: guest=1 is already on the href.
    if (!opts.guest) {
      try {
        const r = await fetch("/api/integrations/handoff", { method: "POST" });
        if (r.ok) {
          const { h } = (await r.json()) as { h?: string };
          if (h) url += `&h=${encodeURIComponent(h)}`;
        }
      } catch { /* fall through — the sheet shows sign-in instead of a dead tap */ }
    }
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

  // Web. A guest keeps the old full-page hop: their photo comes back as
  // ?li_photo= for the mini-builder to apply to its own draft, and that draft
  // lives in localStorage, so navigating costs them nothing. A signed-in user
  // is the one with unsaved editor state to protect.
  if (!opts.guest) {
    try {
      const popup = window.open(
        popupConnectUrl(href, opts.returnTo, opts.nonce),
        "swiftcard-linkedin",
        "width=620,height=760,noopener=no,noreferrer=no",
      );
      if (popup) {
        popup.focus?.();
        return;
      }
    } catch {
      // Blocked or unavailable — fall through to the navigation below.
    }
  }
  window.location.href = href;
}

/** What to tell the user when a one-shot import came back without a photo. */
function oneShotFailure(status: string | null): string | null {
  if (status === "nophoto") return "Your LinkedIn profile doesn't have a photo to import. Upload one instead.";
  if (status === "error") return "LinkedIn didn't finish connecting — try again, or upload a photo instead.";
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
  /** The page keeps its own progress across a page load (the card wizard's
   *  draft) and applies a returning ?li_photo= itself. Then a signed-in user
   *  gets the SAME LinkedIn round trip a guest does: one hop in this tab (the
   *  in-app sheet on iOS), the photo back in the URL. No popup, no session
   *  hand-off, no second import step — every one of which broke on a phone at
   *  some point (owner, 2026-09-29: "it fully glitched and just didn't work"). */
  photoReturn?: boolean;
  /** Persist the page's progress before the hop. Returning false (the save
   *  failed — storage full or blocked) cancels it: leaving would lose the card. */
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

export default function ProfilePhotoSuggest({ linkedinEnabled, onConfirm, returnTo, guest = false, email, photoReturn = false, beforeLeave }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [applied, setApplied] = useState(false);
  // The one-shot photo import (guest=1 connect → ?li_photo=) instead of the
  // account connect. Guests have no other option; photoReturn pages opt in.
  const oneShot = guest || photoReturn;

  // ── The return leg from "Connect LinkedIn" ────────────────────────────────
  // The OAuth round trip lands the signed-in user back on this editor with
  // ?integration=linkedin&status=… (web and native shell both). Connecting FROM
  // the headshot section is the user's explicit ask to pull their photo, so on
  // status=connected we import and apply it immediately — no second click on
  // "Suggest" required (the owner-reported bug: connect finished, nothing
  // happened). Guests return via ?li_photo=, handled by the builder itself.
  // The return leg, shared by both ways the result can arrive: a postMessage
  // from the consent popup (web, the normal path now) and a plain page load
  // carrying ?integration=linkedin (the iOS sheet, and the web fallback when a
  // popup is blocked).
  async function finishLinkedInReturn(status: string | null) {
    if (status === "error") {
      setState({ kind: "error", message: "LinkedIn connection didn't finish — try again." });
      return;
    }
    if (status !== "connected") return;
    setState({ kind: "applying", source: "linkedin" });
    try {
      const res = await fetch("/api/integrations/linkedin", { method: "POST" });
      const data = await res.json().catch(() => ({} as { url?: string }));
      if (res.ok && data.url) {
        onConfirm(data.url);
        setApplied(true);
        setState({ kind: "idle" });
        return;
      }
    } catch { /* fall through to the picker */ }
    // Photo missing/revoked or import failed — fall back to the normal
    // suggestion flow so the user sees exactly what's wrong (reconnect /
    // no-photo states) instead of silence.
    void suggest();
  }

  useEffect(() => {
    if (oneShot) return;
    // Inside the consent popup nothing should run: the relay page owns that
    // document and is about to close it.
    if (isLinkedInPopup()) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("integration") !== "linkedin") return;
    const status = sp.get("status");
    // Strip the params first so a refresh (or a second mount) can't re-run this.
    sp.delete("integration"); sp.delete("status");
    window.history.replaceState(null, "", `${window.location.pathname}${sp.size ? `?${sp}` : ""}${window.location.hash}`);
    // Off the effect body: the import's first setState would otherwise land
    // synchronously in this commit and cascade a render. Cancelled if the page
    // unmounts before it fires.
    const t = setTimeout(() => { void finishLinkedInReturn(status); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount for the OAuth return leg
  }, []);

  // The popup's result, by whichever road reaches this page first:
  //   • postMessage — the popup kept its opener (LinkedIn already signed in),
  //     or the iOS shell's NativeAppBridge finishing in place (no nonce);
  //   • localStorage — the popup's opener was cut by LinkedIn's sign-in page
  //     (COOP, lib/linkedin-popup), so the relay left it in same-origin
  //     storage: the `storage` event, or a check when this tab is focused
  //     again (a phone suspends it while the popup tab is in front).
  // Handled ONCE per connect: the nonce is cleared on first delivery, so the
  // message and the storage event arriving together import one photo.
  const pendingNonce = useRef<string | null>(null);
  useEffect(() => {
    if (oneShot) {
      // The iOS shell finishes a one-shot FAILURE in place (NativeAppBridge
      // posts the status instead of reloading, since there is no photo to
      // carry). Nothing listened here, so a failed import in the app looked
      // exactly like the button doing nothing. Success always reloads with
      // ?li_photo= and is applied by the page.
      const onOneShotMessage = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        const data = e.data as LinkedInRelayMessage | null;
        if (!data || data.source !== LINKEDIN_MESSAGE) return;
        const message = oneShotFailure(data.status);
        if (message) setState({ kind: "error", message });
      };
      window.addEventListener("message", onOneShotMessage);
      return () => window.removeEventListener("message", onOneShotMessage);
    }
    function take(status: string | null) {
      pendingNonce.current = null;
      void finishLinkedInReturn(status);
    }
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as (LinkedInRelayMessage & { n?: string }) | null;
      if (!data || data.source !== LINKEDIN_MESSAGE) return;
      if (data.n !== undefined) {
        // A popup's result: only the page that opened it, and only once.
        if (!pendingNonce.current || data.n !== pendingNonce.current) return;
        takeLinkedInResult(data.n); // clear the stored copy so it isn't handled twice
      }
      take(data.status);
    }
    function checkStored(raw?: string | null) {
      const nonce = pendingNonce.current;
      if (!nonce) return;
      const r = takeLinkedInResult(nonce, raw);
      if (r) take(r.status);
    }
    function onStorage(e: StorageEvent) {
      if (e.key === LINKEDIN_RESULT_KEY && e.newValue) checkStored(e.newValue);
    }
    function onVisible() {
      if (document.visibilityState === "visible") checkStored();
    }
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listener only needs the stable handler
  }, [oneShot]);

  // A one-shot import's failure. Success is applied by the builder (?li_photo=);
  // a failure used to reopen the builder with nothing said, which looks like
  // the button did nothing. Read from the URL (the card builder leaves it
  // there) or from the hand-over the homepage builders make before stripping it.
  useEffect(() => {
    if (!oneShot) return;
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
  }, [oneShot]);

  /** One connect attempt: the nonce this page will accept a result for. */
  function startConnect(): string {
    const n = newLinkedInNonce();
    pendingNonce.current = n;
    return n;
  }

  const connectUrl = `/api/integrations/linkedin/connect?next=${encodeURIComponent(returnTo)}`;
  // A guest has no session to attach a LinkedIn token to, so their Connect
  // button runs a one-shot photo import instead: straight into LinkedIn's
  // consent screen (guest=1 — no signup detour), and the callback copies the
  // consented photo into storage and returns it via ?li_photo= for the builder
  // to apply to the draft. Nothing is persisted server-side beyond the photo.
  const guestConnectHref = `/api/integrations/linkedin/connect?guest=1&next=${encodeURIComponent(returnTo)}`;
  const connectHref = oneShot ? guestConnectHref : connectUrl;

  /** Every LinkedIn button on this component goes through here. */
  function connectLinkedIn(e?: { preventDefault(): void }) {
    e?.preventDefault();
    // The one-shot hop leaves this page. Never with the card unsaved: a failed
    // save stops here, with the upload button right above as the way forward.
    if (oneShot && beforeLeave && !beforeLeave()) {
      setState({ kind: "error", message: "Couldn't save your card on this device to open LinkedIn — upload your photo above instead." });
      return;
    }
    void openLinkedInConnect(connectHref, { guest: oneShot, returnTo, nonce: oneShot ? undefined : startConnect() });
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
            ? "We couldn't find a photo for that email — upload one above instead."
            : "We couldn't find a photo on your accounts — upload one above instead.",
        });
        return;
      }
      setState({ kind: "results", candidates, linkedin });
    } catch {
      setState({ kind: "error", message: "Couldn't look for photos right now — try again, or upload one instead." });
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
      const data = await res.json().catch(() => ({} as { url?: string }));
      if (!res.ok || !data.url) {
        setState({ kind: "error", message: "Couldn't import that photo — try another, or upload it manually." });
        return;
      }
      onConfirm(data.url);
      setApplied(true);
      setState({ kind: "idle" });
    } catch {
      setState({ kind: "error", message: "Couldn't import that photo — try another, or upload it manually." });
    }
  }

  const linkBtn = "inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800 transition-colors";

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
          {/* On a phone, typing/uploading a photo is more friction than
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
              <a href={connectHref} onClick={connectLinkedIn} className="font-medium text-blue-700 hover:text-blue-800 underline underline-offset-2">
                connect your LinkedIn
              </a>{" "}
              and we&apos;ll pull your photo from there automatically.
            </p>
          )}
        </>
      )}

      {applied && state.kind === "idle" && (
        <p className="text-[0.6875rem] text-emerald-400 mt-1">
          Headshot added — it&apos;s saved when you save your card. Not right? Upload your own above.
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
          <button type="button" onClick={suggest} className="text-blue-700 hover:text-blue-800">Retry</button>
        </p>
      )}

      {state.kind === "results" && (
        <div className="mt-1.5 rounded-xl border border-gray-700/60 bg-gray-800/40 p-3">
          {state.candidates.length > 0 ? (
            <>
              <p className="text-[0.6875rem] text-gray-400 mb-2.5">
                {state.candidates.length === 1 ? "We found this photo — it's only used if you choose it:" : "We found these photos — pick one, or upload your own above:"}
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
