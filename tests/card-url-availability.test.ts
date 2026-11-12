import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { slugAvailability } from "@/lib/username";

// The card URL editor's "is it free?" check (owner, 2026-11-12: "if a username
// is taken and a user puts in that username, it won't let them save it and
// it'll say it's taken already … There can't be any flaws with this").
//
// slugAvailability is the rule the editor asks while you type. It has to say
// exactly what the save will do — the rename route (reserved names, another
// card's old address) plus rename_card_slug (any card, any account handle) —
// or the editor would promise a URL the save then refuses, or the reverse.

type Card = { id: string; username: string; prevSlugs?: string[] };
type World = { cards: Card[]; profiles: { id: string; username: string }[]; fail?: boolean };

/** Just enough of the Supabase query builder for the two lookups involved. */
function fakeAdmin(w: World) {
  return {
    from(table: "cards" | "profiles") {
      const f: { eq?: [string, string]; neq?: [string, string]; contains?: string } = {};
      const q = {
        select: () => q,
        eq: (c: string, v: string) => { f.eq = [c, v]; return q; },
        neq: (c: string, v: string) => { f.neq = [c, v]; return q; },
        contains: (_c: string, v: { _prevSlugs: string[] }) => { f.contains = v._prevSlugs[0]; return q; },
        limit: () => q,
        maybeSingle: async () => {
          if (w.fail) return { data: null, error: { message: "boom" } };
          const rows: { id: string; username: string; prevSlugs?: string[] }[] = table === "cards" ? w.cards : w.profiles;
          const hit = rows.find((r) =>
            (!f.eq || r.username === f.eq[1]) &&
            (!f.contains || (r.prevSlugs ?? []).includes(f.contains)) &&
            (!f.neq || r.id !== f.neq[1]));
          return { data: hit ? { id: hit.id } : null, error: null };
        },
      };
      return q;
    },
  } as never;
}

const WORLD: World = {
  cards: [
    { id: "mine", username: "jane-smith", prevSlugs: ["janesmith-oldco"] },
    { id: "my-other", username: "jane-realty", prevSlugs: ["jane-old-realty"] },
    { id: "theirs", username: "john-acme", prevSlugs: ["john-old-acme"] },
  ],
  profiles: [{ id: "u-john", username: "johnhandle" }],
};
const check = (raw: string, w: World = WORLD) => slugAvailability(fakeAdmin(w), raw, "mine");

describe("what the editor says while you type", () => {
  it("someone else's card URL is taken", async () => {
    expect(await check("john-acme")).toEqual({ slug: "john-acme", status: "taken" });
  });

  it("your OTHER card's URL is taken too", async () => {
    expect((await check("jane-realty")).status).toBe("taken");
  });

  it("an account handle is taken", async () => {
    expect((await check("johnhandle")).status).toBe("taken");
  });

  it("another card's OLD address (it still redirects there) is taken — yours or anyone's", async () => {
    expect((await check("john-old-acme")).status).toBe("taken");
    expect((await check("jane-old-realty")).status).toBe("taken");
  });

  it("this card's own old address can be taken back", async () => {
    expect((await check("janesmith-oldco")).status).toBe("available");
  });

  it("this card's current URL is 'current', not taken", async () => {
    expect((await check("jane-smith")).status).toBe("current");
    expect((await check("Jane Smith")).status).toBe("current");
  });

  it("capitals, spaces and punctuation are judged as the URL they save as", async () => {
    expect(await check("John ACME!")).toEqual({ slug: "john-acme", status: "taken" });
    expect(await check("  John--Acme ")).toEqual({ slug: "john-acme", status: "taken" });
  });

  it("an app page name is reserved", async () => {
    expect((await check("pricing")).status).toBe("reserved");
    expect((await check("Dashboard")).status).toBe("reserved");
  });

  it("nothing usable is invalid", async () => {
    expect((await check("!!!")).status).toBe("invalid");
    expect((await check("")).status).toBe("invalid");
  });

  it("a free URL is available", async () => {
    expect(await check("jane-new-url")).toEqual({ slug: "jane-new-url", status: "available" });
  });

  it("a lookup that fails is never reported as available", async () => {
    const r = await check("jane-new-url", { ...WORLD, fail: true });
    expect(r.status).not.toBe("available");
  });
});

const read = (p: string) => readFileSync(p, "utf8");

describe("the wiring", () => {
  it("the check route answers only a signed-in owner, for their own card, uncached", () => {
    const s = read("src/app/api/cards/[id]/slug-check/route.ts");
    expect(s).toMatch(/if \(!user\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401/);
    expect(s).toMatch(/\.eq\("id", id\)\s*\.eq\("user_id", user\.id\)/);
    expect(s).toContain("status: 404");
    expect(s).toContain('"Cache-Control": "no-store"');
    expect(s).toContain("slugAvailability(admin, raw, id)");
  });

  it("two people saving the same URL at once: the second is told it's taken, not 'try again'", () => {
    const s = read("src/app/api/cards/[id]/rename/route.ts");
    const i = s.indexOf('error.code === "23505"');
    expect(i).toBeGreaterThan(0);
    expect(s.slice(i, i + 200)).toContain("That URL is already taken");
    expect(i).toBeLessThan(s.indexOf("Couldn't change the URL right now"));
  });

  it("the editor's button only turns on for a URL the check calls free", () => {
    const s = read("src/components/CardUrlEditor.tsx");
    expect(s).toMatch(/const canSave = !!changed && status === "idle" && \(verdict === "available" \|\| verdict === "error"\);/);
    expect(s).toContain("disabled={!canSave}");
    expect(s).toContain("onChange={(e) => { setValue(e.target.value); setError(\"\"); }}");
    expect(s).toMatch(/role="status" aria-live="polite"/);
  });
});
