"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { uploadMedia, uploadErrorMessage, UploadError } from "@/lib/upload-media";
import { createFallbackUrl, createIdFromUpload, createShareUrl, GMAIL_SIGNATURE_LIMIT } from "@/lib/create-link";
import {
  isSafeLinkedHtml, linkEverything, pictureHtml, relink, renderableDocument, renderOffscreen, snapshotPng, textToHtml, TooMuchError,
} from "@/lib/link-anything";

// The Links page's Create + side (owner, 2026-10-07): paste anything — an email
// signature, some text — or drop a picture, and get it back looking exactly
// the same with every part opening your SwiftCard. One Copy puts it on the
// clipboard twice over: as the linked thing for email, docs and websites, and
// as its share link for texts and social apps, where the link previews as the
// thing itself (lib/create-link, src/app/[username]/p/[id]). Pro and Office.

const PLACEHOLDER = "https://swiftcard.me/__create_link__";
// The upload route's request limit is ~4.5 MB; leave headroom.
const MAX_UPLOAD = 4_300_000;
const UPLOADABLE = ["image/jpeg", "image/png", "image/webp", "image/gif"];

type Made = { html: string; shareUrl: string; dropped: number };
type Phase =
  | { kind: "empty" }
  | { kind: "working" }
  | ({ kind: "ready" } & Made)
  | { kind: "error"; message: string };
type Input = { html: string } | { text: string } | { file: File };

class NothingError extends Error {}

/** A picture the upload route will take: a JPG/PNG/WebP/GIF under the limit.
 *  Anything else (a huge photo, a BMP, a HEIC) is redrawn as JPEG/PNG. */
async function uploadable(file: File): Promise<File> {
  if (UPLOADABLE.includes(file.type) && file.size <= MAX_UPLOAD) return file;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("Use a JPG, PNG, WebP or GIF picture."); }
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const png = file.type === "image/png";
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, png ? "image/png" : "image/jpeg", 0.9));
  if (!blob) throw new Error("That picture couldn't be read — try another.");
  return new File([blob], png ? "picture.png" : "picture.jpg", { type: blob.type });
}

async function naturalSize(file: File): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const s = { w: bmp.width, h: bmp.height };
    bmp.close();
    return s;
  } catch {
    return { w: 600, h: 400 };
  }
}

async function srcToFile(src: string): Promise<File> {
  const blob = await (await fetch(src)).blob();
  const ext = blob.type.split("/")[1] || "png";
  return new File([blob], `pasted.${ext}`, { type: blob.type || "image/png" });
}

/** What was pasted or dropped. A signature copied from a mail app arrives as
 *  HTML (perhaps with pictures in it); a picture copied on its own arrives as
 *  a file, often with a one-<img> HTML twin that's only a pointer to it. */
function readTransfer(dt: DataTransfer | null): Input | null {
  if (!dt) return null;
  const html = dt.getData("text/html");
  const file = Array.from(dt.files ?? []).find((f) => f.type.startsWith("image/"));
  const htmlHasText = !!html && !!new DOMParser().parseFromString(html, "text/html").body.textContent?.trim();
  if (file && !htmlHasText) return { file };
  if (html && html.trim()) return { html };
  if (file) return { file };
  const text = dt.getData("text/plain");
  return text.trim() ? { text } : null;
}

function messageFor(e: unknown): string {
  if (e instanceof TooMuchError) return "That's more than a signature — paste just your signature, some text, or one picture.";
  if (e instanceof NothingError) return "There was nothing to link in that. Copy your signature or a picture, then paste it here.";
  if (e instanceof UploadError && e.status === 403) return "Create is part of Pro.";
  return uploadErrorMessage(e);
}

/** The linked thing exactly as an email shows it: in a shadow root, so none of
 *  this app's CSS can change a margin, a font or an image. Clickable, like
 *  the real thing (links open in a new tab). */
