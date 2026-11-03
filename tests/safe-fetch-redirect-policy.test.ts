import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeFetch } from "@/lib/safe-fetch";

const transport = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "8.8.8.8", family: 4 }] }));
vi.mock("undici", () => ({ Agent: class {}, fetch: transport }));
beforeEach(() => transport.mockReset());

describe("public crawler redirect policy", () => {
  it("checks the caller's robots/rate policy before every redirect hop", async () => {
    transport.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example/team" } })).mockResolvedValueOnce(new Response("ok"));
    const check = vi.fn<(url: URL) => Promise<void>>().mockResolvedValue(undefined);
    await safeFetch("https://business.example/", {}, 3, check);
    expect(check.mock.calls.map((args) => (args[0] as URL).href)).toEqual(["https://business.example/", "https://other.example/team"]);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("does not fetch a redirect target whose policy refuses access", async () => {
    transport.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://blocked.example/team" } }));
    await expect(safeFetch("https://business.example/", {}, 3, async (url) => {
      if (url.hostname === "blocked.example") throw new Error("robots denied");
    })).rejects.toThrow("robots denied");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("still rejects a private redirect before transport or policy evaluation", async () => {
    transport.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    const check = vi.fn<(url: URL) => Promise<void>>().mockResolvedValue(undefined);
    await expect(safeFetch("https://business.example/", {}, 3, check)).rejects.toThrow("blocked ip");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
