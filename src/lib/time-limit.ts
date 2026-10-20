// ── Time limits for waits in the browser ────────────────────────────────────
//
// Owner, 2026-10-20: a Create + paste "just stays on a loading screen". Nothing
// it waited on had a limit, and html-to-image's own createImage can stay
// pending for good (lib/capture-exact). Two tools, one for each kind of wait:
//
//   • a fetch → `timeoutSignal(ms)`: the request is really cancelled, so a
//     slow upload can't still land after the person was told it didn't.
//   • anything that can't be cancelled (a decode, fonts.ready, a capture) →
//     `within(p, ms)`: stop waiting for it.
//
// AbortSignal.timeout() would be the one-liner for the first, but it needs
// iOS 16 and the app still runs on iOS 15.

export class TookTooLongError extends Error {
  constructor() { super("took too long"); }
}

/** `p`, or a TookTooLongError after `ms`. */
export function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TookTooLongError()), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** An AbortSignal that fires after `ms` (a fetch given it rejects then). */
export function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(new TookTooLongError()), ms);
  return ctrl.signal;
}

/** The rejection of a fetch whose timeoutSignal fired. */
export function isTimeout(e: unknown): boolean {
  return e instanceof TookTooLongError || (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError"));
}
