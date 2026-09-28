// ── A card link opens in the app ────────────────────────────────────────────
//
// Owner, 2026-09-23: opening your OWN card on your own phone must never count
// as a view ("a huge legal issue"). Production showed the gap: an owner's
// iPhone Safari — never signed in to swiftcard.me — was recorded as a stranger
// eight times in a week, on his own cards. The app is signed in and recognised
// (lib/self-traffic: session + sc_device); Safari is not. Cards live at the
// TOP LEVEL (swiftcard.me/<name>), which the old list never covered, so a card
// link tapped in Messages, a QR scanned with the Camera or an NFC tag tapped
// all opened Safari. Now they open the app on any iPhone that has it.
//
// Apple's "components" form (iOS 13+) is used for that: first match wins, so
// the includes come first, then every top-level page and file of the SITE is
// excluded by name, and whatever single segment is left is a card. The old
// "paths" list stays for older iOS, which ignores "components".
//
// Every top-level route in src/app and every file in public/ MUST be in
// SITE_SEGMENTS — otherwise tapping, say, a /pricing link on an iPhone with
// the app would open the app. tests/aasa-card-links.test.ts fails when a new
// one is added without being listed here.
export const SITE_SEGMENTS = [
  // app routes
  "account-deleted", "admin", "api", "auth", "blog", "business-card-view-tracking", "cards", "checkout",
  "company", "compare", "contact", "contacts", "dashboard", "email", "for", "grow", "link-in-bio-with-analytics",
  "linkedin-connected", "login", "office", "onboarding", "press", "preview", "pricing", "privacy", "products", "profile",
  "r", "review", "settings", "share", "sms-consent", "sms-terms", "splash-preview", "templates", "terms",
  "testimonials", "unsubscribe", "upgrade", "welcome", "signup",
  // generated metadata files
  "robots.txt", "sitemap.xml", "manifest.webmanifest", "opengraph-image", "apple-icon.png", "icon.png", "favicon.ico",
  // public/
  "bimi-logo.svg", "brand-icon-192.png", "brand-icon.png", "demo", "google9d510ed9f03ed408.html", "hero-bg-poster.jpg",
  "hero-bg.mp4", "icon-192.png", "icon-512.png", "marketing", "showcase", "sw.js", "wallet",
  // framework
  "_next", ".well-known",
] as const;

export function aasaComponents() {
  return [
    // What always opened in the app, first.
    { "/": "/card/*" },
    { "/": "/links/*" },
    { "/": "/join/*" },
    { "/": "/auth/callback" },
    // The site itself stays in the browser.
    { "/": "/", exclude: true },
    ...SITE_SEGMENTS.flatMap((seg) => [
      { "/": `/${seg}`, exclude: true },
      { "/": `/${seg}/*`, exclude: true },
      { "/": `/${seg}.*`, exclude: true },
    ]),
    // A single top-level segment that is not the site: a card.
    { "/": "/*" },
  ];
}
