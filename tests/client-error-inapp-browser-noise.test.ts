import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "src/components/ClientErrorReporter.tsx"), "utf8");

describe("ClientErrorReporter ignores in-app browser injected-script noise", () => {
  it("drops the Instagram window.webkit.messageHandlers TypeError", () => {
    const block = src.slice(src.indexOf("const IGNORE = ["), src.indexOf("];", src.indexOf("const IGNORE = [")));
    const patterns = [...block.matchAll(/^\s*(\/.+\/i),/gm)].map((m) => {
      const lit = m[1];
      return new RegExp(lit.slice(1, lit.lastIndexOf("/")), "i");
    });
    const msg = "TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers')";
    expect(patterns.some((re) => re.test(msg))).toBe(true);
  });
});
