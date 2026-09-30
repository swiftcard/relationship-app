"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useIsNativeApp, useNativePlatform } from "@/lib/platform";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import PasswordField from "@/components/PasswordField";
import { safeNextPath } from "@/lib/safe-next";
import { assessPassword, CONFIRM_MISMATCH, MIN_LENGTH, type PasswordAssessment } from "@/lib/password-policy";
import { suggestDomain } from "@/lib/email-typo";

// Auth redirects are pinned to the SwiftCard domain, NOT window.location.origin.
// Origin-based redirects break sign-in if the form is ever loaded on a Vercel
// preview host (Supabase would reject the non-allowlisted redirect and the PKCE
// exchange would fail cross-host). Every login / signup / Google / reset flow
// therefore routes through swiftcard.me.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// Kill switch for the Apple button, kept deliberately after the provider went
// live (2026-08-07, NEXT_PUBLIC_APPLE_SIGNIN_ENABLED=1 in Vercel Production).
// It exists so the button can never be visible while Apple sign-in is broken —
// which it will be roughly every 6 months when the Apple client secret expires.
// Set to 0 and redeploy to hide it; a dead sign-in control is an App Review 2.1
// rejection on its own. Read at module scope, not per render, and compared to
// the literal so a stray value can't accidentally switch it on.
const APPLE_SIGNIN_ENABLED = process.env.NEXT_PUBLIC_APPLE_SIGNIN_ENABLED === "1";

const noopSubscribe = () => () => {};

const CANT_REACH = "We couldn't reach SwiftCard. Check your connection and try again.";

/**
 * Supabase's own error strings in the user's words. "User already registered"
 * and "Password should be at least 6 characters" used to reach the screen
 * verbatim — the two most common signup failures, in the API's voice.
 * `existing` lets the form offer "Sign in instead" for the first one.
 */
export function friendlySignupError(
  err: { message?: string; status?: number; name?: string },
  policy: PasswordAssessment,
): { text: string; existing: boolean; field: "email" | "password" | null } {
  const msg = err.message ?? "";
  if (/already (been )?registered|already exists|user_already_exists/i.test(msg)) {
    return { text: "An account with this email already exists.", existing: true, field: null };
  }
  if (err.name === "AuthRetryableFetchError" || /failed to fetch|network|load failed|timeout|timed out/i.test(msg) || err.status === 0 || (err.status ?? 0) >= 500) {
    return { text: CANT_REACH, existing: false, field: null };
  }
  if (/rate limit|too many/i.test(msg)) {
    return { text: "Too many attempts. Wait a minute and try again.", existing: false, field: null };
  }
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(msg)) {
    return { text: "Enter a valid email address.", existing: false, field: "email" };
  }
  if (/password/i.test(msg)) {
    return { text: policy.reason ?? `Use at least ${MIN_LENGTH} characters.`, existing: false, field: "password" };
  }
  return { text: "Something went wrong creating your account. Please try again.", existing: false, field: null };
}

