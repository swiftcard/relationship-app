import { NextResponse } from "next/server";
import { SEEDED_VISITOR_PREFIX, isSeededView } from "@/lib/seeded-views";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { requireAdmin, isAdminEmail } from "@/lib/admin";
import { getAccountEmailMap } from "@/lib/account-email";
import { isPaidPlan } from "@/lib/plan";
import { warmLeadMetrics } from "@/lib/warm-lead-metrics";

// Rough monthly price per paid plan (matches the pricing page).
const PRO_PRICE = 4.99;
const OFFICE_PRICE = 3.99;

function dayKey(t: number | string) {
  return new Date(t).toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getAdminSupabase();
  const now = Date.now();
  const DAY = 86_400_000;
  const iso = (n: number) => new Date(now - n * DAY).toISOString();

  // ── Accounts ───────────────────────────────────────────────────────────────
  const { data: profRows } = await admin
    .from("profiles")
    .select("id, email, name, username, plan, created_at, customization, signup_source, stripe_subscription_id")
    .order("created_at", { ascending: false })
    .limit(1000);

  // Resolve the AUTH signup email — profiles.email drifts to the card's public
  // contact email, so filtering internal accounts on it silently misses them
  // (see lib/account-email, and the same fix already applied in api/admin/users).
  const authEmails = await getAccountEmailMap();
  const emailOf = (p: { id: unknown; email?: unknown }) =>
    (authEmails.get(p.id as string) ?? (p.email as string) ?? "").toLowerCase();

  const accounts = (profRows ?? []).filter((p) => {
    if ((p.customization as { _deleted?: boolean } | null)?._deleted) return false;
    const e = emailOf(p);
    // Internal accounts are not customers: the demo card and any ADMIN_EMAILS
    // operator account would otherwise show up as signups and as paid revenue.
    return e !== "demo@swiftcard.me" && !isAdminEmail(e);
  });

  const plans = { free: 0, pro: 0, enterprise: 0 };
  const signupSeries: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) signupSeries[dayKey(now - i * DAY)] = 0;
  let signupToday = 0, signup7 = 0, signup30 = 0;

  accounts.forEach((a) => {
    const k = a.plan === "pro" ? "pro" : a.plan === "enterprise" ? "enterprise" : "free";
    plans[k]++;
    const t = new Date(a.created_at as string).getTime();
    if (t >= now - DAY) signupToday++;
    if (t >= now - 7 * DAY) signup7++;
    if (t >= now - 30 * DAY) signup30++;
    const key = dayKey(a.created_at as string);
    if (key in signupSeries) signupSeries[key]++;
  });

  const totalAccounts = accounts.length;

  // Revenue counts only accounts with a REAL Stripe subscription. Deriving it
  // from the plan label alone reported comped/manually-granted accounts as
  // paying — after the 2026-07-28 reset that made a $0 business show non-zero
  // MRR and 100% conversion, which is exactly the number you'd act on.
  const subscribed = accounts.filter((a) => !!a.stripe_subscription_id);
  const paid = subscribed.length;
  const conversion = totalAccounts ? Math.round((paid / totalAccounts) * 1000) / 10 : 0;
  const estMrr =
    Math.round(
      subscribed.reduce(
        (sum, a) => sum + (a.plan === "enterprise" ? OFFICE_PRICE : PRO_PRICE),
        0
      ) * 100
    ) / 100;
  // Accounts on a paid plan with no subscription behind them — comped, legacy,
  // or a checkout that never completed. Surfaced so the gap is visible rather
  // than silently inflating or deflating the numbers above.
  const compedPaidPlans = accounts.filter(
    (a) => isPaidPlan(a.plan as string) && !a.stripe_subscription_id
  ).length;

  // ── Acquisition: where signups come from + which sources convert to paid ──
  // This is the marketing-spend view: signups, last-30-day signups, and the
  // paid-conversion rate per signup source.
  const acqMap: Record<string, { signups: number; d30: number; paid: number }> = {};
  accounts.forEach((a) => {
    const src = ((a as { signup_source?: string | null }).signup_source || "direct") as string;
    const slot = (acqMap[src] ??= { signups: 0, d30: 0, paid: 0 });
    slot.signups++;
    if (new Date(a.created_at as string).getTime() >= now - 30 * DAY) slot.d30++;
    // Same rule as estMrr above: a source only "converted" if money followed.
    if (a.stripe_subscription_id) slot.paid++;
  });
  const acquisition = Object.entries(acqMap)
    .map(([source, v]) => ({ source, ...v, paidRate: v.signups ? Math.round((v.paid / v.signups) * 1000) / 10 : 0 }))
    .sort((a, b) => b.signups - a.signups);

  // ── Cards ────────────────────────────────────────────────────────────────
  const { count: cardTotal } = await admin.from("cards").select("*", { count: "exact", head: true });

  // WHAT COUNTS (audit A-03, A-06). Leads and views are keyed by card slug, and
  // a deleted or QA account's rows outlive it: 84% of leads and a third of card
  // views belonged to cards that no longer exist. And every new card is seeded
  // with a sample contact (lib/demo-contact, tagged "demo", source "qr_code"):
  // 219 of 245 "leads" were that sample, so the total read ~9x real, "QR code"
  // looked like the dominant channel and "activated cards" equalled "cards".
  // Every customer-facing reader already left the sample out; this one forgot.
  // So: only rows of cards that exist now, and never the sample contact.
  const liveSlugs = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("cards").select("username").range(from, from + 999);
    for (const c of data ?? []) if (c.username) liveSlugs.add(c.username as string);
    if (!data || data.length < 1000) break;
  }
  const isLiveSlug = (slug: unknown) => typeof slug === "string" && liveSlugs.has(slug.replace(/__links$/, ""));
  const isRealLead = (l: { card_owner?: unknown; tags?: unknown }) =>
    isLiveSlug(l.card_owner) && !(Array.isArray(l.tags) && (l.tags as unknown[]).includes("demo"));

  // ── Leads (contacts captured) ────────────────────────────────────────────
  const allLeads: { card_owner: unknown; tags: unknown }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("leads").select("card_owner, tags").range(from, from + 999);
    allLeads.push(...((data ?? []) as { card_owner: unknown; tags: unknown }[]));
    if (!data || data.length < 1000) break;
  }
  const realLeads = allLeads.filter(isRealLead);
  const leadTotal = realLeads.length;
  const { data: recentLeadRows } = await admin.from("leads").select("created_at, source, card_owner, tags").gte("created_at", iso(30)).limit(1000);
  const recentLeads = (recentLeadRows ?? []).filter(isRealLead);
  const leadsSeries: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) leadsSeries[dayKey(now - i * DAY)] = 0;
  const bySource: Record<string, number> = {};
  let leads7 = 0, leadsToday = 0;
  (recentLeads ?? []).forEach((l) => {
    const t = new Date(l.created_at as string).getTime();
    if (t >= now - DAY) leadsToday++;
    if (t >= now - 7 * DAY) leads7++;
    const key = dayKey(l.created_at as string);
    if (key in leadsSeries) leadsSeries[key]++;
    const src = (l.source as string) || "direct";
    bySource[src] = (bySource[src] ?? 0) + 1;
  });

  // Top cards by leads (all-time, from card_owner) — live cards, real leads.
  const ownerCounts: Record<string, number> = {};
  realLeads.forEach((l) => {
    const o = (l.card_owner as string) || "";
    if (o) ownerCounts[o] = (ownerCounts[o] ?? 0) + 1;
  });
  const topCards = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([username, count]) => ({ username, count }));
  const activatedCards = Object.keys(ownerCounts).length; // cards that captured ≥1 lead

  // ── Views (SwiftCard vs SwiftLink) ────────────────────────────────────────
  // Excludes the App Review demo account's seeded views — see lib/seeded-views.
  // They were ~30% of this number, which made our own traction look better than
  // it was on the one dashboard we use to judge it.
  // The or() keeps NULL visitor_id rows in the total: a bare not-like filter
  // silently dropped them (NULL LIKE is NULL), so `total` and the 30-day loop
  // below (whose isSeededView(null) is false) were counting two different
  // populations.
  // Live cards only (A-03), counted here because the filter can't be expressed
  // as one query without a join PostgREST doesn't have for a slug key.
  let viewTotal = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("card_views")
      .select("username, visitor_id")
      .or(`visitor_id.is.null,visitor_id.not.like.${SEEDED_VISITOR_PREFIX}%`)
      .range(from, from + 999);
    for (const v of data ?? []) if (isLiveSlug(v.username)) viewTotal++;
    if (!data || data.length < 1000) break;
  }
  // card_views has viewed_at (NOT created_at) — selecting the wrong column made
  // this whole block silently return nothing and the views charts showed 0.
  // Ordered newest-first: with no order, hitting the 5000 cap kept an ARBITRARY
  // 5000 of the month's rows; now it's deterministically the most recent ones.
  const { data: recentViews } = await admin
    .from("card_views")
    .select("username, viewed_at, visitor_id")
    .gte("viewed_at", iso(30))
    .order("viewed_at", { ascending: false })
    .limit(5000);
  let cardViews30 = 0, linkViews30 = 0, views7 = 0;
  (recentViews ?? []).forEach((v) => {
    if (isSeededView(v.visitor_id as string | null)) return;
    if (!isLiveSlug(v.username)) return;
    const t = new Date(v.viewed_at as string).getTime();
    if (t >= now - 7 * DAY) views7++;
    if (((v.username as string) || "").endsWith("__links")) linkViews30++; else cardViews30++;
  });

  // ── Ingest decisions (analytics_ingest_log) ───────────────────────────────
  // "Is that view real?" and "why is that view missing?" were unanswerable: a
  // declined request left no trace, so judging the classifier meant arguing
  // about it. This is the last 7 days of DECISIONS — never a customer-facing
  // number, and card_views stays the one source of counted truth.
  //
  // Admin-only by the requireAdmin() gate at the top of this route, and the
  // table itself is RLS-on-no-policies so nothing but the service role can read
  // it at all. Returns counts and the most recent declines, never a visitor's
  // identity, location, IP or User-Agent.
  let ingest: {
    available: boolean;
    byReason: [string, number][];
    byClassification: [string, number][];
    byGeoAccuracy: [string, number][];
    counted7: number;
    declined7: number;
    relay7: number;
    recentDeclines: { at: string; entity: string; event: string; reason: string; classification: string | null }[];
  } = { available: false, byReason: [], byClassification: [], byGeoAccuracy: [], counted7: 0, declined7: 0, relay7: 0, recentDeclines: [] };
  {
    const { data: logRows, error: logErr } = await admin
      .from("analytics_ingest_log")
      .select("created_at, entity_key, event_type, counted, reason, classification, geo_accuracy, is_relay")
      .gte("created_at", iso(7))
      .order("created_at", { ascending: false })
      .limit(5000);
    // Table not migrated yet (supabase/analytics-accuracy.sql) — the rest of the
    // admin page must still render.
    if (!logErr && logRows) {
      const tally = (rows: (string | null)[]) => {
        const m: Record<string, number> = {};
        for (const r of rows) { const k = r ?? "—"; m[k] = (m[k] ?? 0) + 1; }
        return Object.entries(m).sort((a, b) => b[1] - a[1]);
      };
      ingest = {
        available: true,
        byReason: tally(logRows.map((r) => r.reason as string | null)),
        byClassification: tally(logRows.map((r) => r.classification as string | null)),
        byGeoAccuracy: tally(logRows.map((r) => r.geo_accuracy as string | null)),
        counted7: logRows.filter((r) => r.counted).length,
        declined7: logRows.filter((r) => !r.counted).length,
        relay7: logRows.filter((r) => r.is_relay).length,
        recentDeclines: logRows
          .filter((r) => !r.counted)
          .slice(0, 25)
          .map((r) => ({
            at: r.created_at as string,
            entity: (r.entity_key as string) ?? "",
            event: (r.event_type as string) ?? "",
            reason: (r.reason as string) ?? "",
            classification: (r.classification as string | null) ?? null,
          })),
      };
    }
  }

  // ── The click funnel (product_events) ─────────────────────────────────────
  // Everything above this point counts rows that already exist — accounts,
  // cards, leads, views — so it can only see people who already signed up.
  // This is the part BEFORE that: visited → started a card → finished it →
  // saw pricing → clicked upgrade → paid.
  //
  // Excludes our own traffic (is_internal), which is how testing the wizard
  // signed out stops looking like demand. See supabase/product-events.sql.
  let funnel: {
    available: boolean;
    d30: Record<string, number>;
    d7: Record<string, number>;
    internal30: number;
    topCtas: [string, number][];
    lockedFeatures: [string, number][];
  } = { available: false, d30: {}, d7: {}, internal30: 0, topCtas: [], lockedFeatures: [] };
  {
    // PAGED, every row of the 30 days (audit A-11). One select is answered
    // with at most the database's 1,000-row page whatever .limit() says, so
    // the funnel was counting only the newest sliver of 12,000+ events — the
    // bottom of the funnel (checkouts, finished cards) understated first, with
    // no sign of it. The cap below is a runaway guard, and says when it bites.
    type EventRow = { name: string; props: unknown; is_internal: boolean | null; created_at: string; session_key: string | null };
    const evRows: EventRow[] = [];
    let evErr: unknown = null;
    const PAGE = 1000;
    for (let p = 0; p < 200; p++) {
      const { data, error } = await admin
        .from("product_events")
        .select("name, props, is_internal, created_at, session_key")
        .gte("created_at", iso(30))
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(p * PAGE, p * PAGE + PAGE - 1);
      if (error) { evErr = error; break; }
      evRows.push(...((data ?? []) as EventRow[]));
      if ((data ?? []).length < PAGE) break;
      if (p === 199) console.warn("[admin/analytics] product_events: stopped at 200,000 rows for 30 days");
    }
    // Table not migrated yet (supabase/product-events.sql) — the rest of the
    // admin page must still render, exactly like the ingest block above.
    if (!evErr && evRows) {
      const d30: Record<string, number> = {};
      const d7: Record<string, number> = {};
      const ctas: Record<string, number> = {};
      const features: Record<string, number> = {};
      let internal30 = 0;
      // PEOPLE, not rows (audit A-17): "started a card" fired on every mount
      // of the editor — each reload, each Back to /cards/new, each sign-in
      // mid-build — and the funnel counted every one, so the abandonment it
      // showed could not be acted on. Each step counts a session once; a row
      // with no session key still counts as its own.
      const seen30 = new Set<string>();
      const seen7 = new Set<string>();
      evRows.forEach((r, i) => {
        if (r.is_internal) { internal30++; return; }
        const name = r.name as string;
        const who = `${name}|${r.session_key ?? `row:${i}`}`;
        if (!seen30.has(who)) { seen30.add(who); d30[name] = (d30[name] ?? 0) + 1; }
        if (new Date(r.created_at as string).getTime() >= now - 7 * DAY && !seen7.has(who)) { seen7.add(who); d7[name] = (d7[name] ?? 0) + 1; }
        const props = (r.props ?? {}) as { cta?: string; feature?: string };
        if (name === "cta_clicked" && props.cta) ctas[props.cta] = (ctas[props.cta] ?? 0) + 1;
        if (name === "upgrade_prompt_viewed" && props.feature) features[props.feature] = (features[props.feature] ?? 0) + 1;
      });
      const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8) as [string, number][];
      funnel = { available: true, d30, d7, internal30, topCtas: top(ctas), lockedFeatures: top(features) };
    }
  }

  // Returning-contact alerts: do they get opened, followed up, and are they
  // ever about the wrong person? (lib/warm-lead-metrics.ts)
  const warmLead = await warmLeadMetrics(admin, now);

  return NextResponse.json({
    funnel,
    ingest,
    warmLead,
    accounts: {
      total: totalAccounts,
      today: signupToday, d7: signup7, d30: signup30,
      series: Object.entries(signupSeries).map(([date, count]) => ({ date, count })),
      // id so the admin's "Latest signups" rows open that user's page.
      recent: accounts.slice(0, 10).map((a) => ({ id: a.id, name: a.name, email: a.email, username: a.username, plan: a.plan, created_at: a.created_at })),
    },
    plans: { free: plans.free, pro: plans.pro, office: plans.enterprise, paid, conversion, estMrr, compedPaidPlans },
    acquisition,
    cards: { total: cardTotal ?? 0, perAccount: totalAccounts ? Math.round(((cardTotal ?? 0) / totalAccounts) * 10) / 10 : 0 },
    leads: {
      total: leadTotal ?? 0, today: leadsToday, d7: leads7,
      series: Object.entries(leadsSeries).map(([date, count]) => ({ date, count })),
      bySource: Object.entries(bySource).sort((a, b) => b[1] - a[1]),
      perAccount: totalAccounts ? Math.round(((leadTotal ?? 0) / totalAccounts) * 10) / 10 : 0,
    },
    views: { total: viewTotal ?? 0, d7: views7, cardViews30, linkViews30 },
    engagement: { activatedCards, activationRate: (cardTotal ?? 0) ? Math.round((activatedCards / (cardTotal ?? 1)) * 1000) / 10 : 0 },
    topCards,
  });
}
