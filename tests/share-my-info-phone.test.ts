import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const SRC = "src/components/ShareMyInfoButton.tsx";
const raw = readFileSync(join(root, SRC), "utf8");

// Comments have to go before any content assertion. The file DISCUSSES the
// wrong patterns in order to warn against them ("NOT window.location.origin"),
// so scanning the raw text would fail on the very comment that documents the
// rule. Same trap the office_members guard hit.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const code = stripComments(raw);

// Pull a function body out by balancing braces from its opening `{`. A regex
// stopping at the first `}` would truncate at the first nested block and let a
// violation further down slip through unnoticed.
function functionBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at === -1) throw new Error(`${name}() not found in ${SRC}`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

describe("contact Share menu — share from my phone", () => {
  it("builds the card link from the pinned APP_URL, never the current origin", () => {
    // The bug this pins: window.location.origin resolves to the Vercel PREVIEW
    // host on a preview deploy, so the recipient gets a *.vercel.app link that
    // 404s once that deploy is torn down — and it disagrees with the canonical
    // link /api/leads/share-card sends for the other three options. LoginForm
    // carries the same warning for auth redirects.
    expect(code).not.toContain("window.location.origin");
    expect(code).toContain('process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"');
    expect(functionBody(code, "sharePhone")).toContain("${APP_URL}/${");
  });

  it("sends nothing server-side and logs nothing for the phone share", () => {
    // Handing off to the OS share sheet tells us nothing about whether the
    // owner actually sent it. Posting to share-card would double-send through
    // Twilio; writing a message row would resurrect the "said Sent, never
    // arrived" bug that the Twilio delivery-status work removed.
    const body = functionBody(code, "sharePhone");
    expect(body).not.toContain("fetch(");
    expect(body).not.toContain("share-card");
    expect(body).not.toContain("logMessage");
  });

  it("does not await anything before navigator.share on the web path", () => {
    // navigator.share requires transient user activation. detectNativeApp() is
    // synchronous, so the click's activation survives to the call. Introducing
    // an await ahead of it (an async plan lookup, a fetch) makes Safari reject
    // the share with NotAllowedError — a failure that only shows up on a real
    // device, never in CI.
    const body = functionBody(code, "sharePhone");
    const shareAt = body.indexOf("navigator.share({");
    expect(shareAt).toBeGreaterThan(-1);
    // Drop the trailing `await ` that belongs to navigator.share itself —
    // awaiting the share call is expected; awaiting anything BEFORE it is not.
    const before = body.slice(0, shareAt).replace(/await\s+$/, "");
    // The one permitted await is the native-shell share (lib/native-share.ts),
    // which is unreachable on the web because detectNativeApp() returns false
    // there.
    const awaits = [...before.matchAll(/await\s+([A-Za-z_$.]*)/g)].map((m) => m[1]);
    expect(awaits.filter((a) => !a.startsWith("import") && !a.startsWith("Share.") && a !== "shareNatively")).toEqual([]);
  });

  it("offers all four share options, with the phone one not gated on the contact's channels", () => {
    // The phone share needs only a card link to hand over — a contact with no
    // phone and no email can still be shared with this way, unlike the three
    // SwiftCard-sent options.
    for (const action of ['action: "email"', 'action: "sms"', 'action: "both"', 'action: "phone"']) {
      expect(code).toContain(action);
    }
    const phoneOption = code.slice(code.indexOf('action: "phone"'));
    const enabled = phoneOption.slice(0, phoneOption.indexOf("hint:"));
    // It still needs a card to hand over...
    expect(enabled).toContain("!!cardOwner");
    // ...and it still must NOT depend on what channels the CONTACT has. That is
    // the invariant; the exact expression is not. `!isDark` joined it on
    // 2026-09-08 — a gate on the OWNER's card being switched off, not on the
    // contact — because a dark card's link 404s and previews as the generic
    // brand image (see share-never-sends-a-dark-card.test.ts).
    expect(enabled).not.toContain("hasPhone");
    expect(enabled).not.toContain("hasEmail");
  });
});
