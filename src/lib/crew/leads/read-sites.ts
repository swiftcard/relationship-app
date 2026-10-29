import { readSiteDetailed, type SiteRead } from "./fetch-page";

// ── Reading a run's sites a few at a time ───────────────────────────────────
// Office Prospects read its sites one after another, so 8 slow sites could
// take longer than the tick allows (each can take ~40s: robots.txt, the
// homepage and two pages, 10s timeouts, one second apart). Now a few sites are
// read at once, never two on the same host (so each site still sees one
// request a second), and no new site starts after the deadline. Everything a
// single read does (robots.txt, safe-fetch, timeouts, size limits) is
// unchanged: this only decides when each read starts.

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Reads each item's website, `concurrency` hosts at a time, sites on the same
 * host one after another. Returns the reads in the items' order; a site not
 * started by `deadline` (ms since the epoch) is left out and counted in
 * `notStarted`.
 */
export async function readSites<T extends { website: string }>(
  items: T[],
  o: { concurrency: number; deadline: number; now?: () => number },
): Promise<{ read: (T & SiteRead)[]; notStarted: number }> {
  const now = o.now ?? Date.now;
  const byHost = new Map<string, number[]>();
  items.forEach((it, i) => byHost.set(hostOf(it.website), [...(byHost.get(hostOf(it.website)) ?? []), i]));
  const queue = [...byHost.values()];
  const results: ((T & SiteRead) | undefined)[] = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.min(o.concurrency, queue.length) }, async () => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        for (const i of group) {
          if (now() >= o.deadline) return;
          results[i] = { ...items[i], ...(await readSiteDetailed(items[i].website)) };
        }
      }
    }),
  );
  const read = results.filter((r): r is T & SiteRead => !!r);
  return { read, notStarted: items.length - read.length };
}
