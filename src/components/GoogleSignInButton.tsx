"use client";

import { useEffect, useRef, useState } from "react";
import { safeNextPath } from "@/lib/safe-next";
import { createBrowserClient } from "@supabase/ssr";
import { loadGoogleIdentity } from "@/lib/google-gis";
import { detectNativeApp } from "@/lib/platform";
import { isSocialInAppBrowser } from "@/lib/in-app-browser";

// ── Web-only Google sign-in via Google Identity Services (GIS) ──────────────
// Renders Google's official "Sign in with Google" button and exchanges the
// returned ID token for a Supabase session with signInWithIdToken. This avoids
// the OAuth *redirect* flow, so Google's account chooser shows THIS app's
// domain (via the client ID's authorized origins) instead of the raw
// *.supabase.co project domain.
//
// NOT for native: the Capacitor iOS shell keeps its own Google flow. LoginForm
// only renders this on web (native === false).
//
// Post-login: on success we route through /onboarding, reusing the app's
// EXISTING post-login logic — onboarding is idempotent (existing profile →
// forwards to `next`/dashboard; new user → provisions the profile + referral,
// then forwards). No second onboarding/profile system is introduced.

type Props = {
  // Same-origin continuation (invite token, draft, plan, checkout, next…). Passed
  // straight through to /onboarding so every continuation the password/OAuth
  // flows preserve is preserved here too.
  redirectTo?: string;
  // Rendered fallback label matching the app's existing button copy.
  className?: string;
  /** Also show Google One Tap (the floating account chip): a returning user
   *  signs in with a single tap without finding the button. Login page only —
   *  anywhere account choice must be explicit (the guest gate) leaves it off.
   *  auto_select stays false on purpose: zero-click auto sign-in would violate
   *  the "visitor explicitly picks an account" rule of the guest card flow. */
  oneTap?: boolean;
  /** Which tab the visitor is on. "signin" tells /onboarding to bounce a visitor
   *  who has no account yet to Create-account (Task 4) instead of provisioning
   *  one. "signup" (or undefined) provisions normally. */
  intent?: "signin" | "signup";
  /** The account to pre-select in Google's chooser. The team-invite page
   *  passes the invited address: picking any other Google account there makes
   *  a second SwiftCard account that the invite then refuses. */
  loginHint?: string;
};

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

// "unavailable" = we deliberately are not rendering a Google button here (the
// native shell, which uses its own system-browser flow). A terminal state, so
// the component can't sit on "loading" forever.
// "in_app" = the browser inside Instagram / Facebook / TikTok, where Google
// blocks its own sign-in. Offering the button there strands the visitor on a
// Google error page; pointing them at email signup (instant) does not.
type Phase = "loading" | "ready" | "authenticating" | "error" | "unavailable" | "in_app";

