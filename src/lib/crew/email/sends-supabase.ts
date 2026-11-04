import { getAdminSupabase } from "@/lib/supabase-admin";
import { LIVE, type ClaimResult, type EmailSend, type EmailSendStore, type NewSend, type SendStatus } from "./sends";

// ── crew_email_sends, through the service role ─────────────────────────────
// Server-only (imports the service-role client). The unique keys in
// supabase/crew-email.sql do the locking: insert wins once per draft, and a
// retry is a conditional update that only matches a retryable status, so two
// taps (or two tabs) can never both reach Gmail.

const UNIQUE = "23505";

export class SupabaseEmailSends implements EmailSendStore {
  private db = getAdminSupabase();

  async ready() {
    const { error } = await this.db.from("crew_email_sends").select("id").limit(1);
    return !error;
  }

  async get(approvalId: string) {
    const { data, error } = await this.db.from("crew_email_sends").select("*").eq("approval_id", approvalId).maybeSingle();
    if (error) throw new Error(`email sends: ${error.message}`);
    return (data as EmailSend | null) ?? null;
  }

  async claim(n: NewSend, from: SendStatus[]): Promise<ClaimResult> {
    const now = new Date().toISOString();
    const ins = await this.db
      .from("crew_email_sends")
      .insert({ ...n, attempts: n.status === "sending" ? 1 : 0, created_at: now, updated_at: now })
      .select("*")
      .single();
    if (!ins.error) return { ok: true, row: ins.data as EmailSend };
    if (ins.error.code !== UNIQUE) throw new Error(`email sends: ${ins.error.message}`);
    if (/one_per_address/.test(ins.error.message)) return { ok: false, reason: "address_taken" };

    const existing = await this.get(n.approval_id);
    if (!existing || !from.includes(existing.status)) return { ok: false, reason: "taken", row: existing };
    const upd = await this.db
      .from("crew_email_sends")
      .update({ ...n, attempts: existing.attempts + (n.status === "sending" ? 1 : 0), error: null, updated_at: now })
      .eq("approval_id", n.approval_id)
      .in("status", from)
      .select("*");
    if (upd.error) {
      if (upd.error.code === UNIQUE) return { ok: false, reason: "address_taken" };
      throw new Error(`email sends: ${upd.error.message}`);
    }
    const row = (upd.data ?? [])[0] as EmailSend | undefined;
    return row ? { ok: true, row } : { ok: false, reason: "taken", row: await this.get(n.approval_id) };
  }

  async patch(id: string, p: Partial<EmailSend>) {
    const { error } = await this.db.from("crew_email_sends").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(`email sends: ${error.message}`);
  }

  async transition(id: string, seen: Pick<EmailSend, "status" | "updated_at">, p: Partial<EmailSend>) {
    const { data, error } = await this.db
      .from("crew_email_sends")
      .update({ ...p, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", seen.status)
      .eq("updated_at", seen.updated_at)
      .select("id");
    if (error) throw new Error(`email sends: ${error.message}`);
    return (data ?? []).length === 1;
  }

  async liveForAddress(to: string) {
    const { data } = await this.db.from("crew_email_sends").select("*").eq("to_email", to.trim().toLowerCase()).in("status", LIVE);
    return (data ?? []) as EmailSend[];
  }

  async countSince(sinceIso: string, domain?: string) {
    let q = this.db.from("crew_email_sends").select("id", { count: "exact", head: true }).in("status", LIVE).or(`sent_at.gte.${sinceIso},and(sent_at.is.null,updated_at.gte.${sinceIso})`);
    if (domain) q = q.ilike("to_email", `%@${domain.replace(/[%_]/g, "")}`);
    const { count, error } = await q;
    if (error) throw new Error(`email sends: ${error.message}`);
    return count ?? 0;
  }

  async list(limit: number) {
    const { data } = await this.db.from("crew_email_sends").select("*").order("updated_at", { ascending: false }).limit(limit);
    return (data ?? []) as EmailSend[];
  }

  async awaitingReply(sinceIso: string, checkedBefore: string, limit: number) {
    const { data } = await this.db
      .from("crew_email_sends")
      .select("*")
      .eq("status", "sent")
      .is("reply_state", null)
      .gte("sent_at", sinceIso)
      .or(`last_checked_at.is.null,last_checked_at.lt.${checkedBefore}`)
      .order("sent_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as EmailSend[];
  }
}
