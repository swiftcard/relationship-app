import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// PUSHES REACH THE RIGHT ACCOUNT'S DEVICE, AND TAPS GO SOMEWHERE.
//
// Audit scenarios pinned here: (15) token rotation — a silent launch-time
// re-registration, gated on the SAME user who opted in; (16) logout/login —
// the guard severs the binding on any unstamped-state login, so a failed
// sign-out DELETE can't leave the previous account pushing to the device;
// (18) notification tap routing — senders pass absolute URLs and the tap
// handler must navigate for them (it used to accept relative paths only, so
// every tap silently did nothing).
// ─────────────────────────────────────────────────────────────────────────────

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const bridge = read("src/components/NativeAppBridge.tsx");
const enable = read("src/components/EnablePushButton.tsx");
const device = read("src/lib/push-device.ts");
const subscribe = read("src/app/api/push/subscribe/route.ts");
const migration = read("supabase/view-visit-window.sql");

describe("tap routing actually navigates", () => {
  it("converts our own absolute URLs to a path — senders pass `${APP_URL}/…`", () => {
    const tap = bridge.slice(bridge.indexOf("pushNotificationActionPerformed"));
    expect(tap).toMatch(/u\.hostname === "swiftcard\.me" \|\| u\.hostname === "www\.swiftcard\.me"/);
    expect(tap).toMatch(/u\.pathname \+ u\.search \+ u\.hash/);
  });

  it("still refuses foreign origins and protocol-relative tricks", () => {
    const tap = bridge.slice(bridge.indexOf("pushNotificationActionPerformed"));
    // safeNextPath replaced the inline check: it rejects "//" AND "/\\",
    // which new URL() would otherwise resolve to a foreign origin.
    expect(tap).toMatch(/safeNextPath\(dest\)/);
  });

  it("registers the tap listener BEFORE the network-bound widget sync — cold-start taps race the boot", () => {
    // The sync lives in syncWidgetCard() (defined above the boot sequence so the
    // card-switch event can reuse it); what matters is where it is CALLED.
    const call = bridge.indexOf("await syncWidgetCard()");
    expect(call).toBeGreaterThan(-1);
    expect(bridge.indexOf("pushNotificationActionPerformed")).toBeLessThan(call);
  });
});

describe("silent token refresh — rotated APNs tokens stop being silent death", () => {
  it("re-registers on launch only when permission is granted AND the binding belongs to the current user", () => {
    expect(bridge).toMatch(/checkPermissions\(\)/);
    expect(bridge).toMatch(/perm\.receive === "granted" && pushUid/);
    expect(bridge).toMatch(/session\.user\.id === pushUid/);
  });

  it("never prompts from the bridge — requestPermissions stays in the enable button only", () => {
    expect(bridge).not.toMatch(/requestPermissions/);
    expect(enable).toMatch(/requestPermissions/);
  });

  it("the enable button stamps which uid opted in; unbind clears the stamp", () => {
    expect(enable).toMatch(/PUSH_UID_KEY = "swiftcard_push_uid"/);
    expect(enable).toMatch(/localStorage\.setItem\(PUSH_UID_KEY, uid\)/);
    expect(device).toMatch(/removeItem\("swiftcard_push_uid"\)/);
  });
});

describe("the binding row is trustworthy", () => {
  it("the subscribe upsert result is CHECKED — no more 'subscribed' with no row", () => {
    expect(subscribe).toMatch(/const \{ error \} = await admin\.from\("push_subscriptions"\)\.upsert/);
    expect(subscribe).toMatch(/status: 500/);
  });

  it("the migration dedupes endpoints then makes them UNIQUE — onConflict requires it, and without it two accounts could push to one device", () => {
    expect(migration).toMatch(/DELETE FROM public\.push_subscriptions a/);
    expect(migration).toMatch(/uq_push_subscriptions_endpoint/);
  });

  it("the guard severs any unstamped-state login's binding (see account-isolation tests for the full wiring)", () => {
    const guard = read("src/components/AccountIsolationGuard.tsx");
    expect(guard).toMatch(/unbindDevicePush/);
  });
});
