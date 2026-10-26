import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Android back button closes an open dialog by dispatching Escape
// (NativeAppBridge). A bell panel that ignores Escape stays open on back.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("notification bells close on Escape", () => {
  for (const file of ["src/components/NotificationBell.tsx", "src/components/office/OfficeNotificationBell.tsx"]) {
    it(`${file} listens for Escape while open`, () => {
      const src = read(file);
      expect(src).toMatch(/e\.key === "Escape"\) setOpen\(false\)/);
      expect(src).toMatch(/addEventListener\("keydown", onKey\)/);
    });
  }
});