function LinkedPreview({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Before paint: the preview is never seen empty, not even for a frame.
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>:host{all:initial;display:block}</style>${html}`;
  }, [html]);
  return <div ref={ref} data-create-preview className="block min-w-0 overflow-x-auto" />;
}

export default function CreateLinkBox({ username, appUrl, selfToken = null }: {
  username: string;
  appUrl: string;
  /** The owner's signed self-view token (lib/self-pass, made on the server).
   *  The on-screen preview's links go through /api/self-view with it, so the
   *  owner opening their own creation — in the iPhone app that opens Safari,
   *  which has never signed in — is never counted as a view or notified. The
   *  copied HTML keeps the real share link. */
  selfToken?: string | null;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "empty" });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [canReadClipboard, setCanReadClipboard] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);
  const storeKey = `sc_create_${username}`;

  // The last thing they made, on this device — hosted pictures only, so it is
  // safe to keep (and checked again before it's shown).
  useEffect(() => {
    aliveRef.current = true;
    /* eslint-disable react-hooks/set-state-in-effect -- browser-only state, read once on mount */
    setCanReadClipboard(typeof navigator !== "undefined" && !!navigator.clipboard && "read" in navigator.clipboard);
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || "null") as Made | null;
      if (saved && typeof saved.html === "string" && typeof saved.shareUrl === "string" && isSafeLinkedHtml(saved.html)) {
        setPhase({ kind: "ready", html: saved.html, shareUrl: saved.shareUrl, dropped: 0 });
      }
    } catch { /* storage blocked or junk — start empty */ }
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => { aliveRef.current = false; };
  }, [storeKey]);

  async function make(input: Input) {
    setPhase({ kind: "working" });
    setCopyState("idle");
    try {
      let made: Made;
      if ("file" in input) {
        const file = await uploadable(input.file);
        const { w, h } = await naturalSize(file);
        const { url } = await uploadMedia(file, "create");
        const id = createIdFromUpload(url);
        const shareUrl = id ? createShareUrl(appUrl, username, id) : createFallbackUrl(appUrl, username);
        made = { html: pictureHtml(url, w, h, shareUrl), shareUrl, dropped: 0 };
      } else {
        const raw = "html" in input ? input.html : textToHtml(input.text);
        const frame = await renderOffscreen(renderableDocument(raw));
        let linked;
        try { linked = linkEverything(frame, PLACEHOLDER); } finally { frame.remove(); }
        if (!linked.root.textContent?.trim() && !linked.root.querySelector("img")) throw new NothingError();
        for (const p of linked.pending) {
          const { url } = await uploadMedia(await uploadable(await srcToFile(p.src)), "create");
          p.img.setAttribute("src", url);
        }
        const draft = linked.root.outerHTML;
        // The share link previews as this — a picture of it, uploaded. If the
        // picture can't be made, the link still opens the card (with the
        // card's own preview); nothing is left half-done.
        let shareUrl = createFallbackUrl(appUrl, username);
        try {
          const png = await snapshotPng(draft);
          const { url } = await uploadMedia(new File([png], "signature.png", { type: "image/png" }), "create");
          const id = createIdFromUpload(url);
          if (id) shareUrl = createShareUrl(appUrl, username, id);
        } catch (e) {
          // Keep the fallback; say why in the console for whoever looks.
          console.warn("[create] preview picture not made:", e instanceof Error ? e.message : e);
        }
        made = { html: relink(draft, PLACEHOLDER, shareUrl), shareUrl, dropped: linked.dropped };
      }
      if (!aliveRef.current) return;
      try { localStorage.setItem(storeKey, JSON.stringify({ html: made.html, shareUrl: made.shareUrl })); } catch { /* ignore */ }
      setPhase({ kind: "ready", ...made });
    } catch (e) {
      if (aliveRef.current) setPhase({ kind: "error", message: messageFor(e) });
    }
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const input = readTransfer(e.clipboardData);
    if (input) void make(input);
    else setPhase({ kind: "error", message: "There was nothing to paste. Copy your signature or a picture first." });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const input = readTransfer(e.dataTransfer);
    if (input) void make(input);
  }

  async function pasteButton() {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (!it.types.includes("text/html")) continue;
        const html = await (await it.getType("text/html")).text();
        const hasText = !!new DOMParser().parseFromString(html, "text/html").body.textContent?.trim();
        const pic = it.types.find((t) => t.startsWith("image/"));
        if (!hasText && pic) break; // a picture with a pointer twin: take the picture below
        return void make({ html });
      }
      for (const it of items) {
        const pic = it.types.find((t) => t.startsWith("image/"));
        if (pic) return void make({ file: new File([await it.getType(pic)], `pasted.${pic.split("/")[1]}`, { type: pic }) });
      }
      for (const it of items) {
        if (!it.types.includes("text/plain")) continue;
        const text = await (await it.getType("text/plain")).text();
        if (text.trim()) return void make({ text });
      }
      setPhase({ kind: "error", message: "There was nothing to paste. Copy your signature or a picture first." });
    } catch {
      setPhase({ kind: "error", message: "Your browser kept the clipboard to itself. Tap the box and choose Paste (or press ⌘V / Ctrl+V)." });
    }
  }

  // The clipboard write is REQUESTED inside the tap — WebKit (the iPhone app,
  // Safari) refuses one that comes later (EmailSignatureBox learned this).
  // Two flavours: the linked thing for rich editors, the share link for the
  // apps that only take text.
  function copy() {
    if (phase.kind !== "ready") return;
    let write: Promise<void>;
    try {
      write = navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([phase.html], { type: "text/html" }),
        "text/plain": new Blob([phase.shareUrl], { type: "text/plain" }),
      })]);
    } catch (e) {
      write = Promise.reject(e);
    }
    write.then(
      () => { setCopyState("copied"); setTimeout(() => { if (aliveRef.current) setCopyState((s) => (s === "copied" ? "idle" : s)); }, 2500); },
      () => setCopyState("error"),
    );
  }

  function startOver() {
    try { localStorage.removeItem(storeKey); } catch { /* ignore */ }
    setCopyState("idle");
    setPhase({ kind: "empty" });
  }

  /** The share link as the OWNER should open it: through the self-view hop. */
  function ownHref(url: string): string {
    if (!selfToken) return url;
    try {
      const path = new URL(url).pathname;
      return `${appUrl.replace(/\/+$/, "")}/api/self-view?to=${encodeURIComponent(path)}&t=${encodeURIComponent(selfToken)}`;
    } catch {
      return url;
    }
  }

  const box = "bg-gray-900 border border-gray-800/80 rounded-2xl p-5";

  if (phase.kind === "ready") {
    const long = phase.html.length > GMAIL_SIGNATURE_LIMIT;
    return (
      <div className={box}>
        <p className="text-gray-500 text-xs mb-3">How it looks — click anywhere on it to try your link:</p>
        <div className="rounded-xl border border-gray-700/60 bg-white p-4 overflow-hidden">
          <LinkedPreview html={relink(phase.html, phase.shareUrl, ownHref(phase.shareUrl))} />
        </div>
        {phase.dropped > 0 && (
          <p className="mt-3 text-[0.6875rem] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5 leading-relaxed">
            {phase.dropped === 1 ? "1 picture" : `${phase.dropped} pictures`} couldn&apos;t be kept — {phase.dropped === 1 ? "it was" : "they were"} saved only on the computer you copied from. Add {phase.dropped === 1 ? "it" : "each one"} with Choose a picture.
          </p>
        )}
        {long && (
          <p className="mt-3 text-[0.6875rem] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5 leading-relaxed">
            This is longer than Gmail allows in a signature (10,000 characters). It still works in emails, Outlook and documents.
          </p>
        )}
        <button
          type="button"
          onClick={copy}
          aria-live="polite"
          className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm py-2.5 rounded-full transition-colors"
        >
          {copyState === "copied" ? "Copied ✓ Paste it anywhere" : copyState === "error" ? "Couldn't copy — tap to try again" : "Copy"}
        </button>
        <button type="button" onClick={startOver} className="w-full mt-2 text-xs font-semibold text-gray-400 hover:text-white py-2 transition-colors">
          Start over
        </button>
        <div className="mt-3 space-y-1.5 text-[0.6875rem] text-gray-500 leading-relaxed">
          <p><strong className="text-gray-300">Email, Google Docs, Word, Notion, websites:</strong> it pastes just as you see it, and a click anywhere opens your SwiftCard.</p>
          <p><strong className="text-gray-300">Texts and social apps:</strong> it pastes as your link, showing this as its preview. A tap opens your SwiftCard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={box}>
      {phase.kind === "working" ? (
        <div className="min-h-[168px] flex flex-col items-center justify-center text-center" role="status">
          <span aria-hidden className="w-7 h-7 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
          <p className="mt-3 text-sm font-semibold text-white">Linking it to your card…</p>
        </div>
      ) : (
        <>
          <div
            className={`relative rounded-xl border-2 border-dashed transition-colors min-h-[168px] flex flex-col items-center justify-center text-center px-4 py-6 focus-within:border-blue-500 ${dragging ? "border-blue-500 bg-blue-500/5" : "border-gray-700"}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span aria-hidden className="w-10 h-10 rounded-xl bg-blue-600/10 flex items-center justify-center text-blue-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
            </span>
            <p className="mt-3 text-sm font-semibold text-white">Paste or drop it here</p>
            <p className="mt-1 text-xs text-gray-500 leading-relaxed">Your email signature, some text, or a picture</p>
            {/* The paste target: a transparent editable layer over the box, so a
                click then ⌘V / Ctrl+V works on a computer and a long-press shows
                Paste on a phone. inputMode="none" keeps the phone keyboard
                away; nothing typed is ever inserted. */}
            <div
              contentEditable
              suppressContentEditableWarning
              inputMode="none"
              role="textbox"
              aria-label="Paste your signature, text or a picture here"
              onPaste={onPaste}
              onBeforeInput={(e) => e.preventDefault()}
              onKeyDown={(e) => { if (!(e.metaKey || e.ctrlKey) && e.key.length === 1) e.preventDefault(); }}
              className="absolute inset-0 rounded-xl outline-none caret-transparent text-transparent cursor-text"
            />
          </div>
          {phase.kind === "error" && (
            <p role="alert" className="mt-3 text-[0.6875rem] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5 leading-relaxed">{phase.message}</p>
          )}
          <div className={`mt-3 grid gap-2 ${canReadClipboard ? "grid-cols-2" : "grid-cols-1"}`}>
            {canReadClipboard && (
              <button type="button" onClick={() => void pasteButton()} className="text-center text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full py-2.5 transition-colors">
                Paste
              </button>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} className="text-center text-xs font-semibold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full py-2.5 transition-colors">
              Choose a picture
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void make({ file: f }); }}
          />
        </>
      )}
    </div>
  );
}
