import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { requireAdmin } from "@/lib/admin";
import { paged } from "@/lib/crew/paged";
import { isPaidPlan } from "@/lib/plan";
import { warmLeadMetrics } from "@/lib/warm-lead-metrics";
import { ALL_TIME_SINCE, allTimeUntil, flattenOfficeKeys, getOfficeEmployeeMetricsForTeam } from "@/lib/office-analytics";
import { customersOf, loadAccounts } from "@/lib/admin-data/accounts";
import { accountSlugs, totalsFor } from "@/lib/admin-data/customer-stats";
import { listSubscriptions, monthlyCents, revenue, type SubLite } from "@/lib/admin-data/billing";
import { BUSINESS_TZ, emptyDaySeries, nyDayKey, startOfNyDay } from "@/lib/admin-data/time";

// ── Company Analytics: every number counted for real (2026-10-28) ──────────
// The owner: "make sure that all the analytics are actually real and that
// there's nothing fake". What this used to do, and what it does now:
//   - counted QA's throwaway accounts (28 of 41) and our own as customers
//     → customers only (lib/admin-data/accounts), the rest listed apart;
//   - read profiles, recent leads, recent views and the ingest log with one
//     select each, so each stopped at 1,000 rows → paged, or aggregated in
//     the database;
//   - priced revenue as count × $4.99 and counted free trials as paying
//     → read from Stripe itself (lib/admin-data/billing);
//   - put every Office team member under "Office" and "not paying" → Office
//     owners and seats apart;
//   - bucketed days in UTC with "today" = the last 24 hours → New York days;
//   - started the journey at product_events page views, which include
//     /dashboard and /login → the website's own visits.
// And it checks itself: `numberCheck` recounts the headline numbers a second,
// independent way (plain row counts) and says whether they agree.

