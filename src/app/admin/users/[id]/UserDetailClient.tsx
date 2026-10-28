"use client";

// Everything about ONE user: who they are, how they found us, how they pay,
// every card with per-card stats + live links, 30-day activity, the contacts
// they captured, referral tools — and, for an account that was closed (or
// nearly was), why, in the person's own words. Tabs: Summary · Cards ·
// Contacts · Plan & billing · Referrals.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { getSignupSourceLabel, getSourceLabel } from "@/lib/source-labels";
import Link from "next/link";
import { adminErrorText, grantMonthWarning, planChangeWarning, takeOfflineWarning } from "@/lib/admin-confirm";
import { isPaidPlan } from "@/lib/plan";
import { KpiCard, KpiGrid, Section, Stack } from "../../_ui/layout";
import { TabButtons } from "../../_ui/TabButtons";
import { BackLink } from "../../_ui/links";
import { TrendBars } from "../../_ui/charts";
import { EmptyState, ErrorState, PageSkeleton } from "../../_ui/states";
import { Avatar, BillingBadge, ClosedBadge, FreeMonthBadge, PlanBadge, StatusBadge, type Billing } from "../../_ui/badges";
import { Icon } from "../../_ui/icons";
import { daysUntil, fmtDate, fmtLongDate, fmtNum, planName } from "../../_ui/format";

type Leaving = {
  closed: boolean;
  closed_at: string | null;
  purge_at: string | null;
  plan_at_close: string | null;
  reason_text: string | null;
  comment: string | null;
  surveys: { at: string; plan: string | null; reason_text: string; comment: string | null }[];
  saved_by_text: string | null;
  saved_at: string | null;
};

type Detail = {
  user: {
    id: string; username: string; name: string | null; email: string | null; plan: string;
    plan_expires_at: string | null; created_at: string; company: string | null; title: string | null;
    phone: string | null; website: string | null; photo_url: string | null;
    signup_source: string; referral_code: string | null;
    referred_by: { id: string; name: string | null; email: string | null } | null;
    referral_reward_earned: boolean; deleted: boolean;
    billing?: Billing;
    billingState?: { source: Billing; trialEndsAt: string | null; pastDue: boolean; cancelling: boolean; everPaid: boolean };
    kind?: "customer" | "internal" | "test";
    office_role?: "owner" | "member" | null;
    effective_plan?: string;
    apple?: boolean;
  };
  leaving?: Leaving | null;
  /** The live Stripe subscription (null: none; {error}: Stripe didn't return it). */
  subscription?: Subscription | { error: string } | null;
  cards: { id: string; username: string; label: string | null; name: string | null; title: string | null; company: string | null; template: string | null; created_at: string; leads: number; cardViews: number; linkViews: number; is_offline?: boolean }[];
  profileCard: { username: string; leads: number; cardViews: number; linkViews: number } | null;
  totals: { leads: number; views: number; leads30: number; views30: number; referred: number; referralMonthsClaimed?: number; referralMonthsClaimable?: number; swiftlinkViews?: number; lockedLeads?: number; contactsSaved?: number };
  series: { date: string; views: number; leads: number }[];
  recentLeads: { id: string; name: string | null; email: string | null; phone: string | null; source: string | null; card_owner: string; created_at: string; locked?: boolean }[];
};

type Subscription = {
  status: string; plan: "pro" | "office" | null; interval: "monthly" | "annual"; unitCents: number; quantity: number; monthlyCents: number;
  discount: { percentOff: number | null; amountOff: number | null; duration: string; end: number | null } | null;
  trialEnd: string | null; periodEnd: string | null; cancelAtPeriodEnd: boolean; created: string; livemode: boolean;
};

const STATUS_TEXT: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  active: { label: "Active", tone: "good" },
  trialing: { label: "Free trial", tone: "warn" },
  past_due: { label: "Payment failed — retrying", tone: "bad" },
  unpaid: { label: "Unpaid", tone: "bad" },
  canceled: { label: "Cancelled", tone: "neutral" },
  incomplete: { label: "Checkout not finished", tone: "warn" },
  incomplete_expired: { label: "Checkout expired", tone: "neutral" },
  paused: { label: "Paused", tone: "neutral" },
};

type Tab = "summary" | "cards" | "contacts" | "plan" | "referrals";
const TABS: Tab[] = ["summary", "cards", "contacts", "plan", "referrals"];

