// ── Recovering from a deploy that happened under an open page ─────────────
//
// Every deploy replaces /_next/static/chunks/<hash>.js. A page loaded before
// it still asks for the OLD hashes, and those now 404. Nothing on the page
// looks broken until the next lazy import — a button's dialog, the sign-in
// return leg, a client-side navigation — and then that one thing silently
// does nothing. The app shell is hit hardest: it stays warm for days, so a
// deploy (several a day) left sign-in dead until the app was force-quit
// (audit NS-06; Vercel logged "Failed to load chunk" at /login on 2026-10-10).
//
// The only cure is a fresh document: a reload fetches the current HTML, which
// names the current chunks. This does that ONCE. A sessionStorage stamp makes
// a second chunk failure inside RELOAD_WINDOW_MS give up instead of reloading
// again, so a chunk that is genuinely missing can never become a reload loop.
// No storage, no reload: without the stamp there is nothing to stop a loop.

const RELOAD_STAMP_KEY = "sc-chunk-reload-at";
export const RELOAD_WINDOW_MS = 60_000;

/** Messages each engine uses when a lazy chunk cannot be fetched. */
const CHUNK_FAILURE = [
  /Failed to load chunk/i,                        // Turbopack (this app's bundler)
  /Loading (CSS )?chunk [\w./-]+ failed/i,        // webpack
  /Failed to fetch dynamically imported module/i, // Chrome, native import()
  /Importing a module script failed/i,            // Safari / WKWebView
  /error loading dynamically imported module/i,   // Firefox
];

/** True when `err` (an Error, a rejection reason or a message) is a chunk that could not be fetched. */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: unknown; message?: unknown };
  if (typeof err === "object" && e.name === "ChunkLoadError") return true;
  const message = typeof err === "string" ? err : typeof e.message === "string" ? e.message : "";
  return CHUNK_FAILURE.some((re) => re.test(message));
}

/**
 * Reload the page once to pick up the current deployment.
 * Returns true when a reload was started, false when it was refused (already
 * reloaded for this within RELOAD_WINDOW_MS, or no sessionStorage to guard it).
 */
export function recoverFromChunkError(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_STAMP_KEY) || 0);
    if (last && now - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_STAMP_KEY, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
