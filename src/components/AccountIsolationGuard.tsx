"use client";

import { useEffect } from "react";
import {
  clearPersonScopedState,
  isAccountSwitch,
  markIdentityReconciled,
  readLastAuthUid,
  shouldResetPersonState,
  writeLastAuthUid,
} from "@/lib/account-state";

// ── Account isolation guard ──────────────────────────────────────────────────
//
// Mounted once in the root layout; renders nothing. Its one job: the moment
// this browser's AUTHENTICATED USER is not the user its person-scoped state
// was stamped with, reset that state (lib/account-state.ts) and sever the
// device's push binding (lib/push-device.ts).
//
// Why SignOutButton alone is not enough: logging in over an existing session
// (the /login page never forces a sign-out first), the native shell reopening
// on a webview whose cookies rotated, and any sign-out path that isn't the
// button (session expiry, account deletion) all change the user WITHOUT that
// button's cleanup running. This guard closes every one of those paths by
// checking identity itself, on every page load and on every auth state change.
//
// ── WHY THE SUPABASE CLIENT IS NOT IMPORTED AT THE TOP (perf audit 2026-09-14)
//
// This component lives in the ROOT layout, so a static
// `import { createBrowserClient } from "@supabase/ssr"` here dragged the entire
// Supabase browser SDK — auth, postgrest, storage AND the realtime websocket
// client, 239 kB of raw JavaScript — into the chunk set that every page must
// download and parse before it can hydrate. Every page: the marketing
// homepage, /pricing, and every public card and Swift Links page, none of
// which have a signed-in user at all. (Realtime is not used anywhere in this
// codebase — there is not one `.channel(` call — so a third of that was
// unreachable code shipped to strangers scanning a business card.)
//
// TWO CHANGES, NO BEHAVIOUR LOST:
//
//   1. A SESSION IS A COOKIE, and a cookie can be read with no SDK at all.
//      @supabase/ssr stores the session in `sb-<ref>-auth-token` cookies —
//      that is the whole point of the ssr package, and src/app/[username]/page.tsx
//      already uses exactly this test server-side to skip its own auth hop. With
//      no such cookie there is provably no session, so there is nothing to
//      reconcile: mark the barrier resolved and stop. That is also FASTER than
//      before for anonymous visitors, who used to make trackers wait on a
//      getSession() that could only ever answer "nobody".
//
//   2. When there IS a session, the SDK is loaded with a dynamic import. Same
//      getSession() decode, same reconcile, same onAuthStateChange
//      subscription — it just arrives as its own chunk after hydration instead
//      of blocking it.
//
// What this deliberately does NOT do is guess. The cookie test is the same one
// the server trusts; anything that looks even slightly like a session takes the
// full, unchanged path.

/** Does this browser carry a Supabase session cookie? No SDK required. */
function hasAuthCookie(): boolean {
  if (typeof document === "undefined") return false;
  // Same shape the server checks (src/app/[username]/page.tsx): the ssr client
  // writes `sb-<project-ref>-auth-token`, sometimes chunked with a `.0`/`.1`
  // suffix, which `includes` covers.
  return document.cookie
    .split(";")
    .some((c) => {
      const name = c.split("=")[0]?.trim() ?? "";
      return name.startsWith("sb-") && name.includes("auth-token");
    });
}

export default function AccountIsolationGuard() {
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    // An unbind that never reached the server (offline sign-out) is retried
    // on every load until it does — signed in or not.
    // The flag is checked HERE before importing: the push-device chunk used to
    // be fetched on every page load by every visitor, card scanners included,
    // only to read this one key and return (perf audit 2026-10-06). The key
    // name is pinned to lib/push-device's UNBIND_PENDING_KEY by a test.
    let unbindPending = false;
    try { unbindPending = localStorage.getItem("swiftcard_push_unbind_pending") === "1"; } catch { /* storage blocked */ }
    if (unbindPending) {
      void import("@/lib/push-device").then(({ retryPendingPushUnbind }) => retryPendingPushUnbind()).catch(() => {});
    }

    const reconcile = (sessionUid: string | null) => {
      const lastUid = readLastAuthUid();
      if (!shouldResetPersonState(lastUid, sessionUid)) return;

      const realSwitch = isAccountSwitch(lastUid, sessionUid);
      clearPersonScopedState({ includeGuestFlow: realSwitch, signedInUid: sessionUid });
      writeLastAuthUid(sessionUid);

      // A login this state wasn't stamped with means the device's push binding
      // belongs to nobody: the old account must stop reaching this lock
      // screen, and the new one gets pushes only after it opts in itself.
      // Not just realSwitch — a sign-out whose server DELETE failed (offline)
      // followed by a fresh login lands here with lastUid null, and the stale
      // binding would otherwise keep pushing the previous account's activity
      // to this device. Fire-and-forget — identity hygiene must never delay a
      // page.
      void import("@/lib/push-device").then(({ unbindDevicePush }) => unbindDevicePush()).catch(() => {});
      // The visitor cookie too (httpOnly — only the server can drop it): kept,
      // the next person's card views were credited to whoever used this
      // browser before them (isolation audit 2026-09-24).
      if (realSwitch) void fetch("/api/visit-identity/reset", { method: "POST", keepalive: true }).catch(() => {});
    };

    // No session cookie → no session → nothing this guard can act on. Resolve
    // the barrier immediately so CardEventTracker and friends don't sit on
    // their 2s timeout, and never touch the SDK.
    if (!hasAuthCookie()) {
      markIdentityReconciled();
      return;
    }

    void (async () => {
      try {
        const { createBrowserClient } = await import("@supabase/ssr");
        if (cancelled) return;
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // getSession() decodes the cookie locally (no network) — all that's
        // needed here is the uid to compare. Server code never trusts this
        // value; it does its own getUser()/getClaims() per request.
        let pageUid: string | null = null;
        try {
          const { data: { session } } = await supabase.auth.getSession();
          pageUid = session?.user?.id ?? null;
          if (!cancelled) reconcile(pageUid);
        } finally {
          // Trackers hold their first event until this first pass lands, so a
          // view right after an account switch can't ship the previous
          // person's ids.
          markIdentityReconciled();
        }
        if (cancelled) return;

        // Belt and braces for auth changes that happen without a full
        // navigation (multi-tab sign-ins broadcast here too).
        //
        // …and a BACKGROUND tab whose account changed in another tab reloads:
        // it was still showing the previous person's contacts and bell, and
        // its client router cache served their pages on the next tap
        // (isolation audit 2026-09-24). Only when hidden — the tab doing the
        // signing in/out runs its own cleanup and navigation, which a reload
        // here would cut short. It reloads the moment it is looked at again.
        let reloadOnVisible = false;
        const onVisible = () => {
          if (reloadOnVisible && document.visibilityState === "visible") window.location.reload();
        };
        document.addEventListener("visibilitychange", onVisible);
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          const uid = session?.user?.id ?? null;
          reconcile(uid);
          if (uid !== pageUid && document.visibilityState === "hidden") reloadOnVisible = true;
        });
        unsubscribe = () => {
          sub.subscription.unsubscribe();
          document.removeEventListener("visibilitychange", onVisible);
        };
      } catch {
        // The SDK chunk failed to load (offline, cache miss on a flaky
        // connection). Releasing the barrier is the safe direction: it restores
        // exactly the pre-barrier behaviour rather than stalling every tracker
        // on the page for its full timeout.
        markIdentityReconciled();
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return null;
}
