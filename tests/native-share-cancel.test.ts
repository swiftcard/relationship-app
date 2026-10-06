import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Closing the app's share sheet without sharing opened a SECOND sheet: the
// plugin rejects on cancel, and every share button read any rejection as "no
// plugin here, try navigator.share" — so the owner had to close it twice
// (dashboard "Share link", 2026-10-06). lib/native-share.ts tells the two apart.

// A plain stand-in, not vi.fn(): vitest's spy records a rejected return value
// and fails the test with it even though shareNatively caught it.
const calls: unknown[] = [];
let answer: () => Promise<unknown> = async () => ({});
vi.mock("@capacitor/share", () => ({
  Share: { share: (o: unknown) => { calls.push(o); return answer(); } },
}));

import { shareNatively } from "../src/lib/native-share";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const fail = (message: string, code?: string) => async () => { throw Object.assign(new Error(message), code ? { code } : {}); };

describe("shareNatively", () => {
  beforeEach(() => { calls.length = 0; });

  it("a finished share is 'shared'", async () => {
    answer = async () => ({ activityType: "com.apple.UIKit.activity.Message" });
    expect(await shareNatively({ url: "https://swiftcard.me/x" })).toBe("shared");
    expect(calls).toEqual([{ url: "https://swiftcard.me/x" }]);
  });

  it("closing the sheet is 'cancelled', not a reason to open another one", async () => {
    answer = fail("Share canceled");
    expect(await shareNatively({ url: "https://swiftcard.me/x" })).toBe("cancelled");
  });

  it("an app's share extension failing is the end of it too", async () => {
    answer = fail("Error sharing item");
    expect(await shareNatively({ url: "https://swiftcard.me/x" })).toBe("cancelled");
  });

  it("only a shell without the plugin is 'unavailable'", async () => {
    answer = fail('"Share" plugin is not implemented on ios', "UNIMPLEMENTED");
    expect(await shareNatively({ url: "https://swiftcard.me/x" })).toBe("unavailable");
  });
});

describe("every native share button stops when the sheet is closed", () => {
  for (const f of ["src/components/ShareButton.tsx", "src/components/GrowShare.tsx", "src/components/ShareMyInfoButton.tsx"]) {
    it(f, () => {
      const src = read(f);
      expect(src).toMatch(/shareNatively\(/);
      // The old shape: an inline plugin call whose catch fell through to the
      // web sheet on a cancel.
      expect(src).not.toMatch(/Share\.share\(/);
      expect(src).toMatch(/!== "unavailable"\) return;/);
    });
  }
});