export default function GoogleSignInButton({ redirectTo, className, oneTap = false, intent, loginHint }: Props) {
  const btnRef = useRef<HTMLDivElement>(null);
  // Read at credential-callback time (via ref) so switching the Sign-in/Create
  // tab doesn't re-initialise the Google button. Kept current via an effect
  // (updating a ref during render is disallowed).
  const intentRef = useRef(intent);
  useEffect(() => { intentRef.current = intent; }, [intent]);
  // A missing client ID is known at first render (build-time NEXT_PUBLIC var),
  // so start in the right state instead of setState-ing inside the effect.
  const [phase, setPhase] = useState<Phase>(() => (CLIENT_ID ? "loading" : "error"));
  const [errorMsg, setErrorMsg] = useState(() =>
    CLIENT_ID ? "" : "Google sign-in isn't configured. Use email, or try again later."
  );
  // Guards against a second credential callback running while one is already
  // in flight (double-click, One Tap + button both firing).
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Defense-in-depth: never load or init GIS inside the native Capacitor
    // shell, even if this briefly mounts before useIsNativeApp() flips in the
    // parent (detectNativeApp() reads window.Capacitor and is accurate
    // immediately on the client). Native keeps its own Google flow.
    // Set a TERMINAL phase before bailing. This used to `return` with the
    // phase still on its initial "loading", so the component sat on the
    // "Loading Google…" pill forever. LoginForm swaps this component out on
    // native so it never showed there — but the office invite page
    // (JoinSignIn) renders it directly, which meant an invitee opening a team
    // invite in the shell got a dead control that never resolved, no Apple
    // option, and only the email-link fallback with no hint that it was the
    // one that worked. Rendering nothing is honest: native has its own Google
    // flow, and this component is not it.
    if (detectNativeApp()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- setting a TERMINAL phase is the whole point: detectNativeApp() is client-only, and returning without it left the pill stuck on "Loading Google…" forever (see above)
      if (!cancelled) setPhase("unavailable");
      return;
    }

    if (isSocialInAppBrowser(navigator.userAgent)) {
      if (!cancelled) setPhase("in_app");
      return;
    }

    // Missing client ID is already reflected in the initial phase above.
    if (!CLIENT_ID) return;

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const safeNext =
      safeNextPath(redirectTo);

    // Raw nonce sent to Supabase; Google gets its SHA-256 hash and embeds the
    // hash in the ID token's nonce claim, which Supabase re-hashes to compare.
    const rawNonce = crypto.randomUUID();

    async function handleCredential(resp: { credential?: string }) {
      if (inFlight.current) return; // never run the exchange twice
      if (!resp?.credential) {
        setPhase("error");
        setErrorMsg("Google didn't return a sign-in token — please try again.");
        return;
      }
      inFlight.current = true;
      setPhase("authenticating");
      setErrorMsg("");
      try {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: resp.credential,
          nonce: rawNonce,
        });
        if (error) {
          inFlight.current = false;
          setPhase("error");
          // Surface a plain message; the raw token never gets logged.
          setErrorMsg(
            /audience|client/i.test(error.message)
              ? "Google sign-in isn't fully set up yet. Please use email for now."
              : "We couldn't finish signing you in with Google. Please try again."
          );
          return;
        }
        // Session created. Reuse the existing post-login path (idempotent for
        // both brand-new and returning users). A full navigation ensures the
        // new auth cookies are sent on the next request. Carry the sign-in
        // intent so /onboarding can bounce a no-account sign-in (Task 4).
        const params = new URLSearchParams();
        if (safeNext) params.set("next", safeNext);
        if (intentRef.current === "signin") params.set("intent", "signin");
        const qs = params.toString();
        window.location.href = qs ? `/onboarding?${qs}` : "/onboarding";
      } catch {
        inFlight.current = false;
        setPhase("error");
        setErrorMsg("Network error signing in with Google — please try again.");
      }
    }

    async function sha256Hex(value: string) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    Promise.all([loadGoogleIdentity(), sha256Hex(rawNonce)])
      .then(([googleId, hashedNonce]) => {
        if (cancelled) return;
        googleId.initialize({
          client_id: CLIENT_ID!,
          callback: handleCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
          nonce: hashedNonce,
          ...(loginHint ? { login_hint: loginHint } : {}),
        });
        if (btnRef.current) {
          btnRef.current.replaceChildren(); // clear any prior render (no innerHTML)
          // Google draws the button at a fixed pixel width. 320 fit every
          // layout except a phone-width sign-up form, whose fields are ~300px
          // wide — the button stuck out past them on both sides. Match the
          // space it's given (measured on the wrapper: the button's own box
          // is still hidden), never wider than 320, never below Google's 200.
          const avail = btnRef.current.parentElement?.clientWidth ?? 0;
          const width = avail > 0 ? Math.max(200, Math.min(320, Math.floor(avail))) : 320;
          googleId.renderButton(btnRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "pill",
            logo_alignment: "center",
            width,
          });
        }
        // One Tap: surfaces the returning user's Google account as a floating
        // chip (FedCM UI) — one tap signs them in via the SAME handleCredential
        // as the button, whose inFlight guard already covers both firing.
        // Failures are silent by design: the rendered button is always there.
        if (oneTap) {
          try { googleId.prompt(); } catch { /* chip is best-effort */ }
        }
        setPhase("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPhase("error");
        setErrorMsg("Couldn't load Google sign-in. Check your connection and try again.");
      });

    return () => { cancelled = true; };
  }, [redirectTo, oneTap, loginHint]);

  return (
    <div className={className}>
      {/* Warm up Google's origin the moment this renders — cuts the GIS script
          fetch (the "Loading Google…" gap) by a round-trip. React hoists these
          into <head>. */}
      <link rel="preconnect" href="https://accounts.google.com" />
      <link rel="dns-prefetch" href="https://accounts.google.com" />
      {/* Google's official rendered button (branding-compliant). Hidden until
          ready so we don't flash an empty box. */}
      <div ref={btnRef} className={`flex justify-center ${phase === "ready" ? "" : "hidden"}`} aria-hidden={phase !== "ready"} />

      {phase === "loading" && (
        <div className="w-full flex items-center justify-center gap-3 bg-white text-gray-400 font-semibold py-3 px-6 rounded-full text-sm border border-[#E4DDD4]">
          Loading Google…
        </div>
      )}

      {phase === "authenticating" && (
        <div className="w-full flex items-center justify-center gap-3 bg-white text-gray-500 font-semibold py-3 px-6 rounded-full text-sm border border-[#E4DDD4]">
          Signing you in…
        </div>
      )}

      {phase === "in_app" && (
        <p className="text-gray-500 text-xs text-center">
          Google sign-in doesn&apos;t work inside this app&apos;s browser. Use your email below — it takes a few seconds.
        </p>
      )}

      {phase === "error" && (
        <p className="text-red-400 text-xs text-center mt-1">{errorMsg}</p>
      )}
    </div>
  );
}
