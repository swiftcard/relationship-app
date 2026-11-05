import { NextRequest, NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { isAdminEmail } from "@/lib/admin";
import { isTestMailbox } from "@/lib/test-mailbox";
import { EVENTS, type EventName } from "@/lib/events";
import { isLikelyBot } from "@/lib/bot-detection";

// ── Product-event ingest ────────────────────────────────────────────────────
// Receives the funnel events lib/events.ts fires (card started, plan picked,
// upgrade clicked, …) and stores them in OUR database, where /admin/analytics
// reads them. See supabase/product-events.sql for why this is first-party.
//
// Three rules, in order:
//   1. It can never break a user action. Always answers 202 and swallows
//      everything — a failed insert must not surface anywhere.
//   2. It stores no PII. The property allow-list below is the whole contract:
//      unknown keys are dropped, not passed through, so a future call site
//      cannot leak a name or an email into the analytics table by accident.
//   3. It is a PUBLIC endpoint, so it validates hard: an unknown event name is
//      dropped, every string is capped, and one IP is capped per window.

// Constant-time-enough membership check against the closed vocabulary.
const KNOWN = new Set<string>(EVENTS);

// The ONLY property keys that reach the database. Deliberately identical to
// EventProps minus anything that could identify a human — cardId and orgId are
// excluded on purpose: they are ids, and the funnel is counted, not joined.
const ALLOWED_PROPS = ["placement", "cta", "plan", "interval", "feature", "method", "variant"] as const;

// Low-cardinality by contract; the cap is a backstop against a forged payload
// bloating the table, not a real limit any call site approaches.
const clean = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, 60);
  return s || undefined;
};

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req) ?? "anon";
    // 200 events / IP / 5 min. A real session fires a handful; this only stops
    // someone scripting the endpoint. Over the cap we still answer 202 so the
    // client never retries or logs.
    if (await isRateLimited(`product-events:${ip}`, 200, 5 * 60 * 1000)) {
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    // Crawlers, headless browsers, uptime monitors and scripted clients are
    // not people, and the top of a funnel is exactly where they pile up: the
    // first thing this table collected included runs of single-event "visits"
    // seconds apart, each on a fresh session. Counting those would inflate
    // "Landed on the site" and make every conversion rate below it look worse
    // than it is — the one number on the page you would actually act on.
    //
    // The same rule the five other public ingest routes already apply (views,
    // card-events, analytics/event, leads, site-view). The User-Agent is READ
    // to classify and never stored — see the insert below.
    if (isLikelyBot(req.headers.get("user-agent"))) {
      return NextResponse.json({ ok: true }, { status: 202 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name ?? "");
    if (!KNOWN.has(name)) return NextResponse.json({ ok: true }, { status: 202 });

    const rawProps = (body.props ?? {}) as Record<string, unknown>;
    const props: Record<string, string | number> = {};
    for (const key of ALLOWED_PROPS) {
      const v = clean(rawProps[key]);
      if (v) props[key] = v;
    }
    // `seats` is the one numeric prop, and it is a small count.
    const seats = Number(rawProps.seats);
    if (Number.isFinite(seats) && seats > 0 && seats < 10_000) props.seats = Math.floor(seats);

    // Path only — never the query string, which is where campaign ids, emails
    // and reset tokens live.
    let path: string | undefined;
    const rawPath = clean(body.path);
    if (rawPath && rawPath.startsWith("/")) path = rawPath.split("?")[0].split("#")[0].slice(0, 60);

    // Is this our own traffic? Three independent signals, any one is enough:
    //
    //  - it isn't the production deployment. A dev server and a preview build
    //    both talk to the SAME database, so the moment this route existed two
    //    local `next dev` servers started writing real-looking page views into
    //    it. Caught within a minute of the table being created, which is the
    //    only reason it isn't a permanent quiet distortion of every number on
    //    the admin page.
    //  - the request carries an admin (or demo-account) session, or
    //  - the browser was told it was internal on an earlier event and has
    //    remembered it, which is what keeps our own logged-OUT testing —
    //    building a guest card to check the wizard — out of the real numbers.
    //  - the device carries the owner-set `sc_internal` cookie that Website
    //    analytics honours (/api/site-view) — one marker, both sinks.
    let isInternal =
      process.env.VERCEL_ENV !== "production" ||
      body.internal === true ||
      req.cookies.get("sc_internal")?.value === "1";
    if (!isInternal) {
      try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const email = user?.email?.toLowerCase() ?? "";
        // …or a QA throwaway mailbox, exactly as the server sink labels it
        // (lib/server-events). Without it the nightly QA accounts' browser
        // events counted as real people on the admin funnel.
        if (email && (isAdminEmail(email) || email === "demo@swiftcard.me" || isTestMailbox(email))) isInternal = true;
      } catch {
        // No session, or auth unreachable: treat as ordinary traffic. Failing
        // open here mislabels at worst one event as real; failing closed would
        // silently drop real ones.
      }
    }

    await getAdminSupabase().from("product_events").insert({
      name: name as EventName,
      props,
      session_key: clean(body.sessionKey),
      path,
      is_internal: isInternal,
    });

    // Tells the browser to keep marking itself internal from now on. Only ever
    // true for our own accounts, and it is a hint about traffic labelling —
    // never a permission, so it grants nothing if forged.
    return NextResponse.json({ ok: true, internal: isInternal });
  } catch {
    // Analytics must never surface to a user, and must never fail a page.
    return NextResponse.json({ ok: true }, { status: 202 });
  }
}
