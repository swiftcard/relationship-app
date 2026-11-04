"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { detectNativeApp, useIsNativeApp } from "@/lib/platform";
import SiteNav from "@/components/site/SiteNav";
import SiteFooter from "@/components/site/SiteFooter";
import DemoManage from "@/components/demo/DemoManage";
import "@/app/home.css";

// ── /demo/manage#<token>: change, cancel or confirm a booked demo ───────────
// Reached only from the booking emails and texts. Not in the proxy matcher (it
// needs no session); the app guard below keeps it out of the iPhone and
// Android app like /demo.

export default function DemoManagePage() {
  const router = useRouter();
  useEffect(() => {
    if (detectNativeApp()) router.replace("/dashboard");
  }, [router]);
  const native = useIsNativeApp();
  if (native) return null;

  return (
    <div className="bg-white text-slate-900 min-h-screen">
      <SiteNav />
      <main className="hp overflow-clip">
        <section className="hp-page-hero pt-28 pb-16 sm:pt-36 sm:pb-24">
          <div className="relative max-w-2xl mx-auto px-5 sm:px-6">
            <div className="rounded-[28px] border border-slate-200/80 bg-white p-6 sm:p-8 shadow-[0_40px_80px_-40px_rgba(15,23,42,0.28)]">
              <DemoManage />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
