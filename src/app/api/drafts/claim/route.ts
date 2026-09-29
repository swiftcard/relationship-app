import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { sendWelcomeWhenCardLive } from "@/lib/welcome-email";
import { createClient } from "@/lib/supabase-server";
import { isRateLimited } from "@/lib/rate-limit";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { PLAN_LIMITS, isPaidPlan } from "@/lib/plan";
import { getMemberBrandForUser, overlayOfficeContact, overlayOfficeDesign, overlayOfficeLinks, overlayOfficeInstagram } from "@/lib/office-brand";
import { getOfficeSubUserContext } from "@/lib/office-roles";
import { normalizeSocial } from "@/lib/social-url";
import { seedDemoContact } from "@/lib/demo-contact";
import {
  buildClaimInsert,
  findClaimedCard,
  isDataUrl,
  isHostedImageUrl,
  parseDataUrl,
  extFromMime,
  ALLOWED_IMAGE_MIME,
  CLAIM_DRAFT_ID_KEY,
  type ClaimInsert,
} from "@/lib/draft-claim";
import { ensureUniqueUsername } from "@/lib/username";

// Claim converts a guest's localStorage draft into a real `cards` row under the
// SESSION user. It mirrors src/app/api/cards (field allow-list, username +
// customization sanitation, Free card limit, office brand overlay, demo contact
// seed) and additionally uploads any deferred base64 images. It is idempotent:
// a repeat claim of the same draft returns the existing card instead of creating
// a duplicate — critical for double OAuth callbacks / refresh / a second tab.
//
// The row's user_id is ALWAYS the verified session user (buildClaimInsert takes
// it as an argument and ignores anything in the payload) so a draft can never be
// attached to the wrong account.

// sharp (image resizing) needs the Node runtime.
export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB, matches the upload route

