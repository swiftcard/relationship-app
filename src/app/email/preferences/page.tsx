import Link from "next/link";
import { verifyEmailToken } from "@/lib/email-token";
import { readPreferences, isPaused } from "@/lib/marketing-consent";
import PreferenceCenter from "@/components/email/PreferenceCenter";

// /email/preferences?t=<token>
//
// Reached from the "Manage email preferences" link in every marketing footer.
// NO LOGIN — the token identifies the account. Server-rendered with the current
// settings already filled in, so the switches are never wrong for a moment and
// nobody saves a state they were not shown.
export const metadata = { title: "Email preferences | SwiftCard" };
export const dynamic = "force-dynamic";

const SHELL = "min-h-screen flex items-center justify-center p-6";
const BG = { background: "#FAF7F2" };

export default async function EmailPreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const check = verifyEmailToken(t);

  if (!check.ok) {
    // One message for every failure — expired, forged, malformed. A person who
    // followed a stale link still needs a way out, so point at the one-click
    // control their mail client already draws, and at support.
    return (
      <div className={SHELL} style={BG}>
        <div className="w-full max-w-md rounded-2xl p-8 text-center" style={{ background: "#fff", border: "1px solid #E4DDD4" }}>
          <h1 className="text-xl font-bold mb-2" style={{ color: "#0f172a" }}>This link has expired</h1>
          <p className="text-sm" style={{ color: "#64748b" }}>
            Preference links stop working after 90 days. Open a recent SwiftCard email and use the
            link in its footer, or the unsubscribe control your email app shows at the top of the
            message. Either one works without signing in.
          </p>
          <p className="mt-5 text-sm" style={{ color: "#64748b" }}>
            Stuck? <Link href="/contact" className="underline" style={{ color: "#0f172a" }}>Contact us</Link>{" "}and we&apos;ll
            take you off the list.
          </p>
        </div>
      </div>
    );
  }

  const prefs = await readPreferences(check.userId);

  return (
    <div className={SHELL} style={BG}>
      <PreferenceCenter
        token={t as string}
        initialPaused={isPaused(prefs)}
        initial={{
          lead_tips: prefs?.lead_tips ?? true,
          product_updates: prefs?.product_updates ?? true,
          digest: prefs?.digest ?? true,
          digest_frequency: prefs?.digest_frequency ?? "weekly",
          promotions: prefs?.promotions ?? true,
          paused_until: prefs?.paused_until ?? null,
          marketing_opt_out: !!prefs?.marketing_opt_out || prefs?.marketing_emails === false,
        }}
      />
    </div>
  );
}
