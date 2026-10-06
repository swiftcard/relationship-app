// ── Product event tracking ──────────────────────────────────────────────────
// The conversion funnel (visit → build → publish → account → plan → pay).
//
// Events go to OUR OWN database (api/events → product_events → the funnel on
// /admin/analytics) and, if a key is ever configured, to PostHog as well. The
// first-party sink is the one that matters: PostHog was never configured in
// production, so for the whole life of this file every track() call was a
// no-op and the funnel showed nothing. First-party also survives the ad
// blockers that eat third-party analytics scripts, and needs no consent
// banner, since nothing leaves our own systems.
//
// Design rules, in order of importance:
//
//  1. NEVER block a user action. Every call here is fire-and-forget. An event
//     that fails must not stop a card from publishing or a checkout from
//     starting. `track()` returns void, is safe to call without awaiting, and
//     swallows everything.
//  2. Names are a closed union, not free strings. A typo'd event name is an
//     event you never see and a funnel that silently under-reports, so the
//     compiler owns the vocabulary — and the ingest route rejects any name
//     that isn't in it.
//  3. No PII. Never pass a name, email, phone, or lead content through here.
//     Enums and counts only — see EventProps. The ingest route allow-lists the
//     keys it stores, so this rule is enforced server-side too.

import type { PostHog } from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

// ── The vocabulary ───────────────────────────────────────────────────────────
// One name per meaningful funnel step. Ordered by where they sit in the journey
// so the list reads as the funnel it measures.
export const EVENTS = [
  // Top of funnel. Fired ONLY on the funnel pages in FUNNEL_PATHS below — not
  // on card or Swift Links pages, which are counted properly in card_views and
  // would otherwise be most of this table.
  "page_viewed",

  // CTA surface
  "cta_clicked",

  // Card creation → publish → share
  "card_creation_started",
  "card_creation_completed",
  "card_published",
  "card_shared",
  "qr_downloaded",
  "wallet_pass_added",

  // Account
  "account_creation_started",
  "account_creation_completed",

  // Plan → pay
  "plan_selected",
  "checkout_started",
  "checkout_completed",

  // Monetisation
  "upgrade_prompt_viewed",
  "upgrade_started",

  // Office
  "office_seat_added",
  "employee_invited",
  "invitation_accepted",

  // Leads
  "lead_captured",
  "lead_contacted",

  // Retention / growth
  "subscription_cancel_started",
  "referral_link_copied",

  // Email preference centre. `variant` carries the opt-out source
  // ("footer" | "one_click_header") and the survey answer — both low
  // cardinality, neither an id.
  "email_preferences_saved",
  "email_paused_30d",
  "email_digest_only_chosen",
  "email_full_unsubscribe",
  "email_unsubscribe_reason_given",
] as const;

export type EventName = (typeof EVENTS)[number];

// Written ONLY by our own server routes, straight into product_events — never
// accepted from a browser (/api/events validates against EVENTS above), so a
// visitor cannot forge them.
//   campaign_link_clicked — a real tap on /go/<code> (Instagram bio, a message
//   the Instagram bot sent, an ad). props: { code }.
export const SERVER_EVENTS = ["campaign_link_clicked"] as const;

// Deliberately narrow. Everything here is an id, an enum, or a count — nothing
// that identifies a human. PostHog already attaches device/timestamp/campaign
// from the pageview, so we don't duplicate them.
export type EventProps = {
  /** Where the click happened, e.g. "homepage_hero". Pairs with `cta`. */
  placement?: string;
  /** The button's stable name, e.g. "create_your_card" — NOT its visible label,
   *  so A/B-testing the label doesn't break the funnel. */
  cta?: string;
  plan?: "free" | "pro" | "office";
  interval?: "monthly" | "annual";
  seats?: number;
  /** Which gated feature triggered an upgrade prompt, e.g. "extra_swiftlink". */
  feature?: string;
  cardId?: string;
  orgId?: string;
  /** How a card was shared: "copy_link" | "qr" | "wallet" | "email" | "sms" | … */
  method?: string;
  /** Free-form but LOW cardinality — never an id or user input. */
  variant?: string;
};

// ── First-party sink ─────────────────────────────────────────────────────────

const SESSION_KEY = "sc_evt_session";
const INTERNAL_KEY = "sc_evt_internal";

/**
 * A random id for THIS visit, used only to group one visitor's steps into a
 * funnel. sessionStorage, not a cookie: it dies with the tab, never crosses a
 * browser session, and is never joined to an account.
 */
function sessionKey(): string | undefined {
  try {
    let k = sessionStorage.getItem(SESSION_KEY);
    if (!k) {
      k = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)).slice(0, 36);
      sessionStorage.setItem(SESSION_KEY, k);
    }
    return k;
  } catch {
    return undefined; // Private mode / storage blocked — events still count.
  }
}

/**
 * Has this browser been told it belongs to us?
 *
 * The server marks an event internal when it carries an admin or demo session.
 * That alone would miss the case that pollutes the numbers most: testing the
 * product SIGNED OUT — building a guest card to check the wizard — which is
 * indistinguishable from a real visitor. So the first internal answer is
 * remembered here and sent with every later event, signed in or not.
 */
export function internalFlag(): boolean {
  try {
    return localStorage.getItem(INTERNAL_KEY) === "1";
  } catch {
    return false;
  }
}

