import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Android picks status-bar icon colour from the PHONE's dark mode unless the
// app sets it. The app's theme is light by default, so it must say so.
const src = readFileSync("src/components/NativeAppBridge.tsx", "utf8");

describe("Android status-bar style", () => {
  it("sets the SystemBars style from the app theme", () => {
    expect(src).toMatch(/SystemBars\.setStyle\(/);
    expect(src).toMatch(/SystemBarsStyle\.Light/);
    expect(src).toMatch(/SystemBarsStyle\.Dark/);
  });

  it("follows theme flips and is android-only", () => {
    expect(src).toMatch(/attributeFilter:\s*\["data-sc-theme"\]/);
    expect(src).toMatch(/detectNativePlatform\(\) !== "android"/);
  });
});
