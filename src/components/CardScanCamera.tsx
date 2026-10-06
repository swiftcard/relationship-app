"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useIsNativeApp } from "@/lib/platform";
import {
  ANALYSIS_W, ANALYSIS_H, STEADY_FRAMES, STEADY_MOTION,
  analyzeFrame, analysisRect, coverMap, frameState, guideRect, isFit, toGray,
  type FrameState,
} from "@/lib/card-frame-detect";

/**
 * The business-card scanner's own camera (owner, 2026-10-06).
 *
 * It used to be `<input type="file" capture="environment">`, which hands off to
 * the phone's camera app — nothing can be drawn on it, so people shot the card
 * from across the table and the read was slow and wrong. This is a live preview
 * with a card-shaped frame:
 *   • a card that is small in the frame → "Move closer"
 *   • a card that fills it ("or fits it enough") → the frame turns GREEN
 *   • green and held still for ~half a second → it takes the photo itself
 *   • the shutter works at any time — a white card on a white table may never
 *     show an edge, and that must still be scannable
 * Only the frame area (plus a small margin) is sent, so the upload is small and
 * the read fast. lib/card-frame-detect does the looking.
 *
 * Works the same in the iPhone app (Capacitor grants the webview's camera
 * request and Info.plist carries NSCameraUsageDescription), in phone browsers
 * and on a computer's webcam. Anything that stops the camera opening falls back
 * to "Choose a photo instead", which is the old file picker.
 */

type Phase = "starting" | "live" | "error";
type Failure = "denied" | "nocamera" | "unsupported" | "other";

/** Largest side of the photo that is sent. A card at this size reads cleanly. */
const MAX_SIDE = 1400;
/** Room kept around the frame in the photo, so a card a little past it isn't cut. */
const CROP_PAD = 0.06;
const TICK_MS = 100;
/** Not green for this long → suggest a better background. */
const TIP_AFTER_MS = 4000;

