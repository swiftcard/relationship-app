"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import PlatformIcon from "@/components/PlatformIcon";
import type { SocialInputSpec } from "@/lib/social-input";
import { normalizeSocial, socialDestination, socialUrl } from "@/lib/social-url";

// ── One social profile row: icon, name, and a box that shows the link ───────
//
// Owner, 2026-09-29: the old row asked for "yourname" with "Just your username
// — becomes instagram.com/alexmorgan" underneath, which a first-time user read
// as "type your name in lowercase with no spaces". Now the box itself shows the
// start of the link (instagram.com/ | username), so what goes where is visible
// before anything is typed, and there is nothing to read under an empty field.
//
// ONE component for every place a social is typed — the create-card wizard,
// the card editor, the homepage SwiftLink builder and Office Links branding —
// so they cannot drift apart again (lib/social-input explains the history).
//
// What we SAVE is untouched: the value goes out exactly as typed, and the
// caller's onBlur still runs normalizeSocial. Only the DISPLAY changes:
//   • Instagram/TikTok/X/Snapchat are saved as "@handle" — shown without the
//     "@" after the prefix, or TikTok would read "tiktok.com/@@alex".
//   • A saved or pasted link that starts with this platform's address is shown
//     as just the part after the prefix, so nothing is doubled.
//   • Any other link (youtube.com/c/…, a vanity URL) is shown whole, with the
//     prefix hidden.

/** The social icon's own name for a platform key (PlatformIcon's labels). */
const ICON_LABEL: Record<string, string> = {
  linkedin: "LinkedIn", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook",
  twitter: "X / Twitter", snapchat: "Snapchat", youtube: "YouTube",
};

/**
 * What the box shows for a stored value, and whether the prefix shows with it.
 * Exported so the display rule is unit-tested rather than eyeballed.
 */
