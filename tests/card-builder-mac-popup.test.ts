import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs from the Mac agent
const { popupText } = await import("../scripts/card-builder-mac/popup.mjs");

describe("the Mac pop-up on a real open", () => {
  it("names them and their company, shows the number, and offers to call", () => {
    const p = popupText({ owner_name: "Dana Whitfield", office_name: "Harbor Realty", phone: "516-555-0101" });
    expect(p.title).toBe("Dana is looking at their card");
    expect(p.text).toContain("Dana Whitfield, Harbor Realty just opened the card you sent.");
    expect(p.text).toContain("(516) 555-0101");
    expect(p.callLabel).toBe("Call Dana");
    expect(p.tel).toBe("+15165550101");
  });
  it("with no number there is nothing to call", () => {
    const p = popupText({ owner_name: "Dana Whitfield", office_name: null, phone: null });
    expect(p.tel).toBeNull();
    expect(p.callLabel).toBe("OK");
  });
  it("shows only what the server alerted on, never the automated test's preview", () => {
    const src = readFileSync("scripts/card-builder-mac/agent.mjs", "utf8");
    expect(src).toMatch(/\.eq\("alerted", true\)/);
    expect(src).toMatch(/!p\.alert_user_id/);
    expect(src).toMatch(/\["popups", popups\]/);
  });
});