const DAY = 86_400_000;

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getAdminSupabase();
  const now = Date.now();
  const nowDate = new Date(now);
  const iso = (n: number) => new Date(now - n * DAY).toISOString();
  const today0 = startOfNyDay(0, nowDate).getTime();
  const since7 = startOfNyDay(6, nowDate);
  const since30 = startOfNyDay(29, nowDate);

  // ── Accounts ───────────────────────────────────────────────────────────────
  const all = await loadAccounts();
  const customers = customersOf(all);
  const nonCustomers = all.filter((a) => a.kind !== "customer" && !a.deleted);

  const signupSeries = emptyDaySeries(30, nowDate);
  let signupToday = 0, signup7 = 0, signup30 = 0;
  for (const a of customers) {
    const t = Date.parse(a.createdAt);
    if (t >= today0) signupToday++;
    if (t >= since7.getTime()) signup7++;
    if (t >= since30.getTime()) signup30++;
    const k = nyDayKey(a.createdAt);
    if (signupSeries.has(k)) signupSeries.set(k, (signupSeries.get(k) ?? 0) + 1);
  }

  // Plan mix: what each customer is on right now. Office OWNERS are the
  // Office customers; their team members ride on the owner's seats.
  const plans = { free: 0, pro: 0, office: 0, officeMembers: 0, gift: 0, apple: 0, byHand: 0 };
  for (const a of customers) {
    if (a.effectivePlan === "pro") plans.pro++;
    else if (a.effectivePlan === "enterprise") {
      if (a.officeRole === "member") plans.officeMembers++; else plans.office++;
    } else plans.free++;
    if (a.billing.source === "grant") plans.gift++;
    if (a.billing.source === "apple") plans.apple++;
    // A paid plan with nothing behind it: moved by hand.
    if (isPaidPlan(a.effectivePlan) && a.billing.source === "none") plans.byHand++;
  }

  // ── Money, from Stripe ───────────────────────────────────────────────────
  const rev = await revenue(all);
  let subs: SubLite[] = [];
  if (rev.available) {
    try { subs = await listSubscriptions(); } catch { subs = []; }
  }
  const customerIds = new Set(customers.map((a) => a.id));
  // Who has turned into a paying customer, and when: an active (or past-due)
  // subscription that charges money — from when its trial ended, or from when
  // it started if there was no trial.
  const payingSince = new Map<string, number>();
  for (const s of subs) {
    if (!s.userId || !customerIds.has(s.userId)) continue;
    if ((s.status === "active" || s.status === "past_due") && monthlyCents(s) > 0) {
      const at = (s.trialEnd && s.trialEnd > s.created ? s.trialEnd : s.created) * 1000;
      payingSince.set(s.userId, Math.min(payingSince.get(s.userId) ?? Infinity, at));
    }
  }
  const paid = rev.available ? rev.summary.paying : customers.filter((a) => a.billing.everPaid && a.billing.source === "stripe").length;

  // ── Acquisition: where customers came from, and how many pay ────────────
  const acqMap: Record<string, { signups: number; d30: number; paid: number }> = {};
  for (const a of customers) {
    // A missing source is "not recorded" (it only exists since the signup
    // cookie was added) — not "direct", which it used to be called.
    const src = a.signupSource || "not_recorded";
    const slot = (acqMap[src] ??= { signups: 0, d30: 0, paid: 0 });
    slot.signups++;
    if (Date.parse(a.createdAt) >= since30.getTime()) slot.d30++;
    if (payingSince.has(a.id)) slot.paid++;
  }
  const acquisition = Object.entries(acqMap)
    .map(([source, v]) => ({ source, ...v, paidRate: v.signups ? Math.round((v.paid / v.signups) * 1000) / 10 : 0 }))
    .sort((a, b) => b.signups - a.signups);

  // ── Cards, contacts and views: customers' only, the customer's own count ─
  const customerCards = customers.flatMap((a) => a.cards.map((c) => ({ ...c, userId: a.id })));
  const totals = await totalsFor(customers);
  let leadTotal = 0, lockedTotal = 0, viewTotal = 0, linkViewTotal = 0;
  for (const t of totals.values()) { leadTotal += t.leads; lockedTotal += t.lockedLeads; viewTotal += t.views; linkViewTotal += t.swiftlinkViews; }

  const slugs = customers.flatMap((a) => accountSlugs(a));
  const keys = flattenOfficeKeys(slugs);

  // Contacts per New York day, by source — every row of the 30 days.
  const leadSeries = emptyDaySeries(30, nowDate);
  const bySource: Record<string, number> = {};
  let leads7 = 0, leadsToday = 0;
  const recentLeads = slugs.length
    ? await paged<{ created_at: string; source: string | null }>(
        (from, to) => admin.from("leads").select("created_at, source").in("card_owner", slugs)
          .not("tags", "cs", "{demo}").gte("created_at", since30.toISOString()).order("created_at").order("id").range(from, to),
        500_000, "admin recent leads")
    : [];
  for (const l of recentLeads) {
    const t = Date.parse(l.created_at);
    if (t >= today0) leadsToday++;
    if (t >= since7.getTime()) leads7++;
    const k = nyDayKey(l.created_at);
    if (leadSeries.has(k)) leadSeries.set(k, (leadSeries.get(k) ?? 0) + 1);
    const src = l.source || "unknown";
    bySource[src] = (bySource[src] ?? 0) + 1;
  }

  // Views in a window, card pages and Swift Links apart — database aggregates.
  const viewsSince = async (since: Date) => {
    if (!keys.length) return { card: 0, links: 0 };
    const { data, error } = await admin.rpc("office_employee_view_stats", { p_keys: keys, p_since: since.toISOString(), p_until: allTimeUntil(now) });
    if (error) return { card: 0, links: 0 };
    let card = 0, links = 0;
    for (const r of (data ?? []) as { views: number; swiftlink_views: number }[]) { card += Number(r.views) || 0; links += Number(r.swiftlink_views) || 0; }
    return { card, links };
  };
  const [views30, views7] = await Promise.all([viewsSince(since30), viewsSince(since7)]);

  // Per card: contacts (the top cards) and activation (cards with a contact).
  const perCard = customerCards.length
    ? await getOfficeEmployeeMetricsForTeam(
        customerCards.map((c) => ({ userId: c.id, name: c.name ?? "", username: c.username, isOwner: false, cardSlugs: [{ username: c.username, label: c.label, name: c.name }] })),
        ALL_TIME_SINCE, allTimeUntil(now))
    : [];
  const cardById = new Map(customerCards.map((c) => [c.id, c]));
  const topCards = perCard
    .filter((r) => r.leads > 0)
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 6)
    .map((r) => ({ username: cardById.get(r.userId)?.username ?? r.username, count: r.leads, userId: cardById.get(r.userId)?.userId ?? null }));
  const activatedCards = perCard.filter((r) => r.leads > 0).length;
  const offlineCards = customerCards.filter((c) => c.is_offline).length;

  // ── Ingest decisions (analytics_ingest_log) ───────────────────────────────
  // "Is that view real?" and "why is that view missing?" were unanswerable: a
  // declined request left no trace, so judging the classifier meant arguing
  // about it. This is the last 7 days of DECISIONS — never a customer-facing
  // number, and card_views stays the one source of counted truth.
  //
  // Admin-only by the requireAdmin() gate at the top of this route, and the
  // table itself is RLS-on-no-policies so nothing but the service role can read
  // it at all. Returns counts and the most recent declines, never a visitor's
  // identity, location, IP or User-Agent. Paged: one select stopped at 1,000.
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
  try {
    type LogRow = { created_at: string; entity_key: string | null; event_type: string | null; counted: boolean; reason: string | null; classification: string | null; geo_accuracy: string | null; is_relay: boolean | null };
    const logRows = await paged<LogRow>(
      (from, to) => admin.from("analytics_ingest_log")
        .select("created_at, entity_key, event_type, counted, reason, classification, geo_accuracy, is_relay")
        .gte("created_at", iso(7)).order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to),
      500_000, "admin ingest log");
    const tally = (rows: (string | null)[]) => {
      const m: Record<string, number> = {};
      for (const r of rows) { const k = r ?? "—"; m[k] = (m[k] ?? 0) + 1; }
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    ingest = {
      available: true,
      byReason: tally(logRows.map((r) => r.reason)),
      byClassification: tally(logRows.map((r) => r.classification)),
      byGeoAccuracy: tally(logRows.map((r) => r.geo_accuracy)),
      counted7: logRows.filter((r) => r.counted).length,
      declined7: logRows.filter((r) => !r.counted).length,
      relay7: logRows.filter((r) => r.is_relay).length,
      recentDeclines: logRows
        .filter((r) => !r.counted)
        .slice(0, 25)
        .map((r) => ({ at: r.created_at, entity: r.entity_key ?? "", event: r.event_type ?? "", reason: r.reason ?? "", classification: r.classification ?? null })),
    };
  } catch {
    // Table not migrated yet (supabase/analytics-accuracy.sql) — the rest of
    // the admin page must still render.
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
        .gte("created_at", since30.toISOString())
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
        if (new Date(r.created_at as string).getTime() >= since7.getTime() && !seen7.has(who)) { seen7.add(who); d7[name] = (d7[name] ?? 0) + 1; }
        const props = (r.props ?? {}) as { cta?: string; feature?: string };
        if (name === "cta_clicked" && props.cta) ctas[props.cta] = (ctas[props.cta] ?? 0) + 1;
        if (name === "upgrade_prompt_viewed" && props.feature) features[props.feature] = (features[props.feature] ?? 0) + 1;
      });
      // Step one is the website's own visits (site_pageviews), not the
      // page_viewed event: that one fires on /dashboard and /login too, so
      // signed-in customers opening the app read as new people arriving.
      const visits = await websiteVisits(admin, since30, since7);
      d30.page_viewed = visits.d30;
      d7.page_viewed = visits.d7;
      // The last step is money in, from Stripe: a customer whose subscription
      // started charging in the window. The browser's checkout_completed
      // missed anyone who never came back to the page, and counted $0 trials.
      d30.checkout_completed = [...payingSince.values()].filter((t) => t >= since30.getTime()).length;
      d7.checkout_completed = [...payingSince.values()].filter((t) => t >= since7.getTime()).length;
      const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8) as [string, number][];
      funnel = { available: true, d30, d7, internal30, topCtas: top(ctas), lockedFeatures: top(features) };
    }
  }

  // Returning-contact alerts: do they get opened, followed up, and are they
  // ever about the wrong person? (lib/warm-lead-metrics.ts)
  const warmLead = await warmLeadMetrics(admin, now);

  // ── Number check: the headline numbers, counted a second way ─────────────
  const numberCheck = await checkNumbers(admin, {
    accounts: all.length,
    cards: all.reduce((n, a) => n + a.cards.length, 0),
    customerSlugs: slugs,
    customerKeys: keys,
    leads: leadTotal,
    views: viewTotal + linkViewTotal,
    signups30: [...signupSeries.values()].reduce((n, v) => n + v, 0),
    signups30Direct: signup30,
  });

  const recentCustomers = [...customers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);

  return NextResponse.json({
    tz: BUSINESS_TZ,
    funnel,
    ingest,
    warmLead,
    revenue: rev,
    numberCheck,
    internal: { accounts: nonCustomers.length, subscriptionsLeftOut: rev.available ? rev.summary.excludedInternal : 0 },
    accounts: {
      total: customers.length,
      today: signupToday, d7: signup7, d30: signup30,
      series: [...signupSeries.entries()].map(([date, count]) => ({ date, count })),
      recent: recentCustomers.map((a) => ({ id: a.id, name: a.name, email: a.email, username: a.username, plan: a.effectivePlan, created_at: a.createdAt })),
    },
    plans: {
      free: plans.free, pro: plans.pro, office: plans.office, officeMembers: plans.officeMembers,
      gift: plans.gift, apple: plans.apple,
      paid,
      conversion: customers.length ? Math.round((paid / customers.length) * 1000) / 10 : 0,
      estMrr: rev.available ? rev.summary.mrrCents / 100 : 0,
      compedPaidPlans: plans.byHand,
    },
    acquisition,
    cards: {
      total: customerCards.length,
      offline: offlineCards,
      perAccount: customers.length ? Math.round((customerCards.length / customers.length) * 10) / 10 : 0,
    },
    leads: {
      total: leadTotal, locked: lockedTotal, today: leadsToday, d7: leads7,
      series: [...leadSeries.entries()].map(([date, count]) => ({ date, count })),
      bySource: Object.entries(bySource).sort((a, b) => b[1] - a[1]),
      perAccount: customers.length ? Math.round((leadTotal / customers.length) * 10) / 10 : 0,
    },
    views: { total: viewTotal, linkTotal: linkViewTotal, d7: views7.card + views7.links, cardViews30: views30.card, linkViews30: views30.links },
    engagement: { activatedCards, activationRate: customerCards.length ? Math.round((activatedCards / customerCards.length) * 1000) / 10 : 0 },
    topCards,
  });
}