export function displayHandle(stem: string, value: string): { withPrefix: boolean; shown: string } {
  const bare = value.replace(/^\s*https?:\/\//i, "").replace(/^www\./i, "").replace(/^m\./i, "");
  const stemLc = stem.toLowerCase();
  if (bare.toLowerCase().startsWith(stemLc)) return { withPrefix: true, shown: bare.slice(stem.length) };
  // X is still typed as twitter.com by plenty of people.
  if (stemLc === "x.com/" && bare.toLowerCase().startsWith("twitter.com/")) return { withPrefix: true, shown: bare.slice("twitter.com/".length) };
  // Anything else that is already an address: show it whole.
  if (/^https?:\/\//i.test(value.trim()) || /\.[a-z]{2,}\//i.test(bare)) return { withPrefix: false, shown: value };
  return { withPrefix: true, shown: value.replace(/^@/, "") };
}

// ── LinkedIn: "what do I type?" has no answer you can guess ─────────────────
//
// Owner, 2026-10-02: LinkedIn addresses are "johndoe", "john-doe" or
// "john-doe-4a7b21", so typing your name works for some people and silently
// opens a stranger (or a 404) for the rest. "Connect with LinkedIn" cannot
// fix it: LinkedIn's sign-in (`openid profile email`, lib/sync-linkedin) hands
// apps a name, photo and email — the profile address (vanityName) sits behind
// LinkedIn's partner programme. And LinkedIn blocks server fetches of profile
// pages, so we cannot check a guess either.
//
// What does work on every device: LinkedIn's own https://www.linkedin.com/in/me/
// opens the signed-in member's profile (the LinkedIn app on a phone, a tab on a
// computer). So "Find my exact link" takes them there, says how to copy it on
// THEIR device (address bar on a computer; Contact info in the app, per
// LinkedIn's help article a522735), and the box accepts whatever they bring
// back — a bare link, a link with ?utm junk, or the share sheet's sentence.

/** LinkedIn's own "my profile" address — redirects to whoever is signed in. */
export const LINKEDIN_MY_PROFILE = "https://www.linkedin.com/in/me/";

/** The first LinkedIn address in pasted text, or null. The share sheet can copy
 *  a sentence ("Check out my profile… https://www.linkedin.com/in/…?utm=…"). */
export function linkedinLinkIn(text: string): string | null {
  const m = text.match(/(?:https?:\/\/)?(?:(?:[a-z]{2,3}\.)?linkedin\.com|lnkd\.in)\/[^\s"'<>]+/i);
  if (!m) return null;
  const link = normalizeSocial(m[0], "linkedin");
  return /linkedin\.com\/.|lnkd\.in\/./i.test(link) ? link : null;
}

/** Why a LinkedIn value cannot be someone's profile, or null when it can be. */
export function linkedinLinkProblem(value: string): string | null {
  const url = socialUrl("linkedin", value);
  if (!url) return null;
  let parts: string[];
  try {
    const u = new URL(url);
    // LinkedIn's own short link: we can't see where it goes, so trust it.
    if (/(^|\.)lnkd\.in$/i.test(u.hostname)) return null;
    parts = u.pathname.split("/").filter(Boolean).map((p) => p.toLowerCase());
  } catch {
    return null;
  }
  // Copied before the redirect finished, or typed from our own instructions.
  if (parts[0] === "in" && parts[1] === "me" && parts.length === 2) {
    return "That’s LinkedIn’s shortcut, not your link — copy the address once your profile has opened.";
  }
  if (!["in", "company", "pub", "school", "showcase"].includes(parts[0] ?? "") || !parts[1]) {
    return "That’s a LinkedIn page, not your profile — copy the link from your profile.";
  }
  return null;
}

type Device = "ios" | "android" | "computer";

function deviceNow(): Device {
  const ua = navigator.userAgent;
  // iPadOS asks for the desktop site and reports itself as a Mac.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "computer";
}

/**
 * How to copy your own LinkedIn address, on the device in hand: three short
 * steps, then one line for the case that goes wrong. Owner, 2026-10-05: "the
 * directions are simple but make sense". The phone route is LinkedIn's
 * ••• → Share profile → Copy, the same in the iPhone and Android apps; Contact
 * info is the fallback because its label differs per app.
 */
export function linkedinSteps(device: Device, mac = false): { steps: string[]; help: string } {
  if (device === "computer") {
    return {
      steps: [
        "Your LinkedIn profile just opened in a new tab.",
        "Copy the web address at the top of that tab.",
        `Come back here and paste it into the box (${mac ? "⌘V" : "Ctrl+V"}).`,
      ],
      help: "Not signed in to LinkedIn? Sign in, then click Find my exact link again.",
    };
  }
  return {
    steps: [
      "LinkedIn opens on your profile. (On your feed? Tap your photo.)",
      "Tap ••• (More), then Share profile → Copy.",
      "Come back here and tap Paste my link.",
    ],
    help: "Can’t find it? Tap Contact info on your profile and copy the link there.",
  };
}

function LinkedInLinkHelp({
  tone,
  inputId,
  value,
  filled,
  onPick,
}: {
  tone: (typeof TONE)[Variant];
  inputId: string;
  value: string;
  filled: boolean;
  onPick: (v: string) => void;
}) {
  // null until tapped: the steps depend on the device, which the server render
  // cannot know, so nothing device-specific is ever in the first paint.
  const [device, setDevice] = useState<Device | null>(null);
  const [mac, setMac] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The value when the steps opened. Once a real profile link replaces it —
  // pasted with ⌘V/Ctrl+V, a long-press, or the button — the job is done and
  // the steps fold away (derived, so no effect has to chase the value).
  const [openedWith, setOpenedWith] = useState("");
  const done = value !== openedWith && /linkedin\.com\/.|lnkd\.in\/./i.test(value) && !linkedinLinkProblem(value);
  const away = useRef(false);

  // Back from the LinkedIn tab: put the cursor in the box so ⌘V/Ctrl+V lands
  // straight away. (A phone ignores a focus it didn't tap — Paste covers it.)
  useEffect(() => {
    if (device !== "computer") return;
    const leave = () => { away.current = true; };
    const back = () => {
      if (!away.current || document.visibilityState !== "visible") return;
      away.current = false;
      document.getElementById(inputId)?.focus();
    };
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [device, inputId]);

  const paste = async () => {
    setNote(null);
    try {
      const text = await navigator.clipboard.readText();
      const link = linkedinLinkIn(text);
      if (link) {
        // Saved either way, so the box shows what was copied; a wrong page
        // keeps the steps open with the reason, a right one folds them away.
        onPick(link);
        const problem = linkedinLinkProblem(link);
        // The reason already shows under the box; this says what to do next.
        if (problem) setNote("Copy the link from your own profile, then tap Paste my link again.");
        return;
      }
      setNote(text.trim()
        ? "That isn’t a LinkedIn link. In LinkedIn, tap ••• (More) → Share profile → Copy, then tap Paste my link again."
        : "Nothing is copied yet. In LinkedIn, tap ••• (More) → Share profile → Copy, then tap Paste my link again.");
    } catch {
      setNote("Press and hold the box above, then tap Paste.");
      document.getElementById(inputId)?.focus();
    }
  };

  return (
    <div className="mt-1">
      {/* A real link, so it works before hydration too; the click also opens
          the steps. Same target as the row's "Open", which the iOS shell hands
          to the system (the LinkedIn app when it is installed). */}
      <a
        href={LINKEDIN_MY_PROFILE}
        target="_blank"
        rel="noopener noreferrer"
        data-linkedin-find
        onClick={() => {
          away.current = false;
          setNote(null);
          setOpenedWith(value);
          setMac(/Mac/.test(navigator.platform || navigator.userAgent));
          setDevice(deviceNow());
        }}
        className={`inline-flex items-center gap-1 py-1 text-[0.6875rem] font-semibold ${tone.open}`}
      >
        {filled ? "Not sure it’s right? Find my exact link" : "Not sure what to type? Find my exact link"}
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" aria-hidden><path fillRule="evenodd" d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z" clipRule="evenodd" /></svg>
      </a>
      {/* Read out when the steps appear, and when a note replaces them. */}
      <div aria-live="polite">
      {device && !done && (
        <div data-linkedin-steps={device} className={`mt-1 rounded-xl border p-3 ${tone.box}`}>
          <ol className={`list-decimal pl-4 space-y-1 text-[0.6875rem] leading-snug ${tone.strong}`}>
            {linkedinSteps(device, mac).steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          {device !== "computer" && (
            <button
              type="button"
              onClick={paste}
              // bg-blue-600 + text-white: the light theme turns .text-white
              // near-black except on the app's own blues (globals.css), and a
              // custom LinkedIn blue read dark-on-blue live (2026-10-05).
              className="mt-2.5 w-full rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-2"
            >
              Paste my link
            </button>
          )}
          {note && <p className="text-amber-400 text-[0.6875rem] mt-2 leading-snug">{note}</p>}
          {/* The fallback goes last: steps → the action → what if it didn't work. */}
          <p className={`mt-2 text-[0.625rem] leading-snug ${tone.note}`}>{linkedinSteps(device, mac).help}</p>
        </div>
      )}
      </div>
    </div>
  );
}

type Variant = "app" | "site";

const TONE: Record<Variant, {
  label: string; chip: string; box: string; prefix: string; input: string; note: string; strong: string; open: string;
}> = {
  // The signed-in app (wizard, editor, Office). Gray classes, so the light
  // theme and the iOS shell restyle it exactly like every other field.
  app: {
    label: "text-gray-300",
    chip: "bg-gray-800 text-gray-300",
    box: "bg-gray-900 border-gray-700 focus-within:border-blue-500",
    prefix: "text-gray-500",
    input: "text-white placeholder-gray-600",
    note: "text-gray-500",
    strong: "text-gray-300",
    open: "text-blue-400 hover:text-blue-300",
  },
  // The homepage builders' dark shell (BuilderFields).
  site: {
    label: "text-white/70",
    chip: "bg-white/10 text-white/75",
    box: "bg-[#15171F] border-white/10 focus-within:border-blue-500",
    prefix: "text-white/40",
    input: "text-white placeholder-white/30",
    note: "text-white/45",
    strong: "text-white/75",
    open: "text-blue-300 hover:text-blue-200",
  },
};

export default function SocialHandleField({
  spec,
  value,
  onChange,
  onBlur,
  managed = false,
  managedTag,
  managedNote,
  variant = "app",
  id,
}: {
  spec: SocialInputSpec;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  /** The office sets this one (only ever Instagram): read-only, company value. */
  managed?: boolean;
  managedTag?: ReactNode;
  managedNote?: ReactNode;
  variant?: Variant;
  id?: string;
}) {
  const t = TONE[variant];
  const inputId = id ?? `social-${spec.key}`;
  const { withPrefix, shown } = displayHandle(spec.stem, value);
  // "Filled" is what the person can SEE. A stored lone "@" or a pasted bare
  // "instagram.com/" shows an empty box, and a red line or an "Opens" line
  // under an empty-looking box reads as a glitch (review 2026-09-29).
  const filled = (withPrefix ? shown : value).trim().length > 0;
  const href = filled ? socialUrl(spec.key, value) : null;
  const dest = filled ? socialDestination(spec.key, value) : null;
  const linkedin = spec.key === "linkedin" && !managed;
  const problem = linkedin && filled ? linkedinLinkProblem(value) : null;

  return (
    <div data-social-row={spec.key}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        {/* Wraps rather than truncates: on a 320px phone the office's
            "Managed by your organization" tag would squeeze "Instagram". */}
        <label htmlFor={inputId} className={`flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 text-xs font-medium ${t.label}`}>
          <span aria-hidden className={`grid place-items-center w-6 h-6 rounded-lg shrink-0 ${t.chip}`}>
            <PlatformIcon label={ICON_LABEL[spec.key] ?? spec.label} className="w-3.5 h-3.5" />
          </span>
          <span>{spec.label}</span>
          {managed && managedTag && <span className="shrink-0">{managedTag}</span>}
        </label>
        {!managed && href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`shrink-0 flex items-center gap-1 text-[0.625rem] font-semibold ${t.open}`}
          >
            Open
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" aria-hidden><path fillRule="evenodd" d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z" clipRule="evenodd" /></svg>
          </a>
        )}
      </div>

      {/* The box. The focus ring sits on the WHOLE box, prefix included: the
          global keyboard outline would otherwise draw a rectangle round the
          bare input and cut straight through the middle of the field (the
          homepage claim pill's lesson, globals.css .sc-claim). The inline
          outline:none is what beats that unlayered rule; the ring replaces it,
          so keyboard users still see exactly where they are. */}
      <div
        className={`@container flex items-center min-w-0 rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-blue-500/40 ${t.box} ${managed ? "opacity-70" : ""}`}
      >
        {withPrefix && (
          <span
            aria-hidden
            className={`shrink-0 pl-3.5 text-[0.8125rem] @max-[260px]:text-[0.6875rem] @max-[260px]:pl-3 select-none whitespace-nowrap ${t.prefix}`}
          >
            {spec.stem}
          </span>
        )}
        <input
          id={inputId}
          type="text"
          // Plain text keyboard, not inputMode="url": the iPhone URL keyboard
          // has no space bar, and "John Doe" is a real LinkedIn entry.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="username"
          // Not a sign-in field: without these, password managers treat seven
          // "username" boxes as a login form and offer saved accounts.
          name={`social-${spec.key}`}
          autoComplete="off"
          aria-label={`${spec.label} username or profile link`}
          // `shown` for a managed value too: it sits after the same prefix,
          // and the raw "@northbeamhomes" read "instagram.com/ @northbeamhomes".
          value={shown}
          // After a prefix, a leading "@" is dropped as it is typed: the box
          // would show it stripped anyway, so a lone "@" became an invisible
          // value that backspace could not reach. The caller's blur still
          // saves "@handle" where a platform keeps one (normalizeSocial).
          onChange={(e) => onChange(withPrefix ? e.target.value.replace(/^@+/, "") : e.target.value)}
          // A pasted LinkedIn link is kept as just the address: no ?utm tail,
          // and not the share sheet's whole sentence.
          onPaste={linkedin ? (e) => {
            const link = linkedinLinkIn(e.clipboardData.getData("text"));
            if (!link) return;
            e.preventDefault();
            onChange(link);
          } : undefined}
          onBlur={onBlur}
          readOnly={managed}
          style={{ outline: "none" }}
          className={`flex-1 min-w-0 bg-transparent py-3 pr-3.5 text-sm ${withPrefix ? "pl-0.5" : "pl-3.5"} ${t.input} ${managed ? "cursor-default" : ""}`}
        />
      </div>

      {/* One line, only when there is something to say. An empty field needs
          no line at all now that the box shows where the username goes. */}
      {managed ? (
        managedNote ? <p className={`text-[0.6875rem] mt-1 leading-snug ${t.note}`}>{managedNote}</p> : null
      ) : problem ? (
        <p className="text-amber-400 text-[0.6875rem] mt-1 leading-snug">{problem}</p>
      ) : filled && dest ? (
        <p className={`text-[0.6875rem] mt-1 leading-snug ${t.note}`}>
          Opens <span className={`font-medium break-all ${t.strong}`}>{dest}</span>
        </p>
      ) : filled ? (
        <p className="text-red-400 text-[0.6875rem] mt-1 leading-snug">
          This won&rsquo;t open as a link — just your username, like <span className="font-medium">{spec.example}</span>
        </p>
      ) : null}

      {linkedin && (
        <LinkedInLinkHelp tone={t} inputId={inputId} value={value} filled={filled} onPick={onChange} />
      )}
    </div>
  );
}
