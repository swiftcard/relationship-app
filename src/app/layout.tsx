import type { Metadata, Viewport } from "next";
import { Geist, Bricolage_Grotesque } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import AccountIsolationGuard from "@/components/AccountIsolationGuard";
import NativeAppBridge from "@/components/NativeAppBridge";
import GuidedTourHost from "@/components/GuidedTourHost";
import GlobalAiConsent from "@/components/GlobalAiConsent";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import SiteAnalytics from "@/components/SiteAnalytics";
import ClientErrorReporter from "@/components/ClientErrorReporter";
import { ORGANIZATION_JSONLD, WEBSITE_JSONLD, jsonLdScript } from "@/lib/brand";
import { APP_STORE_ID } from "@/lib/app-store";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
// The marketing DISPLAY face (design batch 2, 2026-09-11). Headlines on the
// site set in Bricolage Grotesque; body copy, the app and every card template
// stay on Geist. Only .rd-display / .rd-h2 in globals.css read this variable,
// so nothing inside the product can pick it up by accident. Variable font,
// one file, optical-size axis so the big sizes get the display cut.
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", axes: ["opsz"], display: "swap" });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

const SITE_TITLE = "SwiftCard: The digital business card that shares everything";
const SITE_DESC =
  "Build your SwiftCard once and share it by tap, QR code, Apple Wallet, or link — with built-in lead capture and automatic follow-up.";

export const metadata: Metadata = {
  // Required so file-based opengraph-image URLs resolve to ABSOLUTE links on the
  // production domain — otherwise share previews (iMessage, WhatsApp, social)
  // can point at the wrong host (or localhost) and fail to render the card.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"),
  // Plain string: untitled pages (homepage/marketing) use this; pages that set
  // their own title override it (they already include "— SwiftCard"). No
  // template — appending one would double the brand ("… SwiftCard · SwiftCard").
  title: SITE_TITLE,
  description: SITE_DESC,
  applicationName: "SwiftCard",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SwiftCard",
  },
  // iOS Smart App Banner (Safari's native "open in the App Store" strip).
  // Gated on the same switch as every other App Store surface: absent until
  // NEXT_PUBLIC_APP_STORE_URL is set, live everywhere the moment it is.
  ...(APP_STORE_ID ? { itunes: { appId: APP_STORE_ID } } : {}),
  // Site-wide link-preview card (the per-card pages override this with their own
  // dynamic opengraph-image). The root src/app/opengraph-image.tsx supplies the
  // image for the homepage and all marketing pages.
  openGraph: {
    type: "website",
    siteName: "SwiftCard",
    url: APP_URL,
    title: SITE_TITLE,
    description: SITE_DESC,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
  },
  // Google Search Console site verification. Search Console's "HTML tag" method
  // wants <meta name="google-site-verification" content="…"> on the homepage;
  // this renders it once the token is set and emits nothing at all until then.
  // Set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION in Vercel (Production) to the
  // content value Search Console shows, redeploy, then press Verify. Keep it
  // set afterwards — Google re-checks periodically and un-verifies if it's gone.
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } }
    : {}),
};

