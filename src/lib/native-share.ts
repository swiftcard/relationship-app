/**
 * The iOS shell's share sheet, with "closed it" told apart from "not there".
 *
 * Closing the sheet without sharing REJECTS the plugin call ("Share canceled"),
 * just like a shell built without the plugin does. Every share button read
 * both the same way — "try the web share sheet next" — so in the app, closing
 * the sheet opened navigator.share's sheet straight after and the owner had to
 * close it twice (dashboard "Share link", 2026-10-06).
 *
 * Only a missing plugin (an old shell, or the chunk failing to load) answers
 * "unavailable" and lets the caller fall through to the web paths. Anything
 * else the sheet says — cancelled, an app's share extension erroring, a sheet
 * already up — is the person's answer, and asking again is the bug.
 *
 * Pinned by tests/native-share-cancel.test.ts.
 */
export type NativeShareResult = "shared" | "cancelled" | "unavailable";

export async function shareNatively(options: { url: string; text?: string }): Promise<NativeShareResult> {
  let Share: typeof import("@capacitor/share").Share;
  try {
    ({ Share } = await import("@capacitor/share"));
  } catch {
    return "unavailable";
  }
  try {
    await Share.share(options);
    return "shared";
  } catch (e) {
    // @capacitor/core throws code "UNIMPLEMENTED" when the shell has no Share
    // plugin; the plugin's own rejections carry no such code.
    return (e as { code?: unknown } | null)?.code === "UNIMPLEMENTED" ? "unavailable" : "cancelled";
  }
}