export default function CardScanCamera({
  onCapture,
  onClose,
  onPickPhoto,
  title = "Scan a business card",
}: {
  /** The cropped JPEG of the card. The camera is already off. */
  onCapture: (photo: Blob) => void;
  onClose: () => void;
  /** Open the photo-library / file picker instead. Called inside the tap. */
  onPickPhoto: () => void;
  /** The heading and the dialog's name. Custom design's Copy opens this same
   *  camera to photograph the owner's own card for its design. */
  title?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const mirroredRef = useRef(false);
  const capturingRef = useRef(false);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [phase, setPhase] = useState<Phase>("starting");
  const [failure, setFailure] = useState<Failure>("other");
  const [mirrored, setMirrored] = useState(false);
  const [state, setState] = useState<FrameState>("none");
  const [steady, setSteady] = useState(0);
  const [tip, setTip] = useState(false);
  const [session, setSession] = useState(0);
  const native = useIsNativeApp();

  useDialogA11y(true, onClose, rootRef);
  // "Scan a card" mounts this in the same commit as the Add contact modal,
  // whose own focus-in effect runs after ours (parents after children) and
  // pulls focus behind the camera. Take it back on the next frame.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!rootRef.current?.contains(document.activeElement)) {
        rootRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // The screen size decides where the frame sits.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const next = { w: el.clientWidth, h: el.clientHeight };
      sizeRef.current = next;
      setSize(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Start the camera. `session` restarts it after the app comes back from the
  // background — iOS stops the camera there, and a frozen preview is worse
  // than a moment of "Opening camera…".
  useEffect(() => {
    let cancelled = false;
    capturingRef.current = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setFailure("unsupported"); setPhase("error"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const settings = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
        // A front or desk camera is shown mirrored, like every video call, so
        // moving the card left moves it left on screen. The photo itself is
        // never mirrored (the crop reads the camera's own pixels).
        const desk = typeof matchMedia === "function" && !matchMedia("(pointer: coarse)").matches;
        const mirror = settings.facingMode === "user" || (!settings.facingMode && desk);
        mirroredRef.current = mirror;
        setMirrored(mirror);
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        if (!cancelled) setPhase("live");
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        setFailure(
          name === "NotAllowedError" || name === "SecurityError" ? "denied"
          : name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError" ? "nocamera"
          : "other",
        );
        setPhase("error");
      }
    })();
    return () => { cancelled = true; stopStream(); };
  }, [session, stopStream]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        stopStream();
        setPhase((p) => (p === "live" ? "starting" : p));
      } else if (!streamRef.current) {
        setSession((s) => s + 1);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stopStream]);

  const capture = useCallback(async () => {
    const v = videoRef.current;
    const { w, h } = sizeRef.current;
    if (capturingRef.current || !v || !v.videoWidth || !w || !h) return;
    capturingRef.current = true;
    const g = guideRect(w, h);
    const rect = { x: g.x - g.w * CROP_PAD, y: g.y - g.h * CROP_PAD, w: g.w * (1 + CROP_PAD * 2), h: g.h * (1 + CROP_PAD * 2) };
    // The crop's size in camera pixels, capped — never upscaled.
    const s = Math.max(w / v.videoWidth, h / v.videoHeight);
    const k = Math.min(1, MAX_SIDE / Math.max(rect.w / s, rect.h / s));
    const outW = Math.max(1, Math.round((rect.w / s) * k));
    const outH = Math.max(1, Math.round((rect.h / s) * k));
    const m = coverMap(rect, w, h, v.videoWidth, v.videoHeight, outW, outH, mirroredRef.current);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!m || !ctx) { capturingRef.current = false; return; }
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(v, m.sx, m.sy, m.sw, m.sh, m.dx, m.dy, m.dw, m.dh);
    // Freeze on the shot while it encodes — stopping the camera here would
    // flash the preview black first.
    v.pause();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    stopStream();
    if (blob) { onCapture(blob); return; }
    // toBlob can hand back null on a starved device — the data URL path still
    // works. Decoded by hand: fetch(data:) can be refused by connect-src.
    const bin = atob(canvas.toDataURL("image/jpeg", 0.85).split(",")[1] ?? "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    onCapture(new Blob([bytes], { type: "image/jpeg" }));
  }, [onCapture, stopStream]);

  // Look at the camera ~10× a second: where is the card, is the phone still,
  // and has it been green and still long enough to take the photo.
  useEffect(() => {
    if (phase !== "live") return;
    const canvas = document.createElement("canvas");
    canvas.width = ANALYSIS_W;
    canvas.height = ANALYSIS_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    let prev: Uint8Array | null = null;
    let fit = false;
    let run = 0;
    let lastFitAt = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const v = videoRef.current;
      const { w, h } = sizeRef.current;
      if (v && v.readyState >= 2 && v.videoWidth && w && h) {
        const m = coverMap(analysisRect(guideRect(w, h)), w, h, v.videoWidth, v.videoHeight, ANALYSIS_W, ANALYSIS_H, mirroredRef.current);
        if (m) {
          ctx.fillStyle = "#808080";
          ctx.fillRect(0, 0, ANALYSIS_W, ANALYSIS_H);
          ctx.drawImage(v, m.sx, m.sy, m.sw, m.sh, m.dx, m.dy, m.dw, m.dh);
          const gray = toGray(ctx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H).data, ANALYSIS_W, ANALYSIS_H);
          const a = analyzeFrame(gray, prev);
          prev = gray;
          fit = isFit(a.sides, fit);
          const calm = a.motion < STEADY_MOTION;
          run = fit && calm ? run + 1 : 0;
          const now = performance.now();
          if (fit) lastFitAt = now;
          setState(frameState(a, fit));
          setSteady(run);
          setTip(now - lastFitAt > TIP_AFTER_MS);
          if (run >= STEADY_FRAMES) { void capture(); return; }
        }
      }
      timer = setTimeout(tick, TICK_MS);
    };
    timer = setTimeout(tick, TICK_MS);
    return () => clearTimeout(timer);
  }, [phase, capture]);

  const g = size.w ? guideRect(size.w, size.h) : null;
  const green = phase === "live" && state === "fit";
  const edge = green ? "#22C55E" : "rgba(255,255,255,0.92)";
  const hint =
    phase === "starting" ? "Opening camera…"
    : green ? (steady >= STEADY_FRAMES ? "Got it" : "Hold still…")
    : state === "closer" ? "Move closer"
    : "Fit the card inside the frame";

  const failureText =
    failure === "denied"
      ? native
        ? "Camera is off for SwiftCard. Turn it on in iPhone Settings → SwiftCard → Camera."
        : "Camera access was blocked. Allow the camera for this site in your browser settings."
      : failure === "nocamera"
        ? "No camera was found on this device."
        : failure === "unsupported"
          ? "This browser can't open the camera here."
          : "The camera couldn't start.";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-card-scan-camera
      className="sc-dark-sheet fixed inset-0 z-[70] overflow-hidden text-white"
      style={{ background: "#000" }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      />

      {g && phase !== "error" && (
        <>
          {/* The frame: everything outside it dimmed, so the eye goes to it. */}
          <div
            data-card-frame={green ? "fit" : state}
            aria-hidden="true"
            className="absolute rounded-[14px] transition-[border-color] duration-150"
            style={{
              left: g.x, top: g.y, width: g.w, height: g.h,
              border: `2px solid ${green ? "#22C55E" : "rgba(255,255,255,0.35)"}`,
              boxShadow: "0 0 0 200vmax rgba(0,0,0,0.55)",
            }}
          >
            {(["tl", "tr", "bl", "br"] as const).map((c) => (
              <span
                key={c}
                className="absolute h-7 w-7 transition-[border-color] duration-150"
                style={{
                  [c[0] === "t" ? "top" : "bottom"]: -4,
                  [c[1] === "l" ? "left" : "right"]: -4,
                  borderColor: edge,
                  borderStyle: "solid",
                  borderWidth: 0,
                  [c[0] === "t" ? "borderTopWidth" : "borderBottomWidth"]: 4,
                  [c[1] === "l" ? "borderLeftWidth" : "borderRightWidth"]: 4,
                  [c === "tl" ? "borderTopLeftRadius" : c === "tr" ? "borderTopRightRadius" : c === "bl" ? "borderBottomLeftRadius" : "borderBottomRightRadius"]: 16,
                }}
              />
            ))}
          </div>

          <p
            aria-live="polite"
            data-card-hint
            className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold"
            style={{
              top: Math.max(64, g.y - 48),
              background: green ? "#16A34A" : "rgba(0,0,0,0.6)",
              color: "#fff",
            }}
          >
            {hint}
          </p>

          {green && (
            <div aria-hidden="true" className="absolute left-1/2 flex -translate-x-1/2 gap-1.5" style={{ top: g.y + g.h + 14 }}>
              {Array.from({ length: STEADY_FRAMES }, (_, i) => (
                <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: i < steady ? "#22C55E" : "rgba(255,255,255,0.35)" }} />
              ))}
            </div>
          )}
          {!green && tip && phase === "live" && (
            <p className="absolute left-1/2 w-[min(90vw,22rem)] -translate-x-1/2 text-center text-xs" style={{ top: g.y + g.h + 14, color: "rgba(255,255,255,0.8)" }}>
              Tip: a plain, darker surface behind the card helps. You can also tap the shutter.
            </p>
          )}
        </>
      )}

      {phase === "error" && (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="w-full max-w-sm rounded-2xl p-5 text-center" style={{ background: "#111827", border: "1px solid #1f2937" }}>
            <p className="text-sm font-semibold text-white">Can&apos;t open the camera</p>
            <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "#9ca3af" }}>{failureText}</p>
            <button
              type="button"
              onClick={onPickPhoto}
              className="mt-4 w-full rounded-xl py-2.5 text-sm font-semibold"
              style={{ background: "#2563EB", color: "#fff" }}
            >
              Choose a photo instead
            </button>
            <button type="button" onClick={onClose} className="mt-2 w-full rounded-xl py-2.5 text-sm font-semibold" style={{ background: "#1f2937", color: "#d1d5db" }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Top: close + title. */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close camera"
          className="absolute left-3 top-[max(0.25rem,calc(env(safe-area-inset-top)-0.5rem))] flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "rgba(0,0,0,0.45)", color: "#fff" }}
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>
        <p className="text-sm font-semibold" style={{ color: "#fff" }}>{title}</p>
      </div>

      {/* Bottom: photo library · shutter. */}
      {phase !== "error" && (
        <div className="absolute inset-x-0 bottom-0 grid grid-cols-3 items-center px-6 pt-4 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
          <button
            type="button"
            onClick={onPickPhoto}
            className="flex flex-col items-center gap-1 justify-self-start text-[0.6875rem] font-medium"
            style={{ color: "rgba(255,255,255,0.9)" }}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: "rgba(255,255,255,0.14)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <circle cx="9" cy="10" r="1.6" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 16l-5-5-8 8" />
              </svg>
            </span>
            Choose photo
          </button>
          <button
            type="button"
            onClick={() => void capture()}
            disabled={phase !== "live"}
            aria-label="Take photo"
            data-card-shutter
            className={`justify-self-center flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border-4 transition-colors disabled:opacity-50 ${green ? "animate-pulse" : ""}`}
            style={{ borderColor: green ? "#22C55E" : "#fff" }}
          >
            <span className="h-[3.4rem] w-[3.4rem] rounded-full" style={{ background: green ? "#22C55E" : "#fff" }} />
          </button>
          <span />
        </div>
      )}
    </div>
  );
}
