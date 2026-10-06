import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Security headers applied to every response. Deliberately conservative so
// nothing legitimate breaks:
//  - HSTS forces HTTPS (the site is HTTPS-only on Vercel already).
//  - X-Frame-Options + CSP frame-ancestors block clickjacking — no other site
//    can iframe SwiftCard (e.g. overlaying a fake "Save Contact" on a public
//    card page). `frame-ancestors 'self'` is the ONLY CSP directive set, so it
//    can't break script/style/third-party loading (Stripe, Google, Supabase).
//  - nosniff stops MIME-type confusion attacks.
//  - Referrer-Policy trims what we leak to outbound links.
//  - Permissions-Policy allows same-origin camera (the card scanner needs it)
//    and geolocation, disables microphone, and opts out of the Topics API.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  // ── Client router cache ────────────────────────────────────────────────────
  //
  // `dynamic` defaults to 0 in Next 15+, and every portal page is dynamic (each
  // one reads the session). So Home → Contacts → Home re-fetched and re-rendered
  // the dashboard from the server BOTH ways, showing a full skeleton each time.
  // Tab switching could never feel instant, which is most of what "the app
  // doesn't feel native" actually is.
  //
  // 30s, not longer: these screens show leads and view counts, and a stale
  // contact list is its own bug. 30 seconds covers the real pattern — bouncing
  // between tabs while doing one thing — and anything older refetches. Newly
  // captured leads still arrive immediately, because the capture path pushes a
  // notification rather than relying on the list being fresh.
  //
  // Back/forward is unaffected by this setting (Next always restores those from
  // cache to preserve scroll position), so this only changes forward taps.
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  // The per-card preview route draws the brand picture (lib/brand-og) at
  // request time when a card can't be shown, reading these from public/.
  // public/ is not part of a function bundle unless named here.
  outputFileTracingIncludes: {
    "/card/[username]/opengraph-image": ["./public/og/**", "./public/brand-icon-192.png"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Canonicalize the domain: send www.swiftcard.me → apex so search engines
      // don't index two copies of every page. 308 keeps the method + is cached.
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.swiftcard.me" }],
        destination: "https://swiftcard.me/:path*",
        permanent: true,
      },
      // swiftcard.app is ours too (registered at Porkbun, attached to this
      // Vercel project 2026-06-24) but its DNS pointed at an old Google-hosted
      // vCard prototype until 2026-09-23. Once it points here, it must be a
      // redirect, not a second copy of every page under a different name.
      {
        source: "/:path*",
        has: [{ type: "host", value: "swiftcard.app" }],
        destination: "https://swiftcard.me/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.swiftcard.app" }],
        destination: "https://swiftcard.me/:path*",
        permanent: true,
      },
      // /signup is the most-guessed URL for a product like this; land it on the
      // real card-creation flow instead of a 404.
      {
        source: "/signup",
        destination: "/cards/new",
        permanent: false,
      },
      // The settings hub lives at /settings/flows — a slug that names one of its
      // seven sections rather than the page. Nothing in the product links to a
      // bare /settings, but it is the obvious thing to type or to guess from the
      // breadcrumb, and it 404'd (audit 2026-09-29). Not permanent: the hub may
      // yet move to /settings itself, and a cached 308 would outlive the fix.
      {
        source: "/settings",
        destination: "/settings/flows",
        permanent: false,
      },
    ];
  },
};

// ── Sentry build integration (monitoring only) ───────────────────────────────
//
// Wraps the config above WITHOUT altering it: every header and redirect is
// unchanged. All this adds is build-time source-map handling so a minified
// production stack trace maps back to real source.
//
// The build must never fail because monitoring isn't configured. Source-map
// upload needs SENTRY_AUTH_TOKEN, which only exists on Vercel — so it's gated on
// the token being present. Without it (local builds, forks, CI) the wrapper is a
// pass-through and `next build` behaves exactly as before.
const uploadSourceMaps = !!process.env.SENTRY_AUTH_TOKEN && !!process.env.SENTRY_ORG && !!process.env.SENTRY_PROJECT;

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Don't turn the build log into noise; errors still surface.
  silent: true,
  telemetry: false,

  // Skip the upload step entirely when unconfigured, rather than letting the
  // plugin try and warn on every single build.
  sourcemaps: { disable: !uploadSourceMaps },

  // Source maps are uploaded to Sentry, then deleted from the deployed output so
  // they are never publicly served — readable traces for us, not for everyone.
  widenClientFileUpload: true,

  // Tree-shake the SDK's own debug logger out of the client bundle.
  disableLogger: true,
});
