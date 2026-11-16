// ── Keep our own QA traffic out of the product funnel ───────────────────────
//
// qa-sweep and qa-flows drive the REAL site with REAL device user agents — an
// iPhone Safari string, a desktop Chrome string — precisely so they exercise
// the paths a customer takes. That is what makes them useful, and it is also
// what makes them invisible to the bot filter on /api/events: they look exactly
// like people, because they are pretending to be people.
//
// So a sweep against production wrote runs of "visits" into product_events —
// landed on the site, started building a card, opened pricing — seconds apart,
// each on a fresh session. On the admin funnel that is indistinguishable from
// demand, and it lands on the top step, which is the denominator for every
// conversion rate below it.
//
// TWO markers, because there are two sinks (audit, 2026-09-23):
//   · localStorage `sc_evt_internal` — read by lib/events.ts and sent with
//     every product_events beacon.
//   · cookie `sc_internal` — read by /api/site-view (marketing pageviews) and,
//     since the audit, by /api/events as well.
// Setting only the first (as this did until 2026-09-23) left 3,206 of 3,842
// marketing pageviews labelled real, most of them our own nightly runs.
//
// Every script that opens a browser context must pass it through here —
// tests/qa-internal-marker.test.ts fails CI otherwise.
//
// Since 2026-11-15 it is also the choke point for the local-only rule: every
// browser a script opens passes through here, so this is where a run pointed at
// swiftcard.me or a Vercel deployment is stopped, and where uploads are
// answered in the browser instead of reaching storage (lib/qa-local.mjs).
// `realUploads: true` lets ONE flow that is about the upload itself through.
import { assertLocalBase, stubUploads } from "./lib/qa-local.mjs";

const HOSTS = ["http://localhost", "http://127.0.0.1"];

export async function markInternal(ctx, base, { realUploads = false } = {}) {
  for (const b of [base, process.env.BASE, process.env.SWEEP_BASE, process.env.ADMIN_BASE]) {
    if (typeof b === "string" && b) assertLocalBase(b);
  }
  // A wall inside the browser too: a link, redirect or image that points at
  // the live site (the app writes canonical swiftcard.me links) is cut off
  // here, so no page a script opens can send a request to production.
  await ctx.route(/^https?:\/\/(?:[a-z0-9-]+\.)*(?:swiftcard\.(?:me|app)|vercel\.app)(?::\d+)?\//i, (route) => route.abort("blockedbyclient"));
  if (!realUploads) await stubUploads(ctx, base || process.env.BASE);
  await ctx.addInitScript(() => {
    try { localStorage.setItem("sc_evt_internal", "1"); } catch { /* storage blocked */ }
  });
  const urls = new Set(HOSTS);
  for (const b of [base, process.env.BASE, process.env.SWEEP_BASE]) {
    if (typeof b === "string" && /^https?:\/\//.test(b)) {
      try { urls.add(new URL(b).origin); } catch { /* not a URL */ }
    }
  }
  // A cookie for a host the run never visits is simply never sent.
  await ctx.addCookies([...urls].map((url) => ({ name: "sc_internal", value: "1", url })));
  return ctx;
}
