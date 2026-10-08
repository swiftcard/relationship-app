import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { aiImageEdit, aiVision, hasAiProvider } from "@/lib/ai";
import { isPaidPlan } from "@/lib/plan";
import { isRateLimited } from "@/lib/rate-limit";
import {
  transferChecklist, type TransferIdentity,
  PRECISE_SCAN_PROMPT, faceLayoutFromScan, freeLayoutFromFace,
  OUTPUT_CHECK_PROMPT, outputProblems, hasProblems, retrySuffix, stripArtworkPrompt,
  DESIGN_SPEC_PROMPT, cleanDesignSpec, SOURCE_FACTS_PROMPT, sourceFacts, EMPTY_FACTS,
  type OutputProblems, type SourceFacts,
} from "@/lib/design-transfer";
import { cropToQuad, prepareCardImage } from "@/lib/card-flatten";
import { aiConsentBlock } from "@/lib/ai-consent-server";

// "Copy a card or template you like" — the design in the picture, re-issued to
// the owner as an EDITABLE card. The answer is a free design (lib/design-
// transfer freeLayoutFromFace): the model's clean redraw of the ARTWORK as the
// card's background image, and the owner's details, headshot and logo as real
// elements at the measured positions. Nothing here publishes anything: the
// client commits the layout only after the owner approves the preview, and
// the owner can drag, resize and restyle every element from then on.
//
// Same gates as scan-design (auth → Pro → rate limit), tighter rate limit
// because an image generation costs roughly an order of magnitude more than a
// vision read.

const MAX_BASE64 = 10_000_000;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

// Image generation is slow — a 10s default would kill most calls mid-flight.
export const maxDuration = 180;

/** Owner-controlled URLs are only fetched from our own hosts (SSRF guard —
 *  same allowlist reasoning as wallet-strip.tsx's embedImage). */
function allowedImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    const ok = new Set<string>();
    for (const env of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_APP_URL || "https://swiftcard.me"]) {
      if (env) try { ok.add(new URL(env).hostname.toLowerCase()); } catch { /* ignore */ }
    }
    return ok.has(host);
  } catch {
    return false;
  }
}

/** The owner's own photo/logo exist? (They are placed by the renderer from the
 *  card's own URLs; the route only needs to know whether to make a slot.) */
