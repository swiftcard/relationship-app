import { NextRequest, NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase-server";
import { aiImageEdit, aiVision, hasAiProvider } from "@/lib/ai";
import { isPaidPlan } from "@/lib/plan";
import { isRateLimited } from "@/lib/rate-limit";
import {
  transferPrompt, transferChecklist, type TransferIdentity,
  PRECISE_SCAN_PROMPT, faceLayoutFromScan, renderFaceImage,
  OUTPUT_CHECK_PROMPT, outputProblems, hasProblems, retrySuffix, stripArtworkPrompt,
  DESIGN_SPEC_PROMPT, cleanDesignSpec, type OutputProblems,
} from "@/lib/design-transfer";
import { prepareCardImage } from "@/lib/card-flatten";
import { aiConsentBlock } from "@/lib/ai-consent-server";

// "Make it EXACTLY this design, with my details" — the image-editing sibling
// of /api/scan-design. scan-design reads a photographed card's LAYOUT so the
// block designer can approximate it; this one has the image model REBUILD the
// design itself, carrying the owner's own name/contacts/headshot/logo, and
// returns a stored image for the owner to approve or regenerate. Nothing here
// publishes anything: the client only writes customization.customLayout
// .faceImage after the owner approves the preview.
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

async function fetchReference(url: unknown): Promise<{ imageBase64: string; mediaType: string } | null> {
  if (typeof url !== "string" || !/^https:\/\//.test(url) || !allowedImageHost(url)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", redirect: "error" }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    if (!/^image\//.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 100 || buf.byteLength > 6_000_000) return null;
    return { imageBase64: buf.toString("base64"), mediaType: type };
  } catch {
    return null;
  }
}

const s = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

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
  // inside an edit form full of unsaved changes, and the face has to show what
  // the form says, not what was last saved. It's the owner describing
  // themselves to their own card — nothing here is trusted anywhere else.
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

  // The owner's own photo/logo ride along so the model can place them. In the
  // same breath, a PHOTO of a paper card is found and laid flat
  // (lib/card-flatten): every engine below then sees the card's design — never
  // the desk, the tilt or the lamp light, which the image model used to carry
  // onto the copy. A screenshot or a scan passes through untouched.
  const [headshot, logo, prepared] = await Promise.all([
    fetchReference(body.photoUrl),
    fetchReference(body.logoUrl),
    prepareCardImage(sourceBase64, sourceMediaType),
  ]);
  identity.hasHeadshot = !!headshot;
  identity.hasLogo = !!logo;
  const { imageBase64, mediaType } = prepared;

  // The design, read into words first: true printed colours (corrected for
  // the room's light), shapes, layout, type. Both image prompts carry it, so
  // the model copies the DESIGN rather than retouching the photo. Empty when
  // the read fails — the prompts still stand on their own.
  const spec = cleanDesignSpec(await aiVision({ imageBase64, mediaType, prompt: DESIGN_SPEC_PROMPT, maxTokens: 500 }));

  // Every generated image passes one check: the original owner's details
  // (leaks) and whether it still looks like a photo of paper.
  const check = async (img: { data: Buffer; mediaType: string }): Promise<OutputProblems> => {
    const scan = await aiVision({
      imageBase64: img.data.toString("base64"),
      mediaType: img.mediaType,
      prompt: OUTPUT_CHECK_PROMPT,
      json: true,
      maxTokens: 400,
    });
    try {
      const m = scan?.match(/\{[\s\S]*\}/);
      return m ? outputProblems(JSON.parse(m[0]), identity) : { leaks: [], photo: false };
    } catch {
      // Unreadable scan — treat as clean rather than burning a retry.
      return { leaks: [], photo: false };
    }
  };
  const logProblems = (stage: string, attempt: number, p: OutputProblems) =>
    console.error(
      `[design-transfer] ${stage} attempt ${attempt + 1} rejected for ${user.id}:`,
      [...p.leaks, ...(p.photo ? ["(looks like a photo of paper)"] : [])].join(", "),
    );

  // Two engines, in order of fidelity:
  //  1. Image EDITING (paid Google tier) — pixel-faithful backgrounds. Tried
  //     first so the feature upgrades itself the day billing appears; on the
  //     free tier it answers 429 in under two seconds, so trying costs nothing.
  //  2. Measure-and-typeset (vision, FREE tier) — the model only MEASURES the
  //     design (surfaces, positions, colors, sizes) and we typeset the owner's
  //     details ourselves. Backgrounds are reconstructed rather than copied,
  //     but the text can never be misspelled: no letter is model-drawn.
  const references = [...(headshot ? [headshot] : []), ...(logo ? [logo] : [])];

  // Engine 1 with the LEAK GATE: generate, then have a vision pass transcribe
  // every email/phone on the OUTPUT. Anything that isn't the owner's is the
  // original card's data surviving — the one failure the prompt alone proved
  // unable to prevent (live test 2026-08-19). One corrective retry names the
  // leaked text; a second leak abandons the engine for this request and falls
  // through to measure-and-typeset, which cannot leak by construction.
  // The same gate now also rejects an output that still looks like a photo of
  // paper (2026-10-06) — named in the retry, and twice over it falls through
  // to the hybrid exactly as a leak does.
  let result: { data: Buffer; mediaType: string } | null = null;
  let last: OutputProblems = { leaks: [], photo: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = transferPrompt(identity, spec) + (attempt === 0 ? "" : retrySuffix(last));
    const candidate = await aiImageEdit({ imageBase64, mediaType, prompt, references });
    if (!candidate) break; // engine unavailable — nothing a retry would change
    const problems = await check(candidate);
    if (!hasProblems(problems)) { result = candidate; break; }
    logProblems("full rebuild", attempt, problems);
    last = problems;
  }

  const sharp = (await import("sharp")).default;

  // ── Hybrid engine: model-copied ARTWORK + our own typesetting ──────────────
  // Runs when the full rebuild leaked twice (or the editor produced nothing).
  // The model reproduces the design with all text/logos/faces stripped — it is
  // pixel-faithful at artwork, it only fails at lettering — and the owner's
  // details are typeset over it in real type from the vision measurement of
  // the original. Text cannot be misspelled or leaked: no letter is
  // model-drawn. The composite still passes the leak gate below in case the
  // strip pass left source text behind.
  let hybridUsed = false;
  if (!result) {
    // The strip pass disobeys on the first try about as often as the full
    // rebuild does — same corrective-retry treatment: scan the ARTWORK for
    // surviving source text, name it, try once more. A clean artwork plus a
    // deterministic owner-text overlay needs no second gate.
    let art: { data: Buffer; mediaType: string } | null = null;
    let artLast: OutputProblems = { leaks: [], photo: false };
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = stripArtworkPrompt(spec) + (attempt === 0 ? "" : retrySuffix(artLast));
      const candidate = await aiImageEdit({ imageBase64, mediaType, prompt });
      if (!candidate) break;
      const problems = await check(candidate);
      if (!hasProblems(problems)) { art = candidate; break; }
      logProblems("hybrid artwork", attempt, problems);
      artLast = problems;
    }
    if (art) {
      const reading = await aiVision({ imageBase64, mediaType, prompt: PRECISE_SCAN_PROMPT, json: true, maxTokens: 2600 });
      const m = reading?.match(/\{[\s\S]*\}/);
      let hybridLayout = null;
      try { hybridLayout = m ? faceLayoutFromScan(JSON.parse(m[0])) : null; } catch { /* fall through */ }
      if (hybridLayout) {
        try {
          const toDataUri = (r: { imageBase64: string; mediaType: string } | null) =>
            r ? `data:${r.mediaType};base64,${r.imageBase64}` : null;
          const overlay = await renderFaceImage(hybridLayout, identity, {
            headshot: toDataUri(headshot), logo: toDataUri(logo),
          }, { overlayOnly: true });
          const bg = await sharp(art.data).resize(1400, 800, { fit: "cover" }).png().toBuffer();
          const composite = await sharp(bg).composite([{ input: await sharp(overlay).png().toBuffer() }]).png().toBuffer();
          result = { data: composite, mediaType: "image/png" };
          hybridUsed = true;
        } catch (e) {
          console.error("[design-transfer] hybrid composite failed:", e);
        }
      }
    }
  }
  void hybridUsed;

  let png: Buffer;
  if (result) {
    try {
      // Normalise to the card's own shape. cover-crop, not pad: the model was
      // told to keep the canvas, so drift is slivers, and bars read as broken.
      png = await sharp(result.data).resize(1400, 800, { fit: "cover" }).png().toBuffer();
    } catch (e) {
      console.error("[design-transfer] sharp normalise failed:", e);
      return NextResponse.json({ error: "generation_failed" }, { status: 502 });
    }
  } else {
    const reading = await aiVision({
      imageBase64,
      mediaType,
      prompt: PRECISE_SCAN_PROMPT,
      json: true,
      maxTokens: 2600,
    });
    const match = reading?.match(/\{[\s\S]*\}/);
    let layout = null;
    try {
      layout = match ? faceLayoutFromScan(JSON.parse(match[0])) : null;
    } catch (e) {
      console.error("[design-transfer] vision JSON parse failed:", e, (match?.[0] ?? "").slice(0, 200));
    }
    if (!layout) {
      // Name which stage died — reading missing vs JSON-less vs validator-null
      // were indistinguishable the first time this failed in production.
      console.error(
        `[design-transfer] both engines failed for ${user.id}:`,
        reading === null ? "aiVision returned null" : match ? `validator rejected: ${match[0].slice(0, 300)}` : `no JSON in: ${String(reading).slice(0, 200)}`,
      );
      return NextResponse.json({ error: "generation_failed" }, { status: 502 });
    }
    try {
      const toDataUri = (r: { imageBase64: string; mediaType: string } | null) =>
        r ? `data:${r.mediaType};base64,${r.imageBase64}` : null;
      const face = await renderFaceImage(layout, identity, {
        headshot: toDataUri(headshot),
        logo: toDataUri(logo),
      });
      png = await sharp(face).png().toBuffer();
    } catch (e) {
      console.error("[design-transfer] face render failed:", e);
      return NextResponse.json({ error: "generation_failed" }, { status: 502 });
    }
  }

  // Stored immediately (bucket is public, like every card image): the preview
  // <img> needs a URL either way, and an unapproved file is just an orphan —
  // the same deal the deferred photo/logo uploads already accept.
  const path = `${user.id}/face-${Date.now()}.png`;
  const { error: upErr } = await adminSupabase.storage
    .from("card-uploads")
    .upload(path, png, { contentType: "image/png", upsert: false });
  if (upErr) {
    console.error("[design-transfer] storage upload failed:", upErr.message);
    return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  }
  const { data: pub } = adminSupabase.storage.from("card-uploads").getPublicUrl(path);

  return NextResponse.json({
    url: pub.publicUrl,
    checklist: transferChecklist(identity),
  });
}
