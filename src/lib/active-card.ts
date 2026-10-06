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
