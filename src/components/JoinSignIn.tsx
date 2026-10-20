"use client";

import { useState } from "react";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import Link from "next/link";
import { useIsNativeApp } from "@/lib/platform";

// Sign-in shown INLINE on the /join/[token] invite page for a signed-out
// invitee (owner request): no detour to the login page, no password.
//   • Google — one tap with the invited email's Google account, or
//   • a passwordless email link sent to the INVITED address.
// Both land back on /join/<token> (Google via /onboarding; the email link via
// /auth/confirm, which provisions a brand-new account through /onboarding
// first), where they accept the invite.
// The email is fixed to the invited address — the join API only accepts the
// invite under that email anyway, so offering a free-text field would just
// let people sign in as the wrong account and hit a dead end.
//
// ONE WAY IN, never a choice (owner, 2026-09-24): the admin invited one
// address, so the invitee creates their account with it — there is no
// "I already have an account" / log-in option beside it. `hasAccount` (the
// invited address already has a SwiftCard account — lib/invite-account) is the
// one exception, because creating that account again fails: then the same
// single path signs in instead, and the words say so.
//
// `linkFailed`: /auth/confirm sends an invitee back here (?link=expired) when
// an emailed link couldn't sign them in — it expired or was already used.
// They used to land on the generic login page, invite lost, with a message
// about "the device where you built your card".
export default function JoinSignIn({
  token,
  inviteEmail,
  hasAccount = false,
  linkFailed = false,
}: {
  token: string;
  inviteEmail: string;
  hasAccount?: boolean;
  linkFailed?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState(
    linkFailed
      ? "That link has expired or was already used. Send yourself a new one below."
      : "",
  );

  const nextPath = `/join/${token}`;
  const native = useIsNativeApp();

  async function sendLink() {
    setStatus("sending");
    setError("");
    try {
      // Our own route, not signInWithOtp: it sends a SwiftCard email branded
      // like the invite (not Supabase's bare "Your sign-in link"), always to the
      // invited address read from the invite itself, and its link is verified
      // on the server (/auth/confirm) — so it works on whatever device or
      // browser the email is opened in. A brand-new invitee's account is
      // created by the link, as before: no password, no signup form.
      const res = await fetch("/api/join/sign-in-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Couldn't send the link. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch {
      setError("Couldn't send the link. Please try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-5 text-center">
        <div className="w-10 h-10 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-white font-semibold text-sm">Check your email</p>
        <p className="text-gray-500 text-xs mt-1.5 leading-relaxed">
          We sent a {hasAccount ? "sign-in " : ""}link to <span className="text-gray-300 font-medium">{inviteEmail}</span>.
          {hasAccount
            ? " Open it on any device and you'll land right back on your invite to accept."
            : " Open it on any device to create your account, and you'll land right back on your invite to accept."}
        </p>
        <button type="button" onClick={sendLink} className="text-blue-400 hover:text-blue-300 text-xs mt-3 transition-colors">
          Didn&apos;t get it? Send again
        </button>
      </div>
    );
  }

  // IN THE APP an emailed sign-in link opens Safari, not the app, and the
  // app never gets the session — the invitee was stuck (2026-09-16 audit).
  // The app's own sign-in works there (email + password, Google, Apple), and
  // both routes come straight back to this page to accept. /login fixes the
  // email field to the invited address (lib/invite-account).
  if (native) {
    const back = encodeURIComponent(nextPath);
    return (
      <div className="space-y-3">
        <p className="text-center text-gray-500 text-xs leading-relaxed">
          {hasAccount ? (
            <>You already have a SwiftCard account with <span className="text-gray-300 font-medium">{inviteEmail}</span>. Sign in with it to accept.</>
          ) : (
            <>Create your account with <span className="text-gray-300 font-medium">{inviteEmail}</span>, the email your team invited.</>
          )}
        </p>
        <Link
          href={hasAccount ? `/login?next=${back}` : `/login?mode=signup&next=${back}`}
          className="block w-full text-center bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-full transition-colors text-sm"
        >
          {hasAccount ? "Sign in to accept" : "Create my account"}
        </Link>
        <p className="text-center text-gray-600 text-[0.6875rem]">
          Using Apple? Choose &quot;Share My Email&quot; so your team can find you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-gray-500 text-xs leading-relaxed">
        {hasAccount ? (
          <>You already have a SwiftCard account with <span className="text-gray-300 font-medium">{inviteEmail}</span>. Sign in with it to accept. No password needed.</>
        ) : (
          <>Create your account with <span className="text-gray-300 font-medium">{inviteEmail}</span>, the email your team invited. No password needed.</>
        )}
      </p>

      {/* Google — the invited address's Google account signs them straight in. */}
      <GoogleSignInButton redirectTo={nextPath} loginHint={inviteEmail} />

      <div className="flex items-center gap-3" role="presentation">
        <span className="h-px flex-1 bg-gray-800" />
        <span className="text-gray-600 text-[0.6875rem]">or</span>
        <span className="h-px flex-1 bg-gray-800" />
      </div>

      {error && <p className="text-red-400 text-xs text-center">{error}</p>}
      <button
        type="button"
        onClick={sendLink}
        disabled={status === "sending"}
        className="w-full bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-semibold py-3 rounded-full transition-colors text-sm"
      >
        {status === "sending" ? "Sending…" : hasAccount ? "Email me a sign-in link" : "Email me a link to create my account"}
      </button>
      <p className="text-center text-gray-600 text-[0.6875rem]">
        {hasAccount
          ? "One tap in that email signs you in, with no password to remember."
          : "One tap in that email creates your account, with no password to create or remember."}
      </p>
    </div>
  );
}
