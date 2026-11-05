import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { waitForHuman } from "@/lib/human-gate";
import { linkTarget } from "@/lib/track-link-click";

// ── Owner, 2026-11-05: "sometimes it shows… sometimes it doesn't" ────────────
// A visitor who opened the card and tapped Instagram at once (the app takes
// over the screen) left a tap with no visit behind it: counted in "Link taps",
// missing from the views, the chart, the bell and Recent visits. Now:
//   - a real tap on the page passes the human check at once, so the page's own
//     view goes out before the tap takes the page away (keepalive);
//   - a tap that still finds no view records it (the companion view a save
//     already recorded), announced AS the visit's view — its one buzz;
//   - one datacenter verdict per visit, so the view and its tap agree;
//   - the phone, email and website rows on the card face are tracked.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// A stand-in browser: enough document for the gate, with a way to fire a tap.
function fakeBrowser(visible = true) {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const doc = {
    visibilityState: visible ? "visible" : "hidden",
    hidden: !visible,
    addEventListener: (t: string, f: (e: Event) => void) => { (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f); },
    removeEventListener: (t: string, f: (e: Event) => void) => { listeners.get(t)?.delete(f); },
  };
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { webdriver: false });
  return {
    tap: (isTrusted = true) => { for (const f of [...(listeners.get("pointerdown") ?? [])]) f({ isTrusted } as Event); },
    listening: () => (listeners.get("pointerdown")?.size ?? 0),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a real tap is a person", () => {
  it("passes the gate at once on a trusted tap, without waiting out the dwell", async () => {
    const b = fakeBrowser();
    const started = Date.now();
    const gate = waitForHuman(() => false, { passOnGesture: true, dwellMs: 10_000 });
    await new Promise((r) => setTimeout(r, 10));
    b.tap(true);
    await expect(gate).resolves.toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    // And lets go of its listeners.
    expect(b.listening()).toBe(0);
  });

  it("a script's synthetic tap proves nothing", async () => {
    const b = fakeBrowser();
    const gate = waitForHuman(() => false, { passOnGesture: true, dwellMs: 50 });
    await new Promise((r) => setTimeout(r, 10));
    b.tap(false);
    // Still visible at the end of the dwell, so it passes the ordinary way —
    // but only after the dwell, not because of the synthetic tap.
    const started = Date.now();
    await expect(gate).resolves.toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("without the option a tap changes nothing (the save path keeps its own rules)", async () => {
    const b = fakeBrowser();
    const gate = waitForHuman(() => false, { dwellMs: 20 });
    await new Promise((r) => setTimeout(r, 5));
    expect(b.listening()).toBe(0);
    await gate;
  });

  it("the card's view uses it, and is sent so it survives the page leaving", () => {
    const tracker = read("src/components/CardEventTracker.tsx");
    expect(tracker).toContain("waitForHuman(() => cancelled, { passOnGesture: true })");
    expect(tracker).toContain("keepalive: true,");
  });
});

describe("a tap with no view records the visit's view", () => {
  const route = read("src/app/api/card-events/route.ts");

  it("taps and saves share the companion-view path, and its milestone counts", () => {
    expect(route).toContain("// A SAVE IS ALSO A VIEW (2026-10-06) — AND SO IS A TAP (2026-11-05).");
    expect(route).toContain("if (companionView) milestone = crossed ?? null;");
  });

  it("announced as the visit's view — the one buzz — and the tap joins that row", () => {
    expect(route).toMatch(/const asView = event_type === "viewed_card" \|\| \(event_type === "clicked_link" && companionView\);/);
    expect(route).toContain("const isView = asView;");
    // A tap that did NOT open the visit writes no notification of its own.
    expect(route).toContain('if (returning && noticeEvent !== "clicked_link") {');
  });

  it("an automated browser's tap is never sent (it could record a view)", () => {
    expect(read("src/lib/track-link-click.ts")).toContain("if ((navigator as Navigator & { webdriver?: boolean }).webdriver) return;");
  });

  it("a forged tap cannot get around the cap on forged views", () => {
    expect(route).toContain('if (event_type === "clicked_link" && identityUnproven && !visitAccepted');
  });

  it("one datacenter verdict per visit", () => {
    expect(route).toContain("visitAccepted = !!acceptedView;");
    expect(route).toContain("if (!viewGeo && liveGeo.isHosting && !visitAccepted) {");
    expect(read("src/lib/record-view.ts")).toContain("if (geo.isHosting && !opts.visitAccepted) return { outcome: \"hosting\", location, geo };");
  });
});

describe("the phone, email and website on the card are tracked", () => {
  it("records the button, never the number or the address", () => {
    expect(linkTarget("tel:+19179057335")).toBe("phone");
    expect(linkTarget("mailto:dana@acme.com")).toBe("email");
    expect(linkTarget("sms:+19179057335")).toBe("text");
  });

  it("one listener on the card's contact block, only for a visitor", () => {
    const tracker = read("src/components/CardEventTracker.tsx");
    expect(tracker).toContain('closest?.("[data-contact-block] a[href]")');
    expect(tracker).toContain('document.addEventListener("click", onClick, true);');
    // The tracker is never mounted for the owner or the preview frame.
    expect(read("src/app/[username]/page.tsx")).toContain("{!isEmbed && !isOwnerView && <CardEventTracker");
    // The templates themselves are untouched: the editor, the capture and
    // the Wallet pass render them and must never track.
    expect(read("src/components/card-templates/shared.tsx")).not.toMatch(/trackLinkClick/);
  });

  it("the card's Swift Links box sends each link's own name", () => {
    expect(read("src/components/SocialLinkIntercept.tsx")).toContain("const label = links.find((s) => s.href === href)?.label ?? null;");
  });
});

describe("one person, two screens: the desktop Scan to save QR", () => {
  it("the QR names the computer's visit, and the phone's download joins it", () => {
    expect(read("src/components/SaveContactButton.tsx")).toContain("&vv=${encodeURIComponent(getVisitorId())}");
    expect(read("src/components/ScanSaveContact.tsx")).toContain("...(joinVisit ? { join_visit: joinVisit } : {}),");
    const route = read("src/app/api/card-events/route.ts");
    // Proven: a view of THIS card by that visitor in this visit.
    expect(route).toMatch(/if \(join_visit && join_visit !== visitor_id\) \{[\s\S]{0,400}\.eq\("visitor_id", join_visit\)/);
    expect(route).toContain("const eventVisitor = joinedVisitor ?? visitor_id;");
    expect(route).toContain("const visitWho = returning ? `lead:${returning.leadId}` : eventVisitor;");
    // Never left in the address bar for the next person.
    expect(read("src/components/CleanShareUrl.tsx")).toContain('const ONE_VISIT_PARAMS = ["source", "save", "shared", "vv"] as const;');
  });
});
