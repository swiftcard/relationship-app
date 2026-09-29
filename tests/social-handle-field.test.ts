import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { displayHandle } from "@/components/SocialHandleField";
import { SOCIAL_INPUTS } from "@/lib/social-input";
import { normalizeSocial, socialUrl } from "@/lib/social-url";

// ── What the social box SHOWS after its link prefix ─────────────────────────
//
// Owner, 2026-09-29: the box now shows the start of the link ("instagram.com/"
// | username) so nobody reads "yourname" as "type your name in lowercase". The
// saved value is untouched — Instagram/TikTok/X/Snapchat are kept as "@handle",
// LinkedIn/Facebook/YouTube often as a URL — so the DISPLAY has to meet each of
// those without ever showing "tiktok.com/@@alex" or a doubled address.

const stem = (k: string) => SOCIAL_INPUTS.find((s) => s.key === k)!.stem;

describe("displayHandle", () => {
  it("shows a saved @handle without its @ after the prefix", () => {
    expect(displayHandle(stem("instagram"), "@alexmorgan")).toEqual({ withPrefix: true, shown: "alexmorgan" });
    expect(displayHandle(stem("tiktok"), "@alexmorgan")).toEqual({ withPrefix: true, shown: "alexmorgan" });
    expect(displayHandle(stem("snapchat"), "@alexmorgan")).toEqual({ withPrefix: true, shown: "alexmorgan" });
  });

  it("shows a link on this platform as just the part after the prefix", () => {
    expect(displayHandle(stem("linkedin"), "linkedin.com/in/john-doe")).toEqual({ withPrefix: true, shown: "john-doe" });
    expect(displayHandle(stem("linkedin"), "https://www.linkedin.com/in/john-doe")).toEqual({ withPrefix: true, shown: "john-doe" });
    expect(displayHandle(stem("instagram"), "https://instagram.com/alexmorgan")).toEqual({ withPrefix: true, shown: "alexmorgan" });
    expect(displayHandle(stem("facebook"), "facebook.com/john-doe")).toEqual({ withPrefix: true, shown: "john-doe" });
    expect(displayHandle(stem("youtube"), "youtube.com/@alexmorgan")).toEqual({ withPrefix: true, shown: "alexmorgan" });
    expect(displayHandle(stem("twitter"), "https://twitter.com/alexmorgan")).toEqual({ withPrefix: true, shown: "alexmorgan" });
  });

  it("shows any other address whole, with the prefix hidden", () => {
    expect(displayHandle(stem("youtube"), "youtube.com/c/AlexMorganHomes")).toEqual({ withPrefix: false, shown: "youtube.com/c/AlexMorganHomes" });
    expect(displayHandle(stem("linkedin"), "https://www.linkedin.com/company/acme")).toEqual({ withPrefix: false, shown: "https://www.linkedin.com/company/acme" });
  });

  it("an empty box shows the prefix and nothing else", () => {
    for (const s of SOCIAL_INPUTS) expect(displayHandle(s.stem, "")).toEqual({ withPrefix: true, shown: "" });
  });

  it("what it shows, typed back in, still builds the same link", () => {
    // Round trip: the value a person sees, if they edit it, must not change
    // where the button goes.
    const cases: Array<[string, string]> = [
      ["instagram", "@alexmorgan"], ["tiktok", "@alexmorgan"], ["twitter", "@alexmorgan"],
      ["snapchat", "@alexmorgan"], ["linkedin", "linkedin.com/in/john-doe"],
      ["facebook", "facebook.com/john-doe"], ["youtube", "youtube.com/@alexmorgan"],
    ];
    for (const [k, saved] of cases) {
      const { shown } = displayHandle(stem(k), saved);
      expect(socialUrl(k, normalizeSocial(shown, k)), k).toBe(socialUrl(k, saved));
    }
  });
});

describe("the box itself", () => {
  // Comments stripped: they explain the history ("yourname", the URL keyboard).
  const src = readFileSync(join(process.cwd(), "src/components/SocialHandleField.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("asks for a username, never a name — no 'yourname' anywhere", () => {
    expect(src).toMatch(/placeholder="username"/);
    expect(src).not.toMatch(/yourname/);
  });

  it("after a prefix, a leading @ is dropped as typed — a lone @ could never be cleared", () => {
    expect(src).toMatch(/onChange\(withPrefix \? e\.target\.value\.replace\(\/\^@\+\/, ""\) : e\.target\.value\)/);
    // …and "filled" is what the person can see, not the raw value.
    expect(src).toMatch(/const filled = \(withPrefix \? shown : value\)\.trim\(\)\.length > 0/);
  });

  it("is not mistaken for a login form by password managers", () => {
    expect(src).toMatch(/autoComplete="off"/);
    expect(src).toMatch(/name=\{`social-\$\{spec\.key\}`\}/);
  });

  it("keeps the saved value untouched — only the display changes", () => {
    // What is typed goes out as typed (only a leading @ after a prefix is
    // dropped, pinned above); normalizeSocial still runs on the caller's blur.
    expect(src).toMatch(/: e\.target\.value\)\}/);
    // The box always shows the tidied value — a managed (office) one too,
    // which read "instagram.com/ @northbeamhomes" before (live check).
    expect(src).toMatch(/value=\{shown\}/);
  });

  it("the focus ring is on the whole box, so the global outline cannot cut through it", () => {
    expect(src).toMatch(/focus-within:ring-2/);
    expect(src).toMatch(/style=\{\{ outline: "none" \}\}/);
  });

  it("uses the plain keyboard: the iPhone URL keyboard has no space bar", () => {
    const input = src.slice(src.indexOf("<input"), src.indexOf("/>", src.indexOf("<input")));
    expect(input).not.toMatch(/inputMode="url"/);
  });
});
