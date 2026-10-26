import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Android picks the status-bar icon colour from the PHONE's dark mode unless
// the app sets it. Nightly QA (qa-android-shell.mjs) flagged
// "status-bar-style-unset" on every screen.
const src = readFileSync(join(__dirname, "..", "src/components/NativeAppBridge.tsx"), "utf8");

describe("Android status-bar style", () => {
  it("sets the SystemBars style from the app theme", () => {
    expect(src).toContain("SystemBars");
    expect(src).toMatch(/setStyle\(\{\s*style\s*\}\)/);
    expect(src).toContain('"LIGHT"');
    expect(src).toContain('"DARK"');
  });

  it("re-applies when the theme attribute changes, and only on Android", () => {
    expect(src).toContain('attributeFilter: ["data-sc-theme"]');
    expect(src).toMatch(/detectNativePlatform\(\) === "android"\)\s*\{\s*const systemBars/);
    expect(src).toContain("themeWatch?.disconnect()");
  });
});
