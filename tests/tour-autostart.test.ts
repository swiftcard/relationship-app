import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Comments describe the bugs being guarded against — including the exact code
// shapes that caused them — so scanning raw text would match the prose that
// documents the rule rather than the rule itself.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

// A new account must be shown the tour on its first dashboard load, on every
// plan. That broke because the trigger was split across TWO flags: a redirect
// had to set welcome=1 AND remember tour=1, and two of them didn't.
//
//   onboarding      → /dashboard?welcome=1                  (free signup)
//   checkout/success→ /dashboard?upgraded=true&welcome=1    (paid signup)
//
// Both marked the account as new; neither started the tour. Only the guest-card
// path worked, because it routes through /welcome which appends tour=1.
//
// The fix makes welcome=1 sufficient. These tests hold that, and hold that every
// new-account exit still carries a marker the component acts on — so a future
// signup path gets the tour by default instead of silently missing it.

const AUTOSTART = "src/components/TourAutoStart.tsx";

describe("the tour starts for a brand-new account", () => {
  it("welcome=1 alone is enough to trigger it", () => {
    // If this reverts to requiring tour=1, free and paid signups silently stop
    // getting the tour again — with nothing visibly broken.
    const src = read(AUTOSTART);
    expect(src).toMatch(/params\.get\("welcome"\) === "1"/);
    expect(src).toMatch(/params\.get\("tour"\) === "1"\s*\|\|\s*params\.get\("welcome"\) === "1"/);
  });

  it("tour=1 still works on its own, for deliberate replays", () => {
    // "Take a tour" in Settings and the office-creation redirect use tour=1 for
    // an EXISTING user, who has no welcome=1.
    expect(read(AUTOSTART)).toContain('params.get("tour") === "1"');
  });

  it("it still refuses to replay for someone who already toured", () => {
    expect(read(AUTOSTART)).toMatch(/if \(tourCompleted\(\)\) return;/);
  });

  it("it still waits for the app-store popup instead of opening underneath it", () => {
    // Ordering matters: the popup shows on a fresh welcome load, and the tour
    // must start after it's dismissed, not behind it.
    const src = read(AUTOSTART);
    expect(src).toContain("sc:appstore-done");
    expect(src).toMatch(/popupPending/);
  });
});

