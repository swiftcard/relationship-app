import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFallbackUrl, createFileFromId, createIdFromUpload, createShareUrl, isCreateId, CREATE_SOURCE } from "@/lib/create-link";
import { getSourceLabel } from "@/lib/source-labels";

// Create + (link anything to your SwiftCard): the pieces a browser test can't
// see. The look, the linking and the safety of a paste are measured in real
// browsers in tests/render/create-link.interactive.test.ts.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("share ids ⇄ stored pictures", () => {
  it("round-trips every stored format", () => {
    for (const [file, id] of [["create-1728330000000.jpg", "1728330000000j"], ["create-1728330000000.png", "1728330000000p"], ["create-1728330000000.gif", "1728330000000g"]]) {
      expect(createIdFromUpload(file)).toBe(id);
      expect(createFileFromId(id)).toBe(file);
    }
  });

  it("reads the id off a real public upload URL", () => {
    expect(createIdFromUpload("https://x.supabase.co/storage/v1/object/public/card-uploads/9f1c/create-1728330000123.png")).toBe("1728330000123p");
    expect(createIdFromUpload("https://x.supabase.co/storage/v1/object/public/card-uploads/9f1c/create-1728330000123.png?v=2")).toBe("1728330000123p");
  });

  it("refuses anything that isn't exactly an id — no path ever comes from the URL", () => {
    for (const bad of ["", "1728330000000", "1728330000000x", "172833000000p", "17283300000000p", "../1728330000000p", "1728330000000p/..", "abc", "1728330000000P"]) {
      expect(isCreateId(bad), bad).toBe(false);
      expect(createFileFromId(bad), bad).toBeNull();
    }
    expect(createIdFromUpload("photo-1728330000000.jpg")).toBeNull();
    expect(createIdFromUpload("create-1728330000000.webp")).toBeNull();
  });

  it("builds the one link every part opens", () => {
    expect(createShareUrl("https://swiftcard.me/", "dana", "1728330000000p")).toBe("https://swiftcard.me/dana/p/1728330000000p");
    expect(createFallbackUrl("https://swiftcard.me", "dana")).toBe(`https://swiftcard.me/dana?source=${CREATE_SOURCE}`);
  });

  it("is a labelled visit source", () => {
    expect(getSourceLabel(CREATE_SOURCE)).toBe("Create link");
  });
});

describe("the upload route takes Create pictures from paid accounts only", () => {
  const route = read("src/app/api/upload/route.ts");
  it("allows the field, refuses guests and Free", () => {
    expect(route).toMatch(/field !== "cardbg" && field !== "create"\)/);
    expect(route).toMatch(/if \(field === "create"\) \{\s*if \(!user\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/);
    expect(route).toMatch(/if \(!isPaidProfile\(planRow\)\) return NextResponse\.json\(\{ error: "pro_required" \}, \{ status: 403 \}\);/);
  });
  it("never writes a profile/card column for one", () => {
    expect(route).toMatch(/field === "hero" \|\| field === "link" \|\| field === "pagebg" \|\| field === "create"\) \{\s*return NextResponse\.json\(\{ url: publicUrl \}\);/);
  });
});

describe("the share link page", () => {
  const page = read("src/app/[username]/p/[id]/page.tsx");
  const og = read("src/app/[username]/p/[id]/opengraph-image.tsx");
  const tw = read("src/app/[username]/p/[id]/twitter-image.tsx");
  const preview = read("src/lib/create-link-preview.ts");

  it("renders the card itself (no redirect a link scraper would follow), tracked as a Create link", () => {
    expect(page).toContain("return CardPage({");
    expect(page).toContain("source: query.source ?? CREATE_SOURCE");
    expect(page).not.toMatch(/\bredirect\(/);
    expect(page).toContain("robots: { index: false, follow: true }");
    expect(page).toMatch(/if \(!isCreateId\(id\)\) notFound\(\);/);
  });

  it("previews as the owner's own picture, and only theirs", () => {
    expect(preview).toContain("getAdminSupabase().storage.from(\"card-uploads\").download(`${ownerId}/${file}`)");
    expect(preview).toContain("if (!(await resolveCardMeta(username))) return null;");
    expect(og).toContain("return cardPreview({ params: Promise.resolve({ username }) });");
    // The two image files must carry the same literal config.
    for (const line of ["export const size = { width: 1200, height: 630 };", 'export const contentType = "image/jpeg";', 'export const runtime = "nodejs";']) {
      expect(og).toContain(line);
      expect(tw).toContain(line);
    }
  });
});

describe("the Create box", () => {
  const box = read("src/components/CreateLinkBox.tsx");
  it("copies the linked thing AND its share link, inside the tap", () => {
    const copy = box.slice(box.indexOf("  function copy() {"), box.indexOf("  function startOver()"));
    expect(copy).toContain('"text/html": new Blob([phase.html], { type: "text/html" })');
    expect(copy).toContain('"text/plain": new Blob([phase.shareUrl], { type: "text/plain" })');
    expect(copy).not.toMatch(/^\s*async function copy/m);
  });
  it("only shows a remembered creation that is still safe", () => {
    expect(box).toContain("isSafeLinkedHtml(saved.html)");
  });
  it("keeps the phone keyboard away from the paste box and never inserts typing", () => {
    expect(box).toContain('inputMode="none"');
    expect(box).toContain("onBeforeInput={(e) => e.preventDefault()}");
  });
});
