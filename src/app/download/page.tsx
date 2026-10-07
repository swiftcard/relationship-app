import type { Metadata } from "next";
import SiteNav from "@/components/site/SiteNav";
import SiteFooterMini from "@/components/site/SiteFooterMini";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import AppStoreBadge, { GooglePlayBadge } from "@/components/AppStoreBadge";
import { MiniQR } from "@/components/card-templates/MiniQR";
import IpadStoreRedirect from "@/components/download/IpadStoreRedirect";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/app-store";
import "@/app/home.css";

// ── swiftcard.me/download — the page a computer sees ────────────────────────
//
// Phones never reach this file: src/proxy.ts reads the User-Agent and sends an
// iPhone to the App Store and an Android phone to Google Play before any HTML
// (lib/download-link). What lands here is a desktop browser, an iPad posing as
// a Mac (fixed on the client by IpadStoreRedirect), a crawler, or a device
// whose store is not configured. For all of them the honest page is BOTH
// stores plus a QR code of this same address — scan it with the phone and the
// proxy does the routing there.
//
// Both badges, deliberately. Everywhere else the site shows ONE store per
// visitor (globals.css, data-sc-os: a computer gets the App Store), because a
// badge in a header is a hint. Here the visitor came for a download and the
// page cannot see which phone is in their pocket — hiding Google Play from a
// Windows laptop would hide it from every Android owner who browses on one.
// The override is scoped to this page's .hp-download-stores row in home.css;
// the header keeps the site rule.
//
// Static: no cookies()/headers() reads, so it prerenders with the rest of the
// marketing site (see marketing-site-static). The store URLs are build-time env
// (lib/app-store); a badge whose store is unset renders nothing, as always.

export const metadata: Metadata = {
  title: "Download SwiftCard — iPhone, iPad and Android",
  description:
    "Get the SwiftCard app on the App Store or Google Play. Share your digital business card with a tap, keep it in your wallet, and see who viewed it.",
  alternates: { canonical: "/download" },
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

const POINTS: { title: string; desc: string }[] = [
  { title: "Share with a tap", desc: "NFC, QR code or a link — the person you meet saves your contact in one tap, no app needed on their side." },
  { title: "Always in your pocket", desc: "Your card lives in Apple Wallet and on Apple Watch, and works without signal." },
  { title: "Know who looked", desc: "A notification when your card is viewed, and every new contact lands in your dashboard." },
];

export default function DownloadPage() {
  const anyStore = Boolean(APP_STORE_URL || PLAY_STORE_URL);
  return (
    // bg-cream stays only for the native shell's status-bar canvas rule in
    // globals.css (html.native-app:has(main.bg-cream)); .hp paints the page
    // itself white (owner, 2026-09-17: light pages, no cream).
    <main className="hp hp-download sc-canvas-white min-h-screen bg-cream flex flex-col">
      <SiteNav />
      <HomeHeadingReveal />
      {APP_STORE_URL && <IpadStoreRedirect appStoreUrl={APP_STORE_URL} />}

      <section className="hp-page-hero flex-1">
        <div className="relative max-w-3xl mx-auto px-5 sm:px-6 pt-28 sm:pt-36 pb-16 sm:pb-24 w-full text-center" data-hp-head>
          <span className="hp-kicker">Get the app</span>
          <h1 className="rd-display text-[clamp(2.1rem,4.4vw,3rem)] text-slate-900 [text-wrap:balance] mt-4">
            SwiftCard on your phone
          </h1>
          <p className="hp-lede mt-4 max-w-[560px] mx-auto">
            {anyStore
              ? "Free on iPhone, iPad and Android. Everything you can do on the website, with the share sheet, your wallet and notifications built in."
              : "The SwiftCard app is on its way. Until then, everything works in the browser on any phone — your card, your links and your contacts."}
          </p>

          {anyStore && (
            <div className="hp-download-stores mt-8 flex flex-wrap items-center justify-center gap-3">
              <AppStoreBadge size="lg" />
              <GooglePlayBadge size="lg" />
            </div>
          )}

          {anyStore && (
            <div className="mt-12 mx-auto max-w-[560px] rounded-2xl border border-slate-200/80 bg-[#F5F7FB] px-5 py-5 sm:px-6 flex flex-col sm:flex-row items-center gap-5 text-left">
              {/* The QR encodes this very address: the phone that scans it is
                  routed by the proxy to its own store, tags and all. */}
              <MiniQR size={120} url={`${APP_URL}/download`} />
              <div>
                <p className="text-slate-900 text-[1rem] font-semibold">On a computer? Scan with your phone.</p>
                <p className="text-slate-600 text-[0.9375rem] leading-relaxed mt-1">
                  Point your camera at the code and it opens the right store for your phone — App Store on iPhone, Google Play on Android.
                </p>
              </div>
            </div>
          )}

          <ul className="mt-12 grid gap-4 sm:grid-cols-3 text-left">
            {POINTS.map((p) => (
              <li key={p.title} className="hp-card !p-5">
                <p className="text-slate-900 text-[0.9375rem] font-semibold">{p.title}</p>
                <p className="text-slate-600 text-[0.875rem] leading-relaxed mt-1.5">{p.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SiteFooterMini />
    </main>
  );
}
