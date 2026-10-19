import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSharedLocation, sharedAccuracyLabel, sharedMapUrl } from "@/lib/shared-location";
import { buildRecentVisits } from "@/lib/recent-visits";

// ── Feature 4 (owner, 2026-10-18): the exact spot, when the visitor offers it ─
// The one location in the product that is not an IP guess. It exists only
// because a visitor turned on "Add my current location" AND their phone asked
// them AND they allowed it; it goes to one card owner, on Pro.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("only a believable point is ever stored", () => {
  it("a real fix, rounded", () => {
    expect(parseSharedLocation({ lat: 40.7484405, lng: -73.9856644, accuracy: 14.7 }))
      .toEqual({ lat: 40.748441, lng: -73.985664, accuracy: 15 });
  });
  it("anything else is dropped", () => {
    for (const bad of [
      null, "40,-73", {}, { lat: "40", lng: -73, accuracy: 10 }, { lat: 91, lng: 0, accuracy: 10 },
      { lat: 40, lng: 181, accuracy: 10 }, { lat: 0, lng: 0, accuracy: 10 }, { lat: 40, lng: -73, accuracy: 0 },
      { lat: 40, lng: -73, accuracy: 5000 }, { lat: NaN, lng: -73, accuracy: 10 },
    ]) {
      expect(parseSharedLocation(bad), JSON.stringify(bad)).toBe(null);
    }
  });
  it("says how sure it is, and links to a map", () => {
    expect(sharedAccuracyLabel(15)).toBe("Within about 15 m");
    expect(sharedAccuracyLabel(1500)).toBe("Within about 1.5 km");
    expect(sharedAccuracyLabel(null)).toBe(null);
    expect(sharedMapUrl(40.74844, -73.985664, "Priya Shah")).toBe("https://maps.apple.com/?ll=40.74844,-73.985664&q=Priya%20Shah");
  });
});

describe("the visitor offers it — it is never taken", () => {
  const toggle = code("src/components/ShareLocationToggle.tsx");
  it("off by default, and the phone is asked only from the tap", () => {
    expect(toggle).toContain('useState<State>(value ? "on" : "off")');
    // The one call to the GPS sits inside the click handler, nowhere else.
    expect((toggle.match(/getCurrentPosition\(/g) ?? []).length).toBe(1);
    expect(toggle.indexOf("getCurrentPosition(")).toBeGreaterThan(toggle.indexOf("function toggle()"));
    expect(toggle).not.toMatch(/watchPosition/);
  });
  it("a 'no' from the phone still sends the form, and says so", () => {
    expect(toggle).toContain("Location not added — your phone didn't allow it. Your info still sends.");
  });
  it("is on all three share forms, and each sends it only when it was given", () => {
    for (const f of ["src/components/SaveContactButton.tsx", "src/components/LeadCaptureForm.tsx", "src/components/ConnectButton.tsx"]) {
      const s = read(f);
      expect(s, f).toContain("<ShareLocationToggle value={sharedLocation} onChange={setSharedLocation} />");
      expect(s, f).toContain("...(sharedLocation ? { shared_location: sharedLocation } : {}),");
    }
  });
});

describe("the server", () => {
  const route = read("src/app/api/leads/route.ts");
  it("parses it, and a lead is never lost to its columns", () => {
    expect(route).toContain("const sharedPoint = parseSharedLocation(shared_location);");
    expect(route).toContain('insert({ ...leadRow, ...(sharedCols ?? {}) })');
    expect(route).toMatch(/error\.code === "42703" \|\| error\.code === "PGRST204"\) && sharedPoint\) \{\n\s*\(\{ data: insertedLead, error \} = await admin\.from\("leads"\)\.insert\(leadRow\)/);
  });
  it("a repeat share updates it only from a browser already that contact's", () => {
    expect(route).toContain("if (sameBrowser && sharedCols) {");
  });
  it("the notification says THAT they shared one, never where", () => {
    expect(route).toContain('shared their info${sharedPoint ? " and their exact location" : ""} with you${sourceStr}.');
  });
  it("Free never receives the coordinates; the panel blurs the line", () => {
    const page = read("src/app/contacts/page.tsx");
    expect(page).toContain("? { ...l, shared_lat: null, shared_lng: null, shared_accuracy_m: null }");
    const panel = read("src/components/ContactsClient.tsx");
    expect(panel).toContain("{selected.shared_location_at && (");
    expect(panel).toContain('<BlurredPlace text="████████" />');
  });
  it("it stays with the card owner: no CRM, no export, no Office drawer", () => {
    for (const f of ["src/lib/crm-sync.ts", "src/lib/office-contact-detail.ts", "src/app/api/leads/export/route.ts"]) {
      let s = "";
      try { s = read(f); } catch { continue; }
      expect(s, f).not.toMatch(/shared_lat|shared_lng/);
    }
  });
});

describe("Recent visits", () => {
  const T = (min: number) => new Date(Date.UTC(2026, 9, 18, 15, 0) + min * 60_000).toISOString();
  const events = [{ id: "v", created_at: T(0), event_type: "viewed_card", surface: "card", visitor_id: "visitor-aaaa" }];
  it("'Shared their details and location' on the visit it happened in — Pro only", () => {
    const shares = [{ visitor_id: "visitor-aaaa", created_at: T(1), surface: "card" as const, location: true }];
    expect(buildRecentVisits({ events, history: [], leads: [], shares, paid: true, limit: 5 })[0].actions)
      .toEqual(["Shared their details and location"]);
    expect(buildRecentVisits({ events, history: [], leads: [], shares, paid: false, limit: 5 })[0].actions).toEqual([]);
  });
});
