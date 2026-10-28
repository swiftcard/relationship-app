import { cookies } from "next/headers";
import WebsiteAnalyticsClient from "./WebsiteAnalyticsClient";
import { resolveWebsiteTab } from "./tabs";

// Admin gate is inherited from src/app/admin/layout.tsx (ADMIN_EMAILS only);
// the data route (api/admin/website) checks requireAdmin itself.
export const metadata = { title: "Website — SwiftCard Admin" };

export default async function AdminWebsitePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // Read the current device's internal flag so the toggle shows the right state
  // on first paint.
  const internalNow = (await cookies()).get("sc_internal")?.value === "1";
  const tab = resolveWebsiteTab((await searchParams).tab);
  return <WebsiteAnalyticsClient initialInternalDevice={internalNow} tab={tab} />;
}
