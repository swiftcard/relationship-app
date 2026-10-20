import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── A team invite is for ONE address, with ONE way in ───────────────────────
// Owner, 2026-09-24: "There should only be an option to create an account and
// it should tell them to create an account with the email address they were
// invited with … There really shouldn't be a login button."

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the invite page", () => {
  const s = code("src/components/JoinSignIn.tsx");

  it("has no log-in option beside Create my account — in the app or on the web", () => {
    expect(s).not.toContain("I already have an account");
    // Exactly one link out of the app branch, and it is chosen, not offered.
    const nativeBranch = s.slice(s.indexOf("if (native) {"), s.indexOf("return (", s.indexOf("if (native) {") + 200));
    expect(nativeBranch.match(/<Link/g) ?? []).toHaveLength(1);
    expect(nativeBranch).toContain('{hasAccount ? "Sign in to accept" : "Create my account"}');
    expect(nativeBranch).toContain("/login?mode=signup&next=${back}");
  });

  it("tells them to use the invited email", () => {
    expect(s).toContain("Create your account with <span");
    expect(s).toContain(", the email your team invited.");
    expect(s).toContain('"Email me a link to create my account"');
  });

  it("offers sign-in ONLY when the invited address already has an account", () => {
    const page = code("src/app/join/[token]/page.tsx");
    expect(page).toContain("const hasAccount = await invitedEmailHasAccount(inviteEmail);");
    expect(page).toContain("hasAccount={hasAccount}");
    // Signed in as the invited address already: no "Switch account" to elsewhere.
    expect(page).not.toContain("Switch account");
  });
});

describe("the account form after it", () => {
  it("is fixed to the invited address, with no Sign in / Create account switch", () => {
    const login = code("src/app/login/page.tsx");
    expect(login).toContain("const inviteEmail = await inviteEmailForNext(next);");
    expect(login).toContain("lockedEmail={inviteEmail ?? undefined}");
    const form = code("src/components/LoginForm.tsx");
    expect(form).toContain("{!lockedEmail && (");
    expect(form).toContain("readOnly={!!lockedEmail}");
    expect(form).toContain("const emailNow = lockedEmail ?? ");
  });

  it("an address that gains an account meanwhile goes back to the invite, which then offers its sign-in", () => {
    const form = code("src/components/LoginForm.tsx");
    expect(form).toMatch(/if \(lockedEmail && friendly\.existing\) \{\s*window\.location\.replace\(safeNextPath\(redirectTo\) \?\? "\/login"\);/);
    // The address the admin sent is never second-guessed as a typo.
    expect(form).toContain("if (typo && !lockedEmail && suggestionDismissed !== emailNow) {");
  });

  it("only a live invite's token locks it, and the lookup is service-role only", () => {
    const lib = code("src/lib/invite-account.ts");
    expect(lib).toContain('if (!data?.invite_email || data.status !== "pending") return null;');
    expect(lib).toContain("isInviteExpired(");
    const sql = read("supabase/invite-account-exists.sql");
    expect(sql).toContain("revoke all on function public.auth_email_registered(text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.auth_email_registered(text) to service_role;");
  });
});
