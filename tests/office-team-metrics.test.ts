import { describe, it, expect } from "vitest";
import {
  computeActivation,
  computeSetupProgress,
  memberStatus,
  deltaPct,
  ACTIVE_WINDOW_MS,
} from "@/lib/office-team";
import { computeAttention } from "@/lib/office-attention";
import { leadStatusView, isLeadStatusValue } from "@/lib/office-leads";
import type { TeamPerson, TeamInvite } from "@/lib/office-team";
import type { SeatUsage } from "@/lib/office-seats";

const now = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("computeActivation — invited people who actually got a card up", () => {
  it("is null with nobody invited (0/0 is not 0%)", () => {
    expect(computeActivation({ activatedMembers: 0, invitedTotal: 0 }).pct).toBeNull();
  });

  it("reports the real fraction", () => {
    expect(computeActivation({ activatedMembers: 2, invitedTotal: 4 })).toEqual({ activated: 2, invited: 4, pct: 50 });
    expect(computeActivation({ activatedMembers: 3, invitedTotal: 3 }).pct).toBe(100);
  });

  it("nobody activated yet is a real 0%, not a null", () => {
    expect(computeActivation({ activatedMembers: 0, invitedTotal: 3 }).pct).toBe(0);
  });
});

describe("deltaPct — no month-over-month claim on a thin baseline", () => {
  it("suppresses the arrow when last month is too small to conclude from", () => {
    expect(deltaPct(2, 1)).toBeNull();  // "+100%" off one event is noise
    expect(deltaPct(10, 0)).toBeNull(); // growth from nothing is undefined
    expect(deltaPct(4, 4)).toBeNull();
  });

  it("reports once there's a real baseline", () => {
    expect(deltaPct(10, 5)).toBe(100);
    expect(deltaPct(5, 10)).toBe(-50);
    expect(deltaPct(10, 10)).toBe(0);
  });
});

describe("memberStatus — the six states an owner sees", () => {
  const base = { liveCards: 1, totalCards: 1, now };

  it("no card at all → card not completed", () => {
    expect(memberStatus({ ...base, liveCards: 0, totalCards: 0, lastActiveAt: null })).toBe("card_incomplete");
  });

  it("has cards but all switched off → card deactivated", () => {
    expect(memberStatus({ ...base, liveCards: 0, totalCards: 2, lastActiveAt: null })).toBe("card_deactivated");
  });

  it("live card with recent activity → active", () => {
    expect(memberStatus({ ...base, lastActiveAt: new Date(now - 2 * DAY).toISOString() })).toBe("active");
  });

  it("live card gone quiet → not using it yet", () => {
    expect(memberStatus({ ...base, lastActiveAt: new Date(now - (ACTIVE_WINDOW_MS + DAY)).toISOString() })).toBe("idle");
    expect(memberStatus({ ...base, lastActiveAt: null })).toBe("idle");
  });
});

describe("computeSetupProgress — three steps, derived from durable facts", () => {
  it("counts completion out of three", () => {
    const none = computeSetupProgress({ hasBrand: false, memberRowCount: 0, liveEmployeeCards: 0 });
    expect(none).toMatchObject({ completed: 0, total: 3, allDone: false });

    const two = computeSetupProgress({ hasBrand: true, memberRowCount: 1, liveEmployeeCards: 0 });
    expect(two).toMatchObject({ completed: 2, total: 3, allDone: false });

    const all = computeSetupProgress({ hasBrand: true, memberRowCount: 1, liveEmployeeCards: 1 });
    expect(all).toMatchObject({ completed: 3, allDone: true });
  });

  it("a live employee card is its own step, separate from inviting", () => {
    const p = computeSetupProgress({ hasBrand: false, memberRowCount: 2, liveEmployeeCards: 0 });
    expect(p.invitedDone).toBe(true);
    expect(p.cardLiveDone).toBe(false);
  });
});

// ── Needs attention ──────────────────────────────────────────────────────────