type Admin = ReturnType<typeof getAdminSupabase>;

/** Visits to the marketing website (site_pageviews sessions), without our own. */
async function websiteVisits(admin: Admin, since30: Date, since7: Date): Promise<{ d30: number; d7: number }> {
  try {
    const rows = await paged<{ session_id: string | null; created_at: string }>(
      (from, to) => admin.from("site_pageviews").select("session_id, created_at").eq("is_internal", false)
        .gte("created_at", since30.toISOString()).order("created_at").order("id").range(from, to),
      2_000_000, "admin website visits");
    const s30 = new Set<string>(), s7 = new Set<string>();
    rows.forEach((r, i) => {
      const k = r.session_id ?? `row:${i}`;
      s30.add(k);
      if (Date.parse(r.created_at) >= since7.getTime()) s7.add(k);
    });
    return { d30: s30.size, d7: s7.size };
  } catch {
    return { d30: 0, d7: 0 };
  }
}

type NumberCheck = { label: string; shown: number; recount: number; ok: boolean; how: string };

/** Count rows with `col` in `values`, 150 values at a time (a URL has a length limit). */
async function countIn(admin: Admin, table: string, col: string, values: string[], opts: { notDemo?: boolean } = {}): Promise<number> {
  let n = 0;
  for (let i = 0; i < values.length; i += 150) {
    const base = admin.from(table).select("*", { count: "exact", head: true }).in(col, values.slice(i, i + 150));
    const { count } = await (opts.notDemo ? base.not("tags", "cs", "{demo}") : base);
    n += count ?? 0;
  }
  return n;
}

