import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const src = readFileSync("src/components/NativeAppBridge.tsx", "utf8");

// The nightly Android run found "View live" (target=_blank → /api/self-view)
// never reached the browser: only iOS has a native new-window hand-off.
describe("Android new-tab links", () => {
  it("are handed to the default browser by the bridge", () => {
    const start = src.indexOf("New-tab links to our own site leave for the browser on Android");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1600);
    expect(block).toContain(`detectNativePlatform() !== "android"`);
    expect(block).toContain("a[target=_blank]");
    expect(block).toContain("e.preventDefault()");
    expect(block).toContain("openLinkInDefaultBrowser(dest)");
    expect(block).toContain(`document.addEventListener("click", onClick)`);
    expect(block).toContain(`document.removeEventListener("click", onClick)`);
  });
});
