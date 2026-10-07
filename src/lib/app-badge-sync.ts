import { after, type NextRequest } from "next/server";
import { isNativeRequest } from "@/lib/native-request";
import { syncAppBadge } from "@/lib/push";

// ── The phone's icon follows the bell, wherever the bell is read ─────────────
//
// Call this from every route that changes the bell's unread count (read,
// unread, dismiss, clear). Changed on the WEBSITE, the iPhone is sent the new
// number after the response (lib/push syncAppBadge). Changed in the APP, it is
// skipped: the app sets its own icon (lib/app-badge), and a second writer
// racing it over the network could land late and put back a number the person
// just cleared.

export function syncPhoneBadgeAfter(req: NextRequest, userId: string): void {
  if (isNativeRequest(req.headers.get("user-agent"), req.cookies.get("sc_shell")?.value ?? null)) return;
  after(() => syncAppBadge(userId));
}
