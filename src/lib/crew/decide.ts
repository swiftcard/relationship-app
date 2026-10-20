import { DISCLOSE_KINDS, TEXT_KINDS } from "./approvals";
import { applyDisclosure } from "./disclosure";
import { executeApproval, EXECUTED_KINDS } from "./execute";
import type { CrewStore } from "./store";
import type { Approval, Platform, TouchKind } from "./types";
import { stripEmDashes } from "./voice";

// ── What the owner's buttons do ─────────────────────────────────────────────
// The only importer of ./execute (tests/crew-approval-gate pins that), so the
// only path from an agent's draft to the outside world is a person pressing
// Approve. Drafts we post ourselves (replies, DMs, comments) are just marked
// approved (a reply counts as contact from then on); "I posted it" turns a
// DM's claim into a recorded contact.

export type Decision =
  | { action: "approve"; body?: string; choice?: string; by: string }
  | { action: "reject"; reason: string; by: string }
  | { action: "posted"; by: string }
  | { action: "edit"; body: string; by: string };

const POSTED_TOUCH: Partial<Record<Approval["kind"], TouchKind>> = {
  reply: "replied",
  comment: "commented",
  dm: "dm_sent",
  connect_note: "connect_sent",
};

export async function decide(store: CrewStore, id: string, d: Decision, now = new Date()): Promise<{ ok: boolean; message: string }> {
  const a = await store.getApproval(id);
  if (!a) return { ok: false, message: "Not found." };
  const settings = await store.getSettings();
  const clean = (b: string) => {
    const d = DISCLOSE_KINDS.includes(a.kind) ? applyDisclosure(b, { on: settings.disclosure_on, disclosure: settings.disclosure }) : b;
    return TEXT_KINDS.includes(a.kind) ? stripEmDashes(d) : d;
  };

  if (d.action === "edit") {
    if (a.status !== "pending") return { ok: false, message: "Only waiting items can be edited." };
    await store.updateApproval(id, { body: clean(d.body) });
    return { ok: true, message: "Saved." };
  }

  if (d.action === "reject") {
    if (a.status !== "pending" && a.status !== "approved") return { ok: false, message: "Already decided." };
    await store.updateApproval(id, { status: "rejected", reject_reason: d.reason.slice(0, 200), decided_at: now.toISOString() });
    await store.releaseDmClaim(id);
    return { ok: true, message: "Rejected. The agent will learn from it." };
  }

  if (d.action === "approve") {
    if (a.status !== "pending") return { ok: false, message: "Already decided." };
    const body = d.body !== undefined ? clean(d.body) : a.body;
    await store.updateApproval(id, { status: "approved", body, decided_at: now.toISOString(), ...(d.choice ? { meta: { ...a.meta, choice: d.choice.slice(0, 20) } } : {}) });
    if (EXECUTED_KINDS.includes(a.kind)) {
      const r = await executeApproval(store, { ...a, body, status: "approved" });
      await store.updateApproval(id, r.ok ? { status: "done", done_at: now.toISOString(), meta: { ...a.meta, result: r.result } } : { meta: { ...a.meta, error: r.message } });
      return { ok: r.ok, message: r.message };
    }
    // A reply counts as contact from the moment it is approved, so no DM can be
    // drafted to that person while the reply waits to be posted.
    if ((a.kind === "reply" || a.kind === "comment") && a.person_id) {
      await store.addTouch(a.person_id, (a.platform ?? "web") as Platform, POSTED_TOUCH[a.kind]!, id);
    }
    return { ok: true, message: "Approved. Post it, then tap “I posted it”." };
  }

  // posted
  if (a.status !== "approved") return { ok: false, message: "Approve it first." };
  await store.updateApproval(id, { status: "done", done_at: now.toISOString() });
  if ((a.kind === "dm" || a.kind === "connect_note") && a.person_id) {
    // The draft's claim (dm_drafted) becomes the real contact.
    await store.releaseDmClaim(id);
    await store.addTouch(a.person_id, (a.platform ?? "web") as Platform, POSTED_TOUCH[a.kind]!, id);
  }
  return { ok: true, message: "Logged. Nobody will contact this person again." };
}
