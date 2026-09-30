import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { aiComplete, hasAiProvider } from "@/lib/ai";
import { isPaidPlan } from "@/lib/plan";
import { isRateLimited } from "@/lib/rate-limit";
import { aiConsentBlock, aiConsentDeclinedResponse, aiConsentState } from "@/lib/ai-consent-server";
import { clientIp } from "@/lib/client-ip";
import { isShellRequest } from "@/lib/shell-request";
import {
  AI_THEME_KEYS, COMPOSITIONS, buildDesign, designPrompt, fallbackSpec, parseDesignSpec,
  type Composition, type DesignContext,
} from "@/lib/ai-card-design";
import type { AiDesignBrief } from "@/components/card-templates/types";

// AI design (Custom design → "AI design"). The owner picks colours, a theme and
// whether their headshot and logo go on the card; this returns a finished free
// design they can then fine-tune.
//
// WHO may generate — three doors (owner, 2026-09-30: AI design opens while
// someone builds their FIRST card; "Copy a card or template you like" stays
// paid, and its routes /api/design-transfer and /api/scan-design are untouched):
//
//   • a paying account (Pro / Office) — the AI notice honoured, 40 an hour;
//   • a signed-in account with NO card yet — building its first one — 20 an
//     hour. Any card on the account and it is Pro-only again;
//   • no session at all — a visitor in Get Started, whose account doesn't exist
//     yet — 15 an hour per IP.
//
// A first-card caller the app hasn't asked about AI (a visitor in the app, or
// an account whose answer is still unset — the consent dialog is never shown on
// /cards/new) gets the design engine's own answer with NO model call: nothing
// leaves, and they still get a finished design. A decline is refused.
//
// The model only chooses TASTE from closed lists (lib/ai-card-design
// parseDesignSpec) and the engine places everything, so the worst a bad or
// hostile answer can do is produce the theme's own default design.
//
// Only the SHAPE of the owner's details reaches the model — lengths and which
// lines exist (designPrompt). The values are used here, server-side, to size
// every line to the room it has.

const HEX = /^#[0-9a-f]{6}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const HOUR = 60 * 60 * 1000;
const tooFast = () =>
  NextResponse.json({ error: "You're generating very quickly — give it a minute and try again." }, { status: 429 });

export async function POST(request: NextRequest) {
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  // False = answer from the design engine alone, no model call.
  let useModel = true;
  if (!user) {
    // A visitor building their first card, before the account exists.
    if (await isRateLimited(`design-generate:ip:${clientIp(request)}`, 15, HOUR)) return tooFast();
    // The app never sends anything to the provider for someone it hasn't asked.
    useModel = !isShellRequest(request);
  } else {
    const admin = getAdminSupabase();
    const { data: profile } = await admin
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();
    if (isPaidPlan(profile?.plan)) {
      const consentBlocked = await aiConsentBlock(user.id, request);
      if (consentBlocked) return consentBlocked;
      // Pro gates WHO can generate, not how much.
      if (await isRateLimited(`design-generate:${user.id}`, 40, HOUR)) return tooFast();
    } else {
      // Free: only while building the account's FIRST card.
      const { count } = await admin.from("cards").select("*", { count: "exact", head: true }).eq("user_id", user.id);
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { code: "AI_DESIGN_PRO_ONLY", error: "upgrade", message: "AI design is a Pro feature.", upgrade: "/upgrade" },
          { status: 403 },
        );
      }
      const consent = await aiConsentState(user.id, request);
      if (consent === "declined") return aiConsentDeclinedResponse();
      useModel = consent === "permit";
      if (await isRateLimited(`design-generate:${user.id}`, 20, HOUR)) return tooFast();
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const b = (body.brief && typeof body.brief === "object" ? body.brief : {}) as Record<string, unknown>;
  const theme = typeof b.theme === "string" && (AI_THEME_KEYS as readonly string[]).includes(b.theme) ? b.theme : null;
  if (!theme) return NextResponse.json({ error: "bad_theme" }, { status: 400 });
  const brief: AiDesignBrief = {
    theme,
    colors: Array.isArray(b.colors) ? b.colors.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, 2).map((c) => c.toLowerCase()) : [],
    headshot: b.headshot === true,
    logo: b.logo === true,
    variant: typeof b.variant === "number" && Number.isFinite(b.variant) ? Math.max(0, Math.min(10_000, Math.floor(b.variant))) : 0,
  };
  const id = (body.identity && typeof body.identity === "object" ? body.identity : {}) as Record<string, unknown>;
  const ctx: DesignContext = {
    name: str(id.name, 80), title: str(id.title, 100), company: str(id.company, 100),
    phone: str(id.phone, 40), email: str(id.email, 120), website: str(id.website, 120), address: str(id.address, 200),
    hasPhoto: body.hasPhoto === true,
    hasLogo: body.hasLogo === true,
  };
  // The composition the owner is looking at now — "Try another" never hands it back.
  const avoid: Composition[] = typeof body.avoid === "string" && (COMPOSITIONS as readonly string[]).includes(body.avoid)
    ? [body.avoid as Composition]
    : [];

  if (!useModel) return NextResponse.json({ layout: buildDesign(fallbackSpec(brief, avoid), ctx, brief) });
  if (!hasAiProvider()) return NextResponse.json({ error: "no_ai" }, { status: 503 });

  const text = (await aiComplete(designPrompt(brief, ctx, avoid), { maxTokens: 500, json: true })) ?? "";
  let raw: unknown = null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { raw = JSON.parse(match[0]); } catch { raw = null; }
  }
  // An unreadable answer still gets a good card: the theme's own choices for
  // this variant, from the owner's colours. parseDesignSpec validates a readable
  // one field by field, falling back the same way.
  const spec = raw ? parseDesignSpec(raw, brief, avoid) : fallbackSpec(brief, avoid);
  return NextResponse.json({ layout: buildDesign(spec, ctx, brief) });
}
