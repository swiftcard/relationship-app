import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { welcomeEmail } from "@/lib/email-templates";

// Office audit (owner, 2026-09-17): what a TEAM MEMBER and an OFFICE OWNER see
// has to make sense for how the plan works — the owner pays per seat, a
// member's card is their seat. Each rule below came from walking both roles on
// the live site.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a team member has one company card", () => {
  it("no + Add card on the dashboard", () => {
    expect(read("src/app/dashboard/page.tsx")).toContain("{!isOfficeMember && <AddCardButton");
  });
  it("the card API refuses a second card and refuses deleting theirs", () => {
    expect(read("src/app/api/cards/route.ts")).toContain("if ((count ?? 0) >= 1 && (await getOfficeSubUserContext(user.id)))");
    expect(read("src/app/api/cards/[id]/route.ts")).toContain("Your company card is managed by your Office admin.");
  });
  it("the builder sends a member who already has their card back to the dashboard", () => {
    expect(read("src/app/cards/new/page.tsx")).toContain('if (user && cardCount >= 1 && (await getOfficeSubUserContext(user.id))) redirect("/dashboard");');
  });
});

describe("nothing to buy, nothing to refer", () => {
  it("members see no Help-us-grow heart anywhere (the page sends them away)", () => {
    // One shared top bar since 2026-10-07 (AppTopNav): the heart is drawn
    // only when the page says showGrow, and every page says it for non-members.
    expect(read("src/components/AppTopNav.tsx")).toContain('{showGrow && <span data-tour="nav-grow"');
    expect(read("src/app/dashboard/page.tsx")).toContain("showGrow={!isOfficeMember}");
    expect(read("src/app/contacts/page.tsx")).toContain("showGrow={!officeSubUser}");
    expect(read("src/app/share/page.tsx")).toContain("showGrow={!officeSubUser}");
    expect(read("src/app/settings/flows/page.tsx")).toContain("showGrow={!isOfficeSubUser}");
  });
  it("members never reach checkout — including a billing_admin", () => {
    expect(read("src/app/checkout/page.tsx")).toContain('if (user && (await getOfficeSubUserContext(user.id))) redirect("/dashboard");');
    const route = read("src/app/api/stripe/checkout/route.ts");
    const guard = route.slice(route.indexOf("const subBlocked"), route.indexOf("if (subBlocked)"));
    expect(guard).not.toContain("manage_billing");
  });
  it("Office accounts get no Pro referral rewards (owner included)", () => {
    expect(read("src/app/settings/flows/page.tsx")).toContain('{!isOfficeSubUser && profile.plan !== "enterprise" && (');
    expect(read("src/app/grow/page.tsx")).toContain('{profile.plan !== "enterprise" && <div>');
    expect(read("src/app/api/referrals/claim/route.ts")).toContain('if (acct?.plan === "enterprise")');
  });
  it("a member's welcome email has no 'connect your CRM' step", () => {
    const member = welcomeEmail({ firstName: "Priya", cardUrl: "https://swiftcard.me/priya", officeMember: true }).html;
    const personal = welcomeEmail({ firstName: "Priya", cardUrl: "https://swiftcard.me/priya" }).html;
    expect(member).not.toContain("Send new contacts to your CRM");
    expect(personal).toContain("Send new contacts to your CRM");
  });
});

describe("the owner", () => {
  it("deleting their account ends the team's plan right away", () => {
    expect(read("src/app/api/account/delete/route.ts")).toContain("await tearDownOfficeForOwner(admin, user.id);");
    // …every ACTIVE member is released now (their own plan, unbranded, cards
    // handed back, membership suspended) and the owner's profile unlinked. The
    // office row itself stays until the 30-day purge (lib/account-purge), so a
    // reopened account — or a switch back to Office — gets its team back.
    const sync = read("src/lib/office-billing-sync.ts");
    const teardown = sync.slice(sync.indexOf("export async function tearDownOfficeForOwner"));
    expect(teardown).toContain('.eq("status", "active")');
    expect(teardown).toContain('update({ status: "suspended" })');
    expect(teardown).toContain('update({ is_office_card: false })');
    expect(teardown.indexOf("stripBrandFromUserCards(uid, brand)")).toBeLessThan(teardown.indexOf('update({ is_office_card: false })'));
    expect(teardown).toContain('await admin.from("profiles").update({ office_id: null }).eq("id", ownerId).eq("office_id", office.id);');
    expect(teardown).not.toContain('from("offices").delete()');
    expect(read("src/lib/account-purge.ts")).toContain('from("offices").delete()');
  });
  it("the team list shows each person's job title from their card", () => {
    expect(read("src/lib/office-team.ts")).toContain("title: cardTitle.get(e.userId) || (prof?.title as string | null) || null,");
  });
  it("the console shows Branding only to roles that can open it, and Billing to whoever pays", () => {
    const layout = read("src/app/office/admin/layout.tsx");
    expect(layout).toContain('<OfficeAdminNav canBrand={caps.canBrand} canBill={!!officeId && (role === "owner" || role === "billing_admin")} />');
  });
});
