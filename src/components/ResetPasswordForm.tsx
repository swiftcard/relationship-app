"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import PasswordField from "@/components/PasswordField";
import { useHumanCheck, isHumanCheckError, HUMAN_CHECK_FAILED } from "@/components/HumanCheck";
import { assessPassword, CONFIRM_MISMATCH, MIN_LENGTH } from "@/lib/password-policy";

type Stage = "checking" | "ready" | "no-session" | "saving" | "done" | "error";

const CANT_REACH = "We couldn't reach SwiftCard. Check your connection and try again.";

// Reached directly via the "Forgot password" email link (resetPasswordForEmail's
// redirectTo now points straight here, not through /auth/callback?next=... — that
// relay depended on Supabase's redirect-URL allowlist preserving an extra query
// param on top of /auth/callback, which it doesn't always honor, silently falling
// back to the default Site URL and landing the user on the dashboard with no way
// to set a new password). This page exchanges the recovery `code` itself, client-side.
// Pinned to the SwiftCard domain for the same reason LoginForm is: an
// origin-based redirect breaks the flow on any non-allowlisted host.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

export default function ResetPasswordForm() {
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  // The account's address, for the "can't contain your email" rule.
  const [userEmail, setUserEmail] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  // The resend is a reset email, which Supabase's CAPTCHA switch guards.
  const human = useHumanCheck();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search);
      // The recovery link arrives in one of three shapes, and only the first
      // was handled. That mattered because the first is the ONE that is
      // device-bound: exchangeCodeForSession is PKCE, and the code verifier
      // lives in the localStorage of whichever device REQUESTED the reset. So
      // the single most ordinary path — request it on the laptop, open the
      // email on the phone — always failed, and the page blamed the link
      // ("invalid or has expired"). Re-requesting reproduced it exactly, which
      // made it a self-repeating dead end for someone who already can't get in.
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type");
      // Implicit flow puts the tokens in the URL fragment instead.
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      let failed = false;

      if (tokenHash) {
        // Device-INDEPENDENT: the hash is verified server-side by Supabase,
        // with no local verifier involved.
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: (type as "recovery") || "recovery",
        });
        failed = !!error;
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        failed = !!error;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        failed = !!error;
      }

      // Strip the credential from the URL either way — single-use, and it
      // shouldn't linger in browser history.
      window.history.replaceState({}, "", window.location.pathname);

      if (failed) {
        setStage("no-session");
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setUserEmail(user.email);
      setStage(user ? "ready" : "no-session");
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase client is stable across renders
  }, []);

  // A resend, right where the failure is. Sending them back to /login to start
  // over is what made this loop: the same request produces the same
  // device-bound link and the same dead end.
  async function resend() {
    setErrorMsg("");
    const target = resendEmail.trim();
    if (!target) return;
    setResendState("sending");
    const captchaToken = await human.token();
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      // /auth/reset-password — the route this form lives on. It said
      // /reset-password, which is no page at all, so the one link a stuck user
      // asked this form to resend landed on a blank screen (email audit 2026-09-08).
      redirectTo: `${APP_URL}/auth/reset-password`,
      captchaToken,
    });
    human.reset();
    // A failed human check is the one error worth showing: nothing was sent,
    // and "a new link is on its way" would leave them waiting for nothing.
    // It says nothing about whether the account exists.
    if (isHumanCheckError(error)) {
      setErrorMsg(HUMAN_CHECK_FAILED);
      setResendState("idle");
      return;
    }
    // Deliberately the same outcome either way: whether an account exists for
    // an address is not something an unauthenticated form should reveal.
    setResendState(error ? "sent" : "sent");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The DOM is the truth at submit time (same rule as LoginForm): a value
    // typed or filled before React attached is in the box, not in state.
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const passwordNow = typeof fd.get("password") === "string" ? (fd.get("password") as string) : password;
    const confirmNow = typeof fd.get("confirm_password") === "string" ? (fd.get("confirm_password") as string) : confirm;
    if (passwordNow !== password) setPassword(passwordNow);
    if (confirmNow !== confirm) setConfirm(confirmNow);
    setErrorMsg("");
    setPasswordError("");
    setConfirmError("");
    const policy = assessPassword(passwordNow, userEmail);
    if (!policy.ok) {
      setPasswordError(policy.reason ?? `Use at least ${MIN_LENGTH} characters.`);
      (document.getElementById("reset-password") as HTMLInputElement | null)?.focus();
      return;
    }
    if (passwordNow !== confirmNow) {
      setConfirmError(CONFIRM_MISMATCH);
      (document.getElementById("reset-confirm-password") as HTMLInputElement | null)?.focus();
      return;
    }
    setStage("saving");
    const { error } = await supabase.auth.updateUser({ password: passwordNow });
    if (error) {
      const m = error.message;
      if (/different from the old|same as/i.test(m)) setPasswordError("Choose a password you haven't used on SwiftCard before.");
      else if (/password/i.test(m)) setPasswordError(policy.reason ?? `Use at least ${MIN_LENGTH} characters.`);
      else if (error.name === "AuthRetryableFetchError" || /failed to fetch|network|load failed/i.test(m)) setErrorMsg(CANT_REACH);
      else setErrorMsg("We couldn't save that password. Please try again.");
      setStage("ready");
      return;
    }
    setStage("done");
    setTimeout(() => { window.location.href = "/dashboard"; }, 1500);
  }

  if (stage === "checking") {
    return <p className="text-slate-400 text-sm text-center">Checking your link…</p>;
  }

  if (stage === "no-session") {
    return (
      <div className="text-center space-y-4">
        {resendState === "sent" ? (
          <>
            <p className="text-slate-600 text-sm">
              If there&apos;s an account for that address, a new reset link is on its way. Open it on
              <span className="font-semibold"> this device</span> and you&apos;ll be able to set a new password.
            </p>
            <Link
              href="/login"
              className="inline-block w-full bg-[#1D4ED8] hover:bg-[#1740C4] text-white font-semibold py-3 px-6 rounded-full transition-colors text-sm"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="text-slate-600 text-sm">
              We couldn&apos;t use that reset link — it may have expired, already been used, or been
              opened on a different device from the one that asked for it.
            </p>
            {/* The resend lives HERE rather than back on /login. Sending someone
                to start over is what made this a loop: the same request
                produces the same link and the same failure. */}
            <label htmlFor="reset-resend-email" className="sr-only">Email</label>
            <input
              id="reset-resend-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full border border-slate-300 rounded-full px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/30"
            />
            {errorMsg && <p role="alert" className="text-red-700 text-xs">{errorMsg}</p>}
            {/* One block with the button, so the (normally zero-height) human
                check adds no space-y gap of its own. */}
            <div>
              {human.slot}
              <button
                type="button"
                onClick={resend}
                disabled={resendState === "sending" || !resendEmail.trim()}
                className="w-full bg-[#1D4ED8] hover:bg-[#1740C4] disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-full transition-colors text-sm"
              >
                {resendState === "sending" ? "Sending…" : "Send me a new link"}
              </button>
            </div>
            <Link href="/login" className="inline-block text-sm text-slate-500 hover:text-slate-700 transition-colors">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="text-center space-y-2">
        <p className="text-green-600 text-sm font-semibold">Password updated ✓</p>
        <p className="text-slate-400 text-xs">Taking you to your dashboard…</p>
      </div>
    );
  }

  // method="post" for the same reason as the sign-in form (see LoginForm): a
  // submit that beats hydration takes the HTML default, and GET would put
  // whatever is named into the query string. These inputs DO carry names now
  // (so password managers bind and the pre-hydration FormData read works), so
  // POST is what keeps a new password out of the URL, the history and the
  // access log. Pinned by tests/credentials-never-in-url.test.ts.
  return (
    <form onSubmit={handleSubmit} method="post" className="space-y-4">
      <PasswordField
        id="reset-password"
        name="password"
        label="New password"
        autoComplete="new-password"
        placeholder={`At least ${MIN_LENGTH} characters`}
        required
        minLength={MIN_LENGTH}
        value={password}
        onChange={(v) => { setPassword(v); if (passwordError) setPasswordError(""); }}
        error={passwordError || null}
        strength={password ? assessPassword(password, userEmail) : null}
      />
      <PasswordField
        id="reset-confirm-password"
        name="confirm_password"
        label="Confirm new password"
        autoComplete="new-password"
        placeholder="Type it again"
        required
        minLength={MIN_LENGTH}
        value={confirm}
        onChange={(v) => { setConfirm(v); if (confirmError) setConfirmError(""); }}
        error={confirmError || null}
      />

      {errorMsg && <p role="alert" className="text-red-700 text-xs text-center">{errorMsg}</p>}

      <button
        type="submit"
        disabled={stage === "saving"}
        className="w-full bg-[#1D4ED8] hover:bg-[#1740C4] disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-full transition-colors text-sm"
      >
        {stage === "saving" ? "Saving…" : "Set new password →"}
      </button>
    </form>
  );
}
