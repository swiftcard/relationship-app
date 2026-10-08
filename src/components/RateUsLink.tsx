"use client";

import type { ReactNode } from "react";
import { trackCta } from "@/lib/events";
import { APP_STORE_WRITE_REVIEW_URL } from "@/lib/app-store";

// The one "Rate us on the App Store" link for the web (dashboard banner,
// Settings, site footer). Points straight at the write-review form: on an
// iPhone, iPad or Mac that opens the App Store on the review screen; on any
// other desktop it opens the listing's web page, which is why the `title`
// tooltip says "Best on iPhone" — hover exists only where that caveat applies.
//
// Every click lands in the funnel as cta_clicked { cta: "rate_us", placement }
// (see /admin/analytics → Top CTAs). Renders nothing until the App Store id is
// configured, like every other lib/app-store.ts consumer. See lib/rate-us.ts
// for the rules the surfaces follow.
//
// `sc-apple-only`: hidden in an Android browser (globals.css, by the
// before-paint data-sc-os tag from lib/store-os) — an Android visitor can't
// rate an app on the App Store, so the link would only be noise there.
export default function RateUsLink({
  placement,
  className = "",
  children = "Rate us on the App Store",
}: {
  placement: "dashboard_banner" | "settings" | "footer" | "reviews_page";
  className?: string;
  children?: ReactNode;
}) {
  if (!APP_STORE_WRITE_REVIEW_URL) return null;
  return (
    <a
      href={APP_STORE_WRITE_REVIEW_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Best on iPhone"
      onClick={() => trackCta("rate_us", placement)}
      className={`sc-apple-only ${className}`.trim()}
    >
      {children}
    </a>
  );
}
