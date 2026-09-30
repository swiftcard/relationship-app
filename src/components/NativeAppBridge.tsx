"use client";

import { useEffect } from "react";
import { safeNextPath } from "@/lib/safe-next";
import { detectNativeApp } from "@/lib/platform";
import { LINKEDIN_MESSAGE } from "@/lib/linkedin-popup";
import { PUBLIC_PAGE_META } from "@/lib/universal-links";
import { ACTIVE_CARD_EVENT } from "@/lib/active-card";

/** The card this phone's home-screen widget shows — how a widget tap is told apart from a scanned QR. */
const WIDGET_CARD_KEY = "sc_widget_card";
/** The last card link handed to the browser — module scope, so it outlives an effect re-run. */
let handedOff: { dest: string; at: number } | null = null;

/**
 * Native-shell runtime bridge. Renders nothing; on web every effect is a no-op.
 *
 * Inside the Capacitor iOS shell it wires two things:
 *
 * 1. `appUrlOpen`. The swiftcard:// return legs of native sign-in and the
 *    integration connects land here. No https link ever opens the app (the
 *    AASA claims nothing — lib/universal-links); one that still arrives from
 *    an old cached AASA is handed to the default browser, never shown here.
 *    A home-screen widget tap (its URL is the card's own ?source=widget
 *    address) opens the dashboard.
 *
 * 2. In-app browser cleanup after that hand-off (`Browser.close()` is safe to
 *    call even when nothing is open).
 *
 * Uses dynamic imports so none of the Capacitor plugin JS enters the web
 * bundle; on web the effect returns before any import happens.
 */
