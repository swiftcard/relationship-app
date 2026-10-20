import { describe, it, expect } from "vitest";
import { isTimeout, timeoutSignal, TookTooLongError, within } from "@/lib/time-limit";

// lib/time-limit: what keeps Create + (and every card picture) off a spinner
// that never ends (owner, 2026-10-20).
describe("time limits", () => {
  it("within: passes a result through, and gives up on a promise that never settles", async () => {
    await expect(within(Promise.resolve(7), 50)).resolves.toBe(7);
    await expect(within(Promise.reject(new Error("no")), 50)).rejects.toThrow("no");
    await expect(within(new Promise(() => {}), 30)).rejects.toBeInstanceOf(TookTooLongError);
  });

  it("timeoutSignal: really cancels the request, and the rejection reads as a timeout", async () => {
    const neverAnswers = (_: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason ?? new DOMException("aborted", "AbortError")));
    });
    const e = await neverAnswers("https://x.test", { signal: timeoutSignal(30) }).catch((err) => err);
    expect(isTimeout(e)).toBe(true);
    expect(isTimeout(new Error("Upload failed"))).toBe(false);
    expect(isTimeout(new DOMException("old WebKit", "AbortError"))).toBe(true);
  });
});
