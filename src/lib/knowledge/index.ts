// ── The product knowledge base ──────────────────────────────────────────────
//
// Everything the support assistants know, in one place. Add a doc to the right
// module in ./docs and it reaches every surface that audience covers.
//
// See AGENTS.md: shipping a user-facing change means updating this in the same
// commit. tests/knowledge-truth.test.ts enforces the parts it can.

import type { KnowledgeDoc } from "./types";
import { productDocs } from "./docs/product";
import { marketingDocs } from "./docs/marketing-site";
import { gettingStartedDocs } from "./docs/getting-started";
import { cardDocs } from "./docs/cards";
import { dashboardDocs } from "./docs/dashboard";
import { contactsDocs } from "./docs/contacts";
import { automationDocs } from "./docs/automations";
import { accountDocs } from "./docs/account";
import { officeDocs } from "./docs/office";

export const KNOWLEDGE: readonly KnowledgeDoc[] = [
  ...productDocs,
  ...marketingDocs,
  ...gettingStartedDocs,
  ...cardDocs,
  ...dashboardDocs,
  ...contactsDocs,
  ...automationDocs,
  ...accountDocs,
  ...officeDocs,
];

/**
 * Page routes the assistants deliberately do not describe, and why.
 *
 * tests/knowledge-truth.test.ts requires every page in src/app to be either
 * covered by a doc or listed here — so a new user-facing page cannot ship
 * without someone deciding whether customers should be told about it. Adding a
 * route here is a decision, not a way to silence the test.
 */
export const UNDOCUMENTED_ROUTES: Record<string, string> = {
  "/admin": "SwiftCard staff console. Never describe it to a customer — it is not the Office admin console.",
  "/admin/analytics": "Staff console — company-wide metrics, not a customer surface.",
  "/admin/marketing": "Staff console — internal marketing tooling.",
  "/admin/plans": "Staff console — internal plan matrix.",
  "/admin/referrals": "Staff console — internal referral auditing.",
  "/admin/retention": "Staff console — the churn funnel: who opened the delete or cancel flow, the reason they gave, and whether an offer kept them. Contains other customers' words; never describe or quote it to a customer.",
  "/admin/users": "Staff console — internal user list.",
  "/admin/users/[id]": "Staff console — internal user detail.",
  "/admin/website": "Staff console — internal site content tooling.",
  "/admin/agent-flow": "Staff console — the marketing-agent review queue and run controls. Never a customer surface.",
  "/pin/[slug]": "The 1000×1500 picture behind each SwiftCard Pinterest pin (a real card design with a headline), photographed by scripts/pinterest-pins.mjs. noindex, linked from nowhere, not a customer surface.",
  "/profile": "Legacy settings page, superseded by /settings/flows and linked from nowhere. Pointing customers here would show them a second, stale copy of their settings.",
  "/profile/card": "Legacy primary-card editor, unlinked and superseded by the per-card editor.",
  "/card/[username]": "Redirect only since 2026-08-19 — card pages moved to the root (swiftcard.me/<username>, the documented /[username] route); this keeps every printed QR, NFC tag and old link working.",
  "/office": "Redirect only — it forwards to /office/admin, which is documented.",
  "/linkedin-connected": "Machine-only relay for the LinkedIn photo hop: the consent window lands here, hands the result to the card editor that opened it, and closes. Nobody navigates here on purpose and there is nothing on it to describe — the flow itself is documented under the headshot in cards.ts.",
  "/office/admin/invite": "Redirect only — inviting is a button on the Team tab, not a page.",
  "/office/admin/team": "Redirect only — folded into the Team tab.",
  "/office/admin/cards": "Redirect only — folded into the Team tab.",
  "/checkout/success": "Transient post-payment screen; nobody navigates here deliberately.",
  "/unsubscribe": "Landing page reached only from an unsubscribe link in an email; the behaviour is documented under email preferences.",
  "/account-deleted": "Reached only by a deleted account signing in; the reopen flow is documented under deleting your account.",
  "/auth/reset-password": "Reached only from a reset link or the Security section; both are documented there.",
  "/onboarding": "Invisible server-side provisioning step that immediately redirects. There is nothing for a user to do here.",
  "/welcome/team": "Legacy redirect for old invite emails; team members now use the normal card builder.",
  "/splash-preview": "An internal review page that plays the app's launch animation in a browser, linked from nowhere and noindex. It exists because the launch image is compiled into the app, so the animation cannot otherwise be seen before a build ships. Nothing a customer needs.",
};
