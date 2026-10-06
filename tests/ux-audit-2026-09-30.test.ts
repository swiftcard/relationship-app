import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The 2026-09-30 UX audit: Create → Preview → Share → Connect with as little
// thinking as possible. Each block pins one change at source so it cannot
// quietly come back.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("returning user: open SwiftCard → show my QR", () => {
  it("the dashboard keeps the card for the SESSION, and a fresh open asks again", () => {
    // This audit first made the dashboard reopen the one-year remembered card.
    // Owner, 2026-10-06: reopening the app must show "Select a card" again.
    // So the fallback is the session-only copy: bare /dashboard links inside
    // the app keep the card, a relaunch starts at the picker.
    const src = read("src/app/dashboard/page.tsx");
    expect(src).toMatch(/SESSION_CARD_COOKIE/);
    expect(src).not.toMatch(/ACTIVE_CARD_COOKIE/);
    expect(src).toMatch(/const selectedCard = params\.card \?\? sessionCard/);
    expect(src).toMatch(/const sessionCard = params\.pick \? null :/);
    expect(src).toMatch(/restored=\{!params\.card && !!sessionCard\}/);

    const lib = read("src/lib/active-card.ts");
    expect(lib).toMatch(/export const SESSION_CARD_COOKIE = "sc_session_card";/);

    // Written with NO max-age (a session cookie) next to its sessionStorage
    // marker; a session card this webview never wrote sends you to the picker.
    const persist = read("src/components/CardSelectionPersist.tsx");
    const write = persist.slice(persist.indexOf("document.cookie = `${SESSION_CARD_COOKIE}=${"));
    expect(write.slice(0, write.indexOf(";\n"))).not.toMatch(/max-age/);
    expect(persist).toMatch(/sessionStorage\.setItem\(SESSION_CARD_FLAG, "1"\)/);
    expect(persist).toMatch(/location\.replace\("\/dashboard\?pick=1"\)/);

    // Signing out / switching account drops it with the one-year copy.
    expect(read("src/lib/account-state.ts")).toMatch(/\$\{SESSION_CARD_COOKIE\}=; path=\/; max-age=0/);
  });

  it("Show QR is the share box's first, primary control", () => {
    const src = read("src/app/dashboard/page.tsx");
    const box = src.slice(src.indexOf('data-tour="share"'), src.indexOf("<MoreShareOptions"));
    expect(box, "no one-tap QR in the share box").toMatch(/<QRCodeModal[^>]*label="Show QR"[^>]*variant="primary"/);
    // It encodes the QR-tagged link so scans land in Traffic as QR scans.
    expect(box).toMatch(/url=\{qrScanUrl\(cardUrl\)\}/);
    // The link share is the quieter second option, in classes the light
    // theme remaps (an inline-styled variant went unreadable in light mode).
    expect(box).toMatch(/<ShareButton[\s\S]*?variant="ghost"/);
    expect(box.indexOf("<QRCodeModal")).toBeLessThan(box.indexOf("<ShareButton"));
  });

  it("the QR popup is a real dialog with a full-width code", () => {
    const src = read("src/components/QRCodeModal.tsx");
    expect(src).toMatch(/role="dialog"/);
    expect(src).toMatch(/aria-modal="true"/);
    expect(src).toMatch(/useDialogA11y\(open/);
    // The popup is the code and nothing else: no title, no address, no panel.
    expect(src).not.toMatch(/Scan to connect with/);
    expect(src).not.toMatch(/url\.replace\(/);
    expect(src).toMatch(/useCardQrStyle\(open\)/);
    expect(src).toMatch(/width: "min\(78vw, 360px\)"/);
    expect(src).toMatch(/prefers-reduced-motion: reduce\) \{ \.animate-pop \{ animation: none/);
  });

  it("the tour's share step teaches the button, not only the card's printed QR", () => {
    expect(read("src/lib/tour-steps.ts")).toMatch(/Tap Show QR/);
  });

  it("the knowledge base explains Show QR", () => {
    expect(read("src/lib/knowledge/docs/product.ts")).toMatch(/\\"Show QR\\" button opens a full-size QR code/);
  });

  it("in the app the QR download button says what it does (it shares a link)", () => {
    const src = read("src/components/QRDownloadButton.tsx");
    expect(src).toMatch(/useIsNativeApp\(\)/);
    expect(src).toMatch(/native \? "Share QR link" : "Download QR \(PNG\)"/);
  });
});

describe("new user: the card is live → share it", () => {
  for (const f of ["src/app/cards/new/NewCardWizard.tsx", "src/components/WelcomePlan.tsx"]) {
    it(`${f}: Show QR and Share link come before notifications and the app offer`, () => {
      const src = read(f);
      const live = src.indexOf("Your card is live!");
      expect(live).toBeGreaterThan(-1);
      const after = src.slice(live);
      const qr = after.indexOf('label="Show QR"');
      const share = after.indexOf('label="Share link"');
      const push = after.indexOf("<EnablePushButton");
      const app = after.indexOf("<GetTheAppCard");
      expect(qr, "no Show QR on the card-is-live screen").toBeGreaterThan(-1);
      expect(share, "no Share link on the card-is-live screen").toBeGreaterThan(-1);
      expect(qr).toBeLessThan(push);
      expect(share).toBeLessThan(push);
      expect(push).toBeLessThan(app);
      // The link itself is copyable, not plain text.
      expect(after.slice(0, qr)).toMatch(/<CopyButton text=\{liveUrl\}/);
    });
  }

  it("the welcome page hands the card's name to the QR title", () => {
    expect(read("src/app/welcome/page.tsx")).toMatch(/cardName=\{cardName\}/);
  });

  it("the getting-started doc describes the new order", () => {
    expect(read("src/lib/knowledge/docs/getting-started.ts")).toMatch(/blue \\"Show QR\\" button/);
  });
});

describe("recipient: the card is on screen in the first paint", () => {
  const src = read("src/components/CardScaler.tsx");

  it("reserves the card's box before it is measured (no layout shift)", () => {
    expect(src).toMatch(/aspectRatio: height \? undefined : `\$\{NATURAL\} \/ \$\{Math\.round\(NATURAL \/ 1\.75\)\}`/);
  });

  it("scales and reveals the card inline, before hydration", () => {
    expect(src).toMatch(/<script dangerouslySetInnerHTML=\{\{ __html: boot \}\} \/>/);
    expect(src).toMatch(/document\.currentScript/);
    expect(src).toMatch(/Math\.min\(1,w\/\$\{NATURAL\}\)/);
    // Both boxes the script touches are marked, so hydration stays quiet.
    expect(src.match(/^\s+suppressHydrationWarning$/gm)?.length).toBe(2);
  });
});

describe("recipient: Save Contact", () => {
  const src = read("src/components/SaveContactButton.tsx");
  const page = read("src/app/[username]/page.tsx");

  it("delivers the server vCard over an iframe on the web, like a QR scan does", () => {
    expect(src).toMatch(/vcardHref\?: string/);
    const body = src.slice(src.indexOf("async function downloadVCard"), src.indexOf("async function shareBack"));
    expect(body).toMatch(/if \(vcardHref && phoneLike\(\)\) \{[\s\S]*?createElement\("iframe"\)[\s\S]*?iframe\.src = vcardHref/);
    // Phones only — a desktop browser may render an inline vCard as text in
    // the hidden frame; there the download is what people expect.
    expect(src).toMatch(/function phoneLike\(\)/);
    // The browser-built file stays as the fallback (the /preview sample, and
    // an owner previewing a card that is not live yet).
    expect(body).toMatch(/new Blob\(\[vcard\]/);
  });

  it("the page offers the route exactly when the route will serve it", () => {
    expect(page).toMatch(/vcardHref=\{awaitingPlan \? undefined : `\/api\/card\/\$\{encodeURIComponent\(profile\.username\)\}\/vcard`\}/);
  });

  it("says Preparing… while the file is built, and says so when it fails", () => {
    expect(src).toMatch(/disabled=\{downloading\}/);
    expect(src).toMatch(/Preparing…/);
    expect(src).toMatch(/\} catch \{\s*setSaveErr\("Couldn't prepare the contact — please try again\."\);/);
    expect(src).toMatch(/\{saveErr && \(\s*<p role="alert"/);
  });

  it("never revokes the blob URL before the browser has started the download", () => {
    expect(src).not.toMatch(/a\.click\(\);\s*document\.body\.removeChild\(a\);\s*URL\.revokeObjectURL/);
    expect(src).toMatch(/setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 1500\)/);
  });

  it("the share-back sheet and the QR popup are dialogs: Escape, focus in, focus back", () => {
    expect(src).toMatch(/useDialogA11y\(showSheet && status !== "done", closeSheet, sheetRef, nameRef\)/);
    expect(src).toMatch(/useDialogA11y\(showQr, closeQr, qrRef\)/);
    expect(src).toMatch(/aria-labelledby="sc-shareback-title"/);
    expect(src).toMatch(/aria-labelledby="sc-scanqr-title"/);
  });

  it("the sheet's validation names the field and moves focus to it", () => {
    expect(src).not.toMatch(/shareErr\?\.startsWith\(/);
    expect(src).toMatch(/setShareMissing\("name"\);[\s\S]*?nameRef\.current\?\.focus\(\)/);
    expect(src).toMatch(/setShareMissing\("phone"\);[\s\S]*?phoneRef\.current\?\.focus\(\)/);
    expect(src).toMatch(/aria-describedby=\{shareErr \? "sc-shareback-err" : undefined\}/);
    expect(src).toMatch(/id="sc-shareback-err" role="alert"/);
  });

  it("the sheet's close is a 44px target and the post-save hint is legible", () => {
    expect(src).toMatch(/className="w-11 h-11 -mr-3 -mt-3[^"]*"\s*aria-label="Close"/);
    expect(src).not.toMatch(/text-\[0\.6875rem\]" style=\{\{ color: "#94a3b8" \}\}/);
    expect(src).toMatch(/text-xs" style=\{\{ color: "#64748b" \}\}/);
  });

  it("phones never download the QR encoder for a desktop-only popup", () => {
    expect(src).not.toMatch(/^import \{ MiniQR \} from/m);
    expect(src).toMatch(/const MiniQR = dynamic\(\(\) => import\("@\/components\/card-templates\/MiniQR"\)/);
  });

  it("section titles are headings a screen reader can jump to", () => {
    expect(page).toMatch(/function SectionHeading[\s\S]*?<h2 className="text-slate-900 font-bold/);
  });
});

describe("editor: nothing is lost without a word", () => {
  const src = read("src/app/cards/[id]/edit/CardEditForm.tsx");

  it("warns before a reload or closed tab while there are unsaved edits", () => {
    expect(src).toMatch(/const dirty = typed \|\| cardHistory\.canUndo \|\| linkHistory\.canUndo/);
    expect(src).toMatch(/addEventListener\("beforeunload", onBeforeUnload\)/);
    // Typing anywhere in the form counts.
    expect(src).toMatch(/<div onInput=\{noteTyped\}/);
    // A save clears it.
    expect(src).toMatch(/linkHistory\.clear\(\);\s*typedRef\.current = false;\s*setTyped\(false\);/);
  });

  it("Cancel asks in-page before discarding, and never with window.confirm", () => {
    expect(src).toMatch(/Discard your unsaved changes\?/);
    expect(src).toMatch(/Keep editing/);
    expect(src).not.toMatch(/window\.confirm\(/);
  });
});

describe("builder: essentials first, errors where the eye is", () => {
  const src = read("src/app/cards/new/NewCardWizard.tsx");

  it("the name error renders under the name box, wired to it", () => {
    expect(src).toMatch(/aria-describedby=\{nameMissing && error \? "wizard-name-error" : undefined\}/);
    expect(src).toMatch(/\{nameMissing && error && <p id="wizard-name-error" role="alert"/);
    expect(src).toMatch(/\{error && !nameMissing && <p role="alert"/);
  });

  it("the bio error is wired to the bio box", () => {
    expect(src).toMatch(/aria-describedby=\{bioMissing \? "wizard-bio-error" : undefined\}/);
    expect(src).toMatch(/<p id="wizard-bio-error" role="alert"/);
  });

  it("address and fax fold away until wanted", () => {
    const loc = src.slice(src.indexOf('id="location"'), src.indexOf('id="wizard-fax"'));
    expect(loc).toMatch(/<MoreOptions\s+label="Address & fax"/);
    expect(src).toMatch(/const \[locationStartOpen\] = useState\(\(\) => locationFilled\)/);
  });

  it("the resume screen says what 'Start a new card' costs before the button", () => {
    const warn = src.indexOf("Starting a new card deletes the unfinished one.");
    const btn = src.indexOf("Start a new card\n");
    expect(warn).toBeGreaterThan(-1);
    expect(warn).toBeLessThan(btn);
  });

  it("no vague failure copy, no machine codes as sentences", () => {
    expect(src).not.toMatch(/"Something went wrong\."/);
    expect(read("src/components/ProfileForm.tsx")).not.toMatch(/Something went wrong\./);
    const mc = read("src/components/ManageCards.tsx");
    expect(mc).not.toMatch(/data\.error \|\|/);
  });
});

describe("dialogs share one accessibility contract", () => {
  it("the hook exists and the share-options popup uses it", () => {
    const hook = read("src/lib/use-dialog-a11y.ts");
    expect(hook).toMatch(/e\.key === "Escape"/);
    expect(hook).toMatch(/opener\?\.focus/);
    const more = read("src/components/MoreShareOptions.tsx");
    expect(more).toMatch(/role="dialog" aria-modal="true" aria-labelledby="share-options-title"/);
    expect(more).toMatch(/useDialogA11y\(open/);
    expect(read("src/components/GuestGateModal.tsx")).toMatch(/useDialogA11y\(open/);
  });
});
