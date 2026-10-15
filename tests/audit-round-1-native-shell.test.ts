import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isChunkLoadError, recoverFromChunkError, RELOAD_WINDOW_MS } from "@/lib/chunk-reload";

// ── Audit round 1 (2026-10-15): the app shells ──────────────────────────────
//
// NS-01  Capacitor 8.4.2 carried GHSA-rvm3-566m-v7fv (critical): remote content
//        at the app origin through Capacitor's internal proxy path. Fixed in
//        8.4.3. Found during the same round: Next 16.3.4 carried
//        GHSA-vcvr-r3jv-pc5j (critical, RCE in next/og ImageResponse, which
//        draws every card's link preview) plus six lesser advisories, all
//        fixed by 16.3.8.
// NS-03  The Android manifest never declared CAMERA, so the card scanner's
//        getUserMedia was refused with no dialog on every Android phone.
// NS-06  A page from before a deploy had no way back: see lib/chunk-reload.

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** "8.4.3" or "^8.4.3" → [8, 4, 3]. */
const parse = (v: string) => v.replace(/^[^\d]*/, "").split(".").map((n) => parseInt(n, 10));
const atLeast = (v: string, min: string) => {
  const a = parse(v);
  const b = parse(min);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
};

const PATCHED: Record<string, string> = {
  "@capacitor/core": "8.4.3",
  "@capacitor/cli": "8.4.3",
  "@capacitor/ios": "8.4.3",
  "@capacitor/android": "8.4.3",
  next: "16.3.8",
};

describe("NS-01: no shell or server ships a version with a known critical advisory", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;

  it.each(Object.entries(PATCHED))("%s is at least %s in package.json and the lockfile", (name, min) => {
    expect(deps[name], `${name} missing from package.json`).toBeTruthy();
    expect(atLeast(deps[name], min), `package.json ${name} ${deps[name]}`).toBe(true);
    const installed = lock.packages?.[`node_modules/${name}`]?.version as string | undefined;
    expect(installed, `${name} missing from package-lock.json`).toBeTruthy();
    expect(atLeast(installed!, min), `package-lock ${name} ${installed}`).toBe(true);
  });

  it("the iOS Swift package pins the same patched Capacitor, and Package.resolved agrees", () => {
    const swift = read("ios/App/CapApp-SPM/Package.swift");
    const pinned = swift.match(/capacitor-swift-pm\.git",\s*exact:\s*"([\d.]+)"/)?.[1];
    expect(pinned).toBeTruthy();
    expect(atLeast(pinned!, "8.4.3")).toBe(true);
    const resolved = JSON.parse(read("ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"));
    const pin = resolved.pins.find((p: { identity: string }) => p.identity === "capacitor-swift-pm");
    expect(pin.state.version).toBe(pinned);
  });
});

describe("NS-03: the Android scanner can ask for the camera", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml").replace(/<!--[\s\S]*?-->/g, "");

  it("declares CAMERA, without which Android refuses the runtime request silently", () => {
    expect(manifest).toMatch(/<uses-permission\s+android:name="android\.permission\.CAMERA"\s*\/>/);
  });

  it("does not make a camera a requirement, so Play keeps the app on camera-less devices", () => {
    expect(manifest).toMatch(/<uses-feature\s+android:name="android\.hardware\.camera"\s+android:required="false"\s*\/>/);
  });
});

describe("NS-06: chunk-load failures are recognised in every engine's wording", () => {
  it.each([
    [Object.assign(new Error("Failed to load chunk /_next/static/chunks/0a.js from runtime"), { name: "ChunkLoadError" })],
    ["Failed to load chunk /_next/static/chunks/0a.js from runtime"],
    [new Error("Loading chunk 123 failed.")],
    [new Error("Loading CSS chunk app-layout failed.")],
    [new TypeError("Failed to fetch dynamically imported module: https://swiftcard.me/_next/static/chunks/x.js")],
    [new TypeError("Importing a module script failed.")],
    [new TypeError("error loading dynamically imported module: https://swiftcard.me/x.js")],
  ])("%s", (err) => {
    expect(isChunkLoadError(err)).toBe(true);
  });

  it.each([[null], [undefined], [new Error("Failed to fetch")], [new TypeError("x is undefined")], ["Load failed"]])(
    "not %s",
    (err) => {
      expect(isChunkLoadError(err)).toBe(false);
    },
  );
});

describe("NS-06: recoverFromChunkError reloads once per window", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (store: Map<string, string> | "throws") => {
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("sessionStorage", store === "throws"
      ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }
      : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    return reload;
  };

  it("reloads the first time, refuses inside the window, reloads again after it", () => {
    const store = new Map<string, string>();
    const reload = stub(store);
    expect(recoverFromChunkError(1_000_000)).toBe(true);
    expect(recoverFromChunkError(1_000_000 + RELOAD_WINDOW_MS - 1)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(recoverFromChunkError(1_000_000 + RELOAD_WINDOW_MS + 1)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads without storage to guard against a loop", () => {
    const reload = stub("throws");
    expect(recoverFromChunkError()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("NS-06: the shell's sign-in return leg survives a deploy", () => {
  const src = read("src/components/NativeAppBridge.tsx");

  it("a chunk failure inside appUrlOpen keeps the link and reloads, instead of being swallowed", () => {
    expect(src).toMatch(/if \(isChunkLoadError\(e\)\) replayAfterReload\(url\);/);
  });

  it("the kept link is replayed once the listener is attached again", () => {
    const attach = src.indexOf('App.addListener("appUrlOpen", onAppUrl)');
    const replay = src.indexOf("takePendingAppUrl();");
    expect(attach).toBeGreaterThan(-1);
    expect(replay).toBeGreaterThan(attach);
  });
});
