// ── Consent to send data to the AI provider ─────────────────────────────────
//
// App Review rejected 1.0.0 (3) under Guidelines 5.1.1(i) and 5.1.2(i):
//
//   "The app appears to share the user's personal data with a third-party AI
//    service but the app does not clearly explain what data is sent, identify
//    who the data is sent to, and ask the user's permission before sharing."
//
// The previous notice failed all three: it said "our AI provider" (nobody
// named), "contact details you provide" (nothing enumerated — and it never
// mentioned that the scanner uploads a photograph of somebody ELSE's business
// card), and its only button was "Got it", which is an acknowledgement rather
// than permission. Apple also notes that putting this in the privacy policy
// alone is not sufficient, so it has to be asked in the app.
//
// What is sent, honestly, per feature:
//   • Card scanner        — the photo you take of another person's card
//   • Follow-up drafts    — that contact's name, company, where you met, notes
//   • Design rebuild      — the photo of the card design you upload
//   • In-app assistant    — the message you type
//
// Consent is stored per ACCOUNT on profiles.customization, alongside the other
// underscore-prefixed flags (_deleted, _usage, _aiConsentAccepted).

export type AiConsent = "accepted" | "declined" | "unset";

/**
 * Read the stored decision.
 *
 * `_aiConsentAccepted: true` is the pre-rejection shape and deliberately does
 * NOT count as a decision. The notice that wrote it is the one App Review
 * ruled insufficient — no provider named, no data enumerated, and its only
 * button was "Got it", an acknowledgement rather than permission. Consent that
 * wasn't informed isn't consent, so those accounts are asked once more with
 * the real dialog (and the review demo account, which carries the legacy
 * flag, shows the ask to the reviewer instead of silently skipping it).
 * Everything new writes `_aiConsent`, which the new dialog is the only
 * author of.
 */
export function readAiConsent(customization: unknown): AiConsent {
  const c = (customization ?? {}) as Record<string, unknown>;
  if (c._aiConsent === "accepted" || c._aiConsent === "declined") return c._aiConsent;
  return "unset";
}

/**
 * Whether an AI request may proceed for this account — WEB semantics.
 *
 * "unset" passes here: the web has never shown a prompt (adding new visible
 * web UI is off-limits) and its users have not refused anything. What must be
 * honoured everywhere is an explicit NO — a declined account's data is not
 * sent from any platform. For requests from the iOS shell, use
 * aiConsentPermits with isShell=true instead: in the app, "hasn't answered
 * yet" must BLOCK.
 */
export function aiConsentAllows(customization: unknown): boolean {
  return readAiConsent(customization) !== "declined";
}

/**
 * The full permission rule, platform-aware. This is the sentence App Review
 * keeps writing back at us, as code:
 *
 *   "Obtain the user's permission BEFORE sending data."   (5.1.2(i))
 *
 * In the app that means consent is OPT-IN: only an explicit "accepted" lets
 * data leave. An account that has never answered ("unset") is blocked until
 * the dialog is answered. The earlier model — block only an explicit decline —
 * is what produced three straight 5.1.1 rejections: any path that reached an
 * AI feature before the dialog happened to render (the help bubble on a page
 * without the gate, the design scanner on /cards/new) shared data with the
 * provider having asked nothing.
 *
 * On the web "unset" still passes (no prompt has ever been shown there, and
 * nothing was refused); a decline made in the app is honoured everywhere.
 */
export function aiConsentPermits(consent: AiConsent, isShell: boolean): boolean {
  if (consent === "declined") return false;
  if (consent === "accepted") return true;
  return !isShell; // unset: web proceeds, the app must ask first
}

// ── WHEN the question is asked ──────────────────────────────────────────────
//
// Owner, 2026-09-18: a brand-new account going through Get Started (build a
// card → create the account → choose a plan → "Your card is live!") was shown
// the AI dialog in the middle of it, between creating the account and the plan
// step — because the ask fired on the FIRST signed-in screen, and Get Started
// made that screen part of onboarding. The ask belongs inside the app, once the
// card is live, and never on a step of getting there.
//
// Two halves, and both must agree before the dialog opens:
//   • aiConsentAskAllowedOn(pathname) — the SCREEN is not a setup/funnel step;
//   • aiConsentAskReady(account)      — the ACCOUNT has finished setting up.
// The account half is what covers the hops a path cannot name: the claim passes
// through /dashboard?claim=1 and /cards/[id]/edit?claim=1, which are ordinary
// app paths for everyone else.
//
// Deferring the QUESTION never defers the PROTECTION: aiConsentPermits still
// blocks every AI request from the app while the answer is "unset", so nothing
// reaches the provider unasked in the meantime (5.1.2(i) holds throughout).

/** Setup and funnel screens. The dialog never opens on these. */
const NO_ASK_EXACT = ["/login", "/account-deleted", "/onboarding", "/upgrade"];
const NO_ASK_PREFIXES = ["/auth/", "/cards/new", "/welcome", "/checkout", "/join/"];

export function aiConsentAskAllowedOn(pathname: string | null | undefined, search?: string | null): boolean {
  if (!pathname) return false;
  if (NO_ASK_EXACT.includes(pathname)) return false;
  // An invited Office member who had already built a card finishes setting up
  // on its editor (/cards/[id]/edit?joined=1, sent there by JoinButton), and
  // its only way on is "Go to my dashboard →" (/dashboard?tour=1). That is a
  // setup step with an ordinary path, so it is named by its query: the ask
  // waits for the dashboard, then the tour follows (owner, 2026-09-18 — every
  // account, every plan, asked on landing in the dashboard).
  if (search && new URLSearchParams(search).get("joined") === "1") return false;
  return !NO_ASK_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/**
 * Has this account finished getting started? It has a card, and the plan step
 * is behind it (`awaitingPlan` is lib/card-active awaitingPlanChoice — the same
 * test that keeps the card dark and sends the dashboard to /welcome, so "your
 * card is live" and "now we may ask" can never disagree).
 */
export function aiConsentAskReady(account: { hasCard: boolean; awaitingPlan: boolean }): boolean {
  return account.hasCard && !account.awaitingPlan;
}

/**
 * The exact disclosure shown before anything is sent.
 *
 * Built from the live provider name (see aiProviderName) so swapping providers
 * cannot silently make this sentence false — which is the failure mode that
 * produced the rejection in the first place.
 */
export function aiConsentCopy(provider: string): {
  title: string;
  what: string[];
  who: string;
  control: string;
} {
  return {
    title: "Before you use AI features",
    what: [
      "Photos you take of a business card, when you scan one",
      "A contact's name, company, where you met and your notes — plus your own name, title, company and About text — when AI writes a follow-up",
      "A card design you upload to rebuild, with your photo, logo and contact details on it",
      "Messages you type to the in-app assistant",
    ],
    // Deliberately does NOT claim anything about model training. Whether the
    // provider trains on API input depends on the plan we are on, and a
    // privacy promise we cannot verify is a worse problem than the one this
    // notice exists to fix. State only what is ours to state.
    who: `This is sent to ${provider} to produce the result, and to no one else. SwiftCard never sells your data or your contacts' data.`,
    control: "You can say no and keep using everything else in SwiftCard. AI features simply stay off.",
  };
}
