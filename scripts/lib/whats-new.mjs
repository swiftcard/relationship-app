// "What's New in This Version" for the release in flight — the ONE copy.
// scripts/asc-whats-new.mjs and scripts/asc-submit.mjs both read it; the
// history of every version's text lives in docs/ios-review/APP-STORE-METADATA.md
// "## Version". Change it here when the next version is cut.
//
// The notes describe what the BUILD changes, which for a remote-URL shell is a
// narrower list than "what changed in SwiftCard": every web improvement is
// already live for users without an app update.
//
// 1.0.5 / build 16 (2026-09-30). Two native changes since the live build 14:
// the Apple Watch app ships for the first time (build 15 was uploaded without
// it and never submitted), and the Associated Domains entitlement is gone, so
// no swiftcard.me link ever opens inside the app.
export const WHATS_NEW = "New: SwiftCard for Apple Watch. Your card's QR code on your wrist, with a watch-face complication that opens it in one tap. It follows the card you choose on your iPhone and works without your phone nearby.\n\nLinks to SwiftCards and Swift Links now always open in your web browser, never inside the app.";
