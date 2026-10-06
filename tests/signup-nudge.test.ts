import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SIGNUP_SOURCES, isSignupSource } from "@/lib/referral";

// ─────────────────────────────────────────────────────────────────────────────
// THE FREE-CARD INVITE APPEARS AT THE MOMENT OF VALUE — AND ONLY THEN.
//
// Why it wasn't appearing (each pinned below):
//   1. One flat session slot, burned invisibly by incidental taps — the Share
//      button even fired it BEFORE the OS share sheet covered the page.
//   2. The slot was written BEFORE the popup rendered, so a slow account
//      check or a navigation spent it with nothing shown.
//   3. sessionStorage["sc_has_acct"]="1" survived sign-out, so a device that
//      had EVER been signed in kept reading "existing customer".
//   4. Delayed nudges fired into OS-sheet-backgrounded pages (throttled
//      timers, invisible popups).
// Audit scenarios (22)-(28): anonymous save/share → popup; logged-in user →
// no popup; only after the action succeeds; correct CTA route; no stacked
// duplicates; impression/click funnel attributed to the hosting card.
// ─────────────────────────────────────────────────────────────────────────────

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const host = read("src/components/SignupNudgeHost.tsx");
const share = read("src/components/ShareButton.tsx");

describe("each moment invites once EVER, spent only when a popup renders", () => {
  it("one lifetime flag PER CLASS in localStorage (owner order 2026-09-02)", () => {
    // Each class spends only its own flag, so an incidental tap can never
    // starve the save moment — but no moment ever invites twice, on any
    // card, in any session.
    expect(host).toMatch(/sc_nudged_ever:\$\{cls\}/);
    expect(host).toMatch(/localStorage\.getItem\(key\)/);
    // Saving is a save-class moment however it was triggered.
    expect(host).toMatch(/vcard: "save"/);
    expect(host).toMatch(/save_contact: "save"/);
    // The old session-scoped slots, per-card keys, and global cap are gone.
    // (The word survives only in the account-cache comment explaining why
    // it is NOT used — pin the calls, not the prose.)
    expect(host).not.toMatch(/sessionStorage\.(get|set)Item/);
    expect(host).not.toMatch(/NUDGE_SESSION_CAP/);
    expect(host).not.toMatch(/sc_nudge_count/);
  });

  it("EXCEPT the save moment, which invites every time (owner, 2026-10-05)", () => {
    // "They need to work every single time": a second save ended at the
    // share-back sheet with no invite, which read as a broken popup.
    expect(host).toMatch(/EVERY_TIME_CLASSES = new Set\(\["save"\]\)/);
    expect(host).toMatch(/onceEver && localStorage\.getItem\(key\)/);
    // Link taps and share-info stay rationed.
    expect(host).not.toMatch(/EVERY_TIME_CLASSES = new Set\(\[[^\]]*"(link|share)"/);
    // Unrationed must not mean stacked: a popup already on screen swallows
    // the next trigger instead of re-opening and re-counting.
    expect(host).toMatch(/if \(deciding\.current \|\| open\.current\) return;/);
  });

  it("the account check runs BEFORE the lifetime flag is written", () => {
    const handler = host.slice(host.indexOf("async function onNudge"));
    const acctCheck = handler.indexOf("await visitorHasAccount()");
    const slotWrite = handler.indexOf("localStorage.setItem(key,");
    expect(acctCheck).toBeGreaterThan(-1);
    expect(slotWrite).toBeGreaterThan(acctCheck);
  });

  it("overlapping nudges are serialized across the async gap", () => {
    expect(host).toMatch(/deciding\.current/);
  });
});

describe("(24) existing customers are excluded by a LIVE check, not a sticky flag", () => {
  it("the answer is cached in memory with a TTL — never persisted", () => {
    expect(host).toMatch(/acctCache/);
    expect(host).toMatch(/ACCT_CACHE_TTL_MS/);
    expect(host).not.toMatch(/sc_has_acct/);
  });

  it("fails open — a network hiccup never suppresses a genuine new visitor", () => {
    expect(host).toMatch(/return false; \/\/ fail open/);
  });

  it("account-state no longer lists sc_has_acct as a surviving key", () => {
    const state = read("src/lib/account-state.ts");
    expect(state).not.toMatch(/sc_has_acct — cosmetic/);
  });
});

describe("(25) the visitor's action completes FIRST", () => {
  it("ShareButton nudges only after the share resolves — never before the OS sheet opens", () => {
    const handler = share.slice(share.indexOf("async function handleShare"), share.indexOf("async function copyLink"));
    // Every nudge in the handler comes after an awaited share call.
    const firstNudge = handler.indexOf("triggerSignupNudge(");
    const firstShare = handler.indexOf("await ");
    expect(firstShare).toBeGreaterThan(-1);
    expect(firstNudge).toBeGreaterThan(firstShare);
    // A cancelled share nudges nothing.
    expect(handler).toMatch(/return; \/\/ user cancelled/);
  });

  it("delayed nudges wait for the page to be VISIBLE (OS sheets background it)", () => {
    const nudgeLib = read("src/lib/nudge.ts");
    expect(nudgeLib).toMatch(/visibilitychange/);
    for (const f of ["src/components/SaveContactButton.tsx", "src/components/LeadCaptureForm.tsx"]) {
      expect(read(f), f).toMatch(/triggerSignupNudgeWhenVisible\(/);
    }
  });
});

describe("(26) the CTA routes into the free-card flow with attribution intact", () => {
  it("links to /cards/new with the source", () => {
    expect(host).toMatch(/\/cards\/new\?src=\$\{encodeURIComponent\(source\)\}/);
  });

  it("every source the product fires is a registered signup source", () => {
    for (const src of ["vcard", "share_info", "link_button", "share_card", "save_contact", "save_contact_cta", "badge"]) {
      expect(isSignupSource(src), src).toBe(true);
    }
    expect(SIGNUP_SOURCES).toContain("save_contact_cta");
  });
});

describe("(28) the funnel is measured and attributed to the hosting card", () => {
  it("impressions and CTA clicks post analytics events with the card username", () => {
    expect(host).toMatch(/trackNudge\(cardUsername, "nudge_impression", src\)/);
    expect(host).toMatch(/trackNudge\(cardUsername, "nudge_cta_click", source\)/);
  });

  it("both public mount points pass the card", () => {
    expect(read("src/app/[username]/page.tsx")).toMatch(/<SignupNudgeHost cardUsername=\{profile\.username\}/);
    expect(read("src/app/links/[username]/page.tsx")).toMatch(/<SignupNudgeHost cardUsername=/);
  });
});
