// "What's New in This Version" for the release in flight — the ONE copy.
// scripts/asc-whats-new.mjs and scripts/asc-submit.mjs both read it; the
// history of every version's text lives in docs/ios-review/APP-STORE-METADATA.md
// "## Version". Change it here when the next version is cut.
//
// The notes describe what the BUILD changes, which for a remote-URL shell is a
// narrower list than "what changed in SwiftCard": every web improvement is
// already live for users without an app update.
//
// 1.0.5 / build 15 (2026-09-29). One native change since the live build 14:
// the Associated Domains entitlement is gone, so no swiftcard.me link ever
// opens inside the app.
export const WHATS_NEW = "Links to SwiftCards and Swift Links now always open in your web browser, never inside the app.";
