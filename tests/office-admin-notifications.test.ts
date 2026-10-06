import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  teamPushContext, teamPushTag, teamPushThread, whoList, noFollowUpCopy, noCardCopy, firstNameOf,
} from "@/lib/team-alerts";
import { officeNotificationPath, LEADS_NO_FOLLOW_UP_PATH } from "@/lib/office-notification-links";
import { buildApnsAlert } from "@/lib/apns";
import { isTeamRecapBellHour } from "@/lib/weekly-recap";
import { proEndedNotice, officeEndedNotice } from "@/lib/billing-state";

// ── The Office admin's two kinds of notification (2026-09-23 review) ────────
// Owner: an admin gets their own card's notifications AND their team's, and
// "especially in push notifications where there's no bell to tell them apart"
// they must be able to tell which is which; team news must be grouped, say who
// it is about, open the right page, and never be spammy.

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const SELLS = /\bpro\b|upgrade|subscrib|price|\$|per month|billing/i;

describe("a team push says it is the team's", () => {
  it("carries 'Team · <office>' as its own line", () => {
    expect(teamPushContext("Harbor Realty")).toBe("Team · Harbor Realty");
    expect(teamPushContext("  ")).toBe("Team");
    const lib = code("src/lib/team-alerts.ts");
    expect(lib).toContain("context,\n        thread: teamPushThread(officeId),");
  });

  it("the line reaches the iPhone as the subtitle, in the team's own group", () => {
    const { body } = buildApnsAlert({
      title: "First lead for Mia 🎉", subtitle: "Team · Harbor Realty", body: "Mia's card just captured its first lead.",
      url: "https://swiftcard.me/office/admin/leads", tag: "team-member_first_lead-u1", thread: teamPushThread("o1"),
    }, "me.swiftcard.app");
    const aps = JSON.parse(body).aps;
    expect(aps.alert.subtitle).toBe("Team · Harbor Realty");
    expect(aps["thread-id"]).toBe("team-o1");
  });

  it("push.ts puts it on the subtitle (iOS) and the body's first line (browser); a card tag still wins", () => {
    const push = code("src/lib/push.ts");
    expect(push).toContain("const line = cardLine ?? (payload.context?.trim() || null);");
    expect(push).toContain("...(line ? { subtitle: line } : {})");
    expect(push).toContain("const webPayload = line ? { ...payload, body: `${line}\\n${payload.body}` } : payload;");
  });

  it("the team's Monday recap is labelled too, and does not share the personal recap's collapse id", () => {
    const route = code("src/app/api/push/recap/route.ts");
    expect(route).toContain('tag: "weekly-recap-team",\n          context: teamPushContext(team.name), thread: teamPushThread(team.officeId),');
  });
});

describe("one push never silently replaces another", () => {
  it("each person's and each milestone's news has its own collapse id", () => {
    expect(teamPushTag("member_joined", { userId: "a" })).not.toBe(teamPushTag("member_joined", { userId: "b" }));
    expect(teamPushTag("member_first_lead", { userId: "a" })).toBe("team-member_first_lead-a");
    expect(teamPushTag("team_milestone", { kind: "views", n: 250 })).toBe("team-team_milestone-views-250");
    expect(teamPushTag("members_no_card", { userIds: ["a"] })).toBe("team-members_no_card");
    expect(teamPushTag("member_joined", { userId: "x".repeat(80) }).length).toBeLessThanOrEqual(64);
  });
});

describe("every team notification opens the page it is about", () => {
  it("bell row and push share one map", () => {
    expect(officeNotificationPath("member_joined")).toBe("/office/admin");
    expect(officeNotificationPath("members_no_card")).toBe("/office/admin");
    expect(officeNotificationPath("invite_declined")).toBe("/office/admin");
    expect(officeNotificationPath("member_first_lead")).toBe("/office/admin/leads");
    expect(officeNotificationPath("leads_waiting")).toBe(LEADS_NO_FOLLOW_UP_PATH);
    expect(officeNotificationPath("team_milestone")).toBe("/office/admin/analytics");
    expect(officeNotificationPath("team_weekly_recap")).toBe("/office/admin/analytics");
    expect(officeNotificationPath("something_new")).toBe("/office/admin");
    expect(code("src/lib/team-alerts.ts")).toContain("alert.push!.path ?? officeNotificationPath(alert.type)");
  });

  it("the admin bell's rows are links that mark themselves read, with titles that wrap", () => {
    const bell = code("src/components/office/OfficeNotificationBell.tsx");
    expect(bell).toContain("href={officeNotificationPath(n.type)}");
    expect(bell).toContain("onClick={() => openRow(n)}");
    expect(bell).toContain("keepalive: true");
    expect(bell).not.toContain('className="text-white text-xs font-semibold truncate"');
  });

  it("the Leads page opens filtered to the leads the notice counted", () => {
    expect(LEADS_NO_FOLLOW_UP_PATH).toBe("/office/admin/leads?followUp=none");
    expect(code("src/app/office/admin/leads/page.tsx")).toContain("initialFollowUp={initialFollowUp}");
    expect(code("src/app/office/admin/leads/LeadsTable.tsx")).toContain('useState<"all" | FollowUpState>(initialFollowUp ?? "all")');
  });
});

