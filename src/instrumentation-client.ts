import type * as SentryTypes from "@sentry/nextjs";
import { sentryEnabled } from "@/lib/sentry-options";

// ── Browser observability ────────────────────────────────────────────────────
//
// Runs before the app becomes interactive, so an error during hydration is
// caught too (see Next's instrumentation-client docs). Replaces the older
// sentry.client.config.ts convention.
//
// MONITORING ONLY, and additive: ClientErrorReporter → /api/client-error keeps
// working exactly as before. That path is our own, stays inside our stack, and is
// deliberately left as the primary signal; Sentry adds grouping, release
// attribution and performance data on top.
//
// No session replay (see sentry-options): on a contacts page the DOM IS the
// customer's contact list.
//
// ── WHY THE SDK IS LOADED DYNAMICALLY (performance audit, 2026-09-14) ────────
//
// `import * as Sentry from "@sentry/nextjs"` at the top of this file put the
// WHOLE SDK into rootMainFiles — the chunk set every single page loads before
// it can hydrate. Measured on production: 453 kB of raw JavaScript, 141 kB over
// the wire, 41% of all the JS on the site, on the marketing homepage, on
// /login, and on every public card and Swift Links page a stranger opens after
// a tap.
//
// And none of it ran. There is no NEXT_PUBLIC_SENTRY_DSN in the Vercel
// production environment (checked: no SENTRY_* var exists at all), so
// `sentryEnabled` is false, `Sentry.init` was never called, and every visitor
// was downloading, parsing and compiling a monitoring SDK that then did
// nothing. On a mid-range phone that parse alone is a measurable slice of
// time-to-interactive.
//
// A static import cannot be tree-shaken away by a runtime flag, so the fix is
// to make the load itself conditional. Now:
//   • DSN absent  → the SDK chunk is never even requested. Zero bytes.
//   • DSN present → it loads as its own chunk right after hydration, off the
//     critical path. Errors thrown in that first moment are still caught, by
//     the buffer below.
//
// Turning Sentry on is unchanged: set NEXT_PUBLIC_SENTRY_DSN and redeploy.
// Nothing else about the configuration moved — sentry-options.ts still owns the
// PII contract and the sample rates for all three runtimes.

/**
 * Router transitions that happened before the SDK finished loading.
 *
 * Next calls `onRouterTransitionStart` synchronously and expects a stable
 * export, so it cannot wait for a dynamic import. Holding the arguments and
 * replaying them means a navigation during the load window is still measured
 * instead of silently dropped — the one behaviour a lazy load could otherwise
 * lose.
 */
type TransitionArgs = Parameters<typeof SentryTypes.captureRouterTransitionStart>;
let realTransitionStart: typeof SentryTypes.captureRouterTransitionStart | null = null;
const pendingTransitions: TransitionArgs[] = [];

if (sentryEnabled) {
  // Deliberately not awaited: this module is evaluated on the critical path and
  // must not hold up hydration. Any failure to load monitoring is silent by
  // design — it must never be the reason a page does not work.
  void (async () => {
    try {
      const [Sentry, { baseSentryOptions }] = await Promise.all([
        import("@/lib/sentry-client-sdk"),
        import("@/lib/sentry-options"),
      ]);

      Sentry.init({
        ...baseSentryOptions(),

        // Web vitals + navigation timing for real users. This is the "page load
        // times" half of performance monitoring; the server half comes from
        // instrumentation.ts.
        integrations: [Sentry.browserTracingIntegration()],

        // Only trace requests to our own origin. Without this, Sentry attaches
        // tracing headers to third-party calls (Stripe, Supabase, Google), which
        // both leaks a trace id and can trip their CORS checks.
        tracePropagationTargets: [/^\//, /^https:\/\/swiftcard\.me/],
      });

      realTransitionStart = Sentry.captureRouterTransitionStart;
      for (const args of pendingTransitions.splice(0)) realTransitionStart(...args);
    } catch {
      /* monitoring is optional; the app is not */
    }
  })();
}

/**
 * App Router navigation tracking, so a slow client-side route change is visible
 * as a transaction rather than disappearing.
 *
 * Exported unconditionally — Next expects a stable export. Inert when Sentry is
 * disabled, and buffered while it is still loading.
 */
export const onRouterTransitionStart = (...args: TransitionArgs) => {
  if (realTransitionStart) return realTransitionStart(...args);
  if (sentryEnabled) pendingTransitions.push(args);
};
