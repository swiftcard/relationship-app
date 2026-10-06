import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERSON_SCOPED_STORAGE_KEYS } from "@/lib/account-state";

// ── Offline cards on the web (public/sw.js, public/offline.html) ────────────
//
// Source guards for the parts a behaviour test can't watch on every push. The
// behaviour itself (save, go offline, reopen; the contact file offline; the
// no-signal screen; the outbox delivering) is exercised in real Chromium by
// tests/render/offline-sw.test.ts.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sw = code(read("public/sw.js"));
const offline = read("public/offline.html");

describe("the service worker only ever touches GET", () => {
  it("forms, logins, payments and every POST go straight to the network", () => {
    expect(sw).toMatch(/if \(req\.method !== "GET"\) return;/);
    // The method check is the first thing the fetch handler does.
    const handler = sw.slice(sw.indexOf('self.addEventListener("fetch"'));
    expect(handler.indexOf('req.method !== "GET"')).toBeLessThan(handler.indexOf("respondWith"));
  });

  it("leaves /api alone, except the card's contact file", () => {
    expect(sw).toMatch(/if \(url\.pathname\.startsWith\("\/api\/"\)\) return;/);
    expect(sw).toMatch(/const VCARD_PATH = \/\^\\\/api\\\/card\\\/\[\^\/\]\+\\\/vcard\$\/;/);
  });

  it("never saves an error, a redirect or a non-page as a card", () => {
    expect(sw).toMatch(/if \(!page\.ok \|\| page\.redirected \|\| !html\) return;/);
    expect(sw).toMatch(/res\.ok && res\.type === "basic" && !res\.redirected/);
  });

  it("a card the server says is gone (switched off, deleted) is dropped, so the office switch still wins", () => {
    expect(sw).toMatch(/res\.status === 404 \|\| res\.status === 410\)\) return forget\(/);
  });

  it("any page that fails to load falls back to the no-signal screen, kept from install", () => {
    expect(sw).toMatch(/const OFFLINE_URL = "\/offline\.html";/);
    expect(sw).toMatch(/c\.add\(new Request\(OFFLINE_URL, \{ cache: "reload" \}\)\)/);
    expect(sw).toMatch(/caches\.match\(OFFLINE_URL, \{ cacheName: SHELL \}\)/);
  });

  it("is bounded: a capped number of cards, and nothing kept that no saved card needs", () => {
    expect(sw).toMatch(/const MAX_CARDS = 25;/);
    expect(sw).toMatch(/async function pruneStatic\(/);
  });

  it("forgets every saved card on sign-out or an account switch", () => {
    expect(sw).toMatch(/msg\.type === "forget-cards"/);
    expect(read("src/lib/account-state.ts")).toMatch(/postMessage\(\{ type: "forget-cards" \}\)/);
  });

  it("keeps the push handlers that the notification tests pin", () => {
    expect(sw).toMatch(/self\.addEventListener\("push"/);
    expect(sw).toMatch(/self\.addEventListener\("notificationclick"/);
  });
});

describe("cards are saved only where it makes sense", () => {
  it("the card and Swift Links pages save themselves, never the /preview embed", () => {
    for (const p of ["src/app/[username]/page.tsx", "src/app/links/[username]/page.tsx"]) {
      expect(read(p), p).toMatch(/\{!isEmbed && \(?\s*<OfflineCardSaver/);
    }
  });

  it("only after a person has really looked, like the view count", () => {
    expect(read("src/components/OfflineCardSaver.tsx")).toMatch(/waitForHuman\(\(\) => cancelled\)/);
  });
});

describe("the no-signal screen", () => {
  it("draws the QR with MiniQR's own look, so the code is the same one everywhere", () => {
    const mini = read("src/components/card-templates/MiniQR.tsx");
    const num = (src: string, name: string) => src.match(new RegExp(`${name} = ([\\d.]+)`))?.[1];
    for (const n of ["MODULE", "CORNER", "EYE"]) {
      expect(num(offline, n), n).toBe(num(mini, n));
      expect(num(offline, n), n).toBeTruthy();
    }
  });

  it("opens on the Contact code and says You're offline", () => {
    expect(offline).toContain("You're offline");
    expect(offline).toMatch(/var mode = card\.contact \? "contact" : "link";/);
  });

  it("never puts stored text into the page as HTML", () => {
    expect(offline).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it("is self-contained: nothing to fetch with no signal", () => {
    expect(offline).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
  });
});

describe("what the owner keeps on the device is person-scoped", () => {
  it("the offline QR and the saved-card list are wiped with the account", () => {
    expect(PERSON_SCOPED_STORAGE_KEYS).toContain("sc_offline_card");
    expect(PERSON_SCOPED_STORAGE_KEYS).toContain("sc_saved_cards");
    expect(read("src/components/OfflineOwnerSnapshot.tsx")).toContain('"sc_offline_card"');
    expect(read("src/components/OfflineCardSaver.tsx")).toContain('"sc_saved_cards"');
  });
});

describe("nothing a visitor does with no signal is lost", () => {
  it("every lead form and the trackers go through the outbox", () => {
    for (const f of ["src/components/LeadCaptureForm.tsx", "src/components/SaveContactButton.tsx", "src/components/ConnectButton.tsx"]) {
      expect(read(f), f).toMatch(/outbox\.fetch\("\/api\/leads"/);
      expect(read(f), f).toMatch(/isQueuedOffline\(err\)/);
    }
    expect(read("src/components/CardEventTracker.tsx")).toMatch(/outbox\.fetch\("\/api\/card-events"/);
    expect(read("src/components/SaveContactButton.tsx")).toMatch(/outbox\.fetch\("\/api\/card-events"/);
    expect(read("src/lib/track-link-click.ts")).toMatch(/navigator\.onLine === false && enqueue\("\/api\/card-events"/);
  });

  it("the outbox is delivered from every page", () => {
    expect(read("src/app/layout.tsx")).toMatch(/<OfflineOutbox \/>/);
  });

  it("Save Contact never says Saved for a file that can't arrive", () => {
    const s = read("src/components/SaveContactButton.tsx");
    expect(s).toMatch(/if \(await contactFileReachable\(vcardHref\)\) \{/);
    expect(s).toMatch(/caches\.match\(key\.origin \+ key\.pathname\.toLowerCase\(\), \{ cacheName: "sc-cards-v1" \}\)/);
  });
});

describe("production is watched", () => {
  it("every night and after every deploy, real Chromium checks a card opens with no signal", () => {
    expect(read(".github/workflows/nightly-qa.yml")).toContain("OUT=nightly/offline node scripts/qa-offline.mjs");
    expect(read("scripts/qa-nightly-summary.mjs")).toContain('"nightly/offline/failures.json"');
    const qa = read("scripts/qa-offline.mjs");
    // Read-only against production: every write the page would make is answered locally.
    expect(qa).toMatch(/ctx\.route\(\/\\\/api\\\/\(card-events\|leads\|analytics\\\/event\|account-exists\)\//);
  });
});

describe("the help assistant knows", () => {
  it("the website now works offline, and the Contact switch exists", () => {
    const kb = read("src/lib/knowledge/docs/product.ts");
    expect(kb).not.toContain("does not work offline");
    expect(kb).toContain("Contact · no signal");
    expect(kb).toContain("Saved on your phone");
  });
});
