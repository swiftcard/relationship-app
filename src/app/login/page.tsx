import LoginForm from "@/components/LoginForm";
import SwiftCardLogo from "@/components/SwiftCardLogo";
import { inviteEmailForNext } from "@/lib/invite-account";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string; ref?: string }>;
}) {
  const { next: rawNext, mode, ref } = await searchParams;
  // ?next=/dashboard is not a destination — it is where every sign-in lands
  // anyway. Treating it as one turned "Get Started" (the card builder first)
  // into a bare "Create account" form, and a brand-new person who used it
  // skipped the builder and landed on an empty dashboard. It arrives that way
  // from any signed-out bounce off /dashboard: an app cold launch, an expired
  // session, an old link (owner, 2026-10-02).
  const next = rawNext === "/dashboard" ? undefined : rawNext;

  // The app creates accounts too (owner decision 2026-08-27, IAP live): with
  // Pro purchasable in-app, the old sign-in-only posture — accounts deflected
  // to the website — is gone. Web and shell now render the same form.
  const initialMode = mode === "signup" ? "signup" : "signin";

  // Arrived through a referral link (/r/CODE → ?ref=1): show the "your first
  // month of Pro is free" copy. The reward itself is applied server-side at
  // /onboarding from the sc_ref cookie. (Signup is open to everyone — no code.)
  const isReferral = ref === "1";

  // A TEAM INVITE is for one address (owner, 2026-09-24). Arriving from
  // /join/<token> (the app's invite screen sends people here), the form is
  // fixed to the invited email and offers no Sign in / Create account switch —
  // the invite page already chose the one that applies (lib/invite-account).
  const inviteEmail = await inviteEmailForNext(next);

  return (
    <main className="min-h-screen bg-cream flex items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <SwiftCardLogo size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {/* Not "Welcome back": the other tab on this very screen is for
                people who have never been here, and it is the tab a first-time
                visitor arrives on from half the marketing CTAs. Greeting them as
                a returning user is the first thing the product gets wrong about
                them (audit 2026-09-29). */}
            {initialMode === "signup" ? "Create your account" : "Sign in to SwiftCard"}
          </h1>
          <p className="text-slate-600 text-sm mt-2">
            {/* Only a team-invite link is an "invitation". Every other `next`
                (the builder's Create-account gate, a checkout bounce, the
                app's Office hand-off) read "Sign in to accept your invitation"
                under "Create your account" — to people nobody had invited. */}
            {inviteEmail
              ? initialMode === "signup"
                ? <>Create your account with <span className="font-semibold text-slate-800 break-words">{inviteEmail}</span> — the email your team invited.</>
                : <>Sign in with <span className="font-semibold text-slate-800 break-words">{inviteEmail}</span> to accept your invitation.</>
              : next?.startsWith("/join/")
              ? initialMode === "signup" ? "Create your account to accept your invitation." : "Sign in to accept your invitation."
              : next?.startsWith("/checkout")
                ? "Create your account or sign in to continue to checkout."
              : next?.startsWith("/welcome") && next.includes("tier=office")
                ? "Sign in with the account you use in the SwiftCard app to set up Office."
              : next && initialMode === "signup"
                ? "Create your account to save your card."
              : isReferral && initialMode === "signup"
                ? "A friend invited you — your first month of Pro is free."
                : initialMode === "signup"
                  // 60, not 30: the homepage says 60 seconds in three places,
                  // the dashboard's empty state says 60, and the invite page
                  // says about 2 minutes. One number per promise.
                  ? "Free to start. Ready in 60 seconds."
                  : "Sign in, or tap Get Started to build your card."}
          </p>
        </div>
        <div className="bg-warm-card border border-warm-card-border rounded-2xl p-6 shadow-sm">
          <LoginForm redirectTo={next} initialMode={initialMode} lockedEmail={inviteEmail ?? undefined} />
        </div>
      </div>
    </main>
  );
}
