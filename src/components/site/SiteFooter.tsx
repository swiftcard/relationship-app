import Link from "next/link";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";
import HomeLink from "@/components/site/HomeLink";
import SalesChat from "@/components/site/SalesChat";
import NativeHidden from "@/components/NativeHidden";
import { StoreBadges } from "@/components/AppStoreBadge";
import RateUsLink from "@/components/RateUsLink";

// Marketing footer — real routes only, no invented content.
const COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Digital Cards", href: "/products/digital-cards" },
      { label: "SwiftLinks", href: "/products/swiftlinks" },
      { label: "Swift Signature", href: "/products/email-signatures" },
      { label: "Lead Capture", href: "/products/lead-capture" },
      { label: "Dashboard & Analytics", href: "/products/analytics" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Teams & Offices", href: "/products/teams" },
      { label: "Apple Wallet", href: "/products/wallet" },
      { label: "Apple Watch", href: "/products/watch" },
      { label: "Integrations", href: "/products/integrations" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    // The /for/[slug] vertical landing pages. Linked here so they aren't
    // orphans — pages with no internal links barely rank, and ranking for
    // "digital business card for <industry>" is their entire job.
    title: "Who it's for",
    links: [
      { label: "Real estate agents", href: "/for/real-estate-agents" },
      { label: "Contractors", href: "/for/contractors" },
      { label: "Insurance agents", href: "/for/insurance-agents" },
      { label: "Loan officers", href: "/for/loan-officers" },
      { label: "Lawyers", href: "/for/lawyers" },
      { label: "Photographers", href: "/for/photographers" },
      { label: "Barbers & stylists", href: "/for/barbers-and-stylists" },
      { label: "Car salespeople", href: "/for/car-salespeople" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Preview", href: "/preview" },
      { label: "Templates", href: "/templates" },
      { label: "Why SwiftCard", href: "/testimonials" },
      { label: "About", href: "/about" },
      { label: "Company", href: "/company" },
      { label: "Press", href: "/press" },
      { label: "Contact Us", href: "/contact" },
      { label: "Privacy Policy", href: "/privacy" },
      // "Terms of Service", not "Terms & Legal": A2P 10DLC vetting crawls the
      // registered website (swiftcard.me) for a Terms & Conditions page and
      // matches on conventional anchor text. Campaign rejection 30882 said the
      // T&C could not be verified while this link read "Terms & Legal" — a
      // label a policy scanner has no reason to recognise.
      { label: "Terms of Service", href: "/terms" },
      { label: "SMS Terms", href: "/sms-terms" },
    ],
  },
];

// `light` (owner, 2026-09-17): every marketing page except the homepage sits
// on light backgrounds, so its footer does too. The homepage keeps the dark one.
export default function SiteFooter({ light = false }: { light?: boolean }) {
  const muted = light ? "text-slate-500 hover:text-slate-900" : "text-white/55 hover:text-white";
  return (
    <>
    {/* Site-wide sales chatbot — appears on every marketing page via the footer */}
    {/* App Store 3.1.1: sales chat discusses pricing — never in the native shell. */}
    <NativeHidden><SalesChat /></NativeHidden>
    {/* sc-site-footer: marketing chrome, hidden in the native shell by
        globals.css. Three columns of site links and a "Get started free" CTA
        below every page is the clearest tell that an app is a wrapped website —
        and the surface App Review reads as one. */}
    <footer className={`sc-site-footer relative overflow-hidden border-t ${light ? "bg-[#F5F7FB] border-slate-200/80" : "rd-dark2 border-white/10"}`}>
      {!light && <div className="rd-glow rd-glow-violet" style={{ width: 520, height: 520, left: "-10%", bottom: "-60%", opacity: 0.25 }} />}
      <div className="max-w-7xl mx-auto px-5 sm:px-6 py-16 relative">
        <div className="grid grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-10">
          <div className="col-span-2 md:col-span-1">
            <HomeLink className="flex items-center gap-2.5 mb-4">
              <SwiftCardIcon size={30} />
              <span className={`${light ? "text-slate-900" : "text-white"} font-bold text-[1.125rem] tracking-tight`}>SwiftCard</span>
            </HomeLink>
            <p className={`${light ? "text-slate-500" : "text-white/55"} text-[0.875rem] leading-relaxed max-w-[240px]`}>
              The digital business card that shares itself. One tap, and you&apos;re in their phone — card, links, and everything you do.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <Link href="/cards/new" className="rd-btn rd-btn-primary text-[0.8125rem] px-4 py-2">Get started free</Link>
            </div>
            {/* The App Store badge (the homepage hero carries the other one).
                It renders ONLY once NEXT_PUBLIC_APP_STORE_URL is set, so it is
                absent while the app is in review and appears by itself the
                moment the listing is live — no second deploy to remember. That
                is the same self-activating pattern AppStoreReviews uses.
                Deliberately NOT wrapped in NativeHidden's opposite: someone
                reading the marketing site in a browser is exactly who should
                see it, and the whole footer is already hidden in the shell. */}
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <StoreBadges size="sm" />
              {/* A second button beside the badge, not a grey line under it
                  (owner, 2026-09-22: "it should be easier to find"). Same
                  radius and height as the sm badge so the pair reads as one
                  row; same self-activating contract. */}
              <RateUsLink
                placement="footer"
                className={`inline-flex items-center rounded-xl border px-3 py-2.5 text-[0.8125rem] font-semibold leading-none transition-colors ${
                  light ? "border-slate-300 text-slate-900 hover:bg-slate-100" : "border-white/20 text-white hover:bg-white/10"
                }`}
              />
            </div>
          </div>
          {COLS.map((col) => (
            <div key={col.title}>
              <p className={`rd-eyebrow ${light ? "text-slate-400" : "text-white/55"} mb-4`}>{col.title}</p>
              <ul className="space-y-2.5">
                {col.links.map((l) => {
                  const li = (
                    <li key={l.label}>
                      <Link href={l.href} className={`text-[0.875rem] ${muted} transition-colors`}>{l.label}</Link>
                    </li>
                  );
                  // Hide the Pricing link inside the native app (no selling).
                  return l.href === "/pricing" ? <NativeHidden key={l.label}>{li}</NativeHidden> : li;
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className={light ? "h-px bg-slate-200 my-10" : "rd-hair-d my-10"} />
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className={`${light ? "text-slate-500" : "text-white/55"} text-[0.8125rem]`}>
            © {new Date().getFullYear()} SwiftCard. All rights reserved.{" "}
            <Link href="/company" className={`${light ? "hover:text-slate-900" : "hover:text-white"} transition-colors`}>SwiftCard is operated by Swift Card Inc.</Link>
          </p>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className={`${muted} text-[0.8125rem] transition-colors`}>Privacy</Link>
            <Link href="/contact" className={`${muted} text-[0.8125rem] transition-colors`}>Contact Us</Link>
          </div>
        </div>
      </div>
    </footer>
    </>
  );
}
