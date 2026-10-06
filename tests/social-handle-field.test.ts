import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { displayHandle, linkedinLinkIn, linkedinLinkProblem, linkedinSteps, LINKEDIN_MY_PROFILE } from "@/components/SocialHandleField";
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

// ── LinkedIn: "Find my exact link" (owner, 2026-10-02) ──────────────────────
// LinkedIn addresses can be "johndoe", "john-doe" or "john-doe-4a7b21", and
// LinkedIn's sign-in never hands apps the address — so the box sends people to
// their own profile and accepts whatever they copy back.
describe("LinkedIn exact link", () => {
  it("pulls the address out of whatever was copied, without the ?utm tail", () => {
    expect(linkedinLinkIn("https://www.linkedin.com/in/john-doe-4a7b21?utm_source=share&utm_medium=ios_app"))
      .toBe("linkedin.com/in/john-doe-4a7b21");
    expect(linkedinLinkIn("Check out my profile on LinkedIn https://www.linkedin.com/in/john-doe-4a7b21/"))
      .toBe("linkedin.com/in/john-doe-4a7b21");
    expect(linkedinLinkIn("linkedin.com/in/johndoe")).toBe("linkedin.com/in/johndoe");
    expect(linkedinLinkIn("https://uk.linkedin.com/in/johndoe")).toBe("linkedin.com/in/johndoe");
    // Every shape LinkedIn itself puts on the clipboard.
    expect(linkedinLinkIn("https://www.linkedin.com/in/john-doe-4a7b21?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=android_app"))
      .toBe("linkedin.com/in/john-doe-4a7b21");
    expect(linkedinLinkIn("www.linkedin.com/in/john-doe-4a7b21")).toBe("linkedin.com/in/john-doe-4a7b21");
    expect(linkedinLinkIn("https://m.linkedin.com/in/john-doe-4a7b21")).toBe("linkedin.com/in/john-doe-4a7b21");
    // Copied from the address bar while a panel was open, or from LinkedIn Lite / an email.
    expect(linkedinLinkIn("https://www.linkedin.com/in/john-doe-4a7b21/overlay/contact-info/")).toBe("linkedin.com/in/john-doe-4a7b21");
    expect(linkedinLinkIn("https://www.linkedin.com/in/john-doe-4a7b21/details/experience/")).toBe("linkedin.com/in/john-doe-4a7b21");
    expect(linkedinLinkIn("https://www.linkedin.com/mwlite/in/john-doe-4a7b21")).toBe("linkedin.com/in/john-doe-4a7b21");
    expect(linkedinLinkIn("https://www.linkedin.com/comm/in/john-doe-4a7b21")).toBe("linkedin.com/in/john-doe-4a7b21");
    // Short links stay whole — linkedin.com/<code> opens nothing.
    expect(linkedinLinkIn("https://lnkd.in/gAbC123")).toBe("https://lnkd.in/gAbC123");
    expect(socialUrl("linkedin", linkedinLinkIn("https://lnkd.in/gAbC123")!)).toBe("https://lnkd.in/gAbC123");
    expect(linkedinLinkProblem("https://lnkd.in/gAbC123")).toBeNull();
    // Names in other alphabets arrive percent-encoded and must stay that way.
    expect(linkedinLinkIn("https://www.linkedin.com/in/%E5%BC%A0%E4%BC%9F-12345/")).toBe("linkedin.com/in/%E5%BC%A0%E4%BC%9F-12345");
    expect(linkedinLinkIn("https://www.linkedin.com/")).toBeNull();
    expect(linkedinLinkIn("John Doe")).toBeNull();
    expect(linkedinLinkIn("https://instagram.com/johndoe")).toBeNull();
  });

  it("a pasted link builds the exact profile, numbers and all", () => {
    const v = linkedinLinkIn("https://www.linkedin.com/in/john-doe-4a7b21?utm_source=share")!;
    expect(socialUrl("linkedin", v)).toBe("https://linkedin.com/in/john-doe-4a7b21");
  });

  it("flags LinkedIn's own shortcut and non-profile pages, never a real profile", () => {
    expect(linkedinLinkProblem("https://www.linkedin.com/in/me/")).toMatch(/shortcut/);
    expect(linkedinLinkProblem("me")).toMatch(/shortcut/);
    expect(linkedinLinkProblem("https://www.linkedin.com/feed/")).toMatch(/not your profile/);
    for (const ok of ["johndoe", "john-doe-4a7b21", "linkedin.com/in/john-doe", "https://www.linkedin.com/company/acme", "John Doe"]) {
      expect(linkedinLinkProblem(ok), ok).toBeNull();
    }
  });

  it("tells each device how to copy the link — address bar on a computer, Share profile → Copy on a phone", () => {
    const pc = linkedinSteps("computer");
    expect(pc.steps.join(" ")).toMatch(/web address at the top/);
    expect(pc.help).toMatch(/Sign in/);
    expect(linkedinSteps("computer", true).steps.join(" ")).toMatch(/⌘V/);
    expect(linkedinSteps("computer", false).steps.join(" ")).toMatch(/Ctrl\+V/);
    for (const phone of ["ios", "android"] as const) {
      const p = linkedinSteps(phone);
      expect(p.steps.join(" ")).toMatch(/Share profile → Copy/);
      expect(p.steps.join(" ")).toMatch(/Paste my link/);
      expect(p.help).toMatch(/Contact info/);
    }
    // Simple means short: three steps, none longer than a line on a phone.
    for (const d of ["computer", "ios", "android"] as const) {
      const { steps } = linkedinSteps(d);
      expect(steps).toHaveLength(3);
      for (const s of steps) expect(s.length, s).toBeLessThanOrEqual(70);
    }
    expect(LINKEDIN_MY_PROFILE).toBe("https://www.linkedin.com/in/me/");
  });

  const src = readFileSync(join(process.cwd(), "src/components/SocialHandleField.tsx"), "utf8");
  it("the helper is a real link (works before hydration) and only on LinkedIn rows", () => {
    expect(src).toMatch(/href=\{LINKEDIN_MY_PROFILE\}/);
    expect(src).toMatch(/const linkedin = spec\.key === "linkedin" && !managed/);
    // Device-specific steps never render on the server: they wait for the tap.
    expect(src).toMatch(/useState<Device \| null>\(null\)/);
  });
});