export const viewport: Viewport = {
  themeColor: "#030712",
  // THE WHITE BARS AT THE TOP AND BOTTOM OF THE APP.
  // This used to be appended to the viewport meta by NativeAppBridge in a mount
  // effect. Until that effect ran, the webview did not extend beneath the notch
  // or the home indicator, so the native view behind it — white by default —
  // showed as bars above the status bar and below the tab bar. Server-rendering
  // it means the webview is edge-to-edge in the very first painted frame, and
  // env(safe-area-inset-*) does the insetting from there.
  //
  // Safe for the website: viewport-fit=cover only changes anything for a page
  // that positions content into the safe areas, and every env(safe-area-inset-*)
  // rule in globals.css is scoped to html.native-app. In Safari the browser
  // chrome occupies those areas anyway.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the inline script below mutates <html> (adds
    // .sc-js + the saved theme attr) BEFORE React hydrates — expected mismatch.
    <html lang="en" className={`${geist.variable} ${display.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {/* NativeSplash (the shell's launch animation) deliberately does NOT
            live here anymore. It reads headers()/cookies(), and a dynamic API
            in the ROOT layout forced EVERY page in the app — the homepage,
            /pricing, /privacy, every marketing and SEO page — to server-render
            in a lambda on every request instead of serving as static HTML from
            the CDN. The shell never sees those pages (src/proxy.ts redirects
            "/" away from the shell before any HTML is sent), so the splash now
            renders from the layouts of the two pages a cold launch can actually
            land on: /dashboard and /login. */}
        {/* Apply the saved app theme before paint (no dark→light flash), and
            mark that JS is running so scroll-reveals only hide when they can be
            un-hidden — with JS off, content stays fully visible. next/script
            beforeInteractive keeps the raw <script> out of the React tree
            (a literal <script> logs console errors on every client render).

            This also decides, BEFORE FIRST PAINT, whether we are the native
            shell — and it has to happen here rather than in React. Two reasons:
              • `html.native-app` scopes the entire native design layer in
                globals.css. Added from an effect (as NativeAppBridge does) the
                shell paints one frame of website chrome first, which is exactly
                the "wrapped web page" tell.
              • The shell's start URL is "/", which renders the MARKETING
                homepage — hero, signup CTA, footer link columns. That must
                never be a screen in the app: it is the wrong first impression,
                and App Review guideline 4.2 rejects apps that are primarily a
                repackaged website. Redirecting from a React effect would still
                flash the hero; redirecting here means it is never painted.
            Capacitor injects window.Capacitor via a document-start user script,
            so it is already present by the time this runs. NativeAppBridge
            re-adds the class on mount as a belt-and-braces fallback. */}
        <Script
          id="sc-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.classList.add('sc-js');" +
              // LIGHT IS THE DEFAULT. The attribute means "light"; its absence
              // means dark, so the test is inverted rather than the meaning:
              // set it unless the user has explicitly stored 'dark'.
              // Anyone who already chose a side keeps it — only visitors with
              // no stored preference move. Still applied before paint, so a
              // light-default user never sees a frame of dark.
              // …except the card builder, which is ALWAYS light (white canvas),
              // even for someone who saved dark (owner, 2026-09-16). Must be
              // decided here, before paint, or a dark-mode phone flashes black.
              // ForceLightTheme keeps it light across client-side navigation.
              "if(localStorage.getItem('sc_theme')!=='dark'||location.pathname.indexOf('/cards/new')===0)document.documentElement.setAttribute('data-sc-theme','light');" +
              // React 19 strips EVERY attribute off <html> when a hydration
              // mismatch makes it client-render the root, so the light theme
              // dropped to dark "at random" (owner, 2026-09-24: going back to
              // the homepage in light mode came up dark). Put back what only
              // this script and the native shell set; the theme only when the
              // saved choice is not dark, so ThemeToggle/ForceLightTheme,
              // which write sc_theme first, keep working.
              "try{new MutationObserver(function(rs){var d=document.documentElement;for(var i=0;i<rs.length;i++){var a=rs[i].attributeName,o=rs[i].oldValue;" +
              "if(a==='class'){if(o&&/(^|\\s)native-app(\\s|$)/.test(o)&&!d.classList.contains('native-app'))d.classList.add('native-app');}" +
              "else if(a==='data-sc-mac'){if(o!==null&&!d.hasAttribute(a))d.setAttribute(a,o);}" +
              "else if(a==='data-sc-theme'&&!d.hasAttribute(a)){var t=null;try{t=localStorage.getItem('sc_theme');}catch(e){}if(t!=='dark')d.setAttribute(a,'light');}}})" +
              ".observe(document.documentElement,{attributes:true,attributeOldValue:true,attributeFilter:['class','data-sc-theme','data-sc-mac']});}catch(e){}" +
              // Detect the shell from window.webkit.messageHandlers.bridge, the
              // NATIVE message handler WKWebView installs before any page script
              // runs. window.Capacitor alone is not reliable here: it is created
              // by Capacitor's own injected bundle, so whether it exists yet is a
              // race against this script — and when it lost, the redirect fell
              // through to a React mount effect and the marketing hero flashed
              // before the app appeared. This is the same signal @capacitor/core
              // uses internally (getPlatformId). Capacitor is still checked as a
              // fallback for any future shell that exposes only that.
              "var W=window.webkit&&window.webkit.messageHandlers;" +
              "var C=window.Capacitor;" +
              "if((W&&W.bridge)||(C&&(C.isNativePlatform?C.isNativePlatform():C.isNative))){" +
              "document.documentElement.classList.add('native-app');" +
              // Mark the shell for the SERVER: src/proxy.ts redirects "/" before
              // any homepage HTML is sent when it sees this cookie (or the
              // SwiftCardApp UA of future builds). The client redirect below
              // still handles the very first launch — which is also what plants
              // the cookie — but every launch after that skips loading the
              // homepage entirely: no dark interstitial, one navigation, not two.
              "document.cookie='sc_shell=1;path=/;max-age=31536000;samesite=lax';" +
              // NOTE: this used to append maximum-scale=1, user-scalable=no to
              // the viewport meta, believing it killed the focus auto-zoom. It
              // did not. iOS zooms on focus because the CONTROL's font-size is
              // under 16px, and the viewport flags do not change that decision —
              // they only remove the user's ability to pinch back OUT once it
              // has happened, which is exactly the "stuck zoomed in, can't get
              // back" report. The real fix lives in globals.css (16px form
              // controls on coarse pointers); disabling zoom is also a WCAG
              // 1.4.4 failure, so nothing here touches the viewport now.
              "if(location.pathname==='/'){" +
              // Hide before navigating so the homepage cannot paint even one
              // frame during the redirect. Scoped to the shell on "/" only, so
              // the website never hides anything.
              "document.documentElement.style.visibility='hidden';" +
              "location.replace('/dashboard');" +
              "}}}catch(e){}",
          }}
        />
        {/* Brand structured data for Google Search (JSON-LD) — see lib/brand.ts.
            Organization feeds the knowledge/brand box (name, logo, operator);
            WebSite is what decides the SITE NAME shown above the URL
            in a result, which otherwise gets guessed from the <title>. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(ORGANIZATION_JSONLD) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(WEBSITE_JSONLD) }}
        />
        <ServiceWorkerRegistrar />
        {/* Person-scoped browser state (visitor identity, active card, device
            visitor id, push binding) must die the moment a DIFFERENT account is
            the one signed in — see lib/account-state.ts for the whole story. */}
        <AccountIsolationGuard />
        {/* Reports uncaught browser errors / promise rejections to the team. */}
        <ClientErrorReporter />
        {/* Capacitor shell only (no-op on web): universal-link → webview navigation. */}
        <NativeAppBridge />
        <AnalyticsProvider />
        <SiteAnalytics />
        {/* ── Vercel Web Analytics + Speed Insights (monitoring only) ────────
            Loaded as plain scripts rather than via @vercel/analytics and
            @vercel/speed-insights. Those packages are thin wrappers that inject
            exactly these two URLs, and both declare an OPTIONAL peer on
            @sveltejs/kit which npm speculatively resolves — dragging in a Vite 8
            requirement that collides with Vitest's Vite 7 and leaves a lockfile
            `npm ci` rejects. Two script tags get the identical result with no
            dependency and no lockfile risk, which is the same reasoning
            lib/report-error.ts already documents for staying SDK-free.

            Vercel serves both paths from its own edge for this project once the
            features are enabled in the dashboard — nothing to host. Production
            only: on localhost and preview they'd 404, and preview traffic is us.

            afterInteractive so measurement never competes with first paint. */}
        {/* SPEED INSIGHTS ONLY — the Web Analytics tag is deliberately absent.
            Vercel serves /_vercel/<feature>/script.js only once that feature is
            enabled in the dashboard. Speed Insights is on and returns 200. Web
            Analytics is NOT, so its tag 404'd on every production page load for
            every visitor, and logged a MIME-type console error on top ("Refused
            to execute script … 'text/html'"). Shipping a guaranteed 404 to
            everyone to hold a slot for a feature nobody turned on is a bad trade.

            To turn Web Analytics on: enable it in Vercel → Analytics, then add
            <Script src="/_vercel/insights/script.js" strategy="afterInteractive" />
            back here. Nothing else is required — see MONITORING.md. */}
        {process.env.NEXT_PUBLIC_VERCEL_ENV === "production" && (
          <Script src="/_vercel/speed-insights/script.js" strategy="afterInteractive" />
        )}
        {children}
        {/* pausePathPrefix: this instance lives in the ROOT layout, so it is
            alive inside /office/admin too — where AdminGuidedTour is the tour
            that belongs. Without pausing, an unfinished dashboard tour pushed
            the visitor straight back to /dashboard the moment they opened Admin,
            which made the console unreachable for a brand-new Office owner. */}
        <GuidedTourHost pausePathPrefix="/office/admin" />
        {/* Native-only AI-consent ask, mounted globally so it appears on the
            FIRST signed-in screen inside the app — not just the pages that
            remembered to mount it, and never on a Get Started step (card →
            account → plan). Renders and fetches nothing on the web. */}
        <GlobalAiConsent />
      </body>
    </html>
  );
}
