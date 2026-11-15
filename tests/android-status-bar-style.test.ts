import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Android app must set its own status-bar icon style. Left unset, Android
// uses the PHONE's dark mode, so a light app on a dark phone gets white icons
// on a white screen (nightly-app finding: status-bar-style-unset).

const src = readFileSync(join(__dirname, "..", "src/components/NativeAppBridge.tsx"), "utf8");

describe("Android status-bar style", () => {
  it("calls SystemBars.setStyle from the native bridge", () => {
    expect(src).toContain("SystemBars.setStyle");
    expect(src).toContain("SystemBarsStyle.Light");
    expect(src).toContain("SystemBarsStyle.Dark");
  });

  it("follows the app's theme attribute, and re-applies when it changes", () => {
    expect(src).toContain('getAttribute("data-sc-theme") === "light"');
    expect(src).toContain("MutationObserver");
  });

  it("only runs on Android", () => {
    const i = src.indexOf("SystemBars.setStyle");
    const before = src.slice(0, i);
    const guard = before.lastIndexOf('detectNativePlatform() !== "android"');
    expect(guard).toBeGreaterThan(before.lastIndexOf("useEffect("));
  });
});
