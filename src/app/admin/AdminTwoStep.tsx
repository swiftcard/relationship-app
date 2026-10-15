"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── The admin console's second step (audit SEC-06, lib/admin) ──────────────
// The first time: scan a QR code into an authenticator app and confirm one
// code. Every sign-in after: type the app's current code. Until then no admin
// page renders and every /api/admin route answers 403.
//
// Supabase's own MFA (TOTP): confirming a code raises this browser's session
// to aal2, and the reload lets the server layout see it.

type Step =
  | { kind: "loading" }
  | { kind: "setup"; factorId: string; qr: string; secret: string }
  | { kind: "code"; factorId: string }
  | { kind: "error"; message: string };

async function browserClient(): Promise<SupabaseClient> {
  const { createBrowserClient } = await import("@supabase/ssr");
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

export default function AdminTwoStep({ email }: { email: string }) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // One enrolment per mount, even under StrictMode's double effect.
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const supabase = await browserClient();
        const { data, error: listError } = await supabase.auth.mfa.listFactors();
        if (listError) throw listError;
        const verified = data.totp.find((f) => f.status === "verified");
        if (verified) {
          setStep({ kind: "code", factorId: verified.id });
          return;
        }
        // A setup that was started and never confirmed would block a new one
        // with the same name; it never protected anything, so clear it.
        for (const f of data.all) {
          if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
        const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: `SwiftCard admin ${new Date().toISOString().slice(0, 16)}`,
          issuer: "SwiftCard",
        });
        if (enrollError) throw enrollError;
        setStep({ kind: "setup", factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
      } catch (e) {
        setStep({ kind: "error", message: e instanceof Error ? e.message : "Couldn't start two-step sign-in." });
      }
    })();
  }, []);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "setup" && step.kind !== "code") return;
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = await browserClient();
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: step.factorId, code: digits });
      if (verifyError) {
        setError("That code didn't match. Codes change every 30 seconds — try the one showing now.");
        setCode("");
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900/60 p-6">
      <p className="text-[0.625rem] font-bold tracking-[0.25em] text-slate-500 uppercase mb-2">SwiftCard Admin</p>
      <h1 className="text-xl font-bold text-white mb-1">Two-step sign-in</h1>
      <p className="text-gray-400 text-sm mb-5">
        The admin console needs a code from an authenticator app as well as your password{email ? ` (${email})` : ""}.
      </p>

      {step.kind === "loading" && <p className="text-gray-500 text-sm" role="status">Loading…</p>}

      {step.kind === "error" && (
        <p className="text-red-400 text-sm" role="alert">
          {step.message} Reload the page to try again.
        </p>
      )}

      {step.kind === "setup" && (
        <div className="mb-4">
          <p className="text-gray-300 text-sm mb-3">
            <span className="font-semibold text-white">One-time setup.</span> Scan this with an authenticator app
            (Google Authenticator, 1Password, Authy…), then type the 6-digit code it shows.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns the QR as an SVG data URL */}
          <img src={step.qr} alt="QR code to add SwiftCard to your authenticator app" className="w-44 h-44 rounded-lg bg-white p-2 mx-auto" />
          <p className="text-gray-500 text-xs mt-3 text-center">
            Can&apos;t scan? Enter this key instead:
            <br />
            <code className="text-gray-300 break-all select-all">{step.secret}</code>
          </p>
        </div>
      )}

      {(step.kind === "setup" || step.kind === "code") && (
        <form method="post" onSubmit={confirm} noValidate>
          <label htmlFor="admin-otp" className="block text-xs font-semibold text-gray-300 mb-1.5">
            6-digit code
          </label>
          <input
            id="admin-otp"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            className="w-full rounded-lg bg-gray-950 border border-gray-700 px-3 py-2.5 text-white text-lg tracking-[0.4em] text-center focus:outline-none focus:border-blue-500"
          />
          {error && <p className="text-red-400 text-xs mt-2" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-full transition-colors"
          >
            {busy ? "Checking…" : step.kind === "setup" ? "Turn on two-step sign-in" : "Continue"}
          </button>
        </form>
      )}

      <p className="mt-5 text-center">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- leave the admin shell entirely */}
        <a href="/dashboard" className="text-gray-500 hover:text-white text-xs">← My dashboard</a>
      </p>
    </div>
  );
}
