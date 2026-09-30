"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useIsNativeApp } from "@/lib/platform";

// Settings layout:
//   • DESKTOP — a section rail + one panel at a time (Stripe/Linear/Vercel
//     style): you pick the area you came for and see only that.
//   • PHONE — a vertical ACCORDION: every section tab is listed, and tapping one
//     drops its content down inline. So on a phone you can see all the tabs at a
//     glance and expand whichever you need, instead of a cramped horizontal strip.
//
// Sections are rendered on the SERVER and passed in as content, so this file
// stays presentational: what's visible per plan/role is decided in the page.
// Each section's content is mounted at most ONCE (the open accordion panel on a
// phone, the active panel on desktop) — never twice — so there are no duplicate
// element ids or double effect/fetch runs.

export type SettingsSection = {
  id: string;
  label: string;
  desc: string;
  icon: ReactNode;
  content: ReactNode;
  /** Rendered in a muted, set-apart style at the bottom of the rail. */
  quiet?: boolean;
  /** Hidden entirely inside the native app (e.g. billing/subscription UI). */
  hideOnNative?: boolean;
};

export default function SettingsShell({
  sections: allSections,
  initialSection,
}: {
  sections: SettingsSection[];
  initialSection?: string;
}) {
  const native = useIsNativeApp();
  // Native app: drop any section flagged hideOnNative (rail item + panel + deep
  // link). On web (native false, incl. first paint) this is the full list, so
  // web behavior is byte-for-byte unchanged.
  const sections = allSections.filter((s) => !(native && s.hideOnNative));

  const first = sections[0]?.id ?? "";
  const valid = (id: string | undefined) => (id && sections.some((s) => s.id === id) ? id : null);

  // Desktop: the panel that's showing. Phone accordion: which section is
  // expanded (null = all collapsed, so you first see just the list of tabs).
  const [active, setActive] = useState<string>(valid(initialSection) ?? first);
  const [mobileOpen, setMobileOpen] = useState<string | null>(valid(initialSection));

  // Which layout to render. Starts false (matches SSR + desktop) and corrects to
  // the accordion on a phone after mount — same post-mount pattern as
  // useIsNativeApp above, which this file already relies on.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Deep links keep working: /settings/flows?billing=1#billing and any #section
  // hash open that panel (desktop) AND expand it (phone). Receipt emails and the
  // Office dashboard both link straight to billing.
  useEffect(() => {
    const apply = (id: string | null) => {
      if (id) { setActive(id); setMobileOpen(id); }
    };
    apply(valid(window.location.hash.replace("#", "")));
    const onHash = () => apply(valid(window.location.hash.replace("#", "")));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.length]);

  function goDesktop(id: string) {
    setActive(id);
    // Replace rather than push so Back leaves Settings instead of walking the tabs.
    window.history.replaceState(null, "", `#${id}`);
  }

  function toggleMobile(id: string) {
    setMobileOpen((cur) => (cur === id ? null : id));
    window.history.replaceState(null, "", `#${id}`);
  }

  const current = sections.find((s) => s.id === active) ?? sections[0];
  const main = sections.filter((s) => !s.quiet);
  const quiet = sections.filter((s) => s.quiet);

  // ── Phone: accordion ───────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col gap-2.5">
        {sections.map((s) => {
          const openHere = mobileOpen === s.id;
          return (
            <div
              key={s.id}
              className={`rounded-2xl border overflow-hidden transition-colors ${
                openHere ? "border-gray-700 bg-gray-900/60" : s.quiet ? "border-gray-800/60 bg-gray-900/30" : "border-gray-800 bg-gray-900/40"
              }`}
            >
              <button
                type="button"
                onClick={() => toggleMobile(s.id)}
                aria-expanded={openHere}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
              >
                <span className={`shrink-0 ${openHere ? "text-blue-400" : "text-gray-600"}`}>{s.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm font-semibold ${s.quiet && !openHere ? "text-gray-400" : "text-white"}`}>{s.label}</span>
                  {/* line-clamp-2, not truncate. These descriptions are the only
                      thing telling someone which of seven closed rows holds what
                      they came for, and `truncate` is one line — so the two
                      longest were cut mid-word ("…the tools your c…",
                      "Deleting is perm…"), losing exactly the part that
                      distinguishes them (audit 2026-09-29). */}
                  <span className="block text-gray-500 text-[0.6875rem] mt-0.5 line-clamp-2">{s.desc}</span>
                </span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className={`w-4 h-4 shrink-0 text-gray-500 transition-transform duration-200 ${openHere ? "rotate-180" : ""}`}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {openHere && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-800/60">
                  <div className="space-y-3 pt-3">{s.content}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Desktop: rail + one panel ──────────────────────────────────────────────
  return (
    <div className="flex flex-col md:flex-row md:gap-10">
      {/* Rail — a sidebar on desktop. */}
      <nav aria-label="Settings sections" className="md:w-56 md:shrink-0 mb-6 md:mb-0">
        <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible -mx-5 px-5 md:mx-0 md:px-0 pb-2 md:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {main.map((s) => (
            <RailItem key={s.id} section={s} active={active === s.id} onClick={() => goDesktop(s.id)} />
          ))}
          {quiet.length > 0 && (
            <>
              <div className="hidden md:block h-px bg-gray-800/80 my-2" />
              {quiet.map((s) => (
                <RailItem key={s.id} section={s} active={active === s.id} onClick={() => goDesktop(s.id)} quiet />
              ))}
            </>
          )}
        </div>
      </nav>

      {/* Panel */}
      <section className="flex-1 min-w-0" aria-live="polite">
        {current && (
          <div key={current.id}>
            <div className="mb-5">
              <h2 className="text-white text-lg font-bold tracking-tight">{current.label}</h2>
              <p className="text-gray-500 text-xs mt-0.5">{current.desc}</p>
            </div>
            <div className="space-y-3">{current.content}</div>
          </div>
        )}
      </section>
    </div>
  );
}

function RailItem({
  section,
  active,
  onClick,
  quiet = false,
}: {
  section: SettingsSection;
  active: boolean;
  onClick: () => void;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 md:w-full flex items-center gap-2.5 text-sm rounded-xl px-3 py-2 transition-colors whitespace-nowrap ${
        active
          ? "bg-gray-800 text-white font-medium"
          : quiet
            ? "text-gray-600 hover:text-gray-300 hover:bg-gray-800/50"
            : "text-gray-400 hover:text-white hover:bg-gray-800/60"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-blue-400" : "text-gray-600"}`}>{section.icon}</span>
      {section.label}
    </button>
  );
}
