import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Android's WebView has no createWebViewWith hook like iOS, so NativeAppBridge
// must hand target="_blank" links (dashboard "View Live Link") to the browser.
describe("Android new-tab links leave the app", () => {
  const bridge = readFileSync("src/components/NativeAppBridge.tsx", "utf8");

  it("intercepts same-origin _blank clicks on Android and opens the default browser", () => {
    expect(bridge).toContain(`closest("a[target='_blank'][href]")`);
    expect(bridge).toMatch(/document\.addEventListener\("click", onClick, true\)/);
    expect(bridge).toMatch(/document\.removeEventListener\("click", onClick, true\)/);
    expect(bridge).toMatch(/u\.origin !== window\.location\.origin/);
    expect(bridge).toMatch(/openLinkInDefaultBrowser\(u\.pathname \+ u\.search \+ u\.hash\)/);
  });
});
