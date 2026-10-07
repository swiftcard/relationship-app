// "What's New in This Version" for the release in flight — the ONE copy.
// scripts/asc-whats-new.mjs and scripts/asc-submit.mjs both read it; the
// history of every version's text lives in docs/ios-review/APP-STORE-METADATA.md
// "## Version". Change it here when the next version is cut.
//
// The notes describe what the BUILD changes, which for a remote-URL shell is a
// narrower list than "what changed in SwiftCard": every web improvement is
// already live for users without an app update.
//
// 1.0.6 / build 17 (2026-10-02). One native change since the live build 16:
// with no connection the app shows the saved card's QR code instead of a blank
// screen (ios/App/App/OfflineCard.swift). Added 2026-10-06: the unread-count
// badge on the app icon (ios/App/App/AppBadge.swift).
export const WHATS_NEW = "Your QR code now works with no signal. Open SwiftCard without a connection and your card's QR code fills the screen, ready to scan. The app reloads by itself when you're back online. The SwiftCard icon now shows how many notifications you haven't read, and clears as you read them.";
