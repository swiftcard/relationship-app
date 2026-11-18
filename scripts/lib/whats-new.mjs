// "What's New in This Version" for the release in flight — the ONE copy.
// scripts/asc-whats-new.mjs and scripts/asc-submit.mjs both read it; the
// history of every version's text lives in docs/ios-review/APP-STORE-METADATA.md
// "## Version". Change it here when the next version is cut.
//
// The notes describe what the BUILD changes, which for a remote-URL shell is a
// narrower list than "what changed in SwiftCard": every web improvement is
// already live for users without an app update.
//
// 1.0.7 / build 18 (2026-11-18). One native change since build 17: a card
// link texted from the app carries the owner's contact card, so someone who
// hasn't saved the owner can tap it, save them, and the link turns tappable
// (ios/App/App/ContactShare.swift). iMessage keeps links from unknown numbers
// switched off until the recipient saves or replies to the sender.
export const WHATS_NEW = "When you text your card link, your contact card now goes with it. iPhones keep links from numbers they haven't saved switched off, so someone you just met couldn't open yours. Now they tap your contact card, save you, and your link and its preview work right away.";
