import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Android app never set its status-bar style, so Android used the PHONE's
// dark mode: light icons on a light screen (nightly-app "status-bar-style-unset").

const src = readFileSync(join(__dirname, "..", "src/components/NativeAppBridge.tsx"), "utf8");

describe("Android status-bar style", () => {
  it("sets the SystemBars style from the app's theme, on Android only", () => {
    expect(src).toMatch(/SystemBars\.setStyle\(/);
    expect(src).toMatch(/SystemBarsStyle\.Dark\s*:\s*SystemBarsStyle\.Light/);
    expect(src).toMatch(/detectNativePlatform\(\) !== "android"\) return;\s*\n\s*let cancelled = false;\s*\n\s*const root/);
  });

  it("re-applies when the theme class or data-theme changes", () => {
    expect(src).toMatch(/attributeFilter: \["class", "data-theme"\]/);
  });
});