function sendFirstParty(name: EventName, props: EventProps, pathOverride?: string): void {
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // keepalive so an event fired on the click that navigates away still
        // lands — this is the whole point of measuring a funnel.
        keepalive: true,
        body: JSON.stringify({
          name,
          props,
          sessionKey: sessionKey(),
          path: pathOverride ?? window.location.pathname,
          internal: internalFlag(),
        }),
      });
      const data = (await res.json().catch(() => null)) as { internal?: boolean } | null;
      if (data?.internal) {
        try { localStorage.setItem(INTERNAL_KEY, "1"); } catch { /* storage blocked */ }
      }
    } catch {
      // Offline, blocked, or the route is down: the user must never know.
    }
  })();
}

let ph: PostHog | null = null;
let loadPromise: Promise<PostHog | null> | null = null;

/**
 * Resolves once the page has loaded and the main thread is free.
 *
 * The SDK is ~225 KB of JavaScript. Imported at hydration (the first pageview
 * effect), it downloaded and compiled in exactly the window where a phone is
 * trying to make the page respond to its first tap (perf audit 2026-10-06).
 * Nothing is lost by waiting: every capture awaits getPostHog(), so events
 * fired before this resolves are sent in order once it does, and the
 * first-party sink — the one that matters — never waits at all.
 */
function whenIdleAfterLoad(): Promise<void> {
  return new Promise((resolve) => {
    const idle = () => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 4000 });
      else setTimeout(resolve, 1500);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  });
}

// Shared loader so AnalyticsProvider and track() can't race into two init()s.
async function getPostHog(): Promise<PostHog | null> {
  if (!KEY) return null;
  if (ph) return ph;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        await whenIdleAfterLoad();
        const mod = await import("posthog-js");
        mod.default.init(KEY, {
          api_host: HOST,
          // Pageviews are captured manually so SPA navigations count exactly once.
          capture_pageview: false,
          capture_pageleave: true,
          autocapture: true,
          // Only spend a person profile on identified users — cheaper, less noise.
          person_profiles: "identified_only",
          // Surveys render into a SHADOW ROOT with their own stylesheet, at
          // 11–14px, including an open-text <textarea>. A shadow boundary is
          // exactly what globals.css cannot cross, so the 16px form-control
          // floor does not reach those fields and focusing one zooms the page —
          // the bug the floor exists to prevent, reintroduced by a feature
          // that is ON by default and needs no code change to appear.
          // Nothing in the product uses PostHog surveys today; turning them on
          // means solving the shadow-DOM sizing first.
          disable_surveys: true,
        });
        ph = mod.default;
        return ph;
      } catch {
        return null; // SDK blocked (ad-blocker, offline) → stay silent forever
      }
    })();
  }
  return loadPromise;
}

/**
 * Fire a product event. Fire-and-forget by design: never await this in a click
 * handler, and never gate navigation on it.
 */
export function track(name: EventName, props: EventProps = {}): void {
  if (typeof window === "undefined") return; // server components / SSR: no-op
  sendFirstParty(name, props);
  if (!KEY) return; // PostHog is optional; the first-party sink above is not.
  void (async () => {
    try {
      const client = await getPostHog();
      client?.capture(name, props);
    } catch {
      // Analytics must never surface to a user.
    }
  })();
}

/** Convenience for the most common event, so call sites stay one line. */
export function trackCta(cta: string, placement: string, props: EventProps = {}): void {
  track("cta_clicked", { cta, placement, ...props });
}

/**
 * Tie events to a user once they're known. Called after sign-in/sign-up.
 * `plan` and `orgId` become person properties so funnels can segment by them.
 */
export function identify(userId: string, props: { plan?: string; orgId?: string } = {}): void {
  if (!KEY || typeof window === "undefined") return;
  void (async () => {
    try {
      const client = await getPostHog();
      client?.identify(userId, props);
    } catch { /* ignore */ }
  })();
}

/** Drop identity on sign-out so the next user isn't merged into the last one. */
export function resetIdentity(): void {
  if (!KEY || typeof window === "undefined") return;
  void (async () => {
    try {
      const client = await getPostHog();
      client?.reset();
    } catch { /* ignore */ }
  })();
}

/**
 * The pages that ARE the funnel. A first-party `page_viewed` is recorded on
 * these and nowhere else.
 *
 * Deliberately a short allow-list rather than "every route": card and Swift
 * Links pages are the highest-traffic routes in the product and already have
 * their own counted, de-duplicated, bot-filtered table (card_views). Letting
 * them in here would make the funnel table mostly visitor traffic, with one
 * row per public username — high cardinality, no new information.
 */
export const FUNNEL_PATHS = ["/", "/pricing", "/upgrade", "/cards/new", "/welcome", "/login", "/dashboard"] as const;

export function isFunnelPath(pathname: string): boolean {
  return (FUNNEL_PATHS as readonly string[]).includes(pathname);
}

/**
 * Manual pageview — used by AnalyticsProvider on every route change.
 *
 * `pathname` comes from usePathname(), which is the router's own committed
 * value. Reading window.location here instead would be trusting that the
 * browser URL has already caught up with the route the effect is reacting to —
 * true today, but the kind of assumption that turns into a page counted under
 * the previous route's name.
 */
export function trackPageview(pathname?: string): void {
  if (typeof window === "undefined") return;
  const path = pathname ?? window.location.pathname;
  // First-party: funnel pages only (see FUNNEL_PATHS).
  if (isFunnelPath(path)) sendFirstParty("page_viewed", {}, path);
  if (!KEY) return;
  void (async () => {
    try {
      const client = await getPostHog();
      client?.capture("$pageview");
    } catch { /* ignore */ }
  })();
}

/**
 * True when the OPTIONAL PostHog leg is configured — for debug surfaces only.
 * Product events are recorded either way: the first-party sink has no key and
 * is never off, so this is not a question of whether tracking works.
 */
export const analyticsEnabled = !!KEY;
