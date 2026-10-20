"use client";

// Last-resort screen for a crash in the root layout itself, where error.tsx
// can't render. It replaces <html>, so globals.css may be missing — inline
// styles only, plain <a>/<button>, nothing that depends on the app shell.
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "64px 20px", boxSizing: "border-box", background: "radial-gradient(ellipse 60% 45% at 50% 40%, rgba(29,78,216,0.10), transparent 70%), #FAF7F2", fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0F172A", textAlign: "center" }}>
        <div style={{ maxWidth: 380, width: "100%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-icon-192.png" alt="SwiftCard" width={44} height={44} style={{ borderRadius: 10, display: "block", margin: "0 auto 32px" }} />
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 12px" }}>Something went wrong</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "#57534E", margin: "0 0 28px" }}>
            SwiftCard hit an unexpected error. Reloading usually fixes it. Nothing you have saved is affected.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => reset()} style={{ background: "#1D4ED8", color: "#fff", border: 0, borderRadius: 999, padding: "13px 26px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the app shell itself crashed; only a full document load is safe. */}
            <a href="/" style={{ background: "#fff", color: "#1F2937", border: "1px solid #D9CFC1", borderRadius: 999, padding: "12px 26px", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
              Go to homepage
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
