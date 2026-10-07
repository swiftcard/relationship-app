import { createBrowserClient } from "@supabase/ssr";
import { clearPersonScopedState, LAST_AUTH_UID_KEY } from "@/lib/account-state";
import { unbindDevicePush } from "@/lib/push-device";
import { setAppBadge } from "@/lib/app-badge";

// ── The ONE way this device lets go of a person ──────────────────────────────
//
// Sign out, switch account on an invite, sign this device out from Settings →
// Devices, delete the account: each used to do its own subset of the cleanup,
// and the ones that skipped steps left the previous person's push binding,
// visitor cookie and cached pages behind for whoever used the phone next
// (isolation audit 2026-09-24). Every path runs this, then a HARD navigation
// (location.replace) so no client router cache or back-forward entry keeps
// their screens.
export async function releaseDevice(opts: { serverAlreadySignedOut?: boolean } = {}): Promise<void> {
  // Push first: the previous account's alerts must stop reaching this lock
  // screen. Bounded internally, never throws.
  await unbindDevicePush();
  // …and their unread count must not stay on the app icon (lib/app-badge).
  setAppBadge(0);
  if (!opts.serverAlreadySignedOut) {
    try {
      await createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ).auth.signOut();
    } catch { /* clear locally + navigate anyway */ }
  }
  clearPersonScopedState({ includeGuestFlow: true });
  try { localStorage.removeItem(LAST_AUTH_UID_KEY); } catch { /* storage blocked */ }
  // The httpOnly visitor cookie — only the server can drop it.
  try {
    await fetch("/api/visit-identity/reset", { method: "POST", keepalive: true });
  } catch { /* best-effort */ }
}
