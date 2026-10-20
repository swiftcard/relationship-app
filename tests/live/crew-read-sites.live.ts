// Manual check, not in CI (tests/live is excluded): can the lead agents read
// real business sites through lib/safe-fetch? Run with:
//   npx vitest run --config vitest.live.crew.ts
import { it, expect } from "vitest";
import { readSite, mailtos, textOf, phonesIn } from "@/lib/crew/leads/fetch-page";
it("reads real team sites", async () => {
  for (const u of ["https://sapirteam.com/", "https://nycexperienceteam.com/", "https://broadwayrealty.com/", "https://nikkifield.com/"]) {
    const pages = await readSite(u);
    const text = pages.map((p) => textOf(p.html)).join(" ");
    console.log(u, "pages:", pages.length, "chars:", text.length, "mailto:", pages.flatMap((p) => mailtos(p.html)).slice(0, 2), "phones:", phonesIn(text).slice(0, 1));
  }
  expect(true).toBe(true);
}, 120_000);