async function referenceExists(url: unknown): Promise<boolean> {
  if (typeof url !== "string" || !/^https:\/\//.test(url) || !allowedImageHost(url)) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", redirect: "error" }).finally(() => clearTimeout(t));
    if (!res.ok || !/^image\//.test(res.headers.get("content-type") || "")) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength >= 100;
  } catch {
    return false;
  }
}

const s = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const parseJson = (text: string | null): unknown => {
  const m = text?.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
};

export async function POST(request: NextRequest) {
  const userSupabase = await createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Declining the AI notice has to actually stop the data leaving —
  // see lib/ai-consent-server.ts (App Review 5.1.1(i)/5.1.2(i)).
  const consentBlocked = await aiConsentBlock(user.id, request);
  if (consentBlocked) return consentBlocked;

  const adminSupabase = getAdminSupabase();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();

  if (!isPaidPlan(profile?.plan)) {
    return NextResponse.json(
      {
        code: "SCAN_DESIGN_PRO_ONLY",
        error: "upgrade",
        message: "Rebuilding a card design with your details is a Pro feature.",
        upgrade: "/upgrade",
      },
      { status: 403 },
    );
  }

  // 15/hour: enough for a healthy approve/regenerate loop, not for a script.
  if (await isRateLimited(`design-transfer:${user.id}`, 15, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: "You're generating very quickly — give it a minute and try again." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const sourceBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  if (!sourceBase64) return NextResponse.json({ error: "no_image" }, { status: 400 });
  if (sourceBase64.length > MAX_BASE64) return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  const sourceMediaType = typeof body.mediaType === "string" && ALLOWED_MEDIA.has(body.mediaType)
    ? body.mediaType
    : "image/jpeg";

  // The identity comes from the CLIENT, not the DB row: the designer runs
  // inside an edit form full of unsaved changes, and the card has to show what
  // the form says, not what was last saved. It only decides which slots to
  // make and what the leak gate may allow — nothing here is trusted elsewhere.
  const id = (body.identity ?? {}) as Record<string, unknown>;
  const identity: TransferIdentity = {
    name: s(id.name, 120) ?? "",
    title: s(id.title, 120),
    company: s(id.company, 120),
    phone: s(id.phone, 40),
    email: s(id.email, 200),
    website: s(id.website, 200),
    address: s(id.address, 300),
  };
  if (!identity.name) return NextResponse.json({ error: "no_name" }, { status: 400 });

  if (!hasAiProvider()) return NextResponse.json({ error: "no_ai" }, { status: 503 });

  // The CARD is found inside the picture and cut out flat (lib/card-flatten):
  // a photo on a desk, a mockup on a backdrop, a page with the card in it — every
  // read and the redraw below see the card's face and nothing else. In the same
  // breath, whether the owner has a photo/logo to make a slot for.
  const [hasHeadshot, hasLogo, prepared] = await Promise.all([
    referenceExists(body.photoUrl),
    referenceExists(body.logoUrl),
    prepareCardImage(sourceBase64, sourceMediaType),
  ]);
  identity.hasHeadshot = hasHeadshot;
  identity.hasLogo = hasLogo;
  const { imageBase64, mediaType } = prepared;

  // Three reads of the flat card, at once:
  //  • the design in words (true printed colours, shapes) — rides in the
  //    artwork prompt so the model copies the DESIGN, not the photo;
  //  • what the ORIGINAL says — names, company, the logo's brand, contacts —
  //    so the output check can recognise any of it surviving;
  //  • the measurement — where every text, photo and logo sits — which is
  //    where the owner's own elements will go.
  const [specRaw, factsRaw, measureRaw] = await Promise.all([
    aiVision({ imageBase64, mediaType, prompt: DESIGN_SPEC_PROMPT, maxTokens: 500 }),
    aiVision({ imageBase64, mediaType, prompt: SOURCE_FACTS_PROMPT, json: true, maxTokens: 600 }),
    aiVision({ imageBase64, mediaType, prompt: PRECISE_SCAN_PROMPT, json: true, maxTokens: 2600 }),
  ]);
  const spec = cleanDesignSpec(specRaw);
  const facts: SourceFacts = factsRaw ? sourceFacts(parseJson(factsRaw)) : EMPTY_FACTS;
  const face = faceLayoutFromScan(parseJson(measureRaw));
  if (!face) {
    // Name which stage died — reading missing vs JSON-less vs validator-null
    // were indistinguishable the first time this failed in production.
    console.error(
      `[design-transfer] measurement failed for ${user.id}:`,
      measureRaw === null ? "aiVision returned null" : `unusable: ${String(measureRaw).slice(0, 300)}`,
    );
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }

  const sharp = (await import("sharp")).default;

  // Every generated image passes one check: anything readable left on it
  // (text, a logo, a face), whether it still looks like a photo of paper, and
  // where the card sits in the frame. A card drawn with a margin or on a
  // backdrop is cut out here; one drawn small in a scene is a rejection.
  const check = async (img: { data: Buffer; mediaType: string }): Promise<{ problems: OutputProblems; image: Buffer | null }> => {
    const meta = await sharp(img.data).metadata();
    const scan = parseJson(await aiVision({
      imageBase64: img.data.toString("base64"),
      mediaType: img.mediaType,
      prompt: OUTPUT_CHECK_PROMPT,
      json: true,
      maxTokens: 600,
    }));
    const { quad, ...problems } = outputProblems(scan, identity, facts, { artwork: true, width: meta.width ?? 100, height: meta.height ?? 100 });
    if (hasProblems(problems)) return { problems, image: null };
    let image: Buffer | null = img.data;
    if (quad) {
      try { image = (await cropToQuad(img.data, quad, "png")) ?? img.data; } catch { image = img.data; }
    }
    return { problems, image };
  };

  // ── The artwork: generate, check, name what was wrong, try once more ──────
  // The strip pass disobeys on the first try often enough (it keeps the logo,
  // a line of text, the paper look, or draws the card on a backdrop) that one
  // corrective retry naming the problem is worth its cost. Twice over, the
  // design still comes back — as measured panels and colours, with no artwork
  // image — and the owner can Try again for the artwork.
  let art: Buffer | null = null;
  let last: OutputProblems = { leaks: [], photo: false, scene: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = stripArtworkPrompt(spec) + (attempt === 0 ? "" : retrySuffix(last));
    const candidate = await aiImageEdit({ imageBase64, mediaType, prompt });
    if (!candidate) break; // engine unavailable — nothing a retry would change
    const { problems, image } = await check(candidate);
    if (image) { art = image; break; }
    console.error(
      `[design-transfer] artwork attempt ${attempt + 1} rejected for ${user.id}:`,
      [...problems.leaks, ...(problems.photo ? ["(looks like a photo of paper)"] : []), ...(problems.scene ? ["(card drawn small in a scene)"] : [])].join(", "),
    );
    last = problems;
  }

  // Stored immediately (bucket is public, like every card image): the preview
  // needs a URL either way, and an unapproved file is just an orphan — the
  // same deal the deferred photo/logo uploads already accept.
  let bgImage: string | null = null;
  if (art) {
    try {
      // The card's own shape. cover-crop, not pad: the model was told to fill
      // the canvas and the check cut the card out, so drift is slivers.
      const png = await sharp(art).resize(1400, 800, { fit: "cover" }).png().toBuffer();
      const path = `${user.id}/art-${Date.now()}.png`;
      const { error: upErr } = await adminSupabase.storage
        .from("card-uploads")
        .upload(path, png, { contentType: "image/png", upsert: false });
      if (upErr) console.error("[design-transfer] storage upload failed:", upErr.message);
      else bgImage = adminSupabase.storage.from("card-uploads").getPublicUrl(path).data.publicUrl;
    } catch (e) {
      console.error("[design-transfer] artwork normalise failed:", e);
    }
  }

  const layout = freeLayoutFromFace(face, identity, { bgImage });
  return NextResponse.json({
    layout,
    artwork: !!bgImage,
    checklist: transferChecklist(identity),
  });
}
