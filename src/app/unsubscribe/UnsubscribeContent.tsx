"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function UnsubscribeContent() {
  const params = useSearchParams();
  const success = params.get("success") === "1";
  const error = params.get("error");
  // "contact" = the platform-wide email opt-out used by lead follow-ups and
  // office invites. Those recipients are NOT account holders, so the marketing-
  // only copy was wrong for them and both CTAs below dead-end at a login wall.
  const isContact = params.get("scope") === "contact";

  if (success) {
    return (
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{ background: "#fff", border: "1px solid #E4DDD4" }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: "#EDE5D8" }}
        >
          <span className="text-2xl">✓</span>
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ color: "#0f172a" }}>
          You&apos;ve been unsubscribed
        </h1>
        <p className="text-sm mb-6" style={{ color: "#64748b" }}>
          {isContact
            ? "We've stopped sending SwiftCard email to this address — invitations and follow-ups included."
            : "You won't receive any more marketing emails from SwiftCard. Transactional emails (receipts, security notices) are unaffected."}
        </p>
        {/* Account-holder CTAs only — a lead or invitee has no account to sign into. */}
        {!isContact && (
          <>
            <Link
              href="/dashboard"
              className="inline-block text-sm font-semibold rounded-full px-6 py-3 transition-colors"
              style={{ background: "#1D4ED8", color: "#fff" }}
            >
              Go to dashboard
            </Link>
            <p className="mt-4 text-xs" style={{ color: "#94a3b8" }}>
              Changed your mind?{" "}
              <Link href="/settings/flows" className="underline">
                Update email preferences
              </Link>
            </p>
          </>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{ background: "#fff", border: "1px solid #E4DDD4" }}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: "#FEE2E2" }}
        >
          <span className="text-2xl">!</span>
        </div>
        {/* Two very different failures. `invalid` is a bad/expired token — the
            person can stop worrying, nothing was going to be sent from it
            anyway. `failed` means the link WAS valid and we could not record
            the opt-out, so telling them the link was invalid would be false and
            would make them give up instead of trying again. */}
        <h1 className="text-xl font-bold mb-2" style={{ color: "#0f172a" }}>
          {error === "failed" ? "We couldn't complete that" : "Invalid unsubscribe link"}
        </h1>
        <p className="text-sm mb-6" style={{ color: "#64748b" }}>
          {error === "failed"
            ? "Something went wrong on our end and you have NOT been unsubscribed yet. Please try the link again in a moment — if it keeps failing, email hello@swiftcard.me and we'll remove you manually."
            : "This link may have already been used or is no longer valid. You can manage your email preferences from your account settings."}
        </p>
        <Link
          href="/settings/flows"
          className="inline-block text-sm font-semibold rounded-full px-6 py-3 transition-colors"
          style={{ background: "#1D4ED8", color: "#fff" }}
        >
          Manage preferences
        </Link>
      </div>
    );
  }

  // The email's link lands here and asks (audit SEC-20): opening the link no
  // longer unsubscribes, because mail scanners open every link. A plain form
  // POST, so the button works before — or without — any JavaScript.
  const token = params.get("token");
  if (params.get("confirm") === "1" && token) {
    return (
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{ background: "#fff", border: "1px solid #E4DDD4" }}
      >
        <h1 className="text-xl font-bold mb-2" style={{ color: "#0f172a" }}>
          Unsubscribe from SwiftCard marketing emails?
        </h1>
        <p className="text-sm mb-6" style={{ color: "#64748b" }}>
          Receipts and security notices still reach you.
        </p>
        <form method="post" action={`/api/unsubscribe?ui=1&token=${encodeURIComponent(token)}`}>
          <button
            type="submit"
            className="inline-block text-sm font-semibold rounded-full px-6 py-3"
            style={{ background: "#1D4ED8", color: "#fff" }}
          >
            Unsubscribe
          </button>
        </form>
      </div>
    );
  }

  // Landing state with no token — direct navigation.
  return (
    <div
      className="w-full max-w-md rounded-2xl p-8 text-center"
      style={{ background: "#fff", border: "1px solid #E4DDD4" }}
    >
      <h1 className="text-xl font-bold mb-2" style={{ color: "#0f172a" }}>
        Unsubscribe from SwiftCard emails
      </h1>
      <p className="text-sm mb-6" style={{ color: "#64748b" }}>
        Manage your marketing email preferences from settings.
      </p>
      <Link
        href="/settings/flows"
        className="inline-block text-sm font-semibold rounded-full px-6 py-3"
        style={{ background: "#1D4ED8", color: "#fff" }}
      >
        Go to settings
      </Link>
    </div>
  );
}
