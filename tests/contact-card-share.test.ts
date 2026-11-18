import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A texted card link carries the owner's contact card (iPhone app 1.0.7+).
//
// Owner report, 2026-11-18: a card link texted to someone the owner had just
// met arrived dead (not tappable, no preview) while the same link worked for
// the owner's partner. iMessage switches off links from a number the recipient
// hasn't saved until they save or reply to the sender. A contact card attached
// to the text still arrives; saving it makes the owner a known sender and the
// link comes on. These tests pin the pieces that make that happen, and the
// fallbacks that keep every older app and the website sharing exactly as before.

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

type Plugin = Record<string, (o: Record<string, unknown>) => Promise<unknown>>;
const g = globalThis as unknown as { window?: unknown };

function installShell(plugin: Plugin | null) {
  g.window = {
    webkit: { messageHandlers: { bridge: {} } },
    Capacitor: { Plugins: plugin ? { ContactShare: plugin } : {} },
  };
}

describe("lib/native-contact-share", () => {
  const calls: { method: string; opts: Record<string, unknown> }[] = [];
  beforeEach(() => { calls.length = 0; });
  afterEach(() => { delete g.window; });

  const plugin = (answers: Partial<Record<"share" | "text" | "prepare", () => Promise<unknown>>>): Plugin => ({
    prepare: (o) => { calls.push({ method: "prepare", opts: o }); return answers.prepare?.() ?? Promise.resolve({ ready: true }); },
    share: (o) => { calls.push({ method: "share", opts: o }); return answers.share?.() ?? Promise.resolve({ result: "shared" }); },
    text: (o) => { calls.push({ method: "text", opts: o }); return answers.text?.() ?? Promise.resolve({ result: "shared" }); },
  });

  it("the contact file is the card's public vCard on the SwiftCard domain", async () => {
    const m = await import("../src/lib/native-contact-share");
    expect(m.contactCardFileUrl("AaronLavi")).toBe("https://swiftcard.me/api/card/aaronlavi/vcard");
  });

  it("the website (no shell) is 'unavailable', so today's share runs", async () => {
    const m = await import("../src/lib/native-contact-share");
    expect(m.canShareContactCard()).toBe(false);
    expect(await m.shareLinkWithContact({ url: "https://swiftcard.me/x", slug: "x" })).toBe("unavailable");
    expect(await m.textWithContact({ phone: "+15555550100", body: "hi", slug: "x" })).toBe("unavailable");
  });

  it("an app older than 1.0.7 (no ContactShare plugin) is 'unavailable'", async () => {
    installShell(null);
    const m = await import("../src/lib/native-contact-share");
    expect(m.canShareContactCard()).toBe(false);
    expect(await m.shareLinkWithContact({ url: "https://swiftcard.me/x", slug: "x" })).toBe("unavailable");
  });

  it("the share sheet gets the link, the vCard URL and the owner's name", async () => {
    installShell(plugin({}));
    const m = await import("../src/lib/native-contact-share");
    expect(m.canShareContactCard()).toBe(true);
    expect(await m.shareLinkWithContact({ url: "https://swiftcard.me/aaronlavi", slug: "aaronlavi", name: "Aaron Lavi" })).toBe("shared");
    expect(calls).toEqual([{ method: "share", opts: { url: "https://swiftcard.me/aaronlavi", vcardUrl: "https://swiftcard.me/api/card/aaronlavi/vcard", fileName: "Aaron Lavi" } }]);
  });

  it("closing the sheet is final: 'cancelled', never a second sheet", async () => {
    installShell(plugin({ share: async () => ({ result: "cancelled" }), text: async () => ({ result: "cancelled" }) }));
    const m = await import("../src/lib/native-contact-share");
    expect(await m.shareLinkWithContact({ url: "https://swiftcard.me/x", slug: "x" })).toBe("cancelled");
    expect(await m.textWithContact({ phone: "+15555550100", body: "hi", slug: "x" })).toBe("cancelled");
  });

  it("a device that can't text falls back to the sms: link", async () => {
    installShell(plugin({ text: async () => { throw Object.assign(new Error("This device can't send texts"), { code: "UNAVAILABLE" }); } }));
    const m = await import("../src/lib/native-contact-share");
    expect(await m.textWithContact({ phone: "+15555550100", body: "hi", slug: "x" })).toBe("unavailable");
  });

  it("Share by text hands Messages the number, the written message and the card", async () => {
    installShell(plugin({}));
    const m = await import("../src/lib/native-contact-share");
    await m.textWithContact({ phone: "+15555550100", body: "Hi Sam!\nhttps://swiftcard.me/x", slug: "x", name: "" });
    expect(calls[0]).toEqual({ method: "text", opts: { phone: "+15555550100", body: "Hi Sam!\nhttps://swiftcard.me/x", vcardUrl: "https://swiftcard.me/api/card/x/vcard", fileName: "Contact" } });
  });
});

