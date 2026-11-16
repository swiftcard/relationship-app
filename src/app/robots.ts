import type { MetadataRoute } from "next";
import { disallowRules } from "@/lib/robots-paths";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me";

// The rules and why each is an exact segment, not a prefix: src/lib/robots-paths.ts.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: disallowRules(),
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
