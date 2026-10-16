import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ── Audit round 7 (2026-10-16) ───────────────────────────────────────────────
//
// C02-A52  A name with no Latin letters (李明, Иван) gave an empty address and
//          wizard step 1 refused to continue — for an Office member with no
//          company field, forever.
// C02-004  A rename copied the pre-edit pictures (old name/company) to the new
//          address, so the corrected card unfurled with the old one.
// NS-04    Every full page load in the app painted the WEBSITE's gates
//          ("Upgrade to Pro") until hydration, then swapped.

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => ({ from: () => { const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: null }), then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) }; return q; } }),
}));

const read = (p: string) => readFileSync(p, "utf8");

describe("C02-A52: a name in any script can make a card", () => {
  const wizard = read("src/app/cards/new/NewCardWizard.tsx");

  it("step 1 no longer stops on an address it couldn't build", () => {
    expect(wizard).not.toContain("Please enter a name we can turn into a URL.");
    expect(wizard).not.toMatch(/if \(!name\.trim\(\) \|\| !username\)/);
  });

  it("the server builds one anyway: the email's first part, else my-card", async () => {
    const { cardSlug } = await import("@/lib/slug");
    expect(cardSlug("李明", "")).toBe("");
    const { ensureUniqueUsername } = await import("@/lib/username");
    // "my-card", or a numbered/random variant when that is taken.
    expect(await ensureUniqueUsername("")).toMatch(/^my-card(-[a-z0-9]+)?$/);
    const create = read("src/app/api/cards/route.ts");
    expect(create).toMatch(/normalizeSlug\(String\(username \?\? ""\)\) \|\|\s*cardSlug\(String\(name \?\? ""\), String\(company \?\? ""\)\) \|\|\s*normalizeSlug\(String\(email \?\? ""\)\.split\("@"\)\[0\] \|\| ""\)/);
  });
});

describe("C02-004: a renamed card's address shows the card as it is now", () => {
  it("the rename copies no pictures to the new address", () => {
    const rename = read("src/lib/auto-rename-slug.ts").replace(/\/\/.*$/gm, "");
    expect(rename).not.toMatch(/storage\.from\(bucket\)\.(download|upload)/);
    expect(rename).not.toMatch(/\.upload\(`\$\{candidate\}\.png`/);
  });

  it("the save clears the pictures at the old AND the new address", () => {
    const route = read("src/app/api/cards/[id]/route.ts");
    expect(route).toContain("const capturedAt = [`${username}.png`, ...(renamedTo ? [`${renamedTo}.png`] : [])];");
    expect(route).toContain('admin.storage.from("card-shares").remove(capturedAt)');
    expect(route).toContain('admin.storage.from("card-signatures").remove(capturedAt)');
  });
});

describe("NS-04: the app's gates render the app's branch in the server HTML", () => {
  it("with the server saying 'app', the first render is the app's — no website selling copy", async () => {
    const { PlanGate } = await import("@/components/PlanGate");
    const { default: NativeRequestProvider } = await import("@/components/NativeRequestProvider");
    const gate = h(PlanGate, { feature: "test", nativeCopy: "Card scanning is a Pro feature." }, h("a", { href: "/upgrade" }, "Upgrade to Pro"));
    const app = renderToStaticMarkup(h(NativeRequestProvider, { native: true }, gate));
    expect(app).toContain("Card scanning is a Pro feature.");
    expect(app).not.toContain("Upgrade to Pro");
    // Website (or no boundary at all): exactly as before.
    expect(renderToStaticMarkup(h(NativeRequestProvider, { native: false }, gate))).toContain("Upgrade to Pro");
    expect(renderToStaticMarkup(gate)).toContain("Upgrade to Pro");
  });

  it("the boundary sits on every signed-in screen, and never in the root layout", () => {
    expect(read("src/app/layout.tsx")).not.toContain("NativeRequestBoundary");
    for (const f of [
      "src/app/dashboard/layout.tsx", "src/app/office/admin/layout.tsx", "src/app/contacts/layout.tsx",
      "src/app/settings/layout.tsx", "src/app/share/layout.tsx", "src/app/cards/layout.tsx",
      "src/app/grow/layout.tsx", "src/app/upgrade/layout.tsx",
    ]) {
      expect(existsSync(f), f).toBe(true);
      expect(read(f), f).toContain("<NativeRequestBoundary>{children}</NativeRequestBoundary>");
    }
  });

  it("the boundary decides exactly as the rest of the server does", () => {
    const b = read("src/components/NativeRequestBoundary.tsx");
    expect(b).toContain('isNativeRequest(h.get("user-agent"), c.get("sc_shell")?.value ?? null)');
    expect(read("src/lib/platform.ts")).toMatch(/const serverKnew = useContext\(NativeRequestContext\);\s*const \[native, setNative\] = useState\(serverKnew\);/);
  });
});
