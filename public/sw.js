// ── OFFLINE CARDS ────────────────────────────────────────────────────────────
//
// A card is most often opened where the signal is worst: a conference hall, a
// basement venue, a trade-show floor. Nothing can open a page on a phone that
// has never loaded it and has no internet (that case is the Contact QR's job,
// lib/contact-qr.ts). But once a card HAS opened on a phone, this worker keeps
// it there, so it opens again with no signal and Save Contact still works:
//
//   • The card page asks to be saved (components/OfflineCardSaver.tsx) once a
//     person has actually looked at it. The worker stores the page, its
//     contact file (/api/card/<u>/vcard, photo included), and the scripts,
//     styles, fonts and pictures it needs to run.
//   • Opening a saved card tries the network first, so an edit or the office
//     switch-off always wins when there is signal. If the network fails, or
//     hasn't answered in a few seconds, the saved copy opens instead.
//   • Any other page that fails to load shows /offline.html: the owner's own QR
//     codes (kept by the dashboard) and the cards saved on this phone.
//
// It touches nothing else. Only GET requests are looked at: forms, logins,
// payments and every POST go straight to the network, as do all /api calls
// except the contact file.

const CARDS = "sc-cards-v1";   // saved pages, their contact files, the index
const STATIC = "sc-static-v1"; // what saved pages need to run: scripts, styles, fonts, pictures
const SHELL = "sc-shell-v1";   // the offline screen
const KEEP = [CARDS, STATIC, SHELL];
const OFFLINE_URL = "/offline.html";
const INDEX_URL = "/__sc/index.json";
const MAX_CARDS = 25;
const MAX_ASSETS = 120;
const REFRESH_MS = 60 * 60 * 1000;
const SLOW_MS = 3500;
const VCARD_PATH = /^\/api\/card\/[^/]+\/vcard$/;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Lets the page request start while the worker is still waking up, so
    // having a worker never makes a page slower.
    try { await self.registration.navigationPreload?.enable(); } catch { /* unsupported */ }
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("sc-") && !KEEP.includes(n)).map((n) => caches.delete(n)));
    await clients.claim();
  })());
});

/** The one address a card is saved under: no query, lower case, /card/x → /x. */
function cardKey(pathname) {
  let p = String(pathname || "/").toLowerCase().replace(/\/+$/, "") || "/";
  if (p.startsWith("/card/")) p = p.slice(5);
  return p;
}

function isCardImage(url) {
  return url.protocol === "https:" && url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/storage/v1/object/public/");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The page's own request: the navigation preload when there is one. */
async function fromNetwork(event) {
  const pre = await event.preloadResponse;
  return pre || fetch(event.request);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && VCARD_PATH.test(url.pathname)) {
    event.respondWith(savedFirstWhenSlow(event, url.origin + url.pathname.toLowerCase()));
    return;
  }
  if (req.mode === "navigate" && sameOrigin) {
    if (url.pathname.startsWith("/api/")) return;
    event.respondWith(navigate(event, url));
    return;
  }
  if (sameOrigin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(networkThenSaved(req));
    return;
  }
  if (!sameOrigin && req.destination === "image" && isCardImage(url)) {
    event.respondWith(networkThenSaved(req));
  }
});

/** Scripts, styles, fonts, pictures: the network as usual, the saved copy only when it fails. */
function networkThenSaved(req) {
  return fetch(req).catch(async (err) => {
    const hit = await caches.match(req.url, { cacheName: STATIC, ignoreVary: true });
    if (hit) return hit;
    throw err;
  });
}

async function navigate(event, url) {
  const key = url.origin + cardKey(url.pathname);
  const cache = await caches.open(CARDS);
  const saved = await cache.match(key);
  if (!saved) {
    try {
      return await fromNetwork(event);
    } catch {
      return (await caches.match(OFFLINE_URL, { cacheName: SHELL })) || Response.error();
    }
  }
  return savedFirstWhenSlow(event, key, saved, cache, true);
}

/**
 * A saved card or contact file: the network if it answers within SLOW_MS
 * (whatever it says: a switched-off card's 404 must win), else the saved copy.
 * The network keeps going in the background and refreshes the saved copy, or
 * drops it when the card is gone.
 */
async function savedFirstWhenSlow(event, key, saved, cache, isPage = false) {
  cache = cache || (await caches.open(CARDS));
  saved = saved || (await cache.match(key));
  const network = fromNetwork(event).then((res) => ({ res, copy: res.clone() }));
  event.waitUntil(
    network.then(({ res, copy }) => {
      if (!saved) return;
      if (isPage && (res.status === 404 || res.status === 410)) return forget(cardKey(new URL(key).pathname));
      if (res.ok && res.type === "basic" && !res.redirected) return cache.put(key, copy);
    }).catch(() => {}),
  );
  if (!saved) return network.then(({ res }) => res);
  // A server error is no better than no signal: the saved copy beats it.
  const first = await Promise.race([network.then(({ res }) => (res.status < 500 ? res : null), () => null), sleep(SLOW_MS).then(() => null)]);
  return first || saved;
}

// ── The saved-card index ─────────────────────────────────────────────────────
// { cards: { "/alex": { name, savedAt, seen, urls: [...] } } } — what is saved,
// when it was fetched, when it was last opened, and every URL it needs.

let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

async function readIndex(cache) {
  try {
    const r = await cache.match(INDEX_URL);
    const j = r ? await r.json() : null;
    return j && typeof j.cards === "object" && j.cards ? j : { cards: {} };
  } catch { return { cards: {} }; }
}

