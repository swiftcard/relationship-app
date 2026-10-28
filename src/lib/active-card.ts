/**
 * Where the "which card is selected" pointer lives.
 *
 * Deliberately a PLAIN module, not part of a "use client" file. The cookie name
 * first lived in CardSelectionPersist.tsx, which carries "use client" — and a
 * value imported from a client module into a Server Component arrives as a
 * client-reference proxy, not the string. `cookies().get(proxy)` then silently
 * returns undefined, so the Share page kept falling back to the oldest card and
 * the fix looked like it simply did not work. Constants shared across the
 * server/client boundary belong in a neutral module like this one.
 */

/** localStorage key — client-only readers (nav, contacts, tour). */
export const ACTIVE_CARD_KEY = "swiftcard_active_card";

/**
 * Cookie mirror of {@link ACTIVE_CARD_KEY}, so the SERVER can read the selection
 * during render instead of shipping the wrong card and correcting it from an
 * effect. Not sensitive and not httpOnly: it holds a card slug the user hands
 * out publicly, and the client has to be able to write it.
 */
export const ACTIVE_CARD_COOKIE = "sc_active_card";

/** One year, matching how long the localStorage copy effectively persists. */
export const ACTIVE_CARD_COOKIE_MAX_AGE = 31536000;

/**
 * Window event fired by CardSelectionPersist after the selection changes.
 * NativeAppBridge listens for it and re-syncs the iOS home-screen widget and
 * the Apple Watch, which otherwise only learn the active card on a full page
 * load — a client-side card switch on the dashboard never remounted them, so
 * the wrist kept showing the previous card until the app was relaunched.
 */
export const ACTIVE_CARD_EVENT = "swiftcard:active-card";

/**
 * Session-only mirror of the selection — what the DASHBOARD falls back to when
 * the address carries no ?card=. No max-age, so it dies with the app (or the
 * browser session): reopening the app shows "Select a card" again, while every
 * bare /dashboard link inside the same session keeps the card you chose
 * (owner, 2026-10-06: "when the app is closed and I reopen it … it's supposed
 * to open to choose a card"). Contacts, Links and the widget keep reading the
 * one-year {@link ACTIVE_CARD_COOKIE}.
 */
export const SESSION_CARD_COOKIE = "sc_session_card";

/**
 * sessionStorage marker written next to {@link SESSION_CARD_COOKIE}. A webview
 * that kept session cookies across a relaunch still starts with empty
 * sessionStorage, so a session card WITHOUT this marker is a previous launch's.
 */
export const SESSION_CARD_FLAG = "sc_session_card_set";

/**
 * Which SIGN-IN a session card was chosen in: the start of the auth session's
 * id (the access token's `session_id` claim). It survives token refreshes and
 * changes on every new sign-in, whatever the method (password, Google, Apple,
 * an emailed link, the app).
 *
 * Owner, 2026-10-27: "The first thing that pops up when a user logs in should
 * ask them which card they want to open." The session cookie outlives a sign-in
 * that ended without Sign out (an expired session, a browser that restores its
 * cookies), so the dashboard reopened the old card: straight into it in the tab
 * that had chosen it, and for a second before the picker in any other tab.
 * Stamping the card with its sign-in lets the SERVER tell, and render the
 * picker first.
 */
export function signInTag(sessionId: unknown): string {
  return typeof sessionId === "string" ? sessionId.replace(/[^a-z0-9]/gi, "").slice(0, 12) : "";
}

/** The {@link SESSION_CARD_COOKIE} value: the card slug, then its sign-in. */
export function sessionCardValue(card: string, signIn: string): string {
  return `${card}.${signIn}`;
}

/**
 * The card a {@link SESSION_CARD_COOKIE} value holds, or null when it was
 * chosen in a different sign-in. Slugs are [a-z0-9-], so the last "." is the
 * separator. A value with no "." was written before sign-ins were stamped and
 * is treated as a previous sign-in's: the picker once, then it is stamped.
 */
export function readSessionCard(raw: string | null | undefined, signIn: string): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  return raw.slice(dot + 1) === signIn ? raw.slice(0, dot) : null;
}

/**
 * Parse-time guard for a dashboard opened from the session card in a tab (or an
 * app launch) that never chose a card itself — no {@link SESSION_CARD_FLAG}.
 * Inline in the page's HTML ahead of the dashboard markup, it runs before any
 * of it can paint: drops the session card, stops the document (so the rest of
 * the dashboard is never parsed or swapped in), and replaces it with the
 * picker. It used to be decided in a mount effect, AFTER the dashboard had
 * painted, which was the "shows the dashboard for a second, then Select a
 * card" glitch. An app cold launch waits for its splash to finish (the splash
 * markup removes `sc-splash-armed` when the sequence ends; only the loading
 * skeleton is under it) so the launch animation is never cut short.
 * Storage blocked: trust the cookie, exactly like the effect.
 */
export const SESSION_CARD_GUARD_SCRIPT =
  "(function(){try{" +
  `if(sessionStorage.getItem("${SESSION_CARD_FLAG}"))return;` +
  `document.cookie="${SESSION_CARD_COOKIE}=; path=/; max-age=0; samesite=lax";` +
  "window.stop();" +
  "var d=document.documentElement;" +
  '(function go(){if(d.classList.contains("sc-splash-armed")){setTimeout(go,100);return}location.replace("/dashboard?pick=1")})();' +
  "}catch(e){}})();";
