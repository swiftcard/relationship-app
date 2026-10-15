// ── Every call to a CRM's API goes through crmFetch ──────────────────────────
//
// Before this, not one native CRM call had a timeout (audit 2026-10-12, I-01).
// A provider that accepted the connection and then never answered held the
// after() tail open until the platform killed it at maxDuration — silently,
// with the lead never sent and nothing recorded anywhere. Google makes three
// sequential calls per contact and Pipedrive up to five, so one slow provider
// was enough.
//
// Three rules, in one place so no provider can forget one:
//
//   1. Every attempt is bounded (CRM_CALL_TIMEOUT_MS), and the whole sync for
//      one contact shares a deadline (CrmBudget), so a provider that is merely
//      slow on every call still finishes — or gives up — well inside the
//      route's 60 seconds.
//   2. A 429 or a 5xx is retried a couple of times, honouring Retry-After. That
//      is a CRM having a bad few seconds, and the same request a moment later
//      is the right answer. Nothing else is retried: a 400 is our data, a
//      401/403 is the connection, and repeating either changes nothing.
//   3. What still fails is returned (or thrown, for no answer at all) to the
//      caller, which decides between "tell the user" and "queue it for the
//      daily catch-up" (lib/crm-outbox).

/** One attempt at one CRM call. A CRM that hasn't answered in this long isn't going to. */
export const CRM_CALL_TIMEOUT_MS = 8000;

/** The whole sync of one contact to one CRM — every lookup, write and note. */
export const CRM_SYNC_BUDGET_MS = 40_000;

/**
 * Pauses between attempts. Mutable so tests can run the retry paths without
 * real sleeps; production never touches it.
 */
export const crmRetry = { delaysMs: [1000, 3000] as number[] };

export type CrmBudget = { deadline: number };

export function newCrmBudget(ms: number = CRM_SYNC_BUDGET_MS): CrmBudget {
  return { deadline: Date.now() + ms };
}

/** The CRM never answered (timeout, DNS, connection reset) — after any retries. */
export class CrmNoAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmNoAnswerError";
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Statuses worth trying again later: the CRM was busy or down, not refusing us. */
export function isRetryableStatus(status: number | null | undefined): boolean {
  return status === null || status === undefined || RETRYABLE_STATUS.has(status);
}

function retryAfterMs(res: Response): number | null {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * fetch, bounded and retried for a CRM. Returns the final Response — which may
 * still be a 429/5xx when retries ran out; check `res.ok` as usual. Throws
 * CrmNoAnswerError only when no response ever arrived.
 */
export async function crmFetch(url: string, init: RequestInit = {}, budget?: CrmBudget): Promise<Response> {
  const deadline = budget?.deadline ?? Date.now() + CRM_SYNC_BUDGET_MS;
  const delays = crmRetry.delaysMs;
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 250) throw new CrmNoAnswerError("out of time for this contact");
    const lastAttempt = attempt >= delays.length;
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(CRM_CALL_TIMEOUT_MS, remaining)) });
      if (!RETRYABLE_STATUS.has(res.status) || lastAttempt) return res;
      // Retry-After can ask for minutes. Waiting that long here would only burn
      // the budget, so a long ask is answered by the outbox instead.
      const wait = retryAfterMs(res) ?? delays[attempt];
      if (wait > 5000 || Date.now() + wait > deadline - 1000) return res;
      await res.body?.cancel().catch(() => {});
      await sleep(wait);
    } catch (e) {
      if (lastAttempt || Date.now() + delays[attempt] > deadline - 1000) {
        throw new CrmNoAnswerError(e instanceof Error ? e.message : String(e));
      }
      await sleep(delays[attempt]);
    }
  }
}

/**
 * The CRM's own explanation of a refusal, short enough for a Settings line.
 * Every provider wraps it differently — HubSpot `message`, Salesforce
 * `[{ message }]`, Pipedrive `error`, Google `error.message` — so this looks
 * in each place and otherwise falls back to the raw text.
 */
export async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as unknown;
    const pick = (v: unknown): string | null => {
      if (!v) return null;
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return pick(v[0]);
      if (typeof v === "object") {
        const o = v as Record<string, unknown>;
        return pick(o.message) ?? pick(o.error_description) ?? pick(o.error) ?? pick(o.errors) ?? null;
      }
      return null;
    };
    const found = pick(j);
    if (found) return found.slice(0, 300);
  } catch { /* not JSON */ }
  return text.slice(0, 300);
}