function writeIndex(cache, index) {
  return cache.put(INDEX_URL, new Response(JSON.stringify(index), { headers: { "Content-Type": "application/json" } }));
}

async function forget(path) {
  return serial(async () => {
    const cache = await caches.open(CARDS);
    const index = await readIndex(cache);
    const entry = index.cards[path];
    await cache.delete(self.location.origin + path);
    if (entry?.vcard) await cache.delete(self.location.origin + entry.vcard);
    delete index.cards[path];
    await writeIndex(cache, index);
    await pruneStatic(index);
  });
}

async function pruneStatic(index) {
  const keep = new Set();
  for (const e of Object.values(index.cards)) for (const u of e.assets || []) keep.add(u);
  const cache = await caches.open(STATIC);
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

function validAsset(raw) {
  try {
    const u = new URL(raw, self.location.origin);
    if (u.origin === self.location.origin) return u.pathname.startsWith("/_next/static/") ? u.href : null;
    return isCardImage(u) ? u.href : null;
  } catch { return null; }
}

async function fetchAsset(href) {
  const same = new URL(href).origin === self.location.origin;
  let r = await fetch(href, { mode: same ? "same-origin" : "cors", credentials: same ? "same-origin" : "omit" }).catch(() => null);
  // A picture host that doesn't answer CORS can still be kept for an <img>.
  if (!r && !same) r = await fetch(href, { mode: "no-cors", credentials: "omit" }).catch(() => null);
  return r && (r.ok || r.type === "opaque") ? r : null;
}

async function saveCard(msg) {
  if (typeof msg.path !== "string" || !msg.path.startsWith("/") || msg.path.startsWith("//")) return;
  const path = cardKey(msg.path);
  if (path === "/") return;
  const vcard = typeof msg.vcard === "string" && VCARD_PATH.test(msg.vcard) ? msg.vcard.toLowerCase() : null;
  const assets = [...new Set((Array.isArray(msg.assets) ? msg.assets : []).map(validAsset).filter(Boolean))].slice(0, MAX_ASSETS);
  const name = typeof msg.name === "string" ? msg.name.slice(0, 120) : "";

  const cache = await caches.open(CARDS);
  const index = await readIndex(cache);
  const prev = index.cards[path];
  const now = Date.now();
  let savedAt = prev?.savedAt || 0;

  if (!prev || now - savedAt > REFRESH_MS || !(await cache.match(self.location.origin + path))) {
    const page = await fetch(path, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
    if (!page) return;
    if (page.status === 404 || page.status === 410) {
      if (prev) { delete index.cards[path]; await cache.delete(self.location.origin + path); await writeIndex(cache, index); }
      return;
    }
    const html = (page.headers.get("Content-Type") || "").includes("text/html");
    if (!page.ok || page.redirected || !html) return;
    await cache.put(self.location.origin + path, page);
    if (vcard) {
      const v = await fetch(vcard, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
      if (v && v.ok) await cache.put(self.location.origin + vcard, v);
    }
    savedAt = now;
  }

  const stat = await caches.open(STATIC);
  for (const href of assets) {
    if (await stat.match(href, { ignoreVary: true })) continue;
    const r = await fetchAsset(href);
    if (r) await stat.put(href, r);
  }

  index.cards[path] = { name, savedAt, seen: now, vcard, assets };
  // Only the most recently opened cards stay.
  const order = Object.entries(index.cards).sort((a, b) => (b[1].seen || 0) - (a[1].seen || 0));
  for (const [p, e] of order.slice(MAX_CARDS)) {
    await cache.delete(self.location.origin + p);
    if (e.vcard) await cache.delete(self.location.origin + e.vcard);
    delete index.cards[p];
  }
  await writeIndex(cache, index);
  await pruneStatic(index);
}

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "save-card") event.waitUntil(serial(() => saveCard(msg)).catch(() => {}));
  // Sign-out or a different account on this browser (lib/account-state.ts).
  if (msg.type === "forget-cards") event.waitUntil(serial(() => Promise.all([caches.delete(CARDS), caches.delete(STATIC)])).catch(() => {}));
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { return; }

  // ONE ACTION, AND IT OPENS THE APP.
  //
  // Lead notifications used to carry a second button that downloaded the
  // contact card straight from the notification. It was removed
  // 2026-09-11 on the owner's reasoning, which is right: a notification saying
  // someone shared their details is the highest-intent moment SwiftCard ever
  // gets, and finishing the job on the lock screen spends it. The person never
  // sees who it was, what they wrote, or anything else waiting for them — and
  // the product loses the one visit it had earned. Saving is a thing you decide
  // after looking, inside the app.
  const actions = [{ action: "view", title: "Open SwiftCard" }];

  // A SILENT update (the running view count — see lib/push-policy.ts) replaces
  // the notification already on screen without alerting again: same tag, no
  // sound or vibration, and renotify OFF, which is the flag that decides
  // whether replacing a tagged notification re-alerts the person. The web half
  // of what interruption-level "passive" does on iOS.
  const silent = data.silent === true;

  event.waitUntil(
    self.registration.showNotification(data.title ?? "SwiftCard", {
      body: data.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag ?? "swiftcard",
      renotify: !silent,
      silent,
      data: { url: data.url ?? "/dashboard" },
      actions,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notifData = event.notification.data ?? {};

  // Every tap, on every action, lands in the app on the screen the notification
  // is about. There is deliberately no path out of here that completes a task
  // without opening SwiftCard — see the note on `actions` above.
  const url = notifData.url ?? "/dashboard";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // If a SwiftCard tab is already open, navigate it to the target URL and focus
      for (const client of windowClients) {
        if ("navigate" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