const seats = (over: Partial<SeatUsage> = {}): SeatUsage => ({
  purchased: 3, ownerSeats: 1, active: 2, pending: 0, used: 3, available: 0, ...over,
});

const person = (over: Partial<TeamPerson> = {}): TeamPerson => ({
  kind: "member", userId: "u1", name: "Dana Lee", username: "dana", isOwner: false,
  cards: 1, views: 10, leads: 1, memberRowId: "m1", title: null, email: null, photoUrl: null,
  lastActiveAt: new Date(now).toISOString(), liveCards: 1, totalCards: 1, status: "active",
  ...over,
});

const caps = { canManageSeats: true, canInvite: true };

describe("computeAttention — only real, actionable items", () => {
  it("a healthy office shows nothing at all", () => {
    const items = computeAttention({
      people: [person({ isOwner: true, userId: "owner" }), person()],
      invites: [], seats: seats(), uncontactedLeads: 0, ...caps,
    });
    expect(items).toEqual([]);
  });

  it("surfaces waiting leads first — they cost the most", () => {
    const items = computeAttention({ people: [], invites: [], seats: seats(), uncontactedLeads: 3, ...caps });
    expect(items[0].kind).toBe("lead_uncontacted");
    expect(items[0].title).toContain("3 new leads");
  });

  it("flags a paid-for empty seat", () => {
    const items = computeAttention({
      people: [], invites: [], seats: seats({ used: 2, available: 1 }), uncontactedLeads: 0, ...caps,
    });
    expect(items.map((i) => i.kind)).toContain("empty_seat");
  });

  it("a full, healthy office stays silent — being full is not a to-do", () => {
    const items = computeAttention({
      people: [person({ isOwner: true, userId: "owner" }), person()],
      invites: [], seats: seats({ used: 3, available: 0 }), uncontactedLeads: 0, ...caps,
    });
    expect(items).toEqual([]);
  });

  it("flags an expired invitation with a resend action", () => {
    const inv: TeamInvite = {
      kind: "invite", memberRowId: "m9", email: "dana@co.com",
      inviteToken: "t", sentAt: null, status: "invite_expired",
    };
    const items = computeAttention({ people: [], invites: [inv], seats: seats(), uncontactedLeads: 0, ...caps });
    const hit = items.find((i) => i.kind === "invite_expired");
    expect(hit?.actionLabel).toBe("Resend invite");
    expect(hit?.targetId).toBe("m9");
  });

  it("flags an unfinished card, and never flags the owner", () => {
    const items = computeAttention({
      people: [person({ status: "card_incomplete", totalCards: 0, liveCards: 0 }),
               person({ userId: "owner", isOwner: true, status: "card_incomplete", totalCards: 0, liveCards: 0 })],
      invites: [], seats: seats(), uncontactedLeads: 0, ...caps,
    });
    expect(items.filter((i) => i.kind === "card_incomplete")).toHaveLength(1);
  });

  it("says nothing about seats to someone who can't buy or invite", () => {
    const items = computeAttention({
      people: [], invites: [], seats: seats({ used: 1, available: 2 }), uncontactedLeads: 0,
      canManageSeats: false, canInvite: false,
    });
    expect(items.map((i) => i.kind)).not.toContain("empty_seat");
  });
});

describe("lead statuses — four owner-facing labels over the stored values", () => {
  it("maps every stored value, including the new one", () => {
    expect(leadStatusView("new_contact")).toEqual({ label: "New", worked: false });
    expect(leadStatusView("touch")).toEqual({ label: "Contacted", worked: true });
    expect(leadStatusView("dissolved")).toEqual({ label: "Closed", worked: true });
    expect(leadStatusView("not_interested")).toEqual({ label: "Not interested", worked: true });
  });

  it("only accepts values the personal contacts UI can also render", () => {
    expect(isLeadStatusValue("not_interested")).toBe(true);
    expect(isLeadStatusValue("touch")).toBe(true);
    expect(isLeadStatusValue("hot")).toBe(false);
    expect(isLeadStatusValue(null)).toBe(false);
  });
});
