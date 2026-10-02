import { getAdminSupabase } from "@/lib/supabase-admin";
import { from as senderAddress, INBOX_ADDRESS } from "@/lib/email-senders";
import { htmlToText } from "@/lib/email-text";
import { escapeHtml } from "@/lib/escape";

// ── Someone tried to leave. Tell the owner. ──────────────────────────────────
//
// The save sequence was recording everything into customization._retention and
// telling NOBODY. A churn signal that only exists in a JSON blob is a churn
// signal nobody acts on: the whole point of asking "what would make it worth
// it?" is that a human reads the answer while the person is still reachable.
//
// Two moments are worth an alert, and only two:
//   saved   — an offer was taken. This is a win, and the reason they nearly
//             left is the most valuable sentence the business receives.
//   deleted — they went through with it. Last chance to reach out, and the
//             reason tells us whether it was price, a bug, or a missing thing.
//
// The survey step itself is deliberately NOT alerted: someone who picks a
// reason and then takes the free month never actually left, and mailing on
// step 2 of 6 would cry wolf on every abandoned dialog.
//
// Internal mail: FROM support@, TO hello@ — never hello@ to itself.
// Best-effort throughout. A failed alert must never block a save or a deletion:
// losing the notification is bad, blocking a customer's deletion is worse (and
// App Review 5.1.1(v) requires deletion to complete).

export type RetentionOutcome = "grant" | "discount" | "downgrade" | "quiet" | "extend" | "deleted";

const LABEL: Record<RetentionOutcome, string> = {
  grant: "SAVED — took 30 free days of Pro",
  discount: "SAVED — took 50% off for 3 months",
  downgrade: "SAVED — switched to Free instead of deleting",
  quiet: "SAVED — turned off emails, kept the account",
  extend: "SAVED — stretched their Pro trial to a full month",
  deleted: "LOST — account deleted",
};

export async function alertRetention(opts: {
  userId: string;
  email: string | null;
  plan: string | null;
  outcome: RetentionOutcome;
  reason?: string | null;
  comment?: string | null;
}): Promise<void> {
  try {
    const won = opts.outcome !== "deleted";
    const headline = LABEL[opts.outcome];
    const subject = `${won ? "✅" : "🔴"} ${headline} — ${opts.email ?? opts.userId.slice(0, 8)}`;

    const row = (k: string, v: string) =>
      `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;width:110px;">${escapeHtml(k)}</td>` +
      `<td style="padding:6px 0;font-size:13px;color:#0f172a;">${escapeHtml(v)}</td></tr>`;

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background-color:#ffffff;max-width:560px;margin:0 auto;padding:28px 16px;">
  <p style="font-size:11px;font-weight:700;letter-spacing:.2em;color:#6b7280;text-transform:uppercase;margin:0 0 18px;">SwiftCard — Retention</p>
  <h2 style="font-size:20px;font-weight:700;color:${won ? "#065f46" : "#991b1b"};margin:0 0 18px;">${escapeHtml(headline)}</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
    ${row("Account", opts.email ?? opts.userId)}
    ${row("Plan", opts.plan ?? "free")}
    ${row("Reason", opts.reason || "(not given)")}
  </table>
  ${opts.comment
    ? `<div style="background:#F0EBE1;border:1px solid #E4DDD4;border-radius:12px;padding:16px 20px;">
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.7;white-space:pre-wrap;">${escapeHtml(opts.comment)}</p>
  </div>`
    : ""}
  <p style="font-size:12px;color:#9ca3af;margin-top:22px;">${won
    ? "They stayed. Worth a personal note while the reason is fresh."
    : "They are gone. The account is held for 30 days before purge — /account/reopen can still bring it back."}</p>
</div>`;

    const key = process.env.RESEND_API_KEY;
    if (key) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: senderAddress("support", "SwiftCard Retention"),
          to: [INBOX_ADDRESS],
          subject,
          html,
          text: htmlToText(html),
        }),
      });
    }
  } catch {
    /* never block a save or a deletion on a notification */
  }
}

/**
 * The churn funnel, read straight off the profiles the sequence writes to.
 *
 * There is no separate events table on purpose: customization._retention and
 * customization._deletion already hold every answer, and a second store would
 * be one more thing to keep in step with them.
 */
export type RetentionRow = {
  userId: string;
  email: string | null;
  plan: string | null;
  reason: string | null;
  comment: string | null;
  at: string | null;
  outcome: "saved" | "deleted" | "open";
  savedBy: string | null;
  deleted: boolean;
};

export async function retentionFunnel(limit = 200): Promise<{
  rows: RetentionRow[];
  totals: { attempts: number; saved: number; deleted: number; open: number; saveRate: number };
  byReason: { reason: string; attempts: number; saved: number }[];
}> {
  const admin = getAdminSupabase();
  const { data } = await admin
    .from("profiles")
    .select("id, email, plan, customization")
    .limit(2000);

  const rows: RetentionRow[] = [];
  for (const p of data ?? []) {
    const cust = (p.customization as Record<string, unknown> | null) ?? {};
    const ret = (cust._retention as { surveys?: { reason: string; comment: string; plan: string; at: string }[]; savedBy?: string; savedAt?: string } | undefined) ?? {};
    const del = cust._deletion as { reason?: string; comment?: string; at?: string } | undefined;
    const survey = ret.surveys?.[ret.surveys.length - 1];
    // No survey and no deletion record → this account never opened the dialog.
    if (!survey && !del) continue;
    const deleted = !!del || cust._deleted === true;
    rows.push({
      userId: p.id as string,
      email: (p.email as string | null) ?? null,
      plan: (p.plan as string | null) ?? null,
      reason: survey?.reason ?? del?.reason ?? null,
      comment: survey?.comment || del?.comment || null,
      at: ret.savedAt ?? del?.at ?? survey?.at ?? null,
      outcome: deleted ? "deleted" : ret.savedBy ? "saved" : "open",
      savedBy: ret.savedBy ?? null,
      deleted,
    });
  }
  rows.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));

  const saved = rows.filter((r) => r.outcome === "saved").length;
  const deleted = rows.filter((r) => r.outcome === "deleted").length;
  const open = rows.filter((r) => r.outcome === "open").length;
  // Denominator is DECIDED attempts. Someone still mid-dialog has not chosen,
  // and counting them as a loss would make the rate look worse than it is.
  const decided = saved + deleted;

  const byReasonMap = new Map<string, { attempts: number; saved: number }>();
  for (const r of rows) {
    const k = r.reason || "(not given)";
    const e = byReasonMap.get(k) ?? { attempts: 0, saved: 0 };
    e.attempts++;
    if (r.outcome === "saved") e.saved++;
    byReasonMap.set(k, e);
  }

  return {
    rows: rows.slice(0, limit),
    totals: {
      attempts: rows.length,
      saved,
      deleted,
      open,
      saveRate: decided ? Math.round((saved / decided) * 100) : 0,
    },
    byReason: [...byReasonMap.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.attempts - a.attempts),
  };
}
