import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { walletPromptKind, WALLET_PROMPT_SINCE } from "@/lib/wallet-prompt";

const read = (p: string) => readFileSync(p, "utf8");

// The new-card Wallet prompt (owner, 2026-10-19): a card made from now on
// opens with its Wallet button above Show QR — Apple in the iPhone app,
// Google on Android — until the button or the X is pressed. Then never again
// for that card, on any device.

const IOS_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 SwiftCardApp SwiftCardSplash/3";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_APP = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 SwiftCardApp SwiftCardAndroid/1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const NEW_CARD = { id: "c1", created_at: "2026-10-20T15:00:00Z", wallet_prompt_done_at: null };
const both = { appleWallet: true, googleWallet: true, shellCookie: null };

describe("who gets the new-card Wallet prompt", () => {
  it("the iPhone app gets Apple; Safari, a Mac and a PC get nothing", () => {
    expect(walletPromptKind({ ...both, card: NEW_CARD, userAgent: IOS_APP })).toBe("apple");
    expect(walletPromptKind({ ...both, card: NEW_CARD, userAgent: IPHONE_SAFARI })).toBeNull();
    expect(walletPromptKind({ ...both, card: NEW_CARD, userAgent: MAC })).toBeNull();
    expect(walletPromptKind({ ...both, card: NEW_CARD, userAgent: WINDOWS })).toBeNull();
  });

  it("an older iPhone build with no UA token is known by its sc_shell cookie", () => {
    expect(walletPromptKind({ ...both, shellCookie: "1", card: NEW_CARD, userAgent: IPHONE_SAFARI })).toBe("apple");
  });

  it("Android gets Google, in the app and in Chrome", () => {
    expect(walletPromptKind({ ...both, card: NEW_CARD, userAgent: ANDROID_APP })).toBe("google");
    expect(walletPromptKind({ ...both, card: NEW_CARD, userAgent: ANDROID_CHROME })).toBe("google");
    // The Android app carries SwiftCardApp too — it must never read as the iPhone app.
    expect(walletPromptKind({ ...both, shellCookie: "1", card: NEW_CARD, userAgent: ANDROID_APP })).toBe("google");
  });

  it("only when that wallet is configured — never a dead button", () => {
    expect(walletPromptKind({ ...both, appleWallet: false, card: NEW_CARD, userAgent: IOS_APP })).toBeNull();
    expect(walletPromptKind({ ...both, googleWallet: false, card: NEW_CARD, userAgent: ANDROID_CHROME })).toBeNull();
  });

  it("only for a card made since the prompt shipped", () => {
    expect(walletPromptKind({ ...both, card: { ...NEW_CARD, created_at: "2026-10-18T23:59:59Z" }, userAgent: IOS_APP })).toBeNull();
    expect(walletPromptKind({ ...both, card: { ...NEW_CARD, created_at: WALLET_PROMPT_SINCE }, userAgent: IOS_APP })).toBe("apple");
    expect(walletPromptKind({ ...both, card: { ...NEW_CARD, created_at: undefined }, userAgent: IOS_APP })).toBeNull();
  });

  it("gone for good once pressed or closed", () => {
    expect(walletPromptKind({ ...both, card: { ...NEW_CARD, wallet_prompt_done_at: "2026-10-20T16:00:00Z" }, userAgent: IOS_APP })).toBeNull();
  });

  it("nothing at all while the column isn't migrated — a prompt that can't be closed is worse than none", () => {
    const { wallet_prompt_done_at: _omit, ...unmigrated } = NEW_CARD;
    void _omit;
    expect(walletPromptKind({ ...both, card: unmigrated, userAgent: IOS_APP })).toBeNull();
    expect(walletPromptKind({ ...both, card: null, userAgent: IOS_APP })).toBeNull();
  });
});

describe("the prompt's wiring", () => {
  const dash = read("src/app/dashboard/page.tsx");
  const prompt = read("src/components/WalletPrompt.tsx");
  const route = read("src/app/api/cards/[id]/wallet-prompt/route.ts");

  it("sits in the Share box, before Show QR", () => {
    const share = dash.slice(dash.indexOf('data-tour="share"'));
    expect(share.indexOf("<WalletPrompt")).toBeGreaterThan(-1);
    expect(share.indexOf("<WalletPrompt")).toBeLessThan(share.indexOf("<QRCodeModal"));
  });

  it("is decided on the server from the request, not after hydration", () => {
    expect(dash).toMatch(/walletPromptKind\(\{/);
    expect(dash).toMatch(/\(await headers\(\)\)\.get\("user-agent"\)/);
    expect(dash).toMatch(/cookieStore\.get\("sc_shell"\)/);
  });

  it("records the ending with keepalive, and tells the other copy of the Share box", () => {
    expect(prompt).toMatch(/keepalive: true/);
    expect(prompt).toMatch(/\/wallet-prompt`/);
    expect(prompt).toMatch(/dispatchEvent\(new CustomEvent\(DONE_EVENT/);
    // Both the button and the X end it.
    expect(prompt).toMatch(/onPress=\{\(\) => finish\("added"\)\}/);
    expect(prompt).toMatch(/onClick=\{\(\) => finish\("dismissed"\)\}/);
    expect(prompt).toMatch(/aria-label="Dismiss"/);
  });

  it("the route only ever touches the caller's own card", () => {
    expect(route).toMatch(/auth\.getUser\(\)/);
    expect(route).toMatch(/\.eq\("user_id", user\.id\)/);
    expect(route).toMatch(/wallet_prompt_done_at: new Date\(\)\.toISOString\(\)/);
  });

  it("a Mac running the iPhone app is hidden before paint", () => {
    expect(prompt).toContain("sc-wallet-prompt");
    expect(read("src/app/globals.css")).toMatch(/\[data-sc-mac="1"\] \.sc-wallet-prompt \{ display: none !important; \}/);
  });

  it("never on the demo dashboard", () => {
    expect(read("src/app/preview/PreviewClient.tsx")).not.toContain("WalletPrompt");
  });

  it("a new card finishes on itself, so its prompt is on the card being looked at", () => {
    const wizard = read("src/app/cards/new/NewCardWizard.tsx");
    expect(wizard).toMatch(/card=\$\{encodeURIComponent\(createdUsername\)\}/);
  });
});
