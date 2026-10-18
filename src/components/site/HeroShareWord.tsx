"use client";

import { useEffect, useState } from "react";

// The last line of the homepage headline: "The business card that / shares
// everything". The server renders the final word, so no-JS visitors, search
// engines and reduced-motion users get the real headline. With motion it
// rotates once through what a card actually shares, then lands on
// "everything" (with the underline drawn in) and stays there until the next
// page load (owner, 2026-10-18; was an endless loop since 2026-09-17).
const WORDS = ["your number", "your links", "your socials", "everything"];
const FINAL = WORDS.length - 1;
const STEP_MS = 2000; // each of the first three words

export default function HeroShareWord() {
  const [i, setI] = useState(FINAL);
  // False until the rotation starts, so the server-rendered word does not
  // replay its entrance on hydration.
  const [ran, setRan] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRan(true);
      return;
    }
    let n = -1;
    let timer = window.setTimeout(function tick() {
      n += 1;
      setRan(true);
      setI(n);
      if (n < FINAL) timer = window.setTimeout(tick, STEP_MS);
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  const landed = ran && i === FINAL;
  return (
    <span className="hp-word-line">
      {/* Screen readers get the stable headline, not a word that changes. */}
      <span className="sr-only">shares everything</span>
      <span aria-hidden="true" className="rd-aurora-text rd-aurora-anim">shares</span>{" "}
      <span aria-hidden="true" className="hp-word-slot"><span className="hp-word-box">
        <span key={i} className={`rd-aurora-text rd-aurora-anim hp-word ${ran ? "hp-word-in" : ""}`}>
          {WORDS[i]}
        </span>
        <svg
          className={`hp-swoosh ${landed ? "hp-swoosh-on" : ""}`}
          viewBox="0 0 300 20"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="hp-swoosh-g" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#1D3FB8" />
              <stop offset="46%" stopColor="#2563EB" />
              <stop offset="100%" stopColor="#4DA8F5" />
            </linearGradient>
          </defs>
          <path d="M4 14 C 70 4, 150 3, 296 9" fill="none" stroke="url(#hp-swoosh-g)" strokeWidth="5" strokeLinecap="round" pathLength={1} />
        </svg>
      </span></span>
    </span>
  );
}
