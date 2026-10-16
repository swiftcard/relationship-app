import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PERSON_SCOPED_STORAGE_KEYS,
  GUEST_FLOW_STORAGE_KEYS,
  LAST_AUTH_UID_KEY,
  shouldResetPersonState,
  isAccountSwitch,
  clearPersonScopedState,
} from "@/lib/account-state";

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-ACCOUNT ISOLATION OF BROWSER STATE.
//
// This suite exists because it already happened: person-scoped localStorage
// (the visitor-identity blob, the active-card pointer, the device visitor id,
// the push binding) survived logout/login and account switches, so one
// account's identity and selections bled into the next — a view by one user
// was reported under another user's name, and the nav could open the previous
// account's card. These tests pin the decision rules and the wiring that
// prevent it. Scenario numbers refer to the isolation-audit checklist:
//   (1) two accounts on one device  (2) logout A → login B  (3) rapid switch
//   (4) reload / native reopen      (9) stale prior-account state
//   (10) concurrent auth changes.
// ─────────────────────────────────────────────────────────────────────────────

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("shouldResetPersonState — when this browser's person-scoped state must die", () => {
  it("(2) a DIFFERENT user signing in wipes the previous user's state", () => {
    expect(shouldResetPersonState("user-A", "user-B")).toBe(true);
  });

  it("(1) the SAME user signing back in keeps their state", () => {
    expect(shouldResetPersonState("user-A", "user-A")).toBe(false);
  });

  it("(9) state never stamped with any uid is wiped on first sign-in — unknown provenance", () => {
    // This is the one-time reset that clears misattributed identities already
    // sitting on devices from before the guard existed.
    expect(shouldResetPersonState(null, "user-A")).toBe(true);
  });

  it("no session never wipes — an anonymous person's share-state is theirs", () => {
    expect(shouldResetPersonState(null, null)).toBe(false);
    expect(shouldResetPersonState("user-A", null)).toBe(false);
  });

  it("(3)(10) rapid A→B→A switching: every hop that changes the user wipes, repeats don't", () => {
    // Each reconcile stamps the new uid, so the sequence is deterministic no
    // matter how fast it happens or how many tabs broadcast it.
    expect(shouldResetPersonState("user-A", "user-B")).toBe(true); // A → B: wipe
    expect(shouldResetPersonState("user-B", "user-B")).toBe(false); // B again (second tab / re-fire): no-op
    expect(shouldResetPersonState("user-B", "user-A")).toBe(true); // back to A: wipe again
    expect(shouldResetPersonState("user-A", "user-A")).toBe(false); // stable: no-op
  });
});

describe("isAccountSwitch — strictly a signed-in user replaced by a different one", () => {
  it("A → B is a switch", () => {
    expect(isAccountSwitch("user-A", "user-B")).toBe(true);
  });

  it("guest → first sign-in is NOT a switch (guest-flow keys must survive it)", () => {
    // The plan a guest picked and the sketch they built are consumed AFTER
    // login (/welcome, /cards/new) — wiping them here breaks signup→checkout.
    expect(isAccountSwitch(null, "user-A")).toBe(false);
  });

  it("same user and signed-out are never switches", () => {
    expect(isAccountSwitch("user-A", "user-A")).toBe(false);
    expect(isAccountSwitch("user-A", null)).toBe(false);
    expect(isAccountSwitch(null, null)).toBe(false);
  });
});

describe("the person-scoped key lists — what an account switch must erase", () => {
  it("identity keys: active card, visitor identity, share/save maps, device visitor id", () => {
    for (const key of [
      "swiftcard_active_card",
      "swiftcard_visitor",
      "swiftcard_shared",
      "swiftcard_saved",
      "kontact_vid",
    ]) {
      expect(PERSON_SCOPED_STORAGE_KEYS).toContain(key);
    }
  });

  it("guest-flow keys: prefill sketch and plan intent — wiped only on a real switch", () => {
    expect(GUEST_FLOW_STORAGE_KEYS).toContain("swiftcard_prefill");
    expect(GUEST_FLOW_STORAGE_KEYS).toContain("swiftcard_plan_intent");
  });

  it("the guest draft and the device push token are deliberately NOT wiped", () => {
    const all = [...PERSON_SCOPED_STORAGE_KEYS, ...GUEST_FLOW_STORAGE_KEYS];
    // The draft enters an account only through the explicit claim gate; the
    // APNs token is hardware-scoped (its SERVER binding is what gets severed).
    expect(all).not.toContain("swiftcard_guest_draft");
    expect(all).not.toContain("swiftcard_apns_endpoint");
    expect(all).not.toContain("sc_theme");
  });

  it("the key strings match the modules that actually write them (a rename can't silently unlink)", () => {
    const visitor = read("src/lib/visitor.ts");
    expect(visitor).toContain('"kontact_vid"');
    expect(visitor).toContain('"swiftcard_shared"');
    expect(visitor).toContain('"swiftcard_visitor"');
    expect(visitor).toContain('"swiftcard_saved"');
    expect(read("src/lib/active-card.ts")).toContain('"swiftcard_active_card"');
    expect(read("src/lib/prefill.ts")).toContain('"swiftcard_prefill"');
    expect(read("src/lib/plan-intent.ts")).toContain('"swiftcard_plan_intent"');
  });

  it("clearPersonScopedState is SSR-safe (no window → silent no-op)", () => {
    expect(() => clearPersonScopedState()).not.toThrow();
    expect(() => clearPersonScopedState({ includeGuestFlow: true })).not.toThrow();
  });
});

