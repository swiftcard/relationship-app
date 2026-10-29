import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ── A form must save what the person can SEE ────────────────────────────────
//
// Found on production 2026-09-11 by the nightly flow run: typing into the
// profile bio the instant the page painted, then pressing Save, showed a
// green "Saved" and lost the text. React attached ~1s after the DOM was there,
// so the DOM held the new bio while state still held the old one, and the
// submit serialised state. The fix reads every named field from the DOM at
// submit time (FormData) and lets it win. This pins that, so the bug cannot
// come back with a refactor that "simplifies" the submit.

describe("ProfileForm saves the DOM, not stale state", () => {
  const src = readFileSync("src/components/ProfileForm.tsx", "utf8");

  it("builds the payload from FormData at submit time", () => {
    expect(src).toMatch(/const fd = new FormData\(e\.currentTarget as HTMLFormElement\)/);
    expect(src).toMatch(/body: JSON\.stringify\(\{ \.\.\.formNow, template, customization: \{ \.\.\.customizationNow, links, testimonials \} \}\)/);
  });

  it("the bio textarea carries a name so FormData can see it", () => {
    expect(src).toMatch(/<textarea\s+name="about"\s+placeholder="A short bio/);
  });

  it("the bio textarea is uncontrolled so hydration cannot wipe pre-hydration typing", () => {
    const m = src.match(/<textarea\s+name="about"[\s\S]*?\/>/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/defaultValue=/);
    expect(m![0]).not.toMatch(/\svalue=/);
  });

  it("every text field the form state tracks has a matching name attribute", () => {
    // `handle` keys state by e.target.name, so a field without a name could
    // never have updated state either — this catches both problems at once.
    for (const key of ["name", "title", "company", "email", "phone", "website", "linkedin", "instagram", "twitter", "tiktok"]) {
      expect(src, key).toMatch(new RegExp(`name=(?:"${key}"|\\{"${key}"\\}|\\{f\\.name\\})`));
    }
  });
});

describe("CardEditForm adopts pre-hydration typing", () => {
  const src = readFileSync("src/app/cards/[id]/edit/CardEditForm.tsx", "utf8");
  it("marks the six core fields and reads them back once on mount", () => {
    for (const key of ["name", "company", "title", "email", "website", "bio"]) {
      expect(src, key).toMatch(new RegExp(`data-hydrate="${key}"`));
      expect(src, `adopt ${key}`).toMatch(new RegExp(`adopt\\("${key}", ${key}, set${key[0].toUpperCase()}${key.slice(1)}\\)`));
    }
    expect(src).toMatch(/HYDRATION CATCH-UP/);
  });
});

describe("FlowSettingsForm saves the note the person can see", () => {
  const src = readFileSync("src/components/FlowSettingsForm.tsx", "utf8");
  it("marks the note, adopts it on mount, and reads the DOM at save", () => {
    expect(src).toMatch(/<textarea\s+data-hydrate="customNote"/);
    expect(src).toMatch(/HYDRATION CATCH-UP/);
    expect(src).toMatch(/customNote: noteEl\(\)\?\.value \?\? settings\.customNote/);
  });
});

describe("LoginForm signs in with what is in the fields", () => {
  const src = readFileSync("src/components/LoginForm.tsx", "utf8");
  it("reads email and password from FormData at submit, for sign-in, sign-up and reset", () => {
    expect(src).toMatch(/const fd = new FormData\(e\.currentTarget as HTMLFormElement\)/);
    expect(src).toMatch(/signInWithPassword\(\{ email: emailNow, password: passwordNow[,}]/);
    expect(src).toMatch(/signUp\(\{ email: emailNow, password: passwordNow, options/);
    expect(src).toMatch(/resetPasswordForEmail\(emailNow,/);
  });
});

describe("LoginForm keeps what was typed before hydration", () => {
  const src = readFileSync("src/components/LoginForm.tsx", "utf8");
  it("adopts the email and password already in the fields on mount", () => {
    expect(src).toMatch(/ADOPT WHAT IS ALREADY TYPED/);
    expect(src).toMatch(/getElementById\("auth-email"\)[\s\S]{0,80}\?\.value/);
    expect(src).toMatch(/getElementById\("auth-password"\)[\s\S]{0,80}\?\.value/);
    expect(src).toMatch(/if \(typedEmail\) setEmail\(typedEmail\);/);
    expect(src).toMatch(/if \(typedPassword\) setPassword\(typedPassword\);/);
  });
});
