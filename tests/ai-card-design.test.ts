import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AI_THEME_KEYS, COMPOSITIONS, buildDesign, compositionOf, contrast, enforceContrast, fallbackSpec,
  paletteFromColors, parseDesignSpec, designPrompt, type DesignContext, type DesignSpec, type Composition,
} from "@/lib/ai-card-design";
import { normalizeCustomLayout } from "@/lib/custom-layout";
import type { AiDesignBrief, CustomElement, CustomLayout } from "@/components/card-templates/types";

// ── AI design: the arithmetic that makes every design clean ──────────────────
// The model only picks taste from closed lists; this engine places everything.
// These tests hold the engine to what an owner would notice first: nothing off
// the card, nothing on top of anything else, the QR never covered, every line
// readable against what it sits on.

const W = 460;
const H = W / 1.75;

const perChar = (font: string | undefined) => {
  const f = (font ?? "").toLowerCase();
  if (f.includes("courier") || f.includes("mono")) return 0.61;
  if (f.includes("georgia") || f.includes("palatino") || (f.includes("serif") && !f.includes("sans"))) return 0.53;
  return 0.55;
};

type Box = { id: string; l: number; t: number; r: number; b: number };

/** The same size estimate the renderer fits with, as a box in design px. */
function box(el: CustomElement, ctx: DesignContext, layout: CustomLayout): Box | null {
  if (el.type === "shape" || el.type === "divider") return null;
  let w: number;
  let h: number;
  if (el.type === "logo" || el.type === "headshot" || el.type === "qr") {
    w = h = Math.max(el.type === "qr" ? 34 : 0, el.size ?? 50);
  } else {
    const value = (ctx as unknown as Record<string, string>)[el.field ?? ""] ?? el.text ?? "";
    const longest = value.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
    const fs = el.fontSize ?? 12;
    const pc = perChar(el.font ?? layout.fontFamily) * (el.upper ? 1.12 : 1) + (el.tracking ?? 0);
    w = longest * pc * fs + (el.icon ? fs * 1.6 : 0);
    h = fs * 1.2 * (el.field === "address" ? value.split("\n").length : 1);
  }
  const ax = (el.x / 100) * W;
  const l = el.align === "center" ? ax - w / 2 : el.align === "right" ? ax - w : ax;
  const t = (el.y / 100) * H;
  return { id: el.id, l, t, r: l + w, b: t + h };
}

const overlap = (a: Box, b: Box) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;

const PEOPLE: Record<string, DesignContext> = {
  typical: {
    name: "Dana Whitfield", title: "Insurance Advisor", company: "Beacon Mutual",
    phone: "(303) 555-0149", email: "dana@beaconmutual.com", website: "beaconmutual.com", address: "",
    hasPhoto: true, hasLogo: true,
  },
  long: {
    name: "Christopher Fairweather-Blenkinsop", title: "Senior Vice President of Commercial Lending",
    company: "Northwestern Mutual Financial Partners of Greater Philadelphia",
    phone: "(215) 555-0199 ext. 204", email: "christopher.fairweather-blenkinsop@northwesternmutualfinancial.com",
    website: "northwesternmutualfinancialpartners.com", address: "",
    hasPhoto: true, hasLogo: true,
  },
  sparse: {
    name: "Zoe", title: "", company: "", phone: "", email: "zoe@cuts.co", website: "", address: "",
    hasPhoto: false, hasLogo: false,
  },
};

const IMAGE_CHOICES: [boolean, boolean][] = [[false, false], [true, false], [false, true], [true, true]];

function brief(theme: string, headshot: boolean, logo: boolean, colors: string[] = [], variant = 0): AiDesignBrief {
  return { theme, colors, headshot, logo, variant };
}

