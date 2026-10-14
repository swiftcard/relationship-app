"use client";

import { useEffect } from "react";

// One IntersectionObserver for the whole page. Any element with a `data-reveal`
// attribute pops in (fade + rise/slide/scale per the CSS) the first time it
// scrolls into view. Server-rendered markup just adds the attribute — no need
// to wrap each element in a client component.
export default function ScrollReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));

    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );

    els.forEach((el) => io.observe(el));

    // Blocks that mount after load (components/Deferred: the gallery, the
    // dashboards, the phones) bring their own data-reveal elements with them.
    // Observed only at mount, those would keep their pre-reveal opacity: 0 for
    // ever — the exact "rendered but invisible" failure paint-check.yml
    // exists to catch. So every element added later is picked up too.
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.hasAttribute("data-reveal")) io.observe(node);
          node.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => io.observe(el));
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Safety net: if the observer somehow never fires while the page IS visible
    // (a rare browser hiccup), don't leave content stuck invisible — reveal it.
    // Only triggers when nothing has revealed yet despite something being in
    // view, so it never overrides the normal scroll-triggered timing.
    const failsafe = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const anyRevealed = els.some((el) => el.classList.contains("is-in"));
      const anyInView = els.some((el) => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      });
      if (!anyRevealed && anyInView) els.forEach((el) => el.classList.add("is-in"));
    }, 2500);

    return () => { io.disconnect(); mo.disconnect(); window.clearTimeout(failsafe); };
  }, []);

  return null;
}
