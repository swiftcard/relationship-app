import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Android WebView has no second window, so a target=_blank link ("View
// live", "Open Swift Links") stayed in the app or did nothing. The bridge must
// catch the click and hand the link to the default browser. Found by the
// nightly Android sweep: "new-tab-stays-in-app".
const bridge = readFileSync(join(__dirname, "..", "src/components/NativeAppBridge.tsx"), "utf8");

describe("Android new-tab links leave for the browser", () => {
  it("a click listener hands same-site target=_blank links to the browser plugin", () => {
    expect(bridge).toMatch(/addEventListener\("click"/);
    expect(bridge).toContain("a[target='_blank']");
    expect(bridge).toContain("openLinkInDefaultBrowser(u.pathname + u.search + u.hash)");
  });

  it("is Android-only, same-site only, and removes its listener", () => {
    const at = bridge.indexOf('addEventListener("click"');
    const block = bridge.slice(bridge.lastIndexOf("useEffect(", at), at + 200);
    expect(block).toContain('detectNativePlatform() !== "android"');
    expect(block).toContain('u.protocol !== "https:"');
    expect(block).toContain("swiftcard.me");
    expect(block).toContain('removeEventListener("click"');
  });
});
