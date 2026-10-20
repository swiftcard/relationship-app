"use client";

import { useEffect, useState } from "react";
import SiteNav from "@/components/site/SiteNav";
import SiteFooter from "@/components/site/SiteFooter";
import ScrollProgress from "@/components/ScrollProgress";
import HomeHeadingReveal from "@/components/site/HomeHeadingReveal";
import "@/app/home.css";

// Contact Us — rebuilt in the Aurora Graphite (rd-) design system so it matches
// the rest of the marketing site (it was the last page on the old cream look).
// Left column sells the response ("real humans, within 24 hours"), right column
// is the form in a white card. ?topic=office (homepage Teams CTA) preselects
// the Teams & Offices topic.

const TOPICS = ["General question", "Help with my account", "Teams & Offices", "Partnerships & press"] as const;

const INFO: { title: string; desc: string; icon: React.ReactNode }[] = [
  {
    title: "Replies within 24 hours",
    desc: "A real person reads every message, and you'll hear back within 24 hours.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="url(#ct-ico)" strokeWidth={1.8} className="w-5 h-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: "Support that knows the product",
    desc: "You talk to the team that builds SwiftCard, not an outsourced help desk.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="url(#ct-ico)" strokeWidth={1.8} className="w-5 h-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c-4.97 0-9 3.58-9 8 0 2.2 1.1 4.2 2.9 5.6V21l3.7-2c.77.2 1.57.3 2.4.3 4.97 0 9-3.58 9-8s-4.03-8-9-8z" />
      </svg>
    ),
  },
  {
    title: "Based in New York, NY",
    desc: "Weekdays, US Eastern time. We answer in the order messages arrive.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="url(#ct-ico)" strokeWidth={1.8} className="w-5 h-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      </svg>
    ),
  },
];

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[0.90625rem] text-slate-900 placeholder-slate-400 outline-none transition-[border-color,background-color,box-shadow] focus:border-blue-500 focus:bg-white focus:shadow-[0_0_0_4px_rgba(37,99,235,0.12)]";

const REPORT_TOPIC = "Report a public card";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", topic: TOPICS[0] as string, message: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  // Content-report mode (App Review 1.2): reached only from the in-app
  // "Report this card" link (?topic=report&card=<slug>). The extra topic
  // option exists ONLY in that mode, so the normal web form is unchanged.
  const [reportMode, setReportMode] = useState(false);

  // The homepage Teams section links here as /contact?topic=office.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const topic = params.get("topic");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of ?topic after mount; search params are browser-only
      if (topic === "office") setForm((p) => ({ ...p, topic: "Teams & Offices" }));
      if (topic === "report") {
        const slug = (params.get("card") ?? "").replace(/[^a-zA-Z0-9-_.]/g, "");
        setReportMode(true);
        setForm((p) => ({
          ...p,
          topic: REPORT_TOPIC,
          message: slug ? `Reporting this card: swiftcard.me/${slug}\n\nWhat's wrong with it: ` : p.message,
        }));
      }
    } catch {
      /* no search params — default topic stands */
    }
  }, []);

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The API takes name/email/message; the topic rides along at the top of
        // the message so the inbox sees it without an API change.
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          message: `Topic: ${form.topic}\n\n${form.message}`,
        }),
      });
      setStatus(res.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="bg-white">
      <ScrollProgress />
      <HomeHeadingReveal />
      <SiteNav />
      {/* One gradient every info icon strokes with (homepage IconGradient pattern). */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id="ct-ico" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1D3FB8" />
            <stop offset="50%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#4DA8F5" />
          </linearGradient>
        </defs>
      </svg>

      <main className="hp relative overflow-clip">
        <section className="hp-page-hero pt-32 pb-20 sm:pt-40 sm:pb-28">
          <div className="relative max-w-6xl mx-auto px-5 sm:px-6 grid lg:grid-cols-[1fr_1.05fr] gap-12 lg:gap-16 items-start">
            {/* Left: pitch + reassurance */}
            <div>
              <div data-hp-head>
                <span className="hp-kicker">Contact Us</span>
                <h1 className="rd-display text-slate-900 text-[clamp(2.3rem,5vw,3.6rem)] mt-5">
                  Talk to a <span className="hp-fill">real person.</span>
                </h1>
                <p className="hp-lede !text-[1.1rem] mt-5 max-w-[480px]">
                  Questions about SwiftCard, help with your account, rolling out cards to a team, or a partnership idea? Send it over and we&apos;ll take it from there.
                </p>
              </div>

              <div className="mt-10 space-y-3">
                {INFO.map((it) => (
                  <div key={it.title} className="hp-card !p-4 flex items-start gap-4">
                    <span className="hp-feat-ico !w-10 !h-10">
                      {it.icon}
                    </span>
                    <span>
                      <span className="block text-slate-900 font-semibold text-[0.9375rem]">{it.title}</span>
                      <span className="block text-slate-500 text-[0.84375rem] mt-0.5 leading-relaxed">{it.desc}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: the form */}
            <div className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-[0_40px_80px_-40px_rgba(15,23,42,0.28)]">
              {status === "success" ? (
                <div className="py-14 text-center">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-emerald-200 bg-emerald-50">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={1.8} className="w-8 h-8">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="text-slate-900 font-bold text-2xl mb-2">Message sent!</h2>
                  <p className="text-slate-500 text-[0.90625rem] mb-7">Thanks for reaching out. We&apos;ll get back to you within 24 hours.</p>
                  <button
                    onClick={() => { setStatus("idle"); setForm({ name: "", email: "", topic: TOPICS[0], message: "" }); }}
                    className="rd-btn rd-btn-ghost-l"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <h2 className="text-slate-900 font-bold text-xl">Send us a message</h2>
                    <p className="text-slate-500 text-[0.84375rem] mt-1">Fill this in and it lands straight in our inbox.</p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="ct-name" className="block text-[0.8125rem] font-medium text-slate-700 mb-1.5">Your name</label>
                      <input
                        id="ct-name"
                        type="text"
                        required
                        autoComplete="name"
                        value={form.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="Alex Morgan"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label htmlFor="ct-email" className="block text-[0.8125rem] font-medium text-slate-700 mb-1.5">Email address</label>
                      <input
                        id="ct-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={form.email}
                        onChange={(e) => set("email", e.target.value)}
                        placeholder="you@example.com"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="ct-topic" className="block text-[0.8125rem] font-medium text-slate-700 mb-1.5">What&apos;s this about?</label>
                    <select
                      id="ct-topic"
                      value={form.topic}
                      onChange={(e) => set("topic", e.target.value)}
                      className={`${inputCls} appearance-none bg-no-repeat bg-[right_1rem_center] pr-10`}
                      style={{
                        backgroundImage:
                          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='rgba(15,23,42,0.45)' stroke-width='1.7'%3E%3Cpath d='M2.5 4.5L6 8l3.5-3.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
                        backgroundSize: "12px",
                      }}
                    >
                      {(reportMode ? [REPORT_TOPIC, ...TOPICS] : [...TOPICS]).map((t) => (
                        <option key={t} value={t} className="bg-white text-slate-900">{t}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="ct-message" className="block text-[0.8125rem] font-medium text-slate-700 mb-1.5">Message</label>
                    <textarea
                      id="ct-message"
                      required
                      rows={5}
                      value={form.message}
                      onChange={(e) => set("message", e.target.value)}
                      placeholder="Tell us how we can help…"
                      className={`${inputCls} resize-none`}
                    />
                  </div>

                  {status === "error" && (
                    <p className="text-[0.8125rem] text-red-600 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5">
                      Your message didn&apos;t go through. Please try again in a minute.
                    </p>
                  )}

                  <button type="submit" disabled={status === "loading"} className="rd-btn rd-btn-primary rd-btn-lg w-full disabled:opacity-60">
                    {status === "loading" ? "Sending…" : "Send message"}
                  </button>
                  <p className="text-slate-500 text-[0.75rem] text-center">We use your email only to reply to you.</p>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