async function checkNumbers(admin: Admin, v: {
  accounts: number; cards: number; customerSlugs: string[]; customerKeys: string[];
  leads: number; views: number; signups30: number; signups30Direct: number;
}): Promise<NumberCheck[]> {
  const out: NumberCheck[] = [];
  const add = (label: string, shown: number, recount: number, how: string) => out.push({ label, shown, recount, ok: shown === recount, how });
  try {
    const [{ count: profiles }, { count: cards }] = await Promise.all([
      admin.from("profiles").select("*", { count: "exact", head: true }),
      admin.from("cards").select("*", { count: "exact", head: true }),
    ]);
    add("Every account was read", v.accounts, profiles ?? 0, "Accounts the admin read, against a plain count of every account.");
    add("Every card was read", v.cards, cards ?? 0, "Cards the admin read, against a plain count of every card.");
    const leads = await countIn(admin, "leads", "card_owner", v.customerSlugs, { notDemo: true });
    add("Customers' contacts", v.leads, leads, "The contacts total (database totals per customer), against a plain count of their contacts without the sample one.");
    const views = await countIn(admin, "card_views", "username", v.customerKeys);
    add("Customers' views", v.views, views, "Card + Swift Links views (database totals per customer), against a plain count of their view rows.");
    add("Signups in 30 days", v.signups30, v.signups30Direct, "The daily chart's 30 days added up, against the 30-day total.");
  } catch (e) {
    out.push({ label: "Number check", shown: 0, recount: 0, ok: false, how: `Couldn't recount: ${e instanceof Error ? e.message : "error"}` });
  }
  return out;
}

