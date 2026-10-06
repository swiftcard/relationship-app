// What a visitor does with no signal is kept, not lost.
//
// A card is opened where reception is worst: a conference floor, a basement
// venue. The card page itself can open with no signal (public/sw.js), but
// three things it sends would simply fail and be dropped: "Share your info"
// (a warm lead, the most valuable thing a card ever collects), the view and
// the contact save the owner is told about, and link taps. Each of those now
// goes through `outbox.fetch`. With signal it is plain fetch, unchanged. When
// the request cannot leave the phone, it is kept in this browser and sent
// the next time it can: when the connection comes back while the page is
// open, or on the next visit to any swiftcard.me page
// (components/OfflineOutbox.tsx).
//
// Only these endpoints queue, only JSON POSTs, and only on a NETWORK failure.
// An answer from the server, even an error, is handled exactly as before.
// A replay of a request that did land after all is absorbed by the
// server's own dedupe: the 5-minute same-phone window in /api/leads, and the
// visit window in /api/card-events.

export const OUTBOX_KEY = "sc_outbox_v1";
const QUEUEABLE = new Set(["/api/leads", "/api/card-events"]);
const MAX_ITEMS = 30;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Item = { id: string; url: string; body: string; at: number };

/** Thrown by outbox.fetch when the request could not leave the phone and was kept to send later. */
export class QueuedOffline extends Error {
  constructor() {
    super("No signal: kept on this phone and sent when the connection is back");
    this.name = "QueuedOffline";
  }
}

export const isQueuedOffline = (e: unknown): e is QueuedOffline => e instanceof QueuedOffline;

function read(): Item[] {
  try {
    const list = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    return Array.isArray(list)
      ? list.filter((i): i is Item => !!i && typeof i.id === "string" && QUEUEABLE.has(i.url) && typeof i.body === "string" && typeof i.at === "number")
      : [];
  } catch {
    return [];
  }
}

function write(items: Item[]): boolean {
  try {
    if (items.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    else localStorage.removeItem(OUTBOX_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Keep a request to send later. False when this browser can't store it (private mode, storage blocked). */
export function enqueue(url: string, body: string): boolean {
  if (!QUEUEABLE.has(url) || typeof window === "undefined") return false;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return write([...read(), { id, url, body, at: Date.now() }].slice(-MAX_ITEMS));
}

const offlineNow = () => typeof navigator !== "undefined" && navigator.onLine === false;

type Init = { method: "POST"; headers?: Record<string, string>; body: string; keepalive?: boolean };

export const outbox = {
  /**
   * fetch, but a request that can't leave the phone is kept and replayed
   * later. Rejects with QueuedOffline in that case, so a form can say it is
   * saved rather than sent. `timeoutMs` stops a request stuck on a hopeless
   * connection from spinning forever; it is queued instead.
   */
  async fetch(url: string, init: Init, opts: { timeoutMs?: number } = {}): Promise<Response> {
    if (!QUEUEABLE.has(url)) return fetch(url, init);
    if (offlineNow()) {
      if (enqueue(url, init.body)) throw new QueuedOffline();
      throw new TypeError("offline");
    }
    const ctrl = opts.timeoutMs ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
    try {
      return await fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
    } catch (e) {
      if (enqueue(url, init.body)) throw new QueuedOffline();
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
};

let flushing = false;

/**
 * Send whatever was kept, oldest first. A server answer of any kind settles an
 * item, except a 408, a 429 or a 5xx (try again later). A network failure stops
 * the run: still no signal. Safe to call often. One tab flushes at a time.
 */
export async function flushOutbox(): Promise<void> {
  if (typeof window === "undefined" || flushing || offlineNow() || !read().length) return;
  const run = async () => {
    flushing = true;
    try {
      for (const item of read()) {
        const drop = () => write(read().filter((i) => i.id !== item.id));
        if (Date.now() - item.at > MAX_AGE_MS) { drop(); continue; }
        let res: Response;
        try {
          res = await fetch(item.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: item.body,
            keepalive: true,
          });
        } catch {
          return;
        }
        if (res.status === 408 || res.status === 429 || res.status >= 500) return;
        drop();
      }
    } finally {
      flushing = false;
    }
  };
  const locks = (navigator as Navigator & { locks?: { request: (n: string, o: { ifAvailable: boolean }, cb: (l: unknown) => Promise<void>) => Promise<void> } }).locks;
  if (locks) await locks.request("sc-outbox", { ifAvailable: true }, async (lock) => { if (lock) await run(); });
  else await run();
}
