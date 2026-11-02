import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// nightly-app: on Android a target=_blank link to /api/self-view ("View live")
// was never handed to the browser — it loaded inside the app.
const src = readFileSync(join(__dirname, "../src/components/NativeAppBridge.tsx"), "utf8");

describe("Android new-tab links leave the app", () => {
  it("NativeAppBridge intercepts target=_blank same-origin anchors on Android", () => {
    expect(src).toContain('detectNativePlatform() !== "android"');
    expect(src).toContain("a[target=_blank][href]");
    expect(src).toMatch(/addEventListener\("click", onClick, true\)/);
  });

  it("hands them to the default browser through the plugin", () => {
    const at = src.indexOf("a[target=_blank][href]");
    expect(src.slice(at, at + 1200)).toContain("openLinkInDefaultBrowser(dest)");
  });
});