// Upload a single base64 data URL to the card-uploads bucket under the session
// user (same bucket/path convention as src/app/api/upload/route.ts). Returns the
// public URL, or null if it isn't a usable image.
async function uploadDataUrl(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  field: string,
  dataUrl: string,
): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  if (!ALLOWED_IMAGE_MIME.includes(parsed.mime)) return null;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(parsed.base64, "base64");
  } catch {
    return null;
  }
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) return null;

  let body: Buffer = buffer;
  let contentType = parsed.mime;
  let ext = extFromMime(parsed.mime);

  // Resize/compress like the upload route (photos → JPEG, logos → PNG, gifs pass
  // through). Best-effort — fall back to the original on any sharp failure.
  if (parsed.mime !== "image/gif") {
    try {
      const sharp = (await import("sharp")).default;
      const MAXDIM = field === "photo" ? 1000 : 800;
      const img = sharp(buffer).rotate().resize(MAXDIM, MAXDIM, { fit: "inside", withoutEnlargement: true });
      if (field === "logo") {
        body = await img.png({ compressionLevel: 9 }).toBuffer();
        contentType = "image/png";
        ext = "png";
      } else {
        body = await img.jpeg({ quality: 85 }).toBuffer();
        contentType = "image/jpeg";
        ext = "jpg";
      }
    } catch {
      body = buffer;
      contentType = parsed.mime;
      ext = extFromMime(parsed.mime);
    }
  }

  const path = `${userId}/${field}-${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from("card-uploads")
    .upload(path, body, { contentType, upsert: true });
  if (error) return null;

  const { data } = admin.storage.from("card-uploads").getPublicUrl(path);
  return data.publicUrl ?? null;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Per-user throttle: claim runs sharp image processing (CPU/mem) and was
  // previously uncapped for authenticated users.
  if (await isRateLimited(`draft-claim:${user.id}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests — please wait a moment and try again." }, { status: 429 });
  }

  const admin = getAdminSupabase();

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid draft." }, { status: 400 });
  }
  // `intendedPlan` used to ride along here. It is gone: the guest has not
  // picked a plan at this point in the flow any more, and an older client
  // sending one must not change what is stored.
  const { draftId, payload, images, step } = body as {
    draftId?: unknown;
    payload?: Record<string, unknown>;
    images?: Record<string, unknown>;
    step?: unknown;
  };

  const safeDraftId = typeof draftId === "string" ? draftId : null;
  const safeStep = typeof step === "number" && Number.isFinite(step) ? step : 1;

  // Read this user's cards once — used for idempotency AND the Free card limit.
  const { data: existingCards } = await admin
    .from("cards")
    .select("id, username, customization")
    .eq("user_id", user.id);

  // ── Idempotency: was this exact draft already claimed? ────────────────────
  const already = findClaimedCard(existingCards ?? [], safeDraftId);
  if (already) {
    // A re-claim of a card that already exists — they've been here before, so
    // this is not a first-time signup (no onboarding plan step).
    return NextResponse.json({ slug: already.username, id: already.id, step: safeStep, first: false });
  }

  // ── Plan gating (mirror api/cards) ────────────────────────────────────────
  const { data: profile } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();
  const paid = isPaidPlan(profile?.plan);
  const count = existingCards?.length ?? 0;

  // An office TEAM MEMBER has one card — their company card, which is their
  // seat (mirror api/cards). Claiming a draft skipped this: a member with a
  // card could claim a second, unbilled one carrying their own company, logo
  // and website, reached from /dashboard?claim=1 or a card's edit page.
  if (count >= 1 && (await getOfficeSubUserContext(user.id))) {
    return NextResponse.json(
      { error: "team_card_limit", message: "Your company card is managed by your team. Ask your Office admin if you need another." },
      { status: 403 },
    );
  }

  if (!paid && count >= PLAN_LIMITS.FREE_CARD_LIMIT) {
    return NextResponse.json(
      { error: "limit", message: "Ready for a second card? Go unlimited with Pro.", upgrade: "/upgrade" },
      { status: 402 },
    );
  }

  // Design-only bypass: a guest who just picked Pro/Office (checkout happens
  // right after this, on /welcome) hasn't actually paid yet, so `profile.plan`
  // is still "free" here — that must NOT strip the design they just built.
  // This is safe: the public card render re-sanitizes against the REAL plan on
  // every view, so an abandoned checkout gracefully snaps back to Free rather
  // than staying stuck with Pro colors. The Free-card-count-limit check above
  // deliberately still uses the real `paid`, not intent — intent alone must
  // never bypass the actual card cap.
  // ── The design is stored EXACTLY as it was built ───────────────────────────
  // A guest reaches here before choosing a plan (2026-09-15: plan comes after
  // the account), so there is nothing to decide from — flattening now would be
  // guessing, and guessing wrong destroys work the visitor cannot get back.
  //
  // Safe, because nothing about this makes the card LOOK Pro to the public: the
  // card page re-sanitizes against the account's real plan on every view
  // ([username]/page.tsx), so a Free account renders Free either way. The
  // difference is only what is kept in the row — and that is what lets
  // /welcome offer "keep your design with a trial" as a real choice, and
  // convert for good the moment they confirm Free.
  //
  // The Free CARD-COUNT limit above is unaffected; it still uses the real
  // `paid`, so intent can never bypass the cap.
  const treatAsPaidForDesign = true;

  // ── Build the insert (ownership: user_id is ALWAYS this session user) ─────
  const built = buildClaimInsert(user.id, (payload ?? {}) as Record<string, unknown>, treatAsPaidForDesign);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status });
  const insert: ClaimInsert = built.insert;
  const designConverted = built.designConverted;

  // ── Upload deferred base64 images ─────────────────────────────────────────
  const imgs = (images ?? {}) as Record<string, unknown>;

  // Logo: from the images map, or a data URL that slipped into logo_url.
  const logoSource = isDataUrl(imgs.logo) ? (imgs.logo as string) : isDataUrl(insert.logo_url) ? insert.logo_url! : null;
  if (logoSource) {
    const url = await uploadDataUrl(admin, user.id, "logo", logoSource);
    insert.logo_url = url; // resolved URL, or null if the upload was rejected
  } else if (isDataUrl(insert.logo_url)) {
    insert.logo_url = null;
  } else if (!insert.logo_url && isHostedImageUrl(imgs.logo)) {
    // Already hosted (the suggested company logo): keep it. This used to be
    // dropped, so the card lost its logo on the way to the plan step.
    insert.logo_url = imgs.logo;
  }

  // Headshot: lives on customization.photoUrl (per-card).
  const cust = insert.customization as Record<string, unknown>;
  const photoSource = isDataUrl(imgs.photo)
    ? (imgs.photo as string)
    : isDataUrl(cust.photoUrl)
      ? (cust.photoUrl as string)
      : null;
  if (photoSource) {
    const url = await uploadDataUrl(admin, user.id, "photo", photoSource);
    cust.photoUrl = url;
  } else if (isDataUrl(cust.photoUrl)) {
    cust.photoUrl = null;
  } else if (!cust.photoUrl && isHostedImageUrl(imgs.photo)) {
    // An already-hosted headshot (e.g. imported): kept, same as the logo above.
    cust.photoUrl = imgs.photo;
  }

  // ── Office uniform branding overlay (mirror api/cards) ────────────────────
  // Only auto-applied (and flagged is_office_card) on the account's FIRST card
  // — the one built right after accepting an office invite. Any card after
  // that is a deliberate, separate ADD from the dashboard (a second business,
  // a personal card) and must not be silently rebranded just because the
  // account happens to belong to an office — that was the office-branding
  // leak into personal cards bug. is_office_card also gates every future
  // office/admin/branding save (office-brand.ts), so this card keeps getting
  // re-branded going forward while a later personal card never does.
  if (count === 0) {
    const brand = await getMemberBrandForUser(user.id);
    // A SUB-USER never supplies the company half of the card (mirror
    // api/cards): discard it first, then the brand's own values apply below.
    const subCtx = await getOfficeSubUserContext(user.id);
    if (subCtx) {
      insert.company = "";
      insert.website = "";
      insert.logo_url = null;
      delete cust.fax;
      delete cust.address;
      // A member's card is an office card whether or not the office has a
      // brand yet (mirror api/cards `is_office_card: !!subCtx`). Flagged only
      // inside `if (brand)`, a member of a not-yet-branded office got a card
      // every later Branding save skipped, and that was never de-branded when
      // they left.
      insert.is_office_card = true;
    }
    if (brand) {
      insert.is_office_card = true;
      if (brand.logoUrl) insert.logo_url = brand.logoUrl;
      if (brand.company) insert.company = brand.company;
      if (brand.website) insert.website = brand.website;
      if (brand.lockTemplate && brand.template) insert.template = brand.template;
      if (brand.lockTemplate && brand.template === "custom" && brand.customLayout) cust.customLayout = brand.customLayout;
      // Company phone/fax/address (spec §8).
      if (brand.phone || brand.fax || brand.address) {
        Object.assign(cust, overlayOfficeContact(cust as Record<string, unknown>, brand));
      }
      // The rest of the brand, exactly as api/cards applies it (office audit
      // 2026-09-16: a card claimed after joining kept off-brand colours and
      // missed the company links until its next edit). The overlays return a
      // new object, so the result is written back into `cust` in place.
      const replaceInto = (next: Record<string, unknown>) => {
        for (const k of Object.keys(cust)) if (!(k in next)) delete cust[k];
        Object.assign(cust, next);
      };
      replaceInto(overlayOfficeDesign(cust as Record<string, unknown>, brand) as Record<string, unknown>);
      if (subCtx) {
        replaceInto(overlayOfficeLinks(cust as Record<string, unknown>, brand) as Record<string, unknown>);
        const ig = overlayOfficeInstagram(cust as Record<string, unknown>, normalizeSocial(String(insert.instagram || ""), "instagram"), brand);
        replaceInto(ig.customization as Record<string, unknown>);
        if (ig.instagram !== null) insert.instagram = ig.instagram;
      }
    }
  }

  // Stamp the originating draft id for idempotency on any retry.
  if (safeDraftId) cust[CLAIM_DRAFT_ID_KEY] = safeDraftId;

  // The username is only the public URL slug — a collision with another account's
  // card must not block the claim — so pick the next free variant up front (the
  // same-draft idempotency guard above already prevents duplicate cards for this
  // draft).
  insert.username = await ensureUniqueUsername(insert.username, admin);

  // ── Insert ────────────────────────────────────────────────────────────────
  let { data: card, error } = await admin.from("cards").insert(insert).select("id, username").single();

  if (error?.code === "23505") {
    // Raced with another insert. If THIS user already owns a card with the slug
    // (a double-submit of the same draft), that's the idempotent result.
    const { data: mine } = await admin
      .from("cards")
      .select("id, username")
      .eq("user_id", user.id)
      .eq("username", insert.username)
      .maybeSingle();
    if (mine) return NextResponse.json({ slug: mine.username, id: mine.id, step: safeStep, first: count === 0, designConverted });
    // Otherwise another account grabbed it — regenerate and try once more.
    insert.username = await ensureUniqueUsername(insert.username, admin);
    ({ data: card, error } = await admin.from("cards").insert(insert).select("id, username").single());
  }

  if (error || !card) {
    return NextResponse.json({ error: error?.message ?? "Couldn't create the card." }, { status: 500 });
  }

  // First card on the account → seed a sample contact (mirror api/cards).
  if (count === 0) {
    try {
      await seedDemoContact(insert.username);
    } catch {
      /* non-fatal */
    }
  }

  // "Your SwiftCard is live" — the same trigger as /api/cards: the first time
  // this account HAS a card, never at signup. A claimed guest draft is exactly
  // that moment for anyone who built before signing up.
  after(() => sendWelcomeWhenCardLive(user.id, user.email));

  // `first` tells the client this is the account's first card → send them
  // through the onboarding plan-selection step (/welcome) instead of the editor.
  return NextResponse.json({ slug: card.username, id: card.id, step: safeStep, first: count === 0, designConverted });
}