describe("every composition, every person, every image choice: on the card and clear of each other", () => {
  for (const composition of COMPOSITIONS) {
    for (const [who, ctx] of Object.entries(PEOPLE)) {
      for (const [headshot, logo] of IMAGE_CHOICES) {
        it(`${composition} · ${who} · headshot=${headshot} logo=${logo}`, () => {
          const b = brief("modern", headshot, logo, ["#1e3a8a"]);
          const spec: DesignSpec = { ...fallbackSpec(b), composition };
          const layout = buildDesign(spec, ctx, b);
          const boxes = layout.elements.map((e) => box(e, ctx, layout)).filter((x): x is Box => !!x);
          for (const bx of boxes) {
            expect(bx.l, `${bx.id} left`).toBeGreaterThanOrEqual(-1);
            expect(bx.t, `${bx.id} top`).toBeGreaterThanOrEqual(-1);
            expect(bx.r, `${bx.id} right`).toBeLessThanOrEqual(W + 1);
            expect(bx.b, `${bx.id} bottom`).toBeLessThanOrEqual(H + 1);
          }
          for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
              expect(overlap(boxes[i], boxes[j]), `${boxes[i].id} overlaps ${boxes[j].id}`).toBe(false);
            }
          }
          // Only what was asked for AND exists.
          const ids = new Set(layout.elements.map((e) => e.id));
          expect(ids.has("photo")).toBe(headshot && ctx.hasPhoto);
          expect(ids.has("logo")).toBe(logo && ctx.hasLogo);
          expect(ids.has("qr")).toBe(true);
          // It survives the renderer's own validation unchanged in shape.
          const norm = normalizeCustomLayout(layout);
          expect(norm.elements.length).toBe(layout.elements.length);
          expect(norm.blocks).toBeUndefined();
        });
      }
    }
  }
});

