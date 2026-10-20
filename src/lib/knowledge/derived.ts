// ── Facts the assistants derive from code, never from prose ─────────────────
//
// Everything in this file is COMPUTED from the modules that already are the
// single source of truth (plan.ts, plan-content.ts, template-style-presets.ts,
// crm-connection.ts). Change a price, a limit, a plan feature line, a template,
// or a CRM provider and every assistant surface says the new thing on the next
// request — no prompt to remember to edit.
//
// The rule for this file: if a fact lives in a data structure anywhere in the
// codebase, derive it here. Only facts that exist solely as behaviour (how a
// flow works, what a button does) belong in the hand-written docs/.

import { PLAN_LIMITS, PLAN_PRICES, TRIAL_DAYS, FREE_MONTH_DAYS } from "@/lib/plan";
import { PLAN_DESCRIPTIONS, PLAN_FEATURES } from "@/lib/plan-content";
import { META } from "@/lib/template-style-presets";
import { TOUR_STEPS, type TourStep } from "@/lib/tour-steps";
import { ADMIN_TOUR_STEPS } from "@/lib/admin-tour-steps";
import type { CrmProviderKey } from "@/lib/crm-connection";
import { hasGoogleWalletConfig } from "@/lib/google-wallet-config";
import type { Audience } from "./types";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ── Live values a doc can quote ─────────────────────────────────────────────
//
// A doc's `answer` ships to the user verbatim on the instant (no-LLM) path, so
// it cannot say "see the limits above" — but it must not hardcode a number
// either, or the next pricing change makes it a lie. Docs write a placeholder
// and it is filled at request time from the code.
//
// PLACEHOLDERS starting with `price.` are commerce values. `fillPlaceholders`
// refuses to resolve them in a native session, so a placeholder cannot become a
// route around the App Store no-selling rule.
const PLACEHOLDERS: Record<string, () => string> = {
  "limit.cards": () => String(PLAN_LIMITS.FREE_CARD_LIMIT),
  "limit.leads": () => String(PLAN_LIMITS.FREE_LEADS_PER_MONTH),
  "limit.links": () => String(PLAN_LIMITS.FREE_MAX_LINKS),
  "limit.seats": () => String(PLAN_LIMITS.OFFICE_MIN_SEATS),
  "limit.freeMonthDays": () => String(FREE_MONTH_DAYS),
  "trial.days": () => String(TRIAL_DAYS),
  "price.proMonthly": () => usd(PLAN_PRICES.PRO_MONTHLY_CENTS),
  "price.proAnnual": () => usd(PLAN_PRICES.PRO_ANNUAL_CENTS),
  "price.officeMonthly": () => usd(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS),
  "price.officeAnnual": () => usd(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS),
  "product.templateCount": () => String(Object.keys(META).length),
  "product.integrations": () => integrationList(),
  // Google Wallet exists only once its keys are in the environment
  // (lib/google-wallet-config), so the assistant must not promise it before.
  "wallet.android": () => hasGoogleWalletConfig()
    ? "On an Android phone the same spot has \"Add to Google Wallet\" instead, and a card you've just made shows it above Show QR until you tap it or its X: the pass has your name, title, phone and email and a QR that opens your card."
    : "On an Android phone there is no Apple Wallet, so the option isn't shown, and there is no Google Wallet pass yet; share the link or the QR.",
};

export const PLACEHOLDER_KEYS = Object.keys(PLACEHOLDERS);

/** Every `{token}` a doc uses, so tests can reject a typo before users see it. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z.]+)\}/g)].map((m) => m[1]);
}

/**
 * Replace `{limit.leads}` and friends with the live value. An unknown token is
 * left alone rather than blanked — a visible `{typo}` in an answer is a bug
 * someone reports, whereas a silently empty sentence reads as a real answer.
 */
export function fillPlaceholders(text: string, opts?: { native?: boolean }): string {
  return text.replace(/\{([a-zA-Z.]+)\}/g, (whole, key: string) => {
    if (opts?.native && key.startsWith("price.")) return whole;
    return PLACEHOLDERS[key]?.() ?? whole;
  });
}

/**
 * Customer-facing names for every CRM integration.
 *
 * Typed as an exhaustive Record over CrmProviderKey ON PURPOSE: adding a
 * provider to that union without naming it here fails `tsc`, so a new
 * integration cannot ship with the support bot unaware of it.
 */
export const CRM_PROVIDER_NAMES: Record<CrmProviderKey, string> = {
  google: "Google Contacts",
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
  highlevel: "GoHighLevel",
    salesforce: "Salesforce",
};

/** Every card template that actually exists, straight from the style presets. */
export function templateList(): string {
  return Object.entries(META)
    .map(([key, meta]) => `${meta.name} (${key}) — ${meta.blurb}`)
    .join("\n  - ");
}

/** Named integrations, plus the two escape hatches that aren't CRM connections. */
export function integrationList(): string {
  return [...Object.values(CRM_PROVIDER_NAMES), "Zapier", "CSV export"].join(", ");
}