describe("grouped news says who", () => {
  it("names people, most first, three at most", () => {
    expect(whoList([{ name: "Sam", n: 1 }, { name: "Mia", n: 2 }])).toBe("Mia (2) and Sam (1)");
    expect(whoList([{ name: "A", n: 1 }, { name: "B", n: 4 }, { name: "C", n: 2 }, { name: "D", n: 1 }, { name: "E", n: 1 }]))
      .toBe("B (4), C (2), A (1) and 2 others");
    expect(whoList([{ name: "Mia" }])).toBe("Mia");
    expect(firstNameOf("Mia Member")).toBe("Mia");
    expect(firstNameOf("", "A teammate")).toBe("A teammate");
  });

  it("leads with no follow-up: one notice for the team, naming whose they are", () => {
    const c = noFollowUpCopy([{ name: "Mia", n: 2 }, { name: "Sam", n: 1 }]);
    expect(c.title).toBe("3 team leads have no follow-up yet");
    expect(c.body).toContain("Mia (2) and Sam (1)");
    expect(c.pushBody).toBe("Waiting on: Mia (2) and Sam (1).");
    expect(noFollowUpCopy([{ name: "Mia", n: 1 }]).title).toBe("1 team lead has no follow-up yet");
  });

  it("teammates with no card", () => {
    expect(noCardCopy(["Mia"]).title).toBe("Mia hasn't made a card yet");
    expect(noCardCopy(["Mia", "Sam"]).title).toBe("2 teammates haven't made a card yet");
    expect(noCardCopy(["Mia", "Sam"]).body).toContain("Mia and Sam joined your team");
  });

  it("none of it sells", () => {
    const all = [
      noFollowUpCopy([{ name: "Mia", n: 2 }]), noCardCopy(["Mia", "Sam"]),
    ].flatMap((c) => Object.values(c)).join(" ");
    expect(all).not.toMatch(SELLS);
  });
});

describe("the daily team check", () => {
  const route = code("src/app/api/push/recap/route.ts");

  it("'waiting' means no follow-up set up — not a status nothing can change any more", () => {
    expect(route).not.toContain("WORKED_STATUS_VALUES");
    expect(route).toContain('followUpState(l.follow_up_sequence as FollowUpStep[] | null, l.tags as string[] | null) === "none"');
    expect(route).toContain("meta: { leadIds: stuck.map((l) => l.id as string) },");
  });

  it("teammates with no card: two days in, once per person, one grouped row", () => {
    expect(route).toContain("joined <= now - 2 * DAY && joined >= now - 30 * DAY");
    expect(route).toContain('.eq("type", "members_no_card")');
    expect(route).toContain("meta: { userIds: noCard.map((m) => m.user_id as string) },");
  });

  it("the team's week reaches the admin bell even when no admin has a phone registered", () => {
    expect(route).toContain("if (team.memberIds.length && isTeamRecapBellHour(now, ownerTz)) {");
    expect(isTeamRecapBellHour(Date.parse("2026-09-21T13:15:00Z"), "America/New_York")).toBe(true);  // Mon 9:15
    expect(isTeamRecapBellHour(Date.parse("2026-09-22T13:15:00Z"), "America/New_York")).toBe(false); // Tue
    // Due all Monday from 9am (2026-10-05: the scheduler runs a few times a
    // day, so a 9–10am slot was usually missed); one row per office per week.
    expect(isTeamRecapBellHour(Date.parse("2026-09-21T16:00:00Z"), "America/New_York")).toBe(true);  // Mon noon
    expect(isTeamRecapBellHour(Date.parse("2026-09-21T12:00:00Z"), "America/New_York")).toBe(false); // Mon 8am
  });

  it("an office whose only people are still invited is checked too (its first expired invite)", () => {
    expect(route).toMatch(/\.from\("office_members"\)\.select\("office_id"\)\s*\.eq\("status", "pending"\)/);
    // …and only while the owner is still on Office: pending-only offices are
    // exactly where a lapsed owner hides (2026-10-02 audit).
    expect(route).toContain("const toCheck = await liveTeams(admin, candidates);");
  });

  it("an invitee who declines is named", () => {
    const decline = code("src/app/api/office/decline/route.ts");
    expect(decline).toContain("declined your invitation`,");
    expect(decline).not.toContain('title: "An invitation was declined"');
  });
});

describe("an Office owner is never told about Pro", () => {
  it("cancelling Office: an Office notice, with the team in it and nothing that sells", () => {
    expect(proEndedNotice(false, "enterprise").title).toBe("Your Office plan has ended");
    expect(proEndedNotice(true, "enterprise").title).toBe("Your Office trial has ended");
    expect(proEndedNotice(false, "pro").title).toBe("Your Pro plan has ended");
    const office = officeEndedNotice(false);
    expect(office.body).toContain("teammates keep their first card");
    expect(`${office.title} ${office.body}`).not.toMatch(SELLS);
    const hook = code("src/app/api/stripe/webhook/route.ts");
    expect(hook).toContain('.select("id, plan, customization")\n      .eq("stripe_subscription_id", sub.id)');
    expect(hook).toContain("proEndedNotice(wasTrial, profile.plan as string | null)");
  });

  it("a granted Office running out: not 'your free month has ended … until you upgrade'", () => {
    const r = code("src/app/api/reminders/route.ts");
    expect(r).toContain("? officeEndedNotice(u.wasTrial)");
  });
});
