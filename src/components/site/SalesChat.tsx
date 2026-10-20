"use client";

// Floating sales chatbot for the PUBLIC marketing site (logged-out visitors).
// Same UX pattern as the in-app HelpWidget, but posts to the public,
// rate-limited /api/ai/sales endpoint and speaks to prospects (what is
// SwiftCard, pricing, how it works). Mounted via SiteFooter so it appears on
// every marketing page. Self-contained dark styling — marketing pages don't
// use the app's light/dark theme system.

import { useEffect, useRef, useState } from "react";
import { useIsNativeApp } from "@/lib/platform";
import { CHAT_AVOID_ATTR, shouldYield } from "@/lib/chat-avoid";
import { SwiftCardIcon } from "@/components/SwiftCardLogo";

type Msg = { role: "user" | "assistant"; content: string };

const GREETING: Msg = {
  role: "assistant",
  content:
    "Hi! I can answer questions about SwiftCard: what it is, what it costs, and how it works. What would you like to know?",
};

const SUGGESTIONS = [
  "What is SwiftCard?",
  "How much does it cost?",
  "Do people need an app to get my card?",
  "What's in the free plan?",
];

export default function SalesChat() {
  const native = useIsNativeApp();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  // True while the launcher is sitting on a control that asked not to be sat
  // on. See lib/chat-avoid.ts for why this is measured rather than positioned
  // around.
  const [yielding, setYielding] = useState(false);

  // Esc closes the open chat panel, like every other panel on the site.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, loading]);

  // Yield while the launcher covers a `data-chat-avoid` control, and come back
  // the moment it does not. Re-checked on scroll and resize because both move
  // the page under a fixed element; rAF-coalesced so a scroll costs one
  // measurement per frame at most. Runs only while the launcher is on screen —
  // when the panel is open there is no launcher to be in the way.
  useEffect(() => {
    if (open || native) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = launcherRef.current;
      if (!el) return;
      const zones = Array.from(document.querySelectorAll(`[${CHAT_AVOID_ATTR}]`)).map((z) =>
        z.getBoundingClientRect(),
      );
      setYielding(shouldYield(el.getBoundingClientRect(), zones));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [open, native]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/ai/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(1) }), // skip static greeting
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply || "Sorry, I couldn't answer that. Try swiftcard.me/contact." }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, something went wrong. Try again in a moment." }]);
    } finally {
      setLoading(false);
    }
  }

  // App Store 3.1.1: the sales assistant freely discusses prices, plans, and
  // links to /pricing — a selling surface. Never render it inside the native
  // Capacitor shell (defense in depth alongside the SiteFooter NativeHidden wrap).
  if (native) return null;

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          title="Questions? Chat with us"
          aria-label="Open chat"
          // While yielding it is fully out of the way: invisible, untappable,
          // and hidden from assistive tech, so a covered button gets its whole
          // tap target back rather than a launcher that is merely see-through.
          // Any scroll brings it straight back — the CTA it was covering has
          // moved by then. `transition-all` is already here, so it fades.
          aria-hidden={yielding || undefined}
          tabIndex={yielding ? -1 : undefined}
          className={`fixed bottom-5 right-4 z-40 rounded-full flex items-center justify-center transition-all hover:scale-105 ${
            yielding ? "opacity-0 pointer-events-none" : ""
          }`}
          style={{ width: 52, height: 52, background: "#2563eb", boxShadow: "0 8px 24px rgba(37,99,235,0.45)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.9} className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm flex flex-col rounded-2xl overflow-hidden"
          style={{ height: "min(70vh, 560px)", background: "#0B1022", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ background: "#0F162E", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-2">
              <SwiftCardIcon size={28} />
              <div>
                <p className="text-white text-sm font-semibold leading-none">SwiftCard</p>
                <p className="text-[0.6875rem] mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>Ask us anything</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="text-xl leading-none transition-colors" style={{ color: "rgba(255,255,255,0.45)" }}>
              ×
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed"
                  style={m.role === "user" ? { background: "#2563eb", color: "#fff" } : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.88)" }}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {messages.length === 1 && !loading && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="text-[0.6875rem] rounded-full px-2.5 py-1 transition-colors"
                    style={{ color: "rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3.5 py-2.5 text-sm" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>Thinking…</div>
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="p-3 flex items-center gap-2 shrink-0"
            style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about SwiftCard…"
              className="flex-1 rounded-full px-4 py-2.5 text-sm focus:outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="shrink-0 w-9 h-9 rounded-full disabled:opacity-40 flex items-center justify-center transition-colors"
              style={{ background: "#2563eb" }}
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
