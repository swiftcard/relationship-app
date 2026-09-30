import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { aiConsentPermits, readAiConsent } from "@/lib/ai-consent";
import { isShellRequest } from "@/lib/shell-request";

// Server-side half of the AI consent gate. Separate from lib/ai-consent.ts
// because that module is imported (type-only) by a client component, and this
// one reaches for the service-role client — which must never be pulled into a
// client bundle.
//
// The point of this file: the modal is a promise, and a promise the server does
// not keep is worth nothing. Apple asked us to obtain the user's permission
// BEFORE sharing the data; so every route that sends personal data to the AI
// provider calls this first, and the rule is platform-aware
// (see aiConsentPermits):
//
//   • declined  → blocked everywhere, on every platform.
//   • unset     → blocked for requests FROM THE SHELL (detected server-side by
//                 UA/cookie, so a client-side native-detection failure cannot
//                 leak data); the web, which has never shown a prompt and where
//                 nothing was refused, proceeds as before.
//   • accepted  → proceeds.
//
// The unset-blocks-in-app rule is the fix for the third 5.1.1(i)/5.1.2(i)
// rejection: the old shape (block only an explicit decline) meant any path
// that reached an AI feature before the consent dialog happened to render
// shared data with the provider having asked nothing.

/**
 * Returns a 403 response when this account may not use AI from this request's
 * platform, or null when the request may proceed.
 *
 * Fails OPEN on a lookup error — deliberately. A transient database blip should
 * degrade to today's behaviour (the feature works) rather than silently break
 * paid features for everyone; the decline is stored and will be read correctly
 * on the next call. The failure this guard exists to prevent is a standing
 * decision being ignored, not a one-off read error. (For a shell request the
 * consent dialog mounts globally, so by the time a feature is tapped the
 * decision virtually always exists — the fail-open window is the blip itself.)
 */
export async function aiConsentBlock(userId: string, req: NextRequest): Promise<NextResponse | null> {
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("profiles")
    .select("customization")
    .eq("id", userId)
    .single();

  // A lookup error fails OPEN on the web (feature works, the blip passes) but
  // CLOSED for the shell: the app may never send personal data unasked.
  if (error) return isShellRequest(req) ? consentRequired("unset") : null;
  const consent = readAiConsent(data?.customization);
  if (aiConsentPermits(consent, isShellRequest(req))) return null;

  return consentRequired(consent === "declined" ? "declined" : "unset");
}

/**
 * Boolean form, for the one surface that should DEGRADE rather than refuse.
 *
 * The in-app assistant answers most questions from the local knowledge base
 * with no AI call at all, and only reaches for the model when the corpus can't
 * match. Returning 403 there would break a help widget over a preference,
 * whereas skipping the model just makes it answer from what it already knows —
 * which is the honest consequence of declining (or of not having been asked
 * yet), not a punishment for it.
 */
export async function aiConsentAllowsFor(userId: string, req: NextRequest): Promise<boolean> {
  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("profiles")
    .select("customization")
    .eq("id", userId)
    .single();
  if (error) return !isShellRequest(req); // web fails open; the shell never sends unasked
  return aiConsentPermits(readAiConsent(data?.customization), isShellRequest(req));
}

/**
 * The 403 a declined account gets, for a route that reads consent from a
 * profile it already loaded — AI design on a first card (/api/design-generate),
 * where "not asked yet" in the app answers from the design engine instead of
 * refusing, so only a decline needs this.
 */
export function aiConsentDeclinedResponse(): NextResponse {
  return consentRequired("declined");
}

function consentRequired(reason: "declined" | "unset"): NextResponse {
  return NextResponse.json(
    reason === "declined"
      ? {
          error: "ai_consent_required",
          code: "AI_CONSENT_REQUIRED",
          reason,
          message: "AI features are turned off for this account. You can turn them back on in Settings.",
        }
      : {
          error: "ai_consent_required",
          code: "AI_CONSENT_REQUIRED",
          reason,
          message: "SwiftCard needs your permission before using AI features. Allow AI in Settings, or when the notice appears.",
        },
    { status: 403 },
  );
}