export default function LoginForm({
  redirectTo,
  initialMode = "signin",
  lockedEmail,
}: {
  redirectTo?: string;
  initialMode?: "signin" | "signup";
  /** A team invite's address (/login?next=/join/<token>): the email field is
   *  fixed to it and there is no Sign in / Create account switch — an invite
   *  is for one address and offers one way in (owner, 2026-09-24). */
  lockedEmail?: string;
}) {
  // One form for web AND the iOS shell (owner decision 2026-08-27, IAP live):
  // the app creates accounts exactly like the website — the old sign-in-only
  // deflection to swiftcard.me is gone, because Pro is now sold in-app.
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  // false in the server HTML and during hydration, true once React owns the
  // form — the submit button's gate (see it below).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const [email, setEmail] = useState(lockedEmail ?? "");
  const [password, setPassword] = useState("");
  // Create-account only: the second password box, and the errors that belong
  // to one field rather than to the form.
  const [confirm, setConfirm] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  // "An account with this email already exists" → offer Sign in instead.
  const [existingAccount, setExistingAccount] = useState(false);
  // The "Did you mean you@gmail.com?" hint, and the address the person chose
  // to keep anyway (so the hint never nags twice about the same typing).
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  // Signup succeeded but Supabase requires email confirmation (no session yet).
  const [signupSent, setSignupSent] = useState(false);
  // A failed email/password sign-in: Supabase can't reveal whether the email
  // has no account or the password was wrong (by design), so we surface an
  // honest "create one if you're new" affordance rather than a false claim.
  const [signinFailed, setSigninFailed] = useState(false);
  // Focused when "Forgot password?" is tapped with the field empty — see
  // handleForgot. Pointing at the box beats an error that blames the user for
  // not having filled in a field they were never asked to fill in.
  const emailRef = useRef<HTMLInputElement>(null);
  const native = useIsNativeApp();
  // Guideline 4.8 is an APPLE rule. On Android it buys nothing and costs the
  // only one-tap sign-in the app has, so the coupling below is iOS-only.
  const androidApp = useNativePlatform() === "android";
  const socialInApp = androidApp || APPLE_SIGNIN_ENABLED;

  // Surface a failed OAuth round-trip (auth/callback redirects here with
  // ?error=oauth) or a sign-in attempt for an email with no account
  // (?error=no_account) instead of silently landing the visitor back on the
  // form. Read after mount — reading the URL during render would mismatch SSR.
  useEffect(() => {
    let msg = "";
    let toSignup = false;
    try {
      const err = new URLSearchParams(window.location.search).get("error");
      if (err === "oauth") {
        // Not only Google comes back through here: an email-confirmation or
        // sign-in LINK opened in a different browser or device fails the same
        // way, and "Google sign-in didn't complete" told them nothing useful.
        msg = "That sign-in didn't complete. If you opened an email link on a different device or browser, sign in here instead — use the device where you built your card to keep it.";
      } else if (err === "no_account") {
        // They tried to SIGN IN with Google but have no SwiftCard account yet —
        // flip to Create-account and tell them so, instead of leaving them
        // confused on the sign-in tab (Task 4).
        msg = "You don't have an account yet — create one to get started.";
        toSignup = true;
      }
    } catch { /* ignore */ }
    // ADOPT WHAT IS ALREADY TYPED. These inputs are controlled by state that
    // starts empty, so anyone who fills them before React attaches watches
    // their email VANISH the moment it does — hydration writes the empty prop
    // back over the DOM. Measured in CI on 2026-09-11: the email box was blank
    // and the password box full, on a form that had been filled in order.
    // Reading the fields here keeps whatever is in them.
    const typedEmail = (document.getElementById("auth-email") as HTMLInputElement | null)?.value ?? "";
    const typedPassword = (document.getElementById("auth-password") as HTMLInputElement | null)?.value ?? "";
    const typedConfirm = (document.getElementById("auth-confirm-password") as HTMLInputElement | null)?.value ?? "";
    // One-time reads of the URL after mount (SSR-safe): applying them is the
    // whole point of this effect.
    /* eslint-disable react-hooks/set-state-in-effect -- one-time post-mount URL + field read */
    if (typedEmail) setEmail(typedEmail);
    if (typedPassword) setPassword(typedPassword);
    if (typedConfirm) setConfirm(typedConfirm);
    if (msg) setErrorMsg(msg);
    if (toSignup) setMode("signup");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Creating a NEW account must never inherit a session already in this browser —
  // otherwise the visitor can end up inside the previously-logged-in account and
  // it looks like their new email "linked" to it. Local sign-out only (other
  // devices stay signed in).
  async function clearExistingSession() {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* no session — fine */ }
  }

  async function handleGoogle() {
    if (mode === "signup") await clearExistingSession();
    // NATIVE: OAuth must run in the SYSTEM browser (SFSafariViewController) —
    // Google blocks embedded-webview OAuth (403 disallowed_useragent). The
    // round-trip returns via the swiftcard:// scheme and NativeAppBridge
    // completes the session in the webview. See src/lib/native-auth.ts.
    if (native) {
      const { startNativeOAuth } = await import("@/lib/native-auth");
      const err = await startNativeOAuth(supabase, "google", redirectTo, mode);
      if (err) { setErrorMsg(err); setStatus("error"); }
      return;
    }
    // Carry a same-origin `next` (e.g. the guest editor) through the OAuth
    // round-trip so the callback can return the user to where they left off.
    const safeNext = safeNextPath(redirectTo);
    const callback = safeNext
      ? `${APP_URL}/auth/callback?next=${encodeURIComponent(safeNext)}`
      : `${APP_URL}/auth/callback`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      // Force Google's account chooser every time — without this, a browser
      // that already has one Google session signed in skips straight past
      // account selection and logs into that account silently, which is
      // wrong for anyone juggling multiple Google accounts.
      options: { redirectTo: callback, queryParams: { prompt: "select_account" } },
    });
  }

  // Sign in with Apple — mirrors handleGoogle. Rendered only in the native app.
  // The Supabase provider went live 2026-08-07, so this is a real sign-in path
  // now. The error handling stays: the client secret is an Apple-signed JWT that
  // expires every 6 months (next ≈ 2027-02-05), and when it lapses Supabase
  // starts answering "provider is not enabled" again — better a readable message
  // than a thrown promise. See app-store/RELEASE_CHECKLIST.md §B to regenerate.
  async function handleApple() {
    if (mode === "signup") await clearExistingSession();
    // WEB: the same Supabase Apple provider the app uses (the app runs it in
    // the system browser, which IS the web flow), returning through
    // /auth/callback like Google's redirect fallback. Without it an account
    // made in the app with Apple — often a Hide My Email address with no
    // password — could never sign in on swiftcard.me, which is the only place
    // Office can be bought. `intent` rides along so a Sign-in tap with no
    // SwiftCard account is bounced to Create account, as Google's is.
    if (!native) {
      const safeNext = safeNextPath(redirectTo);
      const params = new URLSearchParams();
      if (safeNext) params.set("next", safeNext);
      if (mode === "signin") params.set("intent", "signin");
      const qs = params.toString();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: { redirectTo: `${APP_URL}/auth/callback${qs ? `?${qs}` : ""}` },
      });
      if (error) {
        setErrorMsg(error.message.includes("not enabled") ? "Apple sign-in isn't available right now — please try again." : error.message);
        setStatus("error");
      }
      return;
    }
    try {
      // Same system-browser flow as native Google — consistent, and avoids
      // running Apple's auth page inside the embedded webview.
      const { startNativeOAuth } = await import("@/lib/native-auth");
      const err = await startNativeOAuth(supabase, "apple", redirectTo, mode);
      if (err) {
        setErrorMsg(err.includes("not enabled") ? "Apple sign-in isn't available right now — please try again." : err);
        setStatus("error");
      }
    } catch {
      setErrorMsg("Apple sign-in isn't available right now — please try again.");
      setStatus("error");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // HYDRATION-SAFE: the DOM is the truth at submit time. Someone who types
    // their email and password the instant the page paints (before React has
    // attached) fills the inputs while state still says "", and the sign-in
    // then went out EMPTY — "missing email or phone" from Supabase, on a form
    // the person could see was filled (found by the nightly run, 2026-09-11).
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const emailNow = lockedEmail ?? (typeof fd.get("email") === "string" ? (fd.get("email") as string) : email).trim();
    const passwordNow = typeof fd.get("password") === "string" ? (fd.get("password") as string) : password;
    const confirmNow = typeof fd.get("confirm_password") === "string" ? (fd.get("confirm_password") as string) : confirm;
    if (emailNow !== email) setEmail(emailNow);
    if (passwordNow !== password) setPassword(passwordNow);
    if (confirmNow !== confirm) setConfirm(confirmNow);
    setStatus("loading");
    setErrorMsg("");
    setEmailError("");
    setPasswordError("");
    setConfirmError("");
    setExistingAccount(false);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: emailNow, password: passwordNow });
      if (error) {
        if (error.message === "Invalid login credentials" && lockedEmail) {
          // An invite's sign-in: the invite page only sends people here when
          // the invited address already has an account, so this is the
          // password — including an account first made by an emailed link or
          // Google, which never had one. No "Create an account" beside it.
          setErrorMsg("That password isn't right. If you've never set one, tap Forgot password.");
        } else if (error.message === "Invalid login credentials") {
          // Could be a wrong password OR no account — Supabase won't say which.
          // Guide them to Create-account without a false "no account" claim.
          setErrorMsg("We couldn't sign you in. If you don't have an account yet, create one — it's free.");
          setSigninFailed(true);
        } else if (error.name === "AuthRetryableFetchError" || /failed to fetch|network|load failed/i.test(error.message)) {
          setErrorMsg(CANT_REACH);
        } else {
          setErrorMsg(error.message);
        }
        setStatus("error");
      } else {
        // safeNextPath, NOT the raw redirectTo — `next` is attacker-controlled
        // (see the helper). This line was the one place the guard was missed.
        //
        // Through /onboarding, which passes an existing account straight on to
        // `next` and PROVISIONS one that has no profile yet. An account created
        // with email confirmation whose link opened in another browser (the
        // iPhone app's link opens Safari) signs in here without ever having
        // been through onboarding — and had no profile, so choosing a plan and
        // buying Pro both silently failed (2026-09-16 audit).
        const next = safeNextPath(redirectTo);
        window.location.href = next ? `/onboarding?next=${encodeURIComponent(next)}` : "/onboarding";
      }
    } else {
      // Everything below runs BEFORE a request goes out, so a slip costs one
      // tap on this screen instead of a round-trip and an API error string.
      //
      // 1. A misspelled common domain. Confirmation is off, so this is the one
      //    moment a typo can still be caught — after it, the account exists at
      //    an address nobody reads and the reset email goes there too.
      const typo = suggestDomain(emailNow);
      // Never for an invite's fixed address: it is exactly what the admin sent.
      if (typo && !lockedEmail && suggestionDismissed !== emailNow) {
        setEmailSuggestion(typo);
        setStatus("idle");
        emailRef.current?.focus();
        return;
      }
      // 2. The password rule (lib/password-policy — the same one the reset
      //    page and the Supabase project enforce).
      const policy = assessPassword(passwordNow, emailNow);
      if (!policy.ok) {
        setPasswordError(policy.reason ?? `Use at least ${MIN_LENGTH} characters.`);
        setStatus("idle");
        (document.getElementById("auth-password") as HTMLInputElement | null)?.focus();
        return;
      }
      // 3. Typed twice, and the same both times.
      if (confirmNow !== passwordNow) {
        setConfirmError(CONFIRM_MISMATCH);
        setStatus("idle");
        (document.getElementById("auth-confirm-password") as HTMLInputElement | null)?.focus();
        return;
      }

      await clearExistingSession();
      // Carry a same-origin `next` (e.g. a team invite, or the guest editor)
      // through email-confirmation too — mirrors handleGoogle/handleApple.
      // Without this, a signup with confirmation enabled sends the user to
      // /auth/callback with no `next` once they click the emailed link, so
      // e.g. an invited employee never returns to /join/<token> to accept
      // (auth audit — the invite was silently dropped).
      const safeNext = safeNextPath(redirectTo);
      const emailRedirectTo = safeNext
        ? `${APP_URL}/auth/callback?next=${encodeURIComponent(safeNext)}`
        : `${APP_URL}/auth/callback`;
      const { data, error } = await supabase.auth.signUp({ email: emailNow, password: passwordNow, options: { emailRedirectTo } });
      // Supabase's enumeration-safe shape for "this email already has an
      // account": a user with no identities and no session, and no error.
      const silentDuplicate = !error && !!data.user && !data.session && (data.user.identities?.length ?? 0) === 0;
      if (error || silentDuplicate) {
        const friendly = friendlySignupError(error ?? { message: "user already registered" }, policy);
        if (lockedEmail && friendly.existing) {
          // The invited address turned out to have an account after all (made
          // since the invite page looked). Back to the invite, which checks
          // again and now says "You already have a SwiftCard account with …"
          // with its one Sign-in path — flipping this form in place left the
          // page heading still reading "Create your account" above a sign-in.
          window.location.replace(safeNextPath(redirectTo) ?? "/login");
        } else {
          if (friendly.field === "email") setEmailError(friendly.text);
          else if (friendly.field === "password") setPasswordError(friendly.text);
          else setErrorMsg(friendly.text);
          setExistingAccount(friendly.existing);
          setStatus("error");
        }
      } else if (!data.session) {
        // Confirmation required: /onboarding would only bounce back to /login
        // with no explanation. Tell them what happens next instead.
        setSignupSent(true);
        setStatus("idle");
      } else {
        // New accounts must pass through /onboarding (profile provisioning +
        // referral). This branch only runs when confirmation is OFF and a
        // session came back immediately; the confirmation-required case is
        // handled by emailRedirectTo above instead.
        window.location.href = safeNext ? `/onboarding?next=${encodeURIComponent(safeNext)}` : "/onboarding";
      }
    }
  }

  async function handleForgot() {
    // Same hydration rule: read the field itself, not possibly-stale state.
    const typed = (document.getElementById("auth-email") as HTMLInputElement | null)?.value?.trim();
    if (typed && typed !== email) setEmail(typed);
    const emailNow = typed || email;
    if (!emailNow) {
      // Point at the field instead of scolding. Someone who taps this is
      // already locked out; answering with a red error for a box nobody asked
      // them to fill is the wrong tone AND the wrong instruction. Focusing it
      // puts the cursor where the next action is and says what to do.
      setErrorMsg("Enter your email above and tap Forgot password again.");
      setStatus("idle");
      emailRef.current?.focus();
      return;
    }
    setStatus("loading");
    const { error } = await supabase.auth.resetPasswordForEmail(emailNow, {
      // Straight to the "set a new password" page, which exchanges the code
      // itself — NOT /auth/callback?next=..., which depends on Supabase's
      // redirect-URL allowlist preserving that extra query param (it doesn't
      // reliably), silently falling back to the dashboard instead.
      redirectTo: `${APP_URL}/auth/reset-password`,
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      // A dedicated confirmation screen, not an inline message styled like an
      // error — this was a real success, not a validation failure.
      setForgotSent(true);
      setStatus("idle");
    }
  }

  if (signupSent) {
    return (
      <div className="w-full text-center space-y-5">
        <div className="w-14 h-14 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <p className="text-slate-900 font-semibold text-base">Confirm your email</p>
          <p className="text-slate-600 text-sm mt-1.5">
            We sent a confirmation link to <span className="font-medium text-slate-700">{email}</span>. Tap it on this device and you&apos;ll come straight back to your card.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setSignupSent(false); setMode("signin"); setErrorMsg(""); }}
          className="w-full bg-[#1D4ED8] hover:bg-[#1740C4] text-white font-semibold py-3 px-6 rounded-full transition-colors text-sm"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  if (forgotSent) {
    return (
      <div className="w-full text-center space-y-5">
        <div className="w-14 h-14 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto">
          <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <p className="text-slate-900 font-semibold text-base">Check your email</p>
          <p className="text-slate-600 text-sm mt-1.5">
            We sent a password reset link to <span className="font-medium text-slate-700">{email}</span>. Click it to set a new password.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setForgotSent(false); setErrorMsg(""); }}
          className="w-full bg-[#1D4ED8] hover:bg-[#1740C4] text-white font-semibold py-3 px-6 rounded-full transition-colors text-sm"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-5">
      {/* Sign-in / Get Started toggle.
          A plain visit to the sign-in screen (no destination to return to — the
          app's first screen, a bookmark) offers "Get Started" instead of a
          bare account form: it opens the card builder, the SAME flow as the
          website's "Get started" button — build the card, then create the
          account when you save it, then choose a plan (owner, 2026-09-16).
          Arriving WITH a destination (the builder's "Save & create account"
          gate, a team invite) keeps the real "Create account" form, because
          that is exactly where the account gets made.
          Not shown at all for a team invite (lockedEmail): one address, one
          way in, chosen by the invite page. */}
      {!lockedEmail && (
      <div className="flex bg-[#EDE8E0] border border-[#E4DDD4] rounded-full p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              if (m === "signup" && !redirectTo && mode !== "signup") { window.location.assign("/cards/new"); return; }
              setMode(m); setStatus("idle"); setErrorMsg(""); setSigninFailed(false);
              setConfirm(""); setEmailError(""); setPasswordError(""); setConfirmError(""); setExistingAccount(false); setEmailSuggestion(null);
            }}
            className="flex-1 py-2 text-sm font-semibold rounded-full transition-colors"
            style={{
              background: mode === m ? "#1D4ED8" : "transparent",
              color: mode === m ? "#fff" : "#5B5247",
            }}
          >
            {m === "signin" ? "Sign in" : !redirectTo && mode !== "signup" ? "Get Started" : "Create account"}
          </button>
        ))}
      </div>
      )}

      {/* WEB: Google Identity Services (ID-token flow) — keeps the raw
          *.supabase.co domain out of Google's account chooser. NATIVE: the
          Capacitor iOS shell keeps its existing OAuth-redirect flow untouched.
          `native` is false on the server and first client render, so web always
          gets the GIS button with no hydration mismatch; native flips to the
          old button after mount (and GoogleSignInButton is a hard no-op in
          native regardless). */}
      {/* ⚠️ On native, Google is gated on APPLE_SIGNIN_ENABLED too. Guideline
          4.8 is about the *combination*: offering a third-party social login
          in-app obliges an equivalent private option. Hiding only the Apple
          button when the provider breaks would leave Google standing alone —
          turning a kill switch meant to prevent a 2.1 into a guaranteed 4.8 on
          the next submission. With both hidden, native falls back to
          email/password, which owes Apple nothing. Web is unaffected. */}
      {/* ANDROID: not gated on the Apple switch. The paragraph above is App
          Review 4.8, which applies to the App Store and nowhere else — pairing
          Google to it on Android would mean the Apple kill switch silently
          removes Google sign-in from the Android app, leaving email/password
          as the only way in for no reason at all. */}
      {native ? (
        socialInApp && (
          <button
            type="button"
            onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-900 font-semibold py-3 px-6 rounded-full transition-colors text-sm"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        )
      ) : (
        <GoogleSignInButton redirectTo={redirectTo} oneTap intent={mode} loginHint={lockedEmail} />
      )}

      {/* Sign in with Apple — in the app (Apple requires it alongside other
          social logins in-app) AND on the website (2026-09-22): an account
          made in the app with Apple has no password, so without it the web —
          where Office is bought — was a locked door for it.

          Also gated on APPLE_SIGNIN_ENABLED. This used to render on platform
          alone, while the Supabase Apple provider was not enabled on the
          project — so every tap failed with an error toast, next to a Google
          button that worked. A permanently dead sign-in control is an App
          Review 2.1 rejection on its own, and Apple's own 4.8 rule is about
          OFFERING Sign in with Apple, which a button that cannot sign anyone
          in does not do.

          Same shape as the Wallet/APNs gates: inert until configured. Enable
          the provider in Supabase, then set NEXT_PUBLIC_APPLE_SIGNIN_ENABLED=1
          in Vercel and REDEPLOY — env changes only take effect on a new build.
          Until then, hidden beats broken. */}
      {APPLE_SIGNIN_ENABLED && (
        <button
          type="button"
          onClick={handleApple}
          className="w-full flex items-center justify-center gap-3 bg-black hover:bg-gray-900 text-white font-semibold py-3 px-6 rounded-full transition-colors text-sm mt-3"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
            <path d="M16.365 1.43c0 1.14-.42 2.2-1.13 3-.77.88-2.02 1.56-3.06 1.48-.13-1.1.42-2.28 1.09-3.02.76-.86 2.09-1.48 3.1-1.46zM20.5 17.2c-.55 1.27-.81 1.84-1.52 2.96-.99 1.57-2.39 3.52-4.12 3.53-1.54.01-1.94-1-4.03-.99-2.09.01-2.53 1.01-4.07.99-1.73-.02-3.05-1.78-4.04-3.35C-.02 16.9-.34 12.03 1.35 9.5c1.19-1.8 3.07-2.85 4.83-2.85 1.8 0 2.93 1.01 4.42 1.01 1.44 0 2.32-1.01 4.4-1.01 1.57 0 3.23.86 4.42 2.34-3.88 2.13-3.25 7.67 1.08 9.21z" />
          </svg>
          Continue with Apple
        </button>
      )}

      {/* Only when a one-tap button is actually above it — native with the
          Apple kill switch off shows neither, and a lone "or" heading the
          form would read as a rendering glitch. */}
      {(!native || socialInApp) && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[#E4DDD4]" />
          <span className="text-slate-600 text-xs">or</span>
          <div className="flex-1 h-px bg-[#E4DDD4]" />
        </div>
      )}

      {/* method="post" is the pre-hydration backstop, not decoration.
          handleSubmit calls preventDefault, so once React has attached itself
          this form never navigates — but BEFORE hydration there is no handler,
          and a submit then (a fast typist on Enter, a password manager that
          fills and submits, a slow phone, a chunk that failed to load) takes
          the HTML default. With no method that default is GET, which put the
          named fields in the query string:
            /login?email=victim%40example.com&password=SuperSecret123%21
          — the real password in browser history, in the access log, and in the
          Referer of every request the page made next. It also looked like a
          broken sign-in: the page reloaded to a blank form with no error.
          POST sends the same fields in the body instead, and POST /login
          renders this same page, so the visible outcome is unchanged.
          Pinned by tests/credentials-never-in-url.test.ts. */}
      <form onSubmit={handleSubmit} method="post" className="space-y-4">
        {/* Labelled fields with real autofill hints.
            The inputs were unlabelled, unnamed placeholders with no autoComplete,
            so password managers had nothing to bind to — you had to type your
            credentials by hand every time, which is the single loudest "this is
            not a real product" signal an auth screen can send. A placeholder is
            also not a label: it disappears the moment you type, leaving a filled
            box with no idea what it holds, and screen readers get nothing.
            sc-input is the app's own focus treatment (globals.css) — these were
            hand-rolling a border change and skipping the ring. */}
        <div className="space-y-1.5">
          <label htmlFor="auth-email" className="block text-xs font-semibold text-slate-600">
            Email
          </label>
          <input
            id="auth-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="you@company.com"
            required
            ref={emailRef}
            value={email}
            // A team invite's address can't be edited — the invite only
            // accepts that one (lockedEmail). readOnly, not disabled, so the
            // value still submits and the pre-hydration POST stays whole.
            readOnly={!!lockedEmail}
            aria-readonly={lockedEmail ? true : undefined}
            onChange={(e) => { if (lockedEmail) return; setEmail(e.target.value); if (emailError) setEmailError(""); if (emailSuggestion) setEmailSuggestion(null); }}
            onBlur={(e) => { if (mode === "signup" && !lockedEmail) { const t = suggestDomain(e.target.value); setEmailSuggestion(t && suggestionDismissed !== e.target.value.trim() ? t : null); } }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "auth-email-error" : emailSuggestion ? "auth-email-hint" : undefined}
            className={`sc-input w-full border border-[#E4DDD4] placeholder-slate-400 rounded-xl px-4 py-3 text-sm ${lockedEmail ? "bg-[#F4F0EA] text-slate-700 cursor-default" : "bg-white text-slate-900"}`}
          />
          {emailError && (
            <p id="auth-email-error" role="alert" className="text-xs text-red-700">{emailError}</p>
          )}
          {/* "Did you mean you@gmail.com?" — see the typo gate in handleSubmit
              for why this is worth one extra tap. Tapping the address applies
              it; "Keep what I typed" remembers the exact address so the form
              never asks about it again. */}
          {mode === "signup" && emailSuggestion && !emailError && (
            <p id="auth-email-hint" className="text-xs text-slate-700">
              Did you mean{" "}
              <button
                type="button"
                onClick={() => { setEmail(emailSuggestion); setEmailSuggestion(null); }}
                className="font-semibold text-[#1D4ED8] hover:text-[#1740C4] underline underline-offset-2"
              >
                {emailSuggestion}
              </button>
              ?{" "}
              <button
                type="button"
                onClick={() => { setSuggestionDismissed(email.trim()); setEmailSuggestion(null); }}
                className="text-slate-500 hover:text-slate-800 underline underline-offset-2"
              >
                Keep what I typed
              </button>
            </p>
          )}
        </div>

        {/* current-password vs new-password decides whether the browser offers
            to FILL or to GENERATE — getting it wrong makes managers behave
            strangely on the tab you are actually on. minLength only on
            Create account: an account made under the old 6-character rule must
            still be able to sign in, and the browser would refuse the submit
            before Supabase was even asked. */}
        <PasswordField
          id="auth-password"
          name="password"
          label="Password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder={mode === "signup" ? `At least ${MIN_LENGTH} characters` : "Your password"}
          required
          minLength={mode === "signup" ? MIN_LENGTH : undefined}
          value={password}
          onChange={(v) => { setPassword(v); if (passwordError) setPasswordError(""); }}
          error={passwordError || null}
          strength={mode === "signup" && password ? assessPassword(password, email) : null}
          labelRight={
            /* Where every real platform puts it, and only on the tab where it
               means anything. It used to sit under the OAuth buttons as 12px
               slate-400 on the warm card — roughly 2:1 contrast, below the
               submit button, for the one control someone locked out needs to
               find first. */
            mode === "signin" ? (
              <button
                type="button"
                onClick={handleForgot}
                disabled={status === "loading"}
                className="text-xs font-semibold text-[#1D4ED8] hover:text-[#1740C4] hover:underline underline-offset-2 disabled:opacity-50 transition-colors"
              >
                {status === "loading" ? "Sending…" : "Forgot password?"}
              </button>
            ) : null
          }
        />

        {/* Typed twice. Only exists on Create account — not hidden, absent —
            so the sign-in form stays the two fields password managers expect. */}
        {mode === "signup" && (
          <PasswordField
            id="auth-confirm-password"
            name="confirm_password"
            label="Confirm password"
            autoComplete="new-password"
            placeholder="Type it again"
            required
            minLength={MIN_LENGTH}
            value={confirm}
            onChange={(v) => { setConfirm(v); if (confirmError) setConfirmError(""); }}
            error={confirmError || null}
          />
        )}

        {errorMsg && (
          <p role="alert" className="text-red-700 text-xs text-center">{errorMsg}</p>
        )}

        {/* The one-tap path back to Sign in when the address already has an
            account — keeps the email they typed, clears the passwords. */}
        {mode === "signup" && existingAccount && (
          <button
            type="button"
            onClick={() => { setMode("signin"); setExistingAccount(false); setErrorMsg(""); setStatus("idle"); setPassword(""); setConfirm(""); }}
            className="w-full text-center text-[#1D4ED8] hover:text-[#1740C4] font-semibold text-sm py-1 transition-colors"
          >
            Sign in instead →
          </button>
        )}

        {/* After a failed sign-in, a one-tap path to Create-account (keeps the
            email they typed) — the "redirect to create account" affordance for
            the email/password case, where Supabase can't confirm no-account. */}
        {mode === "signin" && signinFailed && (
          <button
            type="button"
            onClick={() => { setMode("signup"); setSigninFailed(false); setErrorMsg(""); setStatus("idle"); }}
            className="w-full text-center text-[#1D4ED8] hover:text-[#1740C4] font-semibold text-sm py-1 transition-colors"
          >
            Create an account →
          </button>
        )}

        {/* Disabled in the server HTML, live the moment React attaches. The
            POST backstop above keeps a pre-hydration submit from leaking the
            password — but it still reloaded to a blank form with no error:
            a password manager that fills and submits, a fast Enter, a slow
            phone. A disabled default button also blocks implicit (Enter)
            submission, so the gap is closed in the markup. Faded only while
            signing in, so the first paint looks exactly as before. */}
        <button
          type="submit"
          disabled={!hydrated || status === "loading"}
          className={`w-full bg-[#1D4ED8] hover:bg-[#1740C4] text-white font-semibold py-3 px-6 rounded-full transition-colors text-sm ${status === "loading" ? "opacity-50" : ""}`}
        >
          {status === "loading"
            ? mode === "signin" ? "Signing in…" : "Creating your account…"
            : mode === "signin" ? "Sign in →" : "Create account →"}
        </button>

        {mode === "signup" && (
          <p className="text-center text-[0.6875rem] leading-relaxed text-slate-600">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="underline hover:text-slate-600">Terms</Link> and{" "}
            <Link href="/privacy" className="underline hover:text-slate-600">Privacy Policy</Link>.
          </p>
        )}
      </form>
    </div>
  );
}
