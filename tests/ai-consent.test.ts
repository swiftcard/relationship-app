import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AiConsentGate, { AiDraftTag } from "@/components/AiConsentGate";
import { aiConsentCopy, aiConsentAllows, aiConsentPermits, readAiConsent, aiConsentAskAllowedOn, aiConsentAskReady } from "@/lib/ai-consent";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// Item 11 — AI consent notice + "AI draft" tag. Native-only; invisible on web.

describe("(a) consent modal never renders on web", () => {
  const copy = aiConsentCopy("Google");
  it.each(["unset", "accepted", "declined"] as const)(
    "renders nothing on web (%s)",
    (consent) => {
      expect(
        renderToStaticMarkup(h(AiConsentGate, { consent, provider: "Google", copy })),
      ).toBe("");
    },
  );
  it("renders nothing when no AI provider is configured", () => {
    expect(
      renderToStaticMarkup(h(AiConsentGate, { consent: "unset" as const, provider: null, copy })),
    ).toBe("");
  });
});

describe("(b) AI draft tag never renders on web", () => {
  it("renders nothing on web", () => {
    expect(renderToStaticMarkup(h(AiDraftTag))).toBe("");
  });
});

// App Review REJECTED the copy this block used to pin, under Guidelines
// 5.1.1(i) and 5.1.2(i): it never named the recipient, never itemised what is
// sent, and its only button was "Got it" — an acknowledgement, not permission.
// What gets pinned now is the three things Apple actually asked for.
describe("(c) the AI notice discloses, names, and asks", () => {
  const src = read("src/components/AiConsentGate.tsx");
  const lib = read("src/lib/ai-consent.ts");
  const copy = aiConsentCopy("Google");

  it("names the recipient, and takes the name from the live provider", () => {
    expect(copy.who).toContain("Google");
    // Hardcoding a name would be the same bug one release later — swap a key
    // and the disclosure silently becomes false.
    expect(lib).toMatch(/\$\{provider\}/);
    expect(read("src/lib/ai.ts")).toMatch(/export function aiProviderName/);
  });

  it("itemises what is sent, including the third party's card photo", () => {
    const what = copy.what.join(" | ").toLowerCase();
    expect(what).toMatch(/business card/);
    expect(what).toMatch(/notes/);
    expect(what).toMatch(/assistant/);
  });

  it("offers a real choice, not just an acknowledgement", () => {
    expect(src).toContain("Allow");
    expect(src).toMatch(/Don&apos;t allow|Don't allow/);
    expect(src, "the rejected version's single-button pattern").not.toMatch(/>\s*Got it\s*</);
    expect(src).toMatch(/choose\("declined"\)/);
  });

  it("promises nothing about model training that we cannot verify", () => {
    expect(copy.who).not.toMatch(/train/i);
  });

  it("carries no upsell/pricing (compliance notice, not a selling surface)", () => {
    expect(copy.who + copy.control + copy.what.join(" ")).not.toMatch(/upgrade|pricing|\$\d|Pro plan/i);
    expect(src).not.toMatch(/\$\d|Upgrade to Pro/);
  });
});

describe("declining actually stops the data leaving", () => {
  it("a declined account is refused, an unset one is not (WEB semantics)", () => {
    expect(aiConsentAllows({ _aiConsent: "declined" })).toBe(false);
    expect(aiConsentAllows({ _aiConsent: "accepted" })).toBe(true);
    expect(aiConsentAllows({})).toBe(true);
    // The legacy flag was written by the pre-rejection "Got it" notice, which
    // App Review ruled insufficient — it must NOT count as a decision.
    expect(readAiConsent({ _aiConsentAccepted: true })).toBe("unset");
  });

  it("in the app, consent is OPT-IN: unset blocks until the dialog is answered", () => {
    // The rule App Review wrote three times: obtain permission BEFORE sending.
    // "Block only an explicit decline" left every pre-dialog path leaking —
    // that shape must never come back.
    expect(aiConsentPermits("unset", true)).toBe(false);
    expect(aiConsentPermits("accepted", true)).toBe(true);
    expect(aiConsentPermits("declined", true)).toBe(false);
    // Web: never prompted, nothing refused — unset proceeds, declined holds.
    expect(aiConsentPermits("unset", false)).toBe(true);
    expect(aiConsentPermits("declined", false)).toBe(false);
  });

  it.each([
    ["src/app/api/scanner/route.ts", "request"],
    ["src/app/api/ai/suggest-messages/route.ts", "req"],
    ["src/app/api/leads/[id]/generate-sequence/route.ts", "req"],
    ["src/app/api/scan-design/route.ts", "request"],
    ["src/app/api/design-transfer/route.ts", "request"],
  ])("%s guards with the platform-aware block (passes the request)", (route, param) => {
    // The request argument is what makes the guard platform-aware — a call
    // without it can't apply the stricter in-app rule.
    expect(read(route)).toContain(`aiConsentBlock(user.id, ${param})`);
  });

  it("the in-app assistant degrades instead of erroring", () => {
    // It answers from the local corpus with no AI call, so 403-ing there would
    // break a help widget over a preference.
    expect(read("src/app/api/ai/help/route.ts")).toContain("aiConsentAllowsFor(user.id, req)");
  });

  it("the server tells shell requests apart by headers, not by trusting the client", () => {
    // Client-side native detection failing is exactly the state that leaked
    // before (the SFSafariViewController login sheet, 3.1.1); the consent rule
    // must key on what the server can see on every fetch.
    const lib = read("src/lib/shell-request.ts");
    expect(lib).toContain("SwiftCardApp");
    expect(lib).toContain("sc_shell");
    expect(read("src/lib/ai-consent-server.ts")).toContain("isShellRequest(req)");
  });

  it("the unauthenticated sales assistant never calls the model for shell requests", () => {
    // No account → no stored consent → the app may not send the message.
    expect(read("src/app/api/ai/sales/route.ts")).toMatch(/hasAiProvider\(\) && !isShellRequest\(req\)/);
  });
});

describe("the ask is global, not per-page", () => {
  it("the root layout mounts GlobalAiConsent", () => {
    // Mounted per-page it covered 2 of the 6+ surfaces AI is reachable from;
    // the dialog must exist wherever the signed-in app starts.
    expect(read("src/app/layout.tsx")).toContain("<GlobalAiConsent />");
  });

  it("Settings carries the standing switch the 403 message points at", () => {
    expect(read("src/app/settings/flows/page.tsx")).toContain("<AiConsentSetting />");
    expect(read("src/components/AiConsentSetting.tsx")).toMatch(/role="switch"/);
  });
});

// Owner, 2026-09-18: creating an account in the app (Get Started: build a card
// → create the account → choose a plan) showed the AI dialog between the
// account and the plan step. It is asked inside the app, once the card is live.
describe("the ask waits until Get Started is finished", () => {
  it.each([
    "/login", "/auth/callback", "/auth/reset-password", "/account-deleted",
    "/onboarding", "/cards/new", "/welcome", "/welcome/team",
    "/checkout", "/checkout/success", "/join/abc123", "/upgrade",
  ])("never opens on the setup step %s", (path) => {
    expect(aiConsentAskAllowedOn(path)).toBe(false);
  });

  it.each(["/dashboard", "/contacts", "/share", "/grow", "/settings/flows", "/cards/abc/edit", "/office/admin"])(
    "may open inside the app on %s",
    (path) => {
      expect(aiConsentAskAllowedOn(path)).toBe(true);
    },
  );

  it("a prefix only matches a whole path segment", () => {
    expect(aiConsentAskAllowedOn("/welcomed")).toBe(true);
    expect(aiConsentAskAllowedOn("/cards/newest")).toBe(true);
    expect(aiConsentAskAllowedOn(null)).toBe(false);
  });

  it("the account must have a card AND be past the plan step", () => {
    expect(aiConsentAskReady({ hasCard: false, awaitingPlan: false })).toBe(false); // no card yet
    expect(aiConsentAskReady({ hasCard: true, awaitingPlan: true })).toBe(false); // card saved, plan not chosen
    expect(aiConsentAskReady({ hasCard: true, awaitingPlan: false })).toBe(true); // the card is live
  });

  it("the API answers `ready` from the same plan-step test that keeps the card dark", () => {
    // The claim hops through /dashboard?claim=1 and /cards/[id]/edit?claim=1 —
    // ordinary app paths — so the account half is what covers them.
    const route = read("src/app/api/account/ai-consent/route.ts");
    expect(route).toContain("awaitingPlanChoice(profile)");
    expect(route).toMatch(/aiConsentAskReady\(/);
    expect(route).toMatch(/\bready,/);
  });

  it("GlobalAiConsent holds the dialog on both halves, and re-reads a not-ready answer", () => {
    const src = read("src/components/GlobalAiConsent.tsx");
    expect(src).toMatch(/const hold = state\.ready === false \|\| !aiConsentAskAllowedOn\(pathname, currentSearch\(\)\)/);
    expect(src).toContain("hold={hold}");
    // Without the re-read the ask would wait for the next cold launch.
    expect(src).toMatch(/state\.ready !== false\) return;/);
    expect(read("src/components/AiConsentGate.tsx")).toMatch(/const open = [^;]*&& !hold;/);
  });

  it("waiting to ASK never loosens the block: unset still sends nothing from the app", () => {
    expect(aiConsentPermits("unset", true)).toBe(false);
  });
});

describe("persistence uses the _-prefixed customization flag convention", () => {
  const route = read("src/app/api/account/ai-consent/route.ts");
  it("stores the decision, merged and additive, keeping the legacy flag in sync", () => {
    expect(route).toMatch(/_aiConsent: decision/);
    expect(route).toMatch(/_aiConsentAccepted: decision === "accepted"/);
    expect(route).toMatch(/\.\.\.customization/);
  });
});

describe("the AI draft tag is wired at the AI-generated message render sites", () => {
  // The LeadCard assertion that used to sit here was removed with the component
  // itself: LeadCard had no importers left (ContactsClient replaced it), so it
  // was asserting about markup nobody could render. ContactsClient below is the
  // live render site and carries the same tag.
  it("ContactsClient shows <AiDraftTag/> in the generated sequence preview", () => {
    expect(read("src/components/ContactsClient.tsx")).toContain("<AiDraftTag />");
  });
});
