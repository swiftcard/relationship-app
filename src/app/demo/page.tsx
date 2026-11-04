"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { detectNativeApp, useIsNativeApp } from "@/lib/platform";
import SiteNav from "@/components/site/SiteNav";
import SiteFooter from "@/components/site/SiteFooter";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import DemoBookingFlow from "@/components/demo/DemoBookingFlow";
import "@/app/home.css";

// ── /demo: book an Office demo on its own page ──────────────────────────────
// The same flow as the pricing page's popup, inline. This is what the Book a
// demo button opens before the pricing page has hydrated, and where "Book a
// new time" in a canceled-demo email lands. Linked from nowhere else.
//
// A selling surface: never shown inside the iPhone or Android app. The proxy
// redirects the app before any HTML (src/proxy.ts), and this guard covers a
// shell that slips past it.

export default function DemoPage() {
  const router = useRouter();
  useEffect(() => {
    if (detectNativeApp()) router.replace("/dashboard");
  }, [router]);
  const native = useIsNativeApp();
  if (native) return null;

  return (
    <div className="bg-white text-slate-900 min-h-screen">
      <HomeHeadingReveal />
      <SiteNav />
      <main className="hp overflow-clip">
        <section className="hp-page-hero pt-28 pb-16 sm:pt-36 sm:pb-24">
          <div className="relative max-w-6xl mx-auto px-5 sm:px-6 grid lg:grid-cols-[1fr_1.15fr] gap-10 lg:gap-14 items-start">
            <div data-hp-head className="lg:pt-6">
              <span className="hp-kicker">Office demo</span>
              <h1 className="rd-display text-slate-900 text-[clamp(2.2rem,4.8vw,3.4rem)] mt-5">
                See SwiftCard Office <span className="hp-fill">in action.</span>
              </h1>
              <p className="hp-lede !text-[1.05rem] mt-5 max-w-[460px]">
                A 30-minute walkthrough on Google Meet: matching cards for your whole team, every lead in one place, and the numbers per person. Bring your questions.
              </p>
              <ul className="mt-8 space-y-3 text-[0.9375rem] text-slate-700">
                {["Pick any open weekday time", "Get a Google Meet link and a calendar invite", "Reminders before the call, and an easy way to reschedule"].map((t) => (
                  <li key={t} className="flex items-start gap-2.5">
                    <span className="w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "var(--rd-aurora)" }} aria-hidden>
                      <svg viewBox="0 0 20 20" className="w-3 h-3" fill="none" stroke="#ffffff" strokeWidth={2.6}><path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[28px] border border-slate-200/80 bg-white shadow-[0_40px_80px_-40px_rgba(15,23,42,0.28)] overflow-hidden">
              <DemoBookingFlow variant="page" headingId="demo-page-title" />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
