import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Warm-lead plan PR A6. "Priya tapped your Listings link" needs the link's own
// name; the host alone can't tell two zillow.com links apart.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("link taps carry the link's label", () => {
  it("the beacon sends a trimmed label capped at 60, and only when there is one", () => {
    const src = read("src/lib/track-link-click.ts");
    expect(src).toMatch(/opts\.label\?\.trim\(\) \? \{ target_label: opts\.label\.trim\(\)\.slice\(0, 60\) \} : \{\}/);
  });

  it("every labelled link surface passes its label", () => {
    expect((read("src/components/SwiftLinkButtons.tsx").match(/label: link\.label, suppress/g) ?? []).length).toBe(3);
    expect(read("src/components/CardActionLinks.tsx")).toMatch(/label: l\.label, suppress/);
    expect(read("src/components/SocialIcons.tsx")).toMatch(/label: s\.label, suppress/);
  });

  it("the server re-bounds it and stores it for clicks only", () => {
    const src = read("src/app/api/card-events/route.ts");
    expect(src).toMatch(/const target_label = event_type === "clicked_link" \? str\(body\?\.target_label, 60\) : null;/);
    expect(src).toMatch(/\.\.\.\(target_label \? \{ target_label \} : \{\}\)/);
  });

  it("the timeline prefers the owner's name for the link over its host", async () => {
    // One wording for every surface since 2026-11-05 (lib/visit-taps).
    const { tapPhrase } = await import("@/lib/visit-taps");
    expect(tapPhrase({ target: "zillow.com", target_label: "Listings" })).toBe("tapped your Listings link");
    expect(tapPhrase({ target: "zillow.com", target_label: null })).toBe("tapped your zillow.com link");
    expect(read("src/components/ContactsClient.tsx")).toContain('if (e.event_type === "clicked_link") return tapPhrase(e);');
  });
});
