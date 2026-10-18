import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_SLUGS } from "@/lib/slug";
import { uploadToPublicBucket } from "@/lib/public-bucket";

// ── Audit round 20 (2026-10-18): card storage, card addresses, card claims ──
//
// C02-001  createBucket ran before every share-image and signature upload — a
//          failed duplicate-key insert (47 a day) and a wasted round trip.
// C02-003  The reserved-slug list was hand-kept and missed nine live pages:
//          a card at /download or /review could never be reached.
// C02-008  Two claims of one draft made two cards; the claim skipped the
//          field clamps and left photoUrl unset (the account photo bled in).

const read = (p: string) => readFileSync(p, "utf8");

describe("C02-001: a bucket is created only when it is missing", () => {
  const store = (results: { error: unknown }[]) => {
    const calls = { upload: 0, create: 0 };
    const admin = {
      storage: {
        from: () => ({ upload: vi.fn(async () => { calls.upload++; return results.shift() ?? { error: null }; }) }),
        createBucket: vi.fn(async () => { calls.create++; return { error: null }; }),
      },
    };
    return { admin, calls };
  };

  it("an ordinary upload never touches createBucket", async () => {
    const { admin, calls } = store([{ error: null }]);
    expect((await uploadToPublicBucket(admin as never, "b", "x.png", Buffer.from("x"), { contentType: "image/png" })).error).toBeNull();
    expect(calls).toEqual({ upload: 1, create: 0 });
  });

  it("a missing bucket is created and the upload tried once more", async () => {
    const { admin, calls } = store([{ error: { message: "Bucket not found", statusCode: "404" } }, { error: null }]);
    expect((await uploadToPublicBucket(admin as never, "b", "x.png", Buffer.from("x"), { contentType: "image/png" })).error).toBeNull();
    expect(calls).toEqual({ upload: 2, create: 1 });
  });

  it("any other error is returned as it is", async () => {
    const { admin, calls } = store([{ error: { message: "payload too large", statusCode: "413" } }]);
    expect((await uploadToPublicBucket(admin as never, "b", "x.png", Buffer.from("x"), { contentType: "image/png" })).error).toMatchObject({ message: "payload too large" });
    expect(calls.create).toBe(0);
  });

  it.each(["src/app/api/card-share-image/route.ts", "src/app/api/card-signature/route.ts"])("%s uploads through it", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/createBucket\(/);
    expect(src).toContain("await uploadToPublicBucket(admin, BUCKET, path, buffer, {");
  });
});

describe("C02-003: no card can take a page's address", () => {
  it("every top-level page or route under src/app is reserved", () => {
    const dirs = readdirSync("src/app", { withFileTypes: true })
      .filter((d) => d.isDirectory() && !/^[[(_.]/.test(d.name))
      .filter((d) => ["page.tsx", "page.ts", "route.ts", "route.tsx"].some((f) => existsSync(join("src/app", d.name, f))) || readdirSync(join("src/app", d.name)).length > 0);
    const missing = dirs.map((d) => d.name).filter((n) => !RESERVED_SLUGS.has(n));
    expect(missing, `add these to RESERVED_SLUGS in src/lib/slug.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it.each(["download", "review", "faq", "pin", "email"])("%s is reserved", (s) => {
    expect(RESERVED_SLUGS.has(s)).toBe(true);
  });
});

describe("C02-008: one card per draft, built like any other card", () => {
  const claim = read("src/app/api/drafts/claim/route.ts");

  it("a racing second claim deletes only the card it made and answers with the first, before seeding anything", () => {
    const settle = claim.indexOf("// ONE CARD PER DRAFT");
    expect(settle).toBeGreaterThan(0);
    expect(settle).toBeLessThan(claim.indexOf("await seedDemoContact(insert.username)"));
    expect(claim).toContain('await admin.from("cards").delete().eq("id", card.id).eq("user_id", user.id);');
    expect(claim).toMatch(/\.order\("created_at", \{ ascending: true \}\)\s*\.order\("id", \{ ascending: true \}\);/);
  });

  it("the fields are clamped and a card with no headshot says so", () => {
    expect(claim).toContain("const insert: ClaimInsert = clampCardWrite(built.insert);");
    expect(claim).toContain("if (cust.photoUrl === undefined) cust.photoUrl = null;");
  });
});