describe("the iPhone shell", () => {
  it("registers ContactSharePlugin (app-local plugins are never auto-discovered)", () => {
    expect(read("ios/App/App/MainViewController.swift")).toContain("bridge?.registerPluginInstance(ContactSharePlugin())");
  });

  it("compiles ContactShare.swift into the app target", () => {
    const proj = read("ios/App/App.xcodeproj/project.pbxproj");
    expect(proj).toMatch(/\/\* ContactShare\.swift in Sources \*\/ = \{isa = PBXBuildFile; fileRef = (\w+) \/\* ContactShare\.swift \*\/; \}/);
    expect(proj).toMatch(/files = \([^)]*ContactShare\.swift in Sources[^)]*\);/);
  });

  const swift = read("ios/App/App/ContactShare.swift");

  it("gives the contact card to Messages only; every other app keeps the bare link", () => {
    expect(swift).toContain('@objc(ContactSharePlugin)');
    expect(swift).toContain('public let jsName = "ContactShare"');
    expect(swift).toContain("activityType == .message ? file : nil");
    // A .vcf placeholder would drop apps that take links but not contact files
    // out of the share sheet.
    expect(swift).toMatch(/final class ContactCardItem[\s\S]*?activityViewControllerPlaceholderItem[^{]*\{ "" \}/);
    expect(swift).toMatch(/final class CardLinkItem[\s\S]*?itemForActivityType[^{]*\{ url \}/);
  });

  it("Share by text attaches the card to an addressed, written message", () => {
    expect(swift).toContain("MFMessageComposeViewController()");
    expect(swift).toContain("composer.recipients = [phone]");
    expect(swift).toContain("composer.body = body");
    expect(swift).toContain('addAttachmentData(card.data, typeIdentifier: "public.vcard"');
    expect(swift).toContain('call.reject("This device can\'t send texts", "UNAVAILABLE")');
  });

  it("a cancel resolves instead of rejecting, so no second sheet opens", () => {
    expect(swift).toContain('"result": completed ? "shared" : "cancelled"');
    expect(swift).toContain('call?.resolve(["result": result == .sent ? "shared" : "cancelled"])');
  });

  it("shares the link alone when the card can't be downloaded in time", () => {
    expect(swift).toContain("if let file = file { items.append(ContactCardItem(file: file)) }");
    expect(swift).toMatch(/downloadTimeout: TimeInterval = 4/);
  });
});

describe("the share buttons", () => {
  it("ShareButton tries the contact card before the plain native share", () => {
    const s = read("src/components/ShareButton.tsx");
    const withCard = s.indexOf("shareLinkWithContact({");
    const plain = s.indexOf("shareNatively({ url })");
    expect(withCard).toBeGreaterThan(-1);
    expect(plain).toBeGreaterThan(withCard);
    expect(s).toMatch(/if \(result === "unavailable"\) result = await shareNatively\(\{ url \}\);/);
  });

  it("the owner's own-card Share link buttons pass their card; a visitor's never does", () => {
    expect(read("src/app/dashboard/page.tsx")).toMatch(/<ShareButton[\s\S]*?contactCard=\{\{ slug: activeUsername/);
    expect(read("src/components/WelcomePlan.tsx")).toMatch(/<ShareButton[^>]*contactCard=\{\{ slug: cardSlug/);
    expect(read("src/app/cards/new/NewCardWizard.tsx")).toMatch(/<ShareButton[^>]*contactCard=\{createdUsername \?/);
    // A visitor sharing someone else's card is not sending their own contact.
    expect(read("src/app/[username]/page.tsx")).not.toContain("contactCard=");
  });

  it("Share by text decides synchronously and keeps the sms: link as the fallback", () => {
    const s = read("src/components/ShareMyInfoButton.tsx");
    const fn = s.slice(s.indexOf("function openText()"), s.indexOf("function shareText()"));
    expect(fn).toContain("if (cardOwner && canShareContactCard())");
    expect(fn).toContain('if (r === "unavailable") window.location.assign(smsHref(phone, body));');
    // Without the plugin the sms: link still rides the tap, no await first.
    expect(fn).toMatch(/return;\n {4}\}\n {4}window\.location\.assign\(smsHref\(phone, body\)\);/);
  });

  it("Share from my phone tries the contact card, then the plain native share", () => {
    const s = read("src/components/ShareMyInfoButton.tsx");
    const fn = s.slice(s.indexOf("async function sharePhone()"));
    expect(fn.indexOf("shareLinkWithContact({")).toBeGreaterThan(-1);
    expect(fn.indexOf("shareNatively({ url })")).toBeGreaterThan(fn.indexOf("shareLinkWithContact({"));
  });
});
