import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { senderAbout } from "@/lib/sender-about";

// The Swift Links bio is required everywhere it is written (owner, 2026-09-28),
// and the field tells people the AI follow-ups use it — so they must.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const EDITOR = "src/app/cards/[id]/edit/CardEditForm.tsx";
const WIZARD = "src/app/cards/new/NewCardWizard.tsx";
const MINI = "src/components/site/SwiftLinkMiniBuilder.tsx";
// One short line on every surface (owner, 2026-09-29: less to read).
const AI_COPY = "AI follow-ups use it too";

describe("senderAbout — what the AI is told the sender does", () => {
  it("leads with the card's Swift Links bio", () => {
    expect(senderAbout({ bio: "  Austin realtor  " }, { about: "" })).toBe("Austin realtor");
  });

  it("keeps the older About fields, once each", () => {
    expect(senderAbout({ bio: "Realtor", about: "Buyers' agent" }, { about: "Realtor" })).toBe("Realtor\nBuyers' agent");
    expect(senderAbout({}, { about: "Profile about" })).toBe("Profile about");
  });

  it("is empty — never 'undefined' — when nothing is written", () => {
    expect(senderAbout(null, undefined)).toBe("");
    expect(senderAbout({ bio: 42 as unknown as string }, { about: "   " })).toBe("");
  });

  it("both AI writers use it", () => {
    for (const f of ["src/app/api/leads/[id]/generate-sequence/route.ts", "src/app/api/ai/suggest-messages/route.ts"]) {
      const s = code(f);
      expect(s).toMatch(/import \{ senderAbout \} from "@\/lib\/sender-about"/);
      expect(s).toMatch(/const about = senderAbout\(/);
      expect(s).toMatch(/\.from\("cards"\)[\s\S]*?\.eq\("username", lead\.card_owner\)/);
    }
  });
});

describe("the bio field, everywhere it is written", () => {
  it("editor: asterisk, AI copy, and Save sends a missing bio to the Socials tab", () => {
    const s = code(EDITOR);
    // The heading is the textarea's label and carries the asterisk
    // (FormSection's required prop, pinned below).
    expect(s).toMatch(/title="Bio"\s+labelFor="card-bio"\s+required=\{!bioManaged\}/);
    expect(s).toContain(AI_COPY);
    expect(s).toMatch(/required=\{!bioManaged\}\s+aria-invalid/);
    const save = s.slice(s.indexOf("async function handleSave"), s.indexOf("setStatus(\"saving\")"));
    expect(save).toMatch(/if \(!bioManaged && !bio\.trim\(\)\) \{\s*setTab\("sharing"\)/);
  });

  it("FormSection draws the asterisk the Bio heading asks for", () => {
    expect(code("src/components/ui/FormSection.tsx")).toMatch(/required && <span className="text-red-400[^"]*" aria-hidden="true">\*<\/span>/);
  });

  it("wizard: asterisk, AI copy, and every way forward checks the bio", () => {
    const s = code(WIZARD);
    expect(s).toMatch(/title="Bio"\s+labelFor="wizard-bio"\s+required=\{!bioManaged\}/);
    expect(s).toContain(AI_COPY);
    expect(s).not.toMatch(/Swift Links page\. All optional\./);
    expect(s).toMatch(/const bioRequiredMissing = !bioManaged && !bio\.trim\(\);/);
    // Socials → Next
    expect(s).toMatch(/onClick=\{\(\) => \{ if \(requireBio\(\)\) setStep\(4\); \}\}/);
    // the final save button, before any sign-up gate
    expect(s).toMatch(/onClick=\{\(\) => \{\s*if \(!requireBio\(\)\) return;\s*if \(!guest\)/);
    // and a create from any plan gate
    const create = s.slice(s.indexOf("async function handleCreate"), s.indexOf("creatingRef.current = true"));
    expect(create).toMatch(/if \(!requireBio\(\)\) return;/);
  });

  it("homepage mini-builder: asterisk, AI copy, and Next waits for the bio", () => {
    const s = code(MINI);
    expect(s).toMatch(/canAdvance: sketch\.bio\.trim\(\)\.length > 0/);
    expect(s).toMatch(/label="Bio"[\s\S]{0,200}required[\s\S]{0,40}hint="[^"]*AI follow-ups use it too/);
    expect(code("src/components/site/BuilderFields.tsx")).toMatch(/props\.required && <span className="text-red-400/);
  });
});