/**
 * The pricing block. Public — the marketing assistant may quote all of it.
 * NEVER include this in a native-app prompt; `buildPrompt` enforces that.
 */
export function pricingFacts(): string {
  return `PRICING (USD — these are the only prices that exist; never invent discounts, promos, or other numbers):
- Free — $0. ${PLAN_DESCRIPTIONS.free}
  Includes: ${PLAN_FEATURES.free.join("; ")}
- Pro — ${usd(PLAN_PRICES.PRO_MONTHLY_CENTS)}/month, or ${usd(PLAN_PRICES.PRO_ANNUAL_CENTS)}/year (~10% off). ${PLAN_DESCRIPTIONS.pro}
  Includes: ${PLAN_FEATURES.pro.join("; ")}
- Office (teams) — ${usd(PLAN_PRICES.OFFICE_MONTHLY_PER_SEAT_CENTS)}/month per seat, or ${usd(PLAN_PRICES.OFFICE_ANNUAL_PER_SEAT_CENTS)}/year per seat. ${PLAN_DESCRIPTIONS.office}
  Minimum ${PLAN_LIMITS.OFFICE_MIN_SEATS} seats. Includes: ${PLAN_FEATURES.office.join("; ")}
- Free is free forever and does NOT include Pro features. Subscribing to Pro starts with a ${TRIAL_DAYS}-day free trial: a card is collected at checkout and billing begins automatically when the trial ends unless it is cancelled. There is no automatic trial for Free signups. Payments run through Stripe; cancel anytime and access continues to the end of the paid period.`;
}

/**
 * Limits only — no prices, no upgrade language. This is the version the native
 * iOS shell is allowed to see, so it can still answer "why did my leads stop?"
 * without ever pointing at a way to pay.
 */
export function limitFacts(): string {
  return `PLAN LIMITS (the real enforced numbers):
- Free: ${PLAN_LIMITS.FREE_CARD_LIMIT} card; ${PLAN_LIMITS.FREE_LEADS_PER_MONTH} new leads per month; ${PLAN_LIMITS.FREE_MAX_LINKS} additional Swift Links buttons. The monthly meters reset on the 1st and are counted per ACCOUNT, so deleting a card does not reset them.
- Leads captured beyond the monthly cap are still captured and stored — they are hidden until the account is on a paid plan, never discarded.
- Pro and Office remove all of those limits.
- The AI business-card scanner is Pro-only. There is no free scan allowance.
- AI-written follow-ups (AI follow-up drafts) are Pro-only. Free gets none — there is no monthly AI allowance.
- Office requires at least ${PLAN_LIMITS.OFFICE_MIN_SEATS} seats.
- Referral and promo rewards grant ${FREE_MONTH_DAYS} days of Pro at a time.`;
}

/** The live product surface, derived so a new template or CRM shows up free. */
export function surfaceFacts(): string {
  return `CARD TEMPLATES currently available (all templates are available on every plan):
  - ${templateList()}

INTEGRATIONS currently available (Pro and Office): ${integrationList()}.`;
}

/**
 * Where things are, taken from the guided tours.
 *
 * The tours are the one description of the UI the team already keeps current —
 * a step that points at a moved element breaks the tour visibly, so they get
 * fixed. Reading them here means "where do I find X" answers inherit that
 * upkeep instead of needing their own. Each step names the page it lives on and
 * what the thing is for, which is exactly the shape of a support answer.
 */
function tourMap(steps: TourStep[]): string {
  return steps
    .map((s) => `- ${s.title} — on ${s.path}${s.section ? ` (Settings → ${s.section})` : ""}: ${s.body}`)
    .join("\n");
}

export function uiMapFacts(scope: "app" | "office-admin"): string {
  const app = `WHERE THINGS ARE IN THE APP (from the in-product guided tour — these page paths and descriptions are current):
${tourMap(TOUR_STEPS)}`;
  if (scope === "app") return app;
  return `WHERE THINGS ARE IN THE ADMIN CONSOLE (from the admin guided tour):
${tourMap(ADMIN_TOUR_STEPS)}

${app}`;
}

/**
 * The whole derived block, in the order an assistant should read it.
 * `commerce: false` yields the native-safe variant (limits, no prices).
 *
 * Visitors get no UI map: they are not inside the app, and a tour of screens
 * they cannot reach would crowd out the answers they actually came for.
 */
export function derivedFacts(opts: { commerce: boolean; audience?: Audience }): string {
  const audience = opts.audience ?? "user";
  // The limits block goes to EVERY surface — it is price-free, and it carries
  // the enforcement detail ("captured but hidden, never discarded") that
  // answers most of the questions caps generate. Only the pricing block is
  // withheld from native sessions.
  const blocks = [limitFacts(), ...(opts.commerce ? [pricingFacts()] : []), surfaceFacts()];
  if (audience !== "visitor") {
    blocks.push(uiMapFacts(audience === "office-admin" ? "office-admin" : "app"));
  }
  return blocks.join("\n\n");
}
