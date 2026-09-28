import { describe, it, expect } from "vitest";
import { purgeUserData } from "@/lib/account-purge";

// The purge cleaned card-shares and card-signatures and left card-uploads —
// the bucket holding the ORIGINAL headshots and logos — untouched forever.
// Deleting the auth user does not touch storage, so a person who deleted their
// account still had their face on a public URL.

type Removed = { bucket: string; paths: string[] };

/**
 * Minimal stand-in for the admin client. Every table call is a no-op that
 * resolves; only storage is modelled for real, since that is what is under
 * test. `remove` actually deletes from the fake bucket so the drain loop has
 * to make progress to terminate — a loop that re-listed the same page forever
 * would hang this test rather than pass it.
 */
function fakeAdmin(buckets: Record<string, string[]>) {
  const removed: Removed[] = [];
  const listCalls: { bucket: string; prefix: string }[] = [];

  const table = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "delete", "update", "eq", "in", "maybeSingle", "single"]) {
      chain[m] = () => chain;
    }
    // Awaiting the chain yields an empty result set.
    (chain as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
    return chain;
  };

  return {
    removed,
    listCalls,
    client: {
      from: table,
      auth: { admin: { deleteUser: async () => ({ data: null, error: null }) } },
      storage: {
        from(bucket: string) {
          return {
            async list(prefix: string, opts?: { limit?: number }) {
              listCalls.push({ bucket, prefix });
              const all = buckets[bucket] ?? [];
              const mine = all.filter((p) => p.startsWith(`${prefix}/`)).map((p) => ({ name: p.slice(prefix.length + 1) }));
              return { data: mine.slice(0, opts?.limit ?? 100), error: null };
            },
            async remove(paths: string[]) {
              removed.push({ bucket, paths });
              buckets[bucket] = (buckets[bucket] ?? []).filter((p) => !paths.includes(p));
              return { data: null, error: null };
            },
          };
        },
      },
    },
  };
}

const USER = "11111111-2222-3333-4444-555555555555";

describe("purgeUserData clears the card-uploads bucket", () => {
  it("removes the user's uploaded headshots and logos", async () => {
    const { client, removed } = fakeAdmin({
      "card-uploads": [`${USER}/photo-1700000000000.jpg`, `${USER}/logo-1700000000001.png`],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await purgeUserData(client as any, USER);

    const uploads = removed.filter((r) => r.bucket === "card-uploads").flatMap((r) => r.paths);
    expect(uploads, "the account's headshot survived the purge").toContain(`${USER}/photo-1700000000000.jpg`);
    expect(uploads).toContain(`${USER}/logo-1700000000001.png`);
  });

  it("drains past the 100-object page — not just the first batch", async () => {
    // A single list() returns 100. An account that re-uploaded its headshot
    // more than a hundred times would otherwise keep everything after #100.
    const files = Array.from({ length: 250 }, (_, i) => `${USER}/photo-${i}.jpg`);
    const { client, removed } = fakeAdmin({ "card-uploads": [...files] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await purgeUserData(client as any, USER);

    const uploads = new Set(removed.filter((r) => r.bucket === "card-uploads").flatMap((r) => r.paths));
    expect(uploads.size, "stopped early — objects past the first page were left public").toBe(250);
    for (const f of files) expect(uploads.has(f)).toBe(true);
  });

  it("touches only this user's folder", async () => {
    const OTHER = "99999999-8888-7777-6666-555555555555";
    const { client, removed } = fakeAdmin({
      "card-uploads": [`${USER}/photo-1.jpg`, `${OTHER}/photo-1.jpg`],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await purgeUserData(client as any, USER);

    const uploads = removed.filter((r) => r.bucket === "card-uploads").flatMap((r) => r.paths);
    expect(uploads).toEqual([`${USER}/photo-1.jpg`]);
    expect(uploads.some((p) => p.startsWith(OTHER)), "purged another account's uploads").toBe(false);
  });

  it("still deletes the auth user when the bucket is empty", async () => {
    // Storage cleanup is best-effort and must never block the actual deletion.
    const { client, removed } = fakeAdmin({ "card-uploads": [] });
    // true = purged (it now reports whether it did; see the billing guard).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(purgeUserData(client as any, USER)).resolves.toBe(true);
    expect(removed.filter((r) => r.bucket === "card-uploads" && r.paths.length)).toHaveLength(0);
  });
});