export default function UserDetailClient({ userId, initialTab }: { userId: string; initialTab?: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [codeMsg, setCodeMsg] = useState("");
  const [actionError, setActionError] = useState("");
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "summary");
  const loaded = useRef(false);

  const load = useCallback(async () => {
    // A thrown fetch left "Loading…" up forever (audit F-ADMIN-05). After an
    // action the page already shows the user, so a failed refresh keeps it
    // and says so instead of replacing it with an error.
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (!res.ok) { setError(res.status === 404 ? "User not found" : "Failed to load user"); return; }
      const d = await res.json();
      loaded.current = true;
      setData(d);
      setCodeInput(d.user.referral_code ?? "");
    } catch {
      if (loaded.current) setActionError("Couldn't refresh — what's shown may be out of date. Reload the page.");
      else setError("Couldn't reach the server. Reload the page to try again.");
    }
  }, [userId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time data fetch on mount
  useEffect(() => { load(); }, [load]);

  function selectTab(key: string) {
    const next = key as Tab;
    setTab(next);
    try { window.history.replaceState(null, "", next === "summary" ? `/admin/users/${userId}` : `/admin/users/${userId}?tab=${next}`); } catch { /* ignore */ }
  }

  // Every refusal is shown now, not only the referral code's (audit
  // F-ADMIN-02): a 409 or 502 on a plan change used to vanish.
  async function patch(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setCodeMsg("");
    setActionError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (body.referralCode !== undefined) {
        setCodeMsg(res.ok ? "Saved ✓" : await adminErrorText(res));
      } else if (!res.ok) {
        setActionError(await adminErrorText(res));
      }
    } catch {
      setActionError("Couldn't reach the server. Nothing was changed.");
    } finally {
      setBusy("");
    }
    load();
  }

  if (error) return (
    <Stack>
      <BackLink href="/admin/users">Users</BackLink>
      <ErrorState message={error} />
    </Stack>
  );
  if (!data) return <PageSkeleton kpis={4} />;

  const { user, cards, profileCard, totals, series, recentLeads, leaving } = data;
  const who = user.email || user.name || user.username || "this user";
  // The slug whose public pages actually exist: a real card first, then the
  // legacy profile-slug card. Null → this account has no public page yet.
  const primarySlug = cards[0]?.username ?? profileCard?.username ?? null;
  const allCards = [
    ...cards.map((c) => ({ key: c.id, username: c.username, label: c.label || c.name || c.username, template: c.template ?? "classic-pro", leads: c.leads, cardViews: c.cardViews, linkViews: c.linkViews, offline: c.is_offline === true, moderatable: true })),
    ...(profileCard ? [{ key: "profile", username: profileCard.username, label: `${user.name || user.username} (primary)`, template: "primary", leads: profileCard.leads, cardViews: profileCard.cardViews, linkViews: profileCard.linkViews, offline: false, moderatable: false }] : []),
  ];
  const planNow = user.effective_plan ?? user.plan;
  const paidPlan = isPaidPlan(planNow);

  return (
    <Stack>
      <BackLink href={user.deleted ? "/admin/users?tab=closed" : "/admin/users"}>{user.deleted ? "Closed accounts" : "Users"}</BackLink>

      {/* Who they are */}
      <section className="adm-card p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <Avatar name={user.name || user.email} photo={user.photo_url} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="sc-t-title2 break-words">{user.name || user.email || user.username}</h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <PlanBadge plan={user.plan} />
              {user.plan_expires_at && <FreeMonthBadge until={user.plan_expires_at} />}
              {user.deleted && <ClosedBadge />}
              {paidPlan && user.billing && <BillingBadge billing={user.billing} />}
              {user.kind && user.kind !== "customer" && <StatusBadge tone="neutral">{user.kind === "test" ? "QA test account" : "Ours — not counted"}</StatusBadge>}
              {user.office_role === "owner" && <StatusBadge tone="neutral">Office owner</StatusBadge>}
            </div>
            <p className="sc-t-subhead adm-muted mt-2 break-words">
              {[user.email, user.company, user.title].filter(Boolean).join(" · ")}
            </p>
            <p className="sc-t-footnote adm-muted mt-1">
              Joined {fmtLongDate(user.created_at)}
              {" · "}found us via <span style={{ color: "var(--sc-label)" }}>{getSignupSourceLabel(user.signup_source)}</span>
              {user.referred_by && (
                <>
                  {" · referred by "}
                  <Link href={`/admin/users/${user.referred_by.id}`} className="adm-link">
                    {user.referred_by.name || user.referred_by.email || "another user"}
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {primarySlug ? (
              <>
                <a href={`/${primarySlug}`} target="_blank" rel="noopener noreferrer" className="sc-btn sc-btn-gray sc-btn-sm">
                  View card <Icon name="external" className="w-4 h-4" />
                </a>
                <a href={`/links/${primarySlug}`} target="_blank" rel="noopener noreferrer" className="sc-btn sc-btn-gray sc-btn-sm">
                  Swift Links <Icon name="external" className="w-4 h-4" />
                </a>
              </>
            ) : (
              <span className="sc-t-footnote adm-muted">No public card yet</span>
            )}
          </div>
        </div>
      </section>

      {actionError && <p role="alert" className="adm-callout-danger px-4 py-3 sc-t-subhead">{actionError}</p>}

      {leaving && <LeavingCallout leaving={leaving} />}

      <TabButtons
        label="About this user"
        active={tab}
        onSelect={selectTab}
        items={[
          { key: "summary", label: "Summary" },
          { key: "cards", label: "Cards", count: allCards.length },
          { key: "contacts", label: "Contacts", count: totals.leads },
          { key: "plan", label: "Plan & billing" },
          { key: "referrals", label: "Referrals", count: totals.referred },
        ]}
      />

      {tab === "summary" && (
        <Stack>
          <KpiGrid cols={5}>
            <KpiCard label="Cards" value={fmtNum(allCards.length)} />
            <KpiCard label="Contacts captured" value={fmtNum(totals.leads)} sub={<>{fmtNum(totals.leads30)} in 30 days{totals.lockedLeads ? <> · <span className="adm-warn">{fmtNum(totals.lockedLeads)} locked</span></> : null}</>} />
            <KpiCard label="Card views" value={fmtNum(totals.views)} sub="All time" />
            <KpiCard label="Swift Links views" value={typeof totals.swiftlinkViews === "number" ? fmtNum(totals.swiftlinkViews) : "—"} sub="All time" />
            <KpiCard label="People they referred" value={fmtNum(totals.referred)} />
          </KpiGrid>
          <Section title="Last 30 days" hint={`${fmtNum(totals.views30)} views of their cards and Swift Links, with the ${fmtNum(totals.leads30)} contacts they captured on top. New York days.`}>
            <TrendBars
              mode="stack"
              data={series.map((s) => ({ date: s.date, values: [s.views, s.leads] }))}
              series={[{ label: "Views", color: "var(--adm-series-1)" }, { label: "Contacts", color: "var(--adm-series-2)" }]}
              caption="Views and contacts per day, last 30 days"
            />
          </Section>
          <Section
            title="Latest contacts"
            hint="The newest people who shared their details through this user's cards."
            action={recentLeads.length > 5 ? <button type="button" onClick={() => selectTab("contacts")} className="adm-link sc-t-footnote min-h-[28px]">See all ›</button> : undefined}
            flush
          >
            <ContactList leads={recentLeads.slice(0, 5)} />
          </Section>
        </Stack>
      )}

      {tab === "cards" && (
        <Section title={`Cards (${allCards.length})`} hint="Every card this account has, with its views and contacts. Taking a card offline hides it everywhere until you bring it back." flush>
          {allCards.length === 0 ? (
            <EmptyState className="pb-8">No cards yet.</EmptyState>
          ) : (
            <>
              <div aria-hidden className="hidden lg:grid adm-card-grid px-5 py-2.5 sc-t-footnote font-semibold adm-muted" style={{ boxShadow: "inset 0 -1px 0 var(--adm-grid)" }}>
                <span>Card</span><span>Template</span><span className="text-right">Card views</span><span className="text-right">Link views</span><span className="text-right">Contacts</span><span>Status</span><span />
              </div>
              <ul className="adm-divide">
                {allCards.map((c) => (
                  <li key={c.key} className="px-4 lg:px-5 py-3.5 lg:grid adm-card-grid lg:items-center gap-y-2">
                    <div className="min-w-0">
                      <p className="sc-t-subhead font-semibold truncate">{c.label}</p>
                      <p className="sc-t-caption adm-muted truncate">/{c.username}</p>
                    </div>
                    <span className="hidden lg:block sc-t-footnote adm-muted capitalize">{c.template.replace(/-/g, " ")}</span>
                    <p className="lg:hidden sc-t-footnote adm-muted mt-1 adm-num">
                      <span className="capitalize">{c.template.replace(/-/g, " ")}</span> · {fmtNum(c.cardViews)} card views · {fmtNum(c.linkViews)} link views · {fmtNum(c.leads)} contacts
                    </p>
                    <span className="hidden lg:block text-right sc-t-subhead adm-num">{fmtNum(c.cardViews)}</span>
                    <span className="hidden lg:block text-right sc-t-subhead adm-num">{fmtNum(c.linkViews)}</span>
                    <span className="hidden lg:block text-right sc-t-subhead font-semibold adm-num">{fmtNum(c.leads)}</span>
                    <span className="hidden lg:block">{c.offline ? <StatusBadge tone="warn">Offline</StatusBadge> : <StatusBadge tone="good">Live</StatusBadge>}</span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 lg:mt-0 lg:justify-end sc-t-footnote">
                      <span className="lg:hidden">{c.offline ? <StatusBadge tone="warn">Offline</StatusBadge> : <StatusBadge tone="good">Live</StatusBadge>}</span>
                      <a href={`/${c.username}`} target="_blank" rel="noopener noreferrer" className="adm-link">Card ↗</a>
                      <a href={`/links/${c.username}`} target="_blank" rel="noopener noreferrer" className="adm-link">Links ↗</a>
                      {/* Moderation kill-switch (App Review 1.2): reversible
                          takedown of everything this card serves publicly. */}
                      {c.moderatable && (
                        <button
                          type="button"
                          disabled={busy === `offline-${c.key}`}
                          onClick={() => {
                            if (!c.offline && !window.confirm(takeOfflineWarning(c.username))) return;
                            void patch({ cardOffline: { cardId: c.key, offline: !c.offline } }, `offline-${c.key}`);
                          }}
                          className={`sc-btn sc-btn-xs ${c.offline ? "sc-btn-tinted" : "sc-btn-destructive"}`}
                          style={c.offline ? undefined : { background: "rgba(255, 59, 48, 0.08)" }}
                        >
                          {busy === `offline-${c.key}` ? "…" : c.offline ? "Bring online" : "Take offline"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      {tab === "contacts" && (
        <Section title="Contacts captured" hint={`The latest ${Math.min(recentLeads.length, 12)} of ${fmtNum(totals.leads)}, and how each one arrived.`} flush>
          <ContactList leads={recentLeads} />
        </Section>
      )}

      {tab === "plan" && (
        <Section title="Plan & billing" hint="Setting a plan directly clears any free-month expiry.">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="sc-t-title2">{planName(planNow)}</p>
            {paidPlan && user.billing && <BillingBadge billing={user.billing} />}
            {user.plan_expires_at && <FreeMonthBadge until={user.plan_expires_at} />}
          </div>
          <p className="sc-t-footnote adm-muted mt-1">
            {user.plan_expires_at
              ? `A free month of Pro, ending ${fmtLongDate(user.plan_expires_at)}. It ends by itself.`
              : !paidPlan ? "On the free plan." : user.billing === "stripe" ? "Billed through Stripe — the live subscription is below." : user.billing === "apple" ? "Paying through Apple in the iPhone app (Apple keeps the billing; nothing to see in Stripe)." : user.billing === "office_member" ? "A member of an Office team — the team's owner pays for the seat." : "On a paid plan with no payment behind it (moved by hand)."}
          </p>
          {data.subscription && <SubscriptionPanel sub={data.subscription} />}
          <div className="adm-rule mt-4 pt-4">
            <p className="sc-t-footnote font-semibold mb-2.5">Change plan</p>
            <div className="flex flex-wrap items-center gap-2">
              {(["free", "pro", "enterprise"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    if (!window.confirm(planChangeWarning(who, user.plan || "free", p))) return;
                    void patch({ plan: p }, `plan-${p}`);
                  }}
                  disabled={busy !== "" || user.plan === p}
                  className={`sc-btn sc-btn-sm ${user.plan === p ? "sc-btn-filled" : "sc-btn-gray"}`}
                >
                  {busy === `plan-${p}` ? "…" : planName(p)}{user.plan === p ? " · current" : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="adm-rule mt-4 pt-4">
            <p className="sc-t-footnote font-semibold mb-2.5">Give them Pro for free</p>
            <button
              onClick={() => {
                if (!window.confirm(grantMonthWarning(who))) return;
                void patch({ grantFreeMonth: true }, "grant");
              }}
              disabled={busy !== ""}
              className="sc-btn sc-btn-tinted sc-btn-sm"
            >
              <Icon name="gift" className="w-4 h-4" />
              {busy === "grant" ? "…" : "Grant 1 month of Pro"}
            </button>
            <p className="sc-t-caption adm-muted mt-2">Nothing is charged, and it ends by itself when the month is up.</p>
          </div>
        </Section>
      )}

      {tab === "referrals" && (
        <Stack>
          <KpiGrid cols={3}>
            <KpiCard label="Successful signups" value={fmtNum(totals.referred)} sub="People who joined through their link" />
            <KpiCard label="Months claimed" value={`${totals.referralMonthsClaimed ?? 0}/3`} />
            <KpiCard label="Ready to claim" value={fmtNum(totals.referralMonthsClaimable ?? 0)} tone={(totals.referralMonthsClaimable ?? 0) > 0 ? "good" : undefined} />
          </KpiGrid>
          <Section title="Their referral link" hint={user.referral_code ? <>swiftcard.me/r/<span className="font-mono">{user.referral_code}</span></> : "No code yet."}>
            <p className="sc-field-label">Custom code</p>
            <div className="flex items-center gap-2">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="CUSTOM-CODE"
                aria-label="Custom referral code"
                className="sc-field flex-1 min-w-0 px-3.5 font-mono"
              />
              <button
                onClick={() => patch({ referralCode: codeInput }, "code")}
                disabled={busy !== "" || !codeInput.trim()}
                className="sc-btn sc-btn-filled sc-btn-sm shrink-0"
              >
                {busy === "code" ? "…" : "Set code"}
              </button>
            </div>
            {codeMsg && <p role="status" className={`sc-t-footnote mt-2 ${codeMsg.includes("✓") ? "adm-good" : "adm-bad"}`}>{codeMsg}</p>}
            <p className="sc-t-caption adm-muted mt-3">Set a memorable code (e.g. a partner or influencer promo) — anyone signing up through /r/CODE gets the free month and attributes to this user.</p>
          </Section>
        </Stack>
      )}
    </Stack>
  );
}

function ContactList({ leads }: { leads: Detail["recentLeads"] }) {
  if (leads.length === 0) return <EmptyState className="pb-6">None yet.</EmptyState>;
  return (
    <ul className="adm-divide">
      {leads.map((l) => (
        <li key={l.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
          <Avatar name={l.name || l.email || l.phone} size={32} />
          <div className="min-w-0 flex-1">
            <p className="sc-t-subhead font-medium truncate">{l.name || l.email || l.phone || "—"}</p>
            <p className="sc-t-caption adm-muted truncate">via {getSourceLabel(l.source)} · /{l.card_owner}{l.locked ? <> · <span className="adm-warn">locked (over the Free limit)</span></> : null}</p>
          </div>
          <span className="sc-t-caption adm-muted shrink-0 adm-num">{fmtDate(l.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Why they closed their account (red), or that they nearly did (orange). */
function LeavingCallout({ leaving }: { leaving: Leaving }) {
  const left = daysUntil(leaving.purge_at);
  // The answer shown above is the latest; the rest came before it.
  const earlier = leaving.surveys.slice(0, -1);
  return (
    <section className={`${leaving.closed ? "adm-callout-danger" : "adm-callout-warn"} p-4 sm:p-5`}>
      <div className="flex items-start gap-3">
        <span className={leaving.closed ? "adm-bad" : "adm-warn"}><Icon name={leaving.closed ? "userMinus" : "alert"} /></span>
        <div className="min-w-0 flex-1">
          {leaving.closed ? (
            <p className="sc-t-headline">
              Closed their account on {fmtLongDate(leaving.closed_at)}
              {left !== null && <span className="sc-t-subhead font-normal adm-muted"> · {left === 0 ? "permanently deleted today" : `permanently deleted in ${left} ${left === 1 ? "day" : "days"}`}</span>}
            </p>
          ) : (
            <p className="sc-t-headline">Started to leave{leaving.saved_by_text ? " — and stayed" : ""}</p>
          )}

          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr] sc-t-subhead">
            {leaving.closed && leaving.plan_at_close && (<><dt className="adm-muted">Had plan</dt><dd>{planName(leaving.plan_at_close)}</dd></>)}
            {leaving.reason_text && (<><dt className="adm-muted">Why</dt><dd className="font-medium">{leaving.reason_text}</dd></>)}
            {leaving.saved_by_text && (<><dt className="adm-muted">What kept them</dt><dd>{leaving.saved_by_text}{leaving.saved_at ? ` (${fmtDate(leaving.saved_at)})` : ""}</dd></>)}
          </dl>

          {leaving.comment && (
            <figure className="mt-3">
              <figcaption className="sc-t-caption adm-muted mb-1">In their words</figcaption>
              <blockquote className="adm-card px-4 py-3 sc-t-body whitespace-pre-wrap break-words">“{leaving.comment}”</blockquote>
            </figure>
          )}

          {earlier.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer sc-t-footnote font-medium adm-link inline-flex min-h-[28px] items-center">
                {earlier.length === 1 ? "1 earlier answer" : `${earlier.length} earlier answers`}
              </summary>
              <ul className="mt-2 space-y-2">
                {earlier.map((s, i) => (
                  <li key={i} className="adm-card px-3.5 py-2.5">
                    <p className="sc-t-caption adm-muted">{fmtDate(s.at)} · on {planName(s.plan)}</p>
                    <p className="sc-t-subhead font-medium">{s.reason_text}</p>
                    {s.comment && <p className="sc-t-subhead mt-0.5 whitespace-pre-wrap break-words">“{s.comment}”</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}

/** The live subscription from Stripe: what they pay, when, and what's next. */
function SubscriptionPanel({ sub }: { sub: Subscription | { error: string } }) {
  if ("error" in sub) {
    return <p className="adm-callout-warn px-4 py-3 sc-t-subhead mt-4">{sub.error}</p>;
  }
  const st = STATUS_TEXT[sub.status] ?? { label: sub.status, tone: "neutral" as const };
  const price = `${fmtMoneyCents(sub.unitCents)}${sub.quantity > 1 ? ` × ${sub.quantity} seats` : ""} / ${sub.interval === "annual" ? "year" : "month"}`;
  const discount = sub.discount
    ? `${sub.discount.percentOff ? `${sub.discount.percentOff}% off` : sub.discount.amountOff ? `${fmtMoneyCents(sub.discount.amountOff)} off` : "Discount"} (${sub.discount.duration === "forever" ? "forever" : sub.discount.duration === "once" ? "first payment only" : sub.discount.end ? `until ${fmtLongDate(new Date(sub.discount.end * 1000).toISOString())}` : "for a while"})`
    : null;
  const rows: [string, React.ReactNode][] = [
    ["Status", <StatusBadge key="s" tone={st.tone}>{st.label}</StatusBadge>],
    ["Plan", `${sub.plan === "office" ? "Office" : "Pro"} · ${price}`],
    ["Brings in", `${fmtMoneyCents(sub.monthlyCents)} a month${sub.status === "trialing" ? " once the trial ends" : ""}`],
  ];
  if (discount) rows.push(["Discount", discount]);
  if (sub.trialEnd && sub.status === "trialing") rows.push(["Trial ends", fmtLongDate(sub.trialEnd)]);
  if (sub.periodEnd) rows.push([sub.cancelAtPeriodEnd ? "Ends on" : sub.status === "trialing" ? "First charge" : "Next charge", fmtLongDate(sub.periodEnd)]);
  rows.push(["Started", fmtLongDate(sub.created)]);
  if (!sub.livemode) rows.push(["Mode", "Stripe TEST mode — not real money"]);
  return (
    <div className="adm-inset mt-4 p-4">
      <p className="sc-t-footnote font-semibold mb-2.5">Live from Stripe</p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr] sc-t-subhead">
        {rows.map(([k, v]) => (<Fragment key={k}><dt className="adm-muted">{k}</dt><dd>{v}</dd></Fragment>))}
      </dl>
      {sub.cancelAtPeriodEnd && <p className="adm-bad sc-t-footnote mt-3">They&apos;ve cancelled: it ends at the date above and won&apos;t renew.</p>}
    </div>
  );
}

function fmtMoneyCents(c: number): string {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