describe("the Office admin tour and the dashboard tour don't fight", () => {
  // The collision was reachable on the NORMAL path, not an edge case: creating
  // an office sends the owner to /dashboard?tour=1, so the main tour is running
  // the first time they open Admin.
  //
  // <GuidedTour /> is mounted in the ROOT layout, so it's alive inside
  // /office/admin too, where AdminGuidedTour is the tour that belongs. Its
  // step-resolve effect treats "the current step isn't on this page" as
  // "navigate to where it lives" — so an unfinished dashboard tour pushed the
  // owner straight back to /dashboard every time they opened Admin. The console
  // was effectively unreachable until they finished or dismissed the tour.
  const engine = stripComments(read("src/components/GuidedTour.tsx"));
  const rootLayout = stripComments(read("src/app/layout.tsx"));
  const tourLib = stripComments(read("src/lib/tour.ts"));

  it("the root tour goes dormant inside the admin console", () => {
    // The engine is fetched lazily (GuidedTourHost) so a public card page does
    // not ship it, but the mount point and the pause prefix are unchanged —
    // and the host must pass the prefix STRAIGHT through, or the dashboard
    // tour starts shoving Office owners out of the admin console again.
    expect(rootLayout).toMatch(/<GuidedTourHost pausePathPrefix="\/office\/admin"/);
    const host = stripComments(read("src/components/GuidedTourHost.tsx"));
    expect(host).toMatch(/<GuidedTour pausePathPrefix=\{pausePathPrefix\}/);
  });

  it("the lazy host cannot swallow a tour that is already running", () => {
    // Two ways in, and both must stay: a page load while a tour is mid-flight
    // (the sessionStorage flag), and a tour started on the page we are already
    // on (the event). Lose either and "Take a tour" silently does nothing.
    const host = stripComments(read("src/components/GuidedTourHost.tsx"));
    expect(host).toMatch(/sessionStorage\.getItem\(TOUR_RUNNING\) === "1"/);
    expect(host).toMatch(/addEventListener\(TOUR_START_EVENT/);
    // And it must not re-import the engine's own step lists, which is the
    // whole point of loading it separately.
    expect(host).toMatch(/from "@\/lib\/tour-keys"/);
    expect(host).not.toMatch(/from "@\/lib\/tour-steps"/);
  });

  it("dormant means it does not navigate", () => {
    // The guard has to sit on the effect that decides to router.push, before it
    // compares the step's path to the current one.
    expect(engine).toMatch(/if \(!running \|\| paused\) return;/);
  });

  it("dormant also means it renders NOTHING", () => {
    // Equally important: the dim-while-navigating branch fires whenever the
    // step's path differs from the current page — always true on a section this
    // tour doesn't own — so without this it drapes a scrim over the admin page.
    expect(engine).toMatch(/if \(paused\) return null;/);
  });

  it("re-evaluates when the route changes", () => {
    // paused is derived from pathname, so it must be a dependency or the tour
    // stays dormant after the visitor returns to the dashboard.
    expect(engine).toMatch(/\}, \[idx, running, pathname, paused\]\);/);
  });

  it("the admin tour doesn't burn its one-shot while the main tour runs", () => {
    // claimAdminTourAutoStart sets ADMIN_TOUR_SEEN and returns true at most once
    // per browser. Consuming that while the dashboard tour was mid-flight would
    // mean the admin tour silently never ran at all.
    const fn = tourLib.slice(tourLib.indexOf("export function claimAdminTourAutoStart"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    const seenAt = body.indexOf("setItem(ADMIN_TOUR_SEEN");
    const guardAt = body.indexOf("getItem(TOUR_RUNNING)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(seenAt);
  });

  it("the admin tour still auto-starts on a first visit", () => {
    // The whole point — don't let the collision fix disable the feature.
    const auto = stripComments(read("src/components/office/AdminTourAutoStart.tsx"));
    expect(auto).toContain("claimAdminTourAutoStart()");
    expect(auto).toContain("startAdminTour()");
    // Mounted only once an office exists — nothing to tour on the create form.
    expect(stripComments(read("src/app/office/admin/layout.tsx"))).toMatch(/officeId && <AdminTourAutoStart/);
  });
});

describe("every new-account redirect carries a marker the tour acts on", () => {
  // The real regression was a redirect that marked a new account without a
  // trigger. Each entry is a path a brand-new account can land on.
  for (const [label, file] of [
    ["free signup (onboarding)", "src/app/onboarding/page.tsx"],
    ["paid signup (checkout success)", "src/app/checkout/success/page.tsx"],
    ["guest-card claim (welcome)", "src/app/welcome/page.tsx"],
  ] as const) {
    it(`${label} sends the dashboard a welcome=1 or tour=1`, () => {
      const src = read(file);
      const dashboardRedirects = [...src.matchAll(/["'`]\/dashboard\?([^"'`]*)["'`]/g)].map((m) => m[1])
        // The one deliberate exception: an EXISTING account upgrading is not
        // new, so checkout success sends it to plain ?upgraded=true — and only
        // after an account-age check that keeps new accounts on welcome=1.
        .filter((q) => !(file.includes("checkout/success") && q === "upgraded=true"));
      if (file.includes("checkout/success")) {
        expect(src).toContain("redirect(safeNext ?? (newAccount ? WELCOME : UPGRADED));");
      }
      expect(dashboardRedirects.length, `${file} should redirect to /dashboard with params`).toBeGreaterThan(0);
      for (const q of dashboardRedirects) {
        expect(q, `${file} → /dashboard?${q} would skip the tour`).toMatch(/welcome=1|tour=1/);
      }
    });
  }
});