describe("wiring — the guard and sign-out actually run this", () => {
  const guard = read("src/components/AccountIsolationGuard.tsx");
  const signOut = read("src/components/SignOutButton.tsx");
  const layout = read("src/app/layout.tsx");

  it("(4) the guard reconciles on MOUNT (page load / native reopen) and on auth state changes", () => {
    expect(guard).toMatch(/supabase\.auth\.getSession\(\)/);
    expect(guard).toMatch(/onAuthStateChange/);
    expect(guard).toMatch(/shouldResetPersonState\(lastUid, sessionUid\)/);
    expect(guard).toMatch(/writeLastAuthUid\(sessionUid\)/);
  });

  it("the guard severs the device push binding on EVERY unstamped-state login", () => {
    // Not just a real switch: a sign-out whose server DELETE failed (offline)
    // followed by a fresh login arrives with lastUid null — the stale binding
    // would otherwise keep pushing the previous account's activity here. The
    // unbind is unconditional within reconcile's reset branch; guest-flow keys
    // still only clear on a real switch.
    expect(guard).toMatch(/isAccountSwitch\(lastUid, sessionUid\)/);
    expect(guard).toMatch(/unbindDevicePush/);
    expect(guard).not.toMatch(/if \(realSwitch\)[\s\S]*unbindDevicePush/);
  });

  it("the guard is mounted globally in the root layout", () => {
    expect(layout).toMatch(/<AccountIsolationGuard \/>/);
  });

  it("(2) every sign-out path runs ONE release: push unbound first, then the session, the key list, the visitor cookie", () => {
    // lib/device-sign-out is the single sequence (isolation audit 2026-09-24:
    // Settings → Devices and account delete used to skip it).
    const release = read("src/lib/device-sign-out.ts");
    const unbindAt = release.indexOf("await unbindDevicePush({ rememberFor })");
    const signOutAt = release.indexOf(".auth.signOut()");
    expect(unbindAt).toBeGreaterThan(-1);
    expect(signOutAt).toBeGreaterThan(unbindAt);
    expect(release).toMatch(/clearPersonScopedState\(\{ includeGuestFlow: true \}\)/);
    expect(release).toContain("LAST_AUTH_UID_KEY");
    expect(release).toContain('"/api/visit-identity/reset"');
    // A plain sign-out also remembers who had push on, for their own next
    // sign-in (lib/push-device, audit NS-05); the other paths don't.
    expect(signOut).toContain("await releaseDevice({ rememberPush: true });");
    expect(signOut).toContain('window.location.replace("/")');
    expect(read("src/components/JoinSwitchAccount.tsx")).toContain("await releaseDevice();");
    expect(read("src/components/DeviceManager.tsx")).toContain("await releaseDevice();");
    expect(read("src/components/ManageAccount.tsx")).toContain("await releaseDevice({ serverAlreadySignedOut: true });");
  });

  it(`the uid stamp key is stable ("${LAST_AUTH_UID_KEY}") — both sides read the same slot`, () => {
    expect(LAST_AUTH_UID_KEY).toBe("sc_last_uid");
  });
});

describe("push binding — a device never keeps serving an account that left it", () => {
  const route = read("src/app/api/push/subscribe/route.ts");
  const device = read("src/lib/push-device.ts");

  // Scoped to the DELETE handler: POST has its own delete (retiring the
  // endpoint a rotated APNs token replaces) whose authorization model is the
  // opposite and deliberately so — see the test below it.
  const deleteHandler = route.slice(route.indexOf("export async function DELETE"));

  it("DELETE authorizes by ENDPOINT POSSESSION so a new session can sever the old account's row", () => {
    // .eq("user_id") on the delete would silently keep the previous account's
    // notifications flowing to a device it no longer occupies — the new user
    // can present the endpoint but never owned the row.
    expect(deleteHandler).toMatch(/\.delete\(\)\.eq\("endpoint", endpoint\)/);
    expect(deleteHandler).not.toMatch(/\.delete\(\)[\s\S]{0,80}eq\("user_id"/);
  });

  it("POST's stale-endpoint cleanup IS user-scoped — `replaces` is client-supplied", () => {
    // Retiring the row a rotated token replaces stops one phone holding two
    // live subscriptions and buzzing twice. But the endpoint to retire comes
    // from the client, so without the user filter anyone could name someone
    // else's endpoint and silently unsubscribe their device.
    const postHandler = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function DELETE"));
    expect(postHandler).toMatch(/\.delete\(\)\s*\.eq\("user_id", user\.id\)\s*\.eq\("endpoint", replaces\)/);
  });

  it("DELETE needs only the endpoint (retryable after sign-out), throttled per IP; POST still binds strictly to the session user", () => {
    // Isolation audit 2026-09-24: requiring a session meant an unbind that
    // failed at sign-out could never be retried, and the old account's alerts
    // kept reaching the device. Possession of the endpoint is the authority.
    const deleteHandler = route.slice(route.indexOf("export async function DELETE"));
    expect(deleteHandler).not.toMatch(/auth\.getUser\(\)/);
    expect(deleteHandler).toMatch(/isRateLimited\(`push-unbind:\$\{clientIp\(req\)\}`/);
    expect(route).toMatch(/upsert\(\s*\{ user_id: user\.id/);
    // …and the device forgets its endpoint only once the server let go.
    expect(device).toMatch(/if \(severed\) \{\s*\n\s*try \{ localStorage\.removeItem\(APNS_ENDPOINT_KEY\)/);
    expect(read("src/components/AccountIsolationGuard.tsx")).toContain("retryPendingPushUnbind()");
  });

  it("the client helper caps the serviceWorker.ready wait so sign-out can never hang on it", () => {
    expect(device).toMatch(/withTimeout\(navigator\.serviceWorker\.ready/);
  });
});