export default function NativeAppBridge() {
  useEffect(() => {
    if (!detectNativeApp()) return;

    // ── Native look & motion hook ──────────────────────────────────────────
    // `html.native-app` scopes the Liquid-Glass-inspired CSS layer in
    // globals.css (glass chrome, spring taps, page transitions) to the shell
    // only — the website never gets the class. viewport-fit=cover is injected
    // here rather than in the layout's viewport export so the WEBSITE's layout
    // on notched iPhones is untouched; inside the shell it lets content run
    // edge-to-edge with env(safe-area-inset-*) padding handling the notch.
    document.documentElement.classList.add("native-app");

    // Drop the native splash the moment this page has painted (two frames in
    // so the first paint is actually on screen). Any page — login, dashboard,
    // a deep link — so the splash never outlives the content behind it.
    //
    // BACKUP PATH ONLY on a cold launch. This effect runs after hydration,
    // which on a remote-URL shell is 1-3s in, and the launch animation cannot
    // wait that long to start — so the splash overlay hands off from its own
    // inline script two frames after it paints (src/lib/splash/markup.html).
    // This call stays for every path that renders no overlay (an in-app hard
    // navigation, a shell build whose HTML predates it) and is a no-op when
    // the splash is already down.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      import("@capacitor/splash-screen")
        .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 180 }))
        .catch(() => { /* older shell without the plugin: auto-hide covers it */ });
    }));
    try {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
      if (meta && !meta.content.includes("viewport-fit")) {
        meta.content = `${meta.content}, viewport-fit=cover`;
      }
    } catch { /* ignore */ }

    // ── A public card / Swift Links page must never be a screen in the app ──
    // Owner, 2026-09-29: "We don't want links ever opening in that app. That
    // glitch cannot happen." No link opens the app and no app button loads one
    // here, but if the webview lands on one anyway — by ANY route — hide it on
    // this frame, hand it to the browser, and put the app back on its
    // dashboard. Never in an iframe (the in-app previews embed these pages on
    // purpose) and never for ?embed renders.
    //
    // Checked NOW and again whenever a <meta> lands later. The marker is page
    // metadata, which Next streams into the body AFTER the page resolves — on
    // production it arrives ~20KB into the HTML, after the loading skeleton —
    // and a client-side navigation adds it later still. A check made once on
    // mount could run before it existed and never fire.
    let bounced = false;
    const bounceIfPublic = () => {
      if (bounced || window.top !== window) return;
      if (!document.querySelector(`meta[name="${PUBLIC_PAGE_META}"]`)) return;
      if (new URLSearchParams(window.location.search).has("embed")) return;
      bounced = true;
      document.documentElement.style.visibility = "hidden";
      const dest = window.location.pathname + window.location.search + window.location.hash;
      import("@/lib/external-purchase")
        .then(({ openLinkInDefaultBrowser }) => openLinkInDefaultBrowser(dest))
        .catch(() => false)
        .finally(() => window.location.replace("/dashboard"));
    };
    let publicWatch: MutationObserver | null = null;
    try {
      bounceIfPublic();
      // Native only (this whole effect is), and cheap: a tag-name test per
      // inserted element, a lookup only when a <meta> actually arrives.
      publicWatch = new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n.nodeType === 1 && (n.nodeName === "META" || (n as Element).getElementsByTagName("meta").length)) {
              bounceIfPublic();
              return;
            }
          }
        }
      });
      publicWatch.observe(document.documentElement, { childList: true, subtree: true });
    } catch { /* ignore */ }

    let removeListener: (() => void) | null = null;
    let cancelled = false;

    // ── Home-screen QR widget + Apple Watch data sync ─────────────────────
    // Runs once on mount and again whenever CardSelectionPersist reports a
    // card switch (ACTIVE_CARD_EVENT). Before the event existed this only ran
    // on a full document load, so switching cards on the dashboard left the
    // widget and the watch on the previous card until the app was relaunched.
    const syncWidgetCard = async () => {
      if (cancelled) return;
      // Hand the signed-in user's active card to the SwiftCardWidget extension
      // via the WidgetBridge native plugin (ios/App/App/WidgetBridge.swift),
      // which writes the shared App Group suite and reloads the timeline.
      //
      // ⚠️ Do NOT switch this back to @capacitor/preferences: that plugin's
      // `group` option is only a key prefix on UserDefaults.standard, which
      // lives in the app's own container and is unreadable from a widget
      // extension — the widget would sit on its empty state forever.
      //
      // Honors the dashboard's active-card choice when one is stored.
      //
      // Failures are logged rather than swallowed. The only visible output of
      // this block is the widget itself, so a silent skip is indistinguishable
      // from "working" during device testing — which is how the Preferences
      // version above went unnoticed for weeks. Capacitor forwards console
      // output to the Xcode/simctl console, so these lines are visible there.
      const widgetBridge = (window as unknown as {
        Capacitor?: {
          Plugins?: {
            WidgetBridge?: {
              setCard: (o: Record<string, string>) => Promise<void>;
              clearCard: () => Promise<void>;
            };
          };
        };
      }).Capacitor?.Plugins?.WidgetBridge;

      if (!widgetBridge) {
        // Means the plugin was not registered natively — see MainViewController.
        console.warn("[widget] WidgetBridge plugin unavailable; home-screen widget will not update");
      } else {
        try {
          const res = await fetch("/api/cards", { credentials: "include" });
          const cards = res.ok
            ? ((await res.json()) as { cards?: Array<{ username?: string; name?: string; company?: string }> }).cards
            : undefined;

          let active = cards?.length ? cards[0] : undefined;
          if (active) {
            try {
              const chosen = localStorage.getItem("swiftcard_active_card");
              active = cards!.find((c) => c.username === chosen) ?? active;
            } catch { /* default to first card */ }
          }

          if (active?.username) {
            await widgetBridge.setCard({
              url: `https://swiftcard.me/${active.username}?source=widget`,
              name: active.name || "My SwiftCard",
              company: active.company || "",
            });
            try { localStorage.setItem(WIDGET_CARD_KEY, active.username); } catch { /* ignore */ }
          } else if (res.status === 401 || res.status === 403 || cards?.length === 0) {
            // Signed out, or the last card was deleted. Without this the widget
            // keeps rendering the previous account's QR on the home screen
            // indefinitely — including after sign-out on a shared or handed-on
            // device, and after the account itself is gone.
            await widgetBridge.clearCard();
            try { localStorage.removeItem(WIDGET_CARD_KEY); } catch { /* ignore */ }
          }
        } catch (e) {
          // Offline is normal and fine; a native reject is not. Either way the
          // widget keeps its last data, but say so instead of vanishing.
          console.warn("[widget] sync failed:", e);
        }
      }
    };
    const onActiveCard = () => { void syncWidgetCard(); };
    window.addEventListener(ACTIVE_CARD_EVENT, onActiveCard);

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appUrlOpen", async ({ url }) => {
          try {
            // Close the system-browser sheet first in both branches — the
            // OAuth round-trip and universal links can each arrive from it.
            try {
              const { Browser } = await import("@capacitor/browser");
              await Browser.close();
            } catch { /* nothing open — fine */ }

            // swiftcard://linkedin-callback?status=…&next=… — the LinkedIn
            // headshot import's return leg. It has no code to exchange (the
            // callback route already did the token work server-side); all that
            // is left is to put the WEBVIEW back where the user started, which
            // is what makes the imported photo appear in the editor they came
            // from. Checked before the auth branch because both are swiftcard:
            // URLs and completeNativeOAuth would reject this one.
            // Integration OAuth return legs. Each finishes server-side (tokens
            // are already stored); all that is left is to put the WEBVIEW back
            // on Settings so the UI reflects the connection the user just made.
            // Matched BEFORE the auth branch because both are swiftcard: URLs
            // and completeNativeOAuth would reject these (no code to exchange).
            // One branch for every provider return: swiftcard://<provider>-callback.
            // Salesforce shipped without its own branch and fell through to the
            // auth handler below, which sent a signed-in user to /login.
            const provider = url.match(/^swiftcard:\/\/([a-z]+)-callback/)?.[1];
            if (provider && provider !== "auth") {
              const q = new URL(url).searchParams;
              const nextRaw = q.get("next") ?? "";
              // Same-origin relative paths only — an appUrlOpen payload is
              // attacker-reachable (any app can open a swiftcard:// URL), so it
              // must never steer the webview off our own origin.
              const next =
                safeNextPath(nextRaw) ?? "/settings/flows";
              const status = q.get("status") ?? "error";
              // LinkedIn headshot, signed in, and the webview is still on the
              // editor that started it: finish IN PLACE, the way the web popup
              // does, instead of reloading the page. The reload threw away
              // every unsaved edit on the card ("losing all progress" — owner,
              // 2026-09-22); ProfilePhotoSuggest's message listener imports the
              // photo into the live form. A guest's photo (status=photo) rides
              // in `next` as ?li_photo= and is read on mount, so that one
              // still navigates — the guest draft autosaves, nothing is lost.
              if (
                provider === "linkedin" &&
                status !== "photo" &&
                new URL(next, window.location.origin).pathname === window.location.pathname
              ) {
                window.postMessage({ source: LINKEDIN_MESSAGE, status }, window.location.origin);
                return;
              }
              const sep = next.includes("?") ? "&" : "?";
              window.location.href =
                `${next}${sep}integration=${provider}&status=${encodeURIComponent(status)}`;
              return;
            }

            // swiftcard://auth-callback?code=… — the native OAuth return leg.
            if (url.startsWith("swiftcard:")) {
              // Paint "Signing you in…" BEFORE the code exchange. The webview
              // behind the browser sheet is still showing the login form, so
              // without this the user watches Google succeed and then lands
              // back on "Create account" for the seconds the exchange +
              // /onboarding take — which reads as a failed sign-in.
              showAuthOverlay();
              const [{ completeNativeOAuth }, { createBrowserClient }] = await Promise.all([
                import("@/lib/native-auth"),
                import("@supabase/ssr"),
              ]);
              const supabase = createBrowserClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
              );
              await completeNativeOAuth(supabase, url);
              return;
            }

            const u = new URL(url);
            // Only ever navigate to our own origin — never let an arbitrary
            // scheme/host steer the webview.
            if (u.hostname === "swiftcard.me" || u.hostname === "www.swiftcard.me") {
              const dest = u.pathname + u.search + u.hash;
              // "/" is the home-screen widget's empty state (no card yet). No
              // link could ever deliver it: every AASA the app has shipped with
              // excluded "/".
              if (u.pathname === "/") {
                window.location.href = dest;
                return;
              }
              // A home-screen widget tap: the widget's widgetURL is the card's
              // own address (?source=widget, also what its QR encodes), and a
              // widget tap always opens the app. That is the owner opening
              // their app — land on their dashboard with that card selected,
              // not on their public card with no way back.
              // Only THIS phone's widget card counts: the widget's QR encodes the
              // same address, so someone else's widget QR scanned here is a
              // card link like any other and goes to the browser below.
              const card = u.pathname.split("/").filter(Boolean).pop() ?? "";
              let widgetCard: string | null = null;
              // Fallback: the dashboard's chosen card, which the widget shows,
              // for a phone whose widget synced before this key existed.
              try {
                widgetCard = localStorage.getItem(WIDGET_CARD_KEY) ?? localStorage.getItem("swiftcard_active_card");
              } catch { /* ignore */ }
              if (u.searchParams.get("source") === "widget" && widgetCard && card === widgetCard) {
                window.location.replace(`/dashboard?card=${encodeURIComponent(card)}`);
                return;
              }
              // Any other link — a SwiftCard, Swift Links or Swift Signature
              // link, a QR/NFC tap, an Office invite. The app claims no links
              // at all (lib/universal-links), but a phone keeps Apple's cached
              // copy of an older association file for a while, so one can still
              // arrive here. Links NEVER open in the app (owner, 2026-09-29):
              // shown in the webview, a public card had no app chrome and no
              // way out. So it goes to the browser, and the webview is never
              // pointed at it — not even as a fallback.
              //
              // `handedOff` catches a bounce — iOS handing the same link
              // straight back — so this can never loop between app and Safari.
              const bounced =
                handedOff?.dest === dest && Date.now() - handedOff.at < 15_000;
              if (bounced) return;
              handedOff = { dest, at: Date.now() };
              const { openLinkInDefaultBrowser } = await import("@/lib/external-purchase");
              if (!(await openLinkInDefaultBrowser(dest))) {
                console.warn("[links] could not hand a link to the browser:", dest);
              }
            }
          } catch { /* malformed URL — ignore */ }
        });
        if (cancelled) { handle.remove(); return; }
        removeListener = () => handle.remove();
      } catch { /* plugin unavailable (older shell build) — nothing to listen for */ }

      // Push-notification taps: lib/apns.ts puts the in-app destination in the
      // payload's custom `url`; navigate there when the user opens one.
      // Registered BEFORE the widget sync below (which awaits a network fetch)
      // — a tap that launches the app from cold start fires as soon as the
      // listener exists, and every second of delay is a window where the tap
      // silently does nothing.
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const tapHandle = await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
          const dest = (action?.notification?.data as { url?: string } | undefined)?.url;
          if (typeof dest !== "string") return;
          // Senders pass ABSOLUTE urls (`${APP_URL}/dashboard?card=…`) — the
          // old relative-only guard rejected every one of them, so tapping a
          // push never navigated. Accept our own origin and strip it to a
          // path; still never let a foreign origin steer the webview.
          let path: string | null = null;
          if (safeNextPath(dest)) {
            path = dest;
          } else {
            try {
              const u = new URL(dest);
              if (u.hostname === "swiftcard.me" || u.hostname === "www.swiftcard.me") {
                path = u.pathname + u.search + u.hash;
              }
            } catch { /* not a URL — ignore */ }
          }
          if (path) window.location.href = path;
        });
        if (cancelled) { tapHandle.remove(); return; }
        const prevTap = removeListener;
        removeListener = () => { prevTap?.(); tapHandle.remove(); };

        // ── Silent token refresh ──────────────────────────────────────────
        // iOS rotates APNs tokens (OS upgrade, backup restore) and register()
        // is otherwise only called from the user-initiated enable button — a
        // rotated token meant pushes silently stopped until the user toggled
        // the setting again. On each launch, IF this device's push binding
        // belongs to the CURRENT signed-in user and permission is already
        // granted, re-register and re-upsert the (possibly new) token. Never
        // prompts, never binds an account that didn't opt in itself.
        try {
          const perm = await PushNotifications.checkPermissions();
          const pushUid = localStorage.getItem("swiftcard_push_uid");
          if (perm.receive === "granted" && pushUid) {
            const { createBrowserClient } = await import("@supabase/ssr");
            const supabase = createBrowserClient(
              process.env.NEXT_PUBLIC_SUPABASE_URL!,
              process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            );
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id && session.user.id === pushUid) {
              const regHandle = await PushNotifications.addListener("registration", (t) => {
                const endpoint = `apns:${t.value}`;
                // A rotated token must retire the row it replaces, or this
                // phone keeps two live subscriptions and every notification
                // arrives twice (see /api/push/subscribe).
                let previous: string | null = null;
                try { previous = localStorage.getItem("swiftcard_apns_endpoint"); } catch { /* ignore */ }
                fetch("/api/push/subscribe", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ endpoint, p256dh: "apns", auth: "apns", replaces: previous, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
                }).then((r) => {
                  if (r.ok) { try { localStorage.setItem("swiftcard_apns_endpoint", endpoint); } catch { /* ignore */ } }
                }).catch(() => { /* offline — next launch retries */ });
              });
              const prevReg = removeListener;
              removeListener = () => { prevReg?.(); regHandle.remove(); };
              await PushNotifications.register();
            }
          }
        } catch { /* refresh is best-effort — enable button remains the fallback */ }
      } catch { /* push plugin absent — fine */ }

      await syncWidgetCard();
    })();

    return () => {
      cancelled = true;
      removeListener?.();
      window.removeEventListener(ACTIVE_CARD_EVENT, onActiveCard);
      publicWatch?.disconnect();
    };
  }, []);

  return null;
}


/**
 * Full-screen "Signing you in…" cover for the OAuth return leg.
 *
 * Deliberately raw DOM, not React state: this fires from a Capacitor event
 * listener while an arbitrary page is mounted (usually /login), and it must
 * appear on the very next frame. It is removed by the navigation that
 * follows; a 20s failsafe clears it if the exchange never resolves, so a
 * network failure can never leave the app stuck behind a cover.
 */
function showAuthOverlay(): void {
  try {
    if (document.getElementById("sc-auth-overlay")) return;
    const el = document.createElement("div");
    el.id = "sc-auth-overlay";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;" +
      "justify-content:center;gap:14px;background:#030712;color:#e5e7eb;font:600 15px/1.4 system-ui,-apple-system,sans-serif";
    el.innerHTML =
      '<div style="width:34px;height:34px;border:3px solid rgba(255,255,255,.18);border-top-color:#3b82f6;' +
      'border-radius:50%;animation:sc-auth-spin .8s linear infinite"></div><div>Signing you in…</div>' +
      '<style>@keyframes sc-auth-spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);
    setTimeout(() => { document.getElementById("sc-auth-overlay")?.remove(); }, 20000);
  } catch { /* overlay is a nicety — never block the sign-in */ }
}
