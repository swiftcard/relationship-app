import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// A team invite is claimed only via its /join/<token> link. Someone who
// installs the iPhone app first and signs in with Google (same email) used to
// land as a plain Free account with no way into the hub, while the admin saw
// "Pending" forever (owner report, 2026-09-06). These pin the two doors that
// now hand them the Join step, and the one door that was removed.
describe("a pending team invite finds the person by email", () => {
  it("onboarding sends a fresh account with an invite to Join, not to a personal card", () => {
    const s = code("src/app/onboarding/page.tsx");
    expect(s).toContain("findPendingInviteForEmail");
    // A brand-new account with no invite builds its card first (2026-10-02);
    // the invite still wins over the builder.
    expect(s).toMatch(/redirect\(newAccountNext \?\? \(await inviteLanding\(user\.email, user\.id\)\) \?\? "\/cards\/new\?add=1"\)/);
    expect(s).toMatch(/redirect\(safeNext \?\? \(await inviteLanding\(user\.email, user\.id\)\) \?\? "\/dashboard"\)/);
  });

  it("the dashboard shows the invite on both the empty and the normal screen", () => {
    const s = code("src/app/dashboard/page.tsx");
    expect(s).toContain("<PendingInviteBanner officeName={pendingInvite.officeName} token={pendingInvite.token} primary />");
    expect(s).toContain("{pendingInvite && <PendingInviteBanner");
    // Office members never see it — they already have a seat.
    // (Awaited beside the trial check, not after it — same rule.)
    expect(s).toContain("isEnterprise ? null : findPendingInviteForEmail(user.email, user.id)");
  });

  it("the lookup only returns live, pending invites for the exact address", () => {
    const s = code("src/lib/pending-invite.ts");
    expect(s).toContain('.eq("status", "pending")');
    // Exact: ILIKE's `_` and `%` are escaped, so j_smith@ can't match jasmith@.
    expect(s).toContain('.ilike("invite_email", likeExact(addr))');
    expect(s).toMatch(/replace\(\/\[\\\\%_\]\/g/);
    // Only invites that can actually be accepted: the office still pays, and
    // the person doesn't own a team of their own.
    expect(s).toContain('owner?.plan !== "enterprise"');
    expect(s).toContain('.eq("owner_id", userId)');
    expect(s).toContain("isInviteExpired");
  });

  it("the invite email has one door: no App Store badge", () => {
    const s = code("src/lib/office-invite-email.ts");
    expect(s).not.toContain("appStoreUrl");
    expect(code("src/app/api/office/invite/route.ts")).not.toContain("appStoreUrl");
  });
});
