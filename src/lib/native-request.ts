// ── Is this request coming from the iOS shell? (server-side) ─────────────────
//
// The client-side `useIsNativeApp()` cannot answer this before paint: it reads
// `window`, so it returns false on the server AND on the first client render,
// then flips in an effect. That is correct for hydration but wrong for anything
// that must not appear even for one frame — a control gated on it renders, then
// vanishes, which reads as a glitch.
//
// The server has two shell-only signals available on the request itself, so a
// server component can decide before the first byte:
//
//   • the `SwiftCardApp` token that capacitor.config.ts appends to the
//     user-agent (present from build 2 onward), and
//   • the `sc_shell` cookie that the sc-boot script in layout.tsx plants the
//     first time it detects the shell — which covers builds already installed
//     whose UA carries no token.
//
// Only the very first request of a first-ever launch has neither (the cookie is
// planted by the script in the response it is reading). That request falls back
// to the web variant, and every request after it is correct. Same trade-off
// src/proxy.ts already accepts for its "/"→app redirect.
//
// Deliberately a PURE function over two strings rather than something that
// reads headers()/cookies() itself: proxy.ts runs in a different runtime with
// its own request object, this is callable from both, and it can be unit-tested
// without faking Next's async request APIs. proxy.ts keeps its own inline copy
// on purpose — that file is the auth path, and this refactor is not worth
// touching it.

/** True when the request carries either shell signal. */
export function isNativeRequest(userAgent: string | null, scShellCookie: string | null): boolean {
  return (userAgent ?? "").includes("SwiftCardApp") || scShellCookie === "1";
}

/**
 * True when the request comes from the ANDROID shell. Android carries its
 * `SwiftCardAndroid/N` token (capacitor.config.ts android.appendUserAgent) on
 * its very first request, so unlike iOS there is no cookie fallback to need:
 * the server can decide an Android-only screen before the first byte. Used for
 * what Android must never show — the app sells nothing there (owner,
 * 2026-10-08; Google Play payments policy).
 */
export function isAndroidAppRequest(userAgent: string | null): boolean {
  return (userAgent ?? "").includes("SwiftCardAndroid/");
}
