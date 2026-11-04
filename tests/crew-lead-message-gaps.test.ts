import { describe, expect, it } from "vitest";
import { leadsFromSite, messageOutcome } from "@/lib/crew/agents/leads";
import type { SiteAssessment } from "@/lib/crew/leads/assess";

// Every saved Web Lead says why it has, or hasn't, a written email, so a
// "Needs a message" row on the Sheet can be traced to its cause.

const PAGE = { url: "https://cleanco.example/", html: "<html><title>Clean Co</title><body>Clean Co, San Diego. Email hello@cleanco.example. Call (619) 555-0142.</body></html>" };
const base: SiteAssessment = { i: 0, people: [], fit: 30, why: "A cleaning company with staff.", hook: "", opener: "", talking_point: "" } as unknown as SiteAssessment;

describe("why a Web Lead has no message", () => {
  it("names each cause", () => {
    expect(messageOutcome(base, "Subject: hi\\n\\nHello")).toBe("message_written");
    expect(messageOutcome(undefined, null)).toBe("message_no_assessment");
    expect(messageOutcome(base, null)).toBe("message_left_empty");
    expect(messageOutcome({ ...base, opener: "Subject: hi\\n\\nHi Rosa, ..." }, null)).toBe("message_dropped_unverified_name");
  });
  it("matches what leadsFromSite actually saved", () => {
    const empty = leadsFromSite({ name: "Clean Co", website: PAGE.url }, [PAGE], "house cleaning services", base);
    expect(empty).toHaveLength(1);
    expect(messageOutcome(base, empty[0].message)).toBe("message_left_empty");
    // The model greeted someone the site never names: the email is dropped, and the stat says so.
    const invented = { ...base, people: [{ name: "Rosa Diaz", title: "Owner", email: "", phone: "" }], opener: "Subject: your team\n\nHi Rosa, saw Clean Co covers all of San Diego." } as unknown as SiteAssessment;
    const dropped = leadsFromSite({ name: "Clean Co", website: PAGE.url }, [PAGE], "house cleaning services", invented);
    expect(dropped[0].message).toBeNull();
    expect(messageOutcome(invented, dropped[0].message)).toBe("message_dropped_unverified_name");
  });
});
