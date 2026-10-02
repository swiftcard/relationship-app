import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import ReopenAccount from "@/components/ReopenAccount";
import LeaveDeletedAccount from "@/components/LeaveDeletedAccount";

const GRACE_DAYS = 30;

function daysLeftToReopen(deletedAt: string) {
  const used = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86_400_000);
  return Math.max(0, GRACE_DAYS - used);
}

export default async function AccountDeletedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let canReopen = false;
  let daysLeft = 0;

  if (user) {
    const { data: profile } = await supabase.from("profiles").select("customization").eq("id", user.id).single();
    const c = (profile?.customization ?? {}) as { _deleted?: boolean; _deletion?: { at?: string } };
    if (c._deleted && c._deletion?.at) {
      daysLeft = daysLeftToReopen(c._deletion.at);
      canReopen = daysLeft > 0;
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center mb-6">
        <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth={1.5} className="w-8 h-8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m6 2.25a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>

      {canReopen ? (
        <>
          <h1 className="text-2xl font-bold text-white mb-2">Your account is scheduled for deletion</h1>
          <p className="text-gray-400 text-sm mb-8 max-w-sm leading-relaxed">
            You have <span className="text-white font-semibold">{daysLeft} day{daysLeft === 1 ? "" : "s"}</span> left to reopen it — your cards and contacts are still here. After that, your account and all its data are permanently deleted.
          </p>
          <ReopenAccount />
          <LeaveDeletedAccount className="text-sm text-gray-500 hover:text-gray-300 transition-colors mt-6" />
        </>
      ) : !user ? (
        <>
          {/* The single most likely visitor to this page has NO session: the
              delete route signs you out and redirects you straight here. With
              no session we cannot read the profile, so this used to fall
              through to the permanent "Your account has been deleted" branch —
              no Reopen button, no sign-in link — flatly contradicting the
              30-day promise the user had just read and accepted. The window
              does still work; they simply had no way to reach it. */}
          <h1 className="text-2xl font-bold text-white mb-2">Your account is scheduled for deletion</h1>
          <p className="text-gray-400 text-sm mb-8 max-w-sm leading-relaxed">
            You have <span className="text-white font-semibold">{GRACE_DAYS} days</span> from when you deleted it to change your mind — your cards and contacts are still here until then. Sign back in and we&apos;ll offer to reopen it.
          </p>
          <Link
            href="/login?next=/account-deleted"
            className="bg-white hover:bg-white/90 text-gray-900 font-bold text-sm px-6 py-3 rounded-full transition-colors"
          >
            Sign in to reopen
          </Link>
          <LeaveDeletedAccount className="text-sm text-gray-500 hover:text-gray-300 transition-colors mt-6" />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-white mb-2">Your account has been deleted</h1>
          <p className="text-gray-400 text-sm mb-8 max-w-sm leading-relaxed">
            We&apos;re sorry to see you go. Your cards and contacts have been removed. For your security, this email can&apos;t be used to create a new account while the deleted account is held — once it&apos;s permanently purged, the email is freed up again.
          </p>
          <LeaveDeletedAccount className="text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors" />
        </>
      )}
    </main>
  );
}
