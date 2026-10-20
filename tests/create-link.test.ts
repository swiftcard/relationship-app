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

  it("a mixed-case or renamed slug keeps /p/<id> AND every query param", () => {
    // The mixed-case hop used to drop ?source= / ?ct=; a renamed card's old
    // link fell through to the card page's alias redirect, which goes to the
    // bare card — still a view, but the link previewed as the card, not the
    // owner's picture.
    expect(page).toContain("if (raw !== username) permanentRedirect(forwardQuery(`/${username}/p/${id}`, query));");
    expect(page).toContain("const alias = await createLinkAlias(username);");
    expect(page).toContain("if (alias) permanentRedirect(forwardQuery(`/${alias}/p/${id}`, query));");
    // …before the card renders, so the card page's own alias redirect never
    // runs for a /p/ link.
    expect(page.indexOf("if (alias) permanentRedirect(")).toBeLessThan(page.indexOf("return CardPage({"));
  });

  it("names its own picture as the og/twitter image — explicitly", () => {
    // Left for the file convention to fill, the live page shipped with no
    // og:image at all (2026-10-07).
    expect(page).toContain("const image = `${APP_URL}/${username}/p/${id}/opengraph-image`;");
    expect(page).toContain("images: [{ url: image, width: 1200, height: 630, alt }]");
    expect(page).toContain("twitter: { ...base.twitter, images: [image] }");
    expect(page).not.toContain("images: undefined");
  });

  it("previews as the owner's own picture, and only theirs", () => {
    expect(preview).toContain("getAdminSupabase().storage.from(\"card-uploads\").download(`${ownerId}/${file}`)");
    expect(preview).toContain("if (!(await resolveCardMeta(username))) return null;");
    // A link made before a rename still previews as its picture.
    expect(preview).toContain("const username = (await createLinkAlias(slug)) ?? slug;");
    expect(preview).toMatch(/if \(cardRow\) return null;[\s\S]*return findSlugAlias\(username\);/);
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
  it("the owner's own preview clicks go through the self-view hop — never a view of their own card", () => {
    // In the iPhone app a link opens Safari, which has never signed in: without
    // the hop the owner trying their creation counted a view and notified them.
    expect(box).toContain("<LinkedPreview html={relink(phase.html, phase.shareUrl, ownHref(phase.shareUrl))} />");
    expect(box).toContain("/api/self-view?to=${encodeURIComponent(path)}&t=${encodeURIComponent(selfToken)}");
    // …but what is COPIED keeps the real share link for everyone else.
    expect(box).toContain('"text/html": new Blob([phase.html], { type: "text/html" })');
  });

  it("uploads each distinct pasted picture once, and drops one that can't be read instead of failing", () => {
    expect(box).toContain("const stored = new Map<string, Promise<string | null>>();");
    expect(box).toContain("if (stored.has(p.src)) continue;");
    // …all at once, not one after another.
    expect(box).toContain("await Promise.all([...stored]");
    expect(box).toMatch(/e\.status === 401 \|\| e\.status === 403 \|\| e\.status === 408 \|\| e\.status === 429\)\) throw e;/);
    expect(box).toContain('else { (p.img.closest("a") ?? p.img).remove(); dropped++; }');
    expect(box).toContain("made = { html: relink(draft, PLACEHOLDER, shareUrl), shareUrl, dropped };");
  });
  // Owner, 2026-10-20: a paste "just stays on a loading screen". Every wait
  // has a limit; past it the box says so (tests/render/create-link proves it).
  it("never waits forever: every upload and the preview picture have a time limit", () => {
    const uploads = box.match(/uploadMedia\(/g)?.length ?? 0;
    const bounded = box.match(/uploadMedia\([^;]*\{ timeoutMs: (UPLOAD_MS|PREVIEW_UPLOAD_MS) \}\)/g)?.length ?? 0;
    expect(uploads, "an uploadMedia call with no time limit").toBe(bounded);
    // A too-slow pasted picture stops the paste with a message; it is not
    // quietly dropped as "saved only on your computer".
    expect(box).toContain("e.status === 408");
    const upload = readFileSync("src/lib/upload-media.ts", "utf8");
    expect(upload).toContain("signal: timeoutMs ? timeoutSignal(timeoutMs) : undefined");
    expect(upload).toContain("throw new UploadError(408, TOOK_TOO_LONG_MESSAGE)");
    const lib = readFileSync("src/lib/link-anything.ts", "utf8");
    expect(lib).toMatch(/export async function snapshotPng\(html: string, budgetMs = SNAP_BUDGET_MS\)/);
    expect(lib).not.toMatch(/await img\.decode\(\)|await document\.fonts\?\.ready;/);
    const exact = readFileSync("src/lib/capture-exact.ts", "utf8");
    expect(exact).toContain("return await within(toPng(node, options), timeoutMs);");
  });
  it("never ignores a drop", () => {
    const drop = box.slice(box.indexOf("  function onDrop("), box.indexOf("  async function pasteButton()"));
    expect(drop).toMatch(/if \(input\) void make\(input\);\s*\/\/[^\n]*\n\s*else setPhase\(\{ kind: "error"/);
  });
  it("only shows a remembered creation that is still safe", () => {
    expect(box).toContain("isSafeLinkedHtml(saved.html)");
  });
  it("keeps the phone keyboard away from the paste box and never inserts typing", () => {
    expect(box).toContain('inputMode="none"');
    expect(box).toContain("onBeforeInput={(e) => e.preventDefault()}");
  });
});

describe("the Links page offers Create only to accounts the upload route will serve", () => {
  const share = read("src/app/share/page.tsx");
  it("gates on the plan RIGHT NOW (an expired free month is Free), like api/upload", () => {
    expect(share).toContain("const canCreate = isPaidProfile(profile);");
    expect(share).toMatch(/\{canCreate \? \(\s*<CreateLinkBox/);
  });
});