describe("colour", () => {
  it("every palette the engine hands out is readable, whatever the model said", () => {
    const wild = enforceContrast({ background: "#ffffff", surface: "#fefefe", text: "#fafafa", onSurface: "#ffffff", accent: "#fffffe" });
    expect(contrast(wild.text, wild.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(wild.onSurface, wild.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(wild.accent, wild.background)).toBeGreaterThanOrEqual(2.4);
  });

  it("the owner's colours are the heart of it, for dark, bright and light picks", () => {
    for (const c of ["#0f172a", "#2563eb", "#dc2626", "#fafaf9", "#ca8a04"]) {
      for (const theme of AI_THEME_KEYS) {
        const pal = paletteFromColors([c], theme);
        expect([pal.background, pal.surface, pal.accent].some((x) => x.toLowerCase() === c) || pal.background !== "#0f172a").toBe(true);
        expect(contrast(pal.text, pal.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(pal.onSurface, pal.surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("the model's answer is never trusted as structure", () => {
  const b = brief("luxury", true, true, ["#0c0a09"], 2);

  it("anything off the closed lists falls back field by field", () => {
    const spec = parseDesignSpec({
      composition: "explode", palette: { background: "red;position:fixed", text: 7 }, display: "Comic Sans", body: "x",
      nameCase: "SHOUT", weight: 9000, titleStyle: "wavy", gradient: "yes",
    }, b, []);
    const fb = fallbackSpec(b);
    expect(spec.composition).toBe(fb.composition);
    expect(spec.display).toBe(fb.display);
    expect(spec.nameCase).toBe(fb.nameCase);
    expect(/^#[0-9a-f]{6}$/.test(spec.palette.background)).toBe(true);
  });

  it("a composition from the wrong theme, or the one just shown, is refused", () => {
    expect(parseDesignSpec({ composition: "bold-type" }, b, []).composition).not.toBe("bold-type");
    const avoid: Composition[] = ["frame"];
    expect(parseDesignSpec({ composition: "frame" }, b, avoid).composition).not.toBe("frame");
  });

  it("the prompt carries the SHAPE of the owner's details, never the details", () => {
    const prompt = designPrompt(b, PEOPLE.typical, []);
    for (const secret of ["Dana", "Whitfield", "555-0149", "beaconmutual", "Beacon"]) expect(prompt).not.toContain(secret);
    expect(prompt).toContain("Theme: luxury");
  });
});

describe("Try another", () => {
  it("each variant of a theme is a different design, and the composition is recoverable", () => {
    for (const theme of AI_THEME_KEYS) {
      const seen = new Set<string>();
      for (let v = 0; v < 3; v++) {
        const b = brief(theme, true, true, [], v);
        const layout = buildDesign(fallbackSpec(b), PEOPLE.typical, b);
        const comp = compositionOf(layout);
        expect(comp, theme).not.toBeNull();
        seen.add(`${comp}|${layout.background}|${layout.fontFamily}`);
      }
      expect(seen.size, theme).toBeGreaterThan(1);
    }
  });

  it("the brief rides along on the layout, validated", () => {
    const b = brief("tech", false, true, ["#0891b2"], 4);
    const norm = normalizeCustomLayout(buildDesign(fallbackSpec(b), PEOPLE.typical, b));
    expect(norm.ai).toEqual({ theme: "tech", colors: ["#0891b2"], headshot: false, logo: true, variant: 4 });
  });
});

describe("the route's doors: paid, or a first card — Copy stays paid", () => {
  const route = readFileSync(join(process.cwd(), "src/app/api/design-generate/route.ts"), "utf8");
  const designer = readFileSync(join(process.cwd(), "src/components/CustomCardDesigner.tsx"), "utf8");

  it("a paid account: the AI notice, a paid plan and a rate limit — before any model call", () => {
    const call = route.indexOf("aiComplete(");
    for (const gate of ["auth.getUser()", "aiConsentBlock(user.id, request)", "isPaidPlan(profile?.plan)", "isRateLimited(`design-generate:${user.id}`, 40"]) {
      const at = route.indexOf(gate);
      expect(at, gate).toBeGreaterThan(-1);
      expect(at, gate).toBeLessThan(call);
    }
  });

  it("Free only while building the FIRST card — any card on the account and it is Pro-only", () => {
    const call = route.indexOf("aiComplete(");
    const count = route.indexOf('from("cards").select("*", { count: "exact", head: true }).eq("user_id", user.id)');
    const refuse = route.indexOf('code: "AI_DESIGN_PRO_ONLY"');
    expect(count).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(count);
    expect(route).toMatch(/if \(\(count \?\? 0\) > 0\) \{/);
    expect(refuse).toBeLessThan(call);
    // A decline is refused; a Free first card has its own, tighter limit.
    expect(route.indexOf('if (consent === "declined") return aiConsentDeclinedResponse();')).toBeLessThan(call);
    expect(route.indexOf("isRateLimited(`design-generate:${user.id}`, 20")).toBeLessThan(call);
  });

  it("a visitor with no account yet: rate-limited per IP before any model call", () => {
    const call = route.indexOf("aiComplete(");
    const ip = route.indexOf("isRateLimited(`design-generate:ip:${clientIp(request)}`, 15");
    expect(ip).toBeGreaterThan(-1);
    expect(ip).toBeLessThan(call);
  });

  it("nobody the app hasn't asked about AI reaches the model — the engine answers alone", () => {
    expect(route).toMatch(/useModel = !isShellRequest\(request\);/);
    expect(route).toMatch(/useModel = aiConsentPermits\(consent, isShellRequest\(request\)\);/);
    const engine = route.indexOf("if (!useModel) return NextResponse.json({ layout: buildDesign(fallbackSpec(brief, avoid), ctx, brief) });");
    expect(engine).toBeGreaterThan(-1);
    expect(engine).toBeLessThan(route.indexOf("aiComplete("));
  });

  it("Copy's routes are untouched: still a session and a paid plan", () => {
    for (const f of ["src/app/api/design-transfer/route.ts", "src/app/api/scan-design/route.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).toContain("isPaidPlan(");
      expect(src, f).not.toContain("clientIp(");
    }
  });

  it("the model only ever chooses from closed lists; the engine places everything", () => {
    expect(route).toContain("parseDesignSpec(raw, brief, avoid)");
    expect(route).toContain("buildDesign(spec, ctx, brief)");
    expect(route).toContain("designPrompt(brief, ctx, avoid)");
  });

  it("the designer: AI design is open wherever the designer is; canScan gates Copy alone", () => {
    expect(designer).toContain("onClick={() => { setAiError(null); setAiOpen(true); }}");
    expect(designer).toContain("disabled={aiBusy || scanning}");
    expect(designer).toContain("onClick={() => { if (canScan) fileRef.current?.click(); }}");
    // The route no longer answers 401, so the client has no message for it.
    expect(designer).not.toContain("AI design needs an account");
  });
});
