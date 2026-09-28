import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { getAdminSupabase } from "@/lib/supabase-admin";
import { PLAN_LIMITS, isPaidPlan, sanitizeCustomizationForPlan } from "@/lib/plan";
import { PLAN_CHOSEN_KEY, sendWelcomeWhenCardLive } from "@/lib/welcome-email";
import { getMemberBrandForUser, overlayOfficeContact, overlayOfficeDesign, seedBrandFromOwnersFirstCard, overlayOfficeLinks, overlayOfficeInstagram } from "@/lib/office-brand";
import { seedDemoContact } from "@/lib/demo-contact";
import { normalizeSocial } from "@/lib/social-url";
import { ensureUniqueUsername, normalizeSlug } from "@/lib/username";
import { cardSlug } from "@/lib/slug";
import { getOfficeSubUserContext } from "@/lib/office-roles";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();

  const { data: profile } = await admin
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();

  const paid = isPaidPlan(profile?.plan);

  const { count } = await admin
    .from("cards")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  // An office TEAM MEMBER has one card: their company card, which is their seat.
  // The office pays per seat, so a second branded card would be free. Their
  // first card (right after joining) is still allowed.
  if ((count ?? 0) >= 1 && (await getOfficeSubUserContext(user.id))) {
    return NextResponse.json(
      { error: "team_card_limit", message: "Your company card is managed by your team. Ask your Office admin if you need another." },
      { status: 403 },
    );
  }

  // Free is capped at FREE_CARD_LIMIT cards. Existing cards are never deleted —
  // we only block creating new ones beyond the cap.
  if (!paid && (count ?? 0) >= PLAN_LIMITS.FREE_CARD_LIMIT) {
    return NextResponse.json(
      {
        // Additive machine code for native; web keeps using message/error/upgrade.
        code: "CARD_LIMIT_REACHED",
        error: "limit",
        message: "Ready for a second card? Go unlimited with Pro.",
        upgrade: "/upgrade",
      },
      { status: 402 }
    );
  }

  const body = await req.json();
  const { username, name, title, company, phone, email, website, linkedin, instagram, twitter, tiktok, template, customization, logo_url, label, chosenPlan } = body;

  // First-card design preview: a Free account building its FIRST card may have
  // used unlocked Pro colors/custom designer, then explicitly chosen Pro/Office
  // at the in-wizard plan gate — they're headed to checkout next, so keep the
  // design as-designed rather than stripping it here. Safe even before payment
  // completes: the public render always re-sanitizes against the REAL plan, so
  // an abandoned checkout gracefully snaps back to the closest Free look.
  const proIntent = chosenPlan === "pro" || chosenPlan === "office";
  const treatAsPaid = paid || proIntent;

  // Server-side validation (the client validated too, but the API must not
  // accept a card with no name — it renders "Save 's contact" / a blank hero —
  // nor unbounded field lengths. (cards audit M5) Caps are generous so no real
  // card is truncated; they only stop abuse.
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "invalid", message: "A name is required." }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: "invalid", message: "That name is too long." }, { status: 400 });
  }

  // The username is ONLY the public URL slug — the account (email/auth user) is
  // the real identity — so a slug collision must never block card creation. We
  // normalize to the safe charset ([a-z0-9-], so it can't break the Supabase
  // `.or()` analytics filters) and auto-pick the next free variant instead of
  // erroring. Fall back to the name, then the email local-part, then "card".
  const slugBase =
    normalizeSlug(String(username ?? "")) ||
    cardSlug(String(name ?? ""), String(company ?? "")) ||
    normalizeSlug(String(email ?? "").split("@")[0] || "");
  const normalizedUsername = await ensureUniqueUsername(slugBase, admin);

  // Enforce Free limits on the customization blob (Pro-only colors snapped to
  // the nearest Free preset, link buttons capped) — backend-enforced, not just
  // hidden in the UI.
  // "_"-prefixed keys are the server's own bookkeeping — _prevSlugs (which
  // old addresses redirect here), _claimDraftId, office markers. The edit
  // route has always dropped them from a request; create didn't, so a crafted
  // create carrying _prevSlugs: ["<someone's old address>"] could take over
  // the redirect of another user's printed QR codes and links.
  const incomingCust = { ...((customization ?? {}) as Record<string, unknown>) };
  for (const k of Object.keys(incomingCust)) if (k.startsWith("_")) delete incomingCust[k];
  // A NEW card states its own headshot, even "none". Without the key it is
  // read as a legacy card and shows the ACCOUNT photo — another card's
  // picture. The wizard always sends it; the server no longer relies on that
  // (isolation audit 2026-09-24; lib/card-media cardHeadshot).
  if (!Object.prototype.hasOwnProperty.call(incomingCust, "photoUrl")) incomingCust.photoUrl = null;
  let cust = sanitizeCustomizationForPlan(incomingCust, treatAsPaid, template);
  // Custom designer is Pro-only — Free can't save a "custom" template.
  let safeTemplate = !treatAsPaid && template === "custom" ? "classic-pro" : (template || "classic-pro");

  // Office uniform branding: if the user is under an office with a brand, force
  // the logo, company, website and the whole look — every employee card is based
  // on the admin's primary card. Employees keep only their personal details
  // (name/title/phone/email) and their own content (headshot/bio/personal links).
  let finalCompany = company || "";
  let finalWebsite = website || "";
  let finalLogo = logo_url || null;
  let finalLabel = label || null;
  // Set only when an office owns the Instagram slot on this card; null means
  // "whatever the member typed" (see the insert below).
  let officeInstagram: string | null = null;
  // Is this creator an office SUB-USER (active member, not the owner)? Resolved
  // once — it decides both the company nickname AND whether the card is flagged
  // is_office_card (below). The owner is deliberately excluded: their personal
  // cards are individual and must never be touched by office propagation.
  // Independent lookups — resolved together rather than one after the other.
  const [subCtx, brand] = await Promise.all([
    getOfficeSubUserContext(user.id),
    getMemberBrandForUser(user.id),
  ]);
  // Company-level fields are org territory for a SUB-USER (owner decision,
  // Jul 2026): the UI never asks a member for them, and the server backstops
  // that here — whatever a crafted request supplies is discarded, then the
  // brand's own values (where set) are applied below. Owners are unaffected.
  if (subCtx) {
    finalCompany = "";
    finalWebsite = "";
    finalLogo = null;
    if (cust && typeof cust === "object") {
      delete (cust as Record<string, unknown>).fax;
      delete (cust as Record<string, unknown>).address;
    }
  }
  if (brand) {
    if (brand.logoUrl) finalLogo = brand.logoUrl;
    if (brand.company) finalCompany = brand.company;
    if (brand.website) finalWebsite = brand.website;
    // Member cards carry the company-controlled nickname (the company name), so
    // every connected card is labeled consistently. Owners keep their own labels.
    if (brand.company && subCtx) finalLabel = brand.company;
    if (brand.lockTemplate && brand.template) safeTemplate = brand.template;
    if (brand.lockTemplate && brand.template === "custom" && brand.customLayout) cust = { ...cust, customLayout: brand.customLayout };
    // Company phone/fax/address (spec §8) — uniform on every member card.
    if (brand.phone || brand.fax || brand.address) cust = overlayOfficeContact(cust, brand);
    // Locked look (colours + fonts) — no-op while the office leaves it unlocked.
    cust = overlayOfficeDesign(cust, brand);
    // The office's Swift Links branding lands on a new member card from the
    // moment it is created: its look (while locked), its bio, and its pinned
    // links leading anything the member added in the wizard. Sub-users only —
    // an owner's own card is theirs.
    if (subCtx) {
      cust = overlayOfficeLinks(cust as Record<string, unknown>, brand) as typeof cust;
      // A brand-new card has no stored handle, so whatever they typed IS their
      // own — stash it before the company's takes the one Instagram slot, so
      // this card behaves like every existing one if the office clears it.
      const ig = overlayOfficeInstagram(cust as Record<string, unknown>, normalizeSocial(String(instagram || ""), "instagram"), brand);
      cust = ig.customization as typeof cust;
      officeInstagram = ig.instagram;
    }
  }

  const cardRow = {
    user_id: user.id,
    name: name || "",
    title: title || "",
    company: finalCompany,
    phone: phone || "",
    email: email || "",
    website: finalWebsite,
    // Server-side normalize (backstop for older/other clients) so whatever
    // was typed — full URL, bare handle, even a spaced name — always stores
    // a linkable value. See lib/social-url.ts.
    linkedin: normalizeSocial(String(linkedin || ""), "linkedin"),
    // The office's Instagram when it set one — a top-level column, so it is
    // forced here rather than in the links overlay. Every OTHER social stays
    // the member's own.
    instagram: officeInstagram ?? normalizeSocial(String(instagram || ""), "instagram"),
    twitter: normalizeSocial(String(twitter || ""), "twitter"),
    tiktok: normalizeSocial(String(tiktok || ""), "tiktok"),
    template: safeTemplate,
    customization: cust,
    logo_url: finalLogo,
    label: finalLabel,
    // Flag a SUB-USER's card as office-managed so the office Branding page can
    // keep it in sync afterward and strip the brand if they ever leave. Without
    // this, all propagation (which is scoped .eq("is_office_card", true)) skips
    // the card — brand changes never reach it and a departing member walks away
    // with the company logo baked onto their public card. The OWNER's own cards
    // stay unflagged (getMemberBrandForUser/subCtx are null for them), so their
    // personal cards remain individual.
    is_office_card: !!subCtx,
  };

  let { data, error } = await admin
    .from("cards")
    .insert({ ...cardRow, username: normalizedUsername })
    .select()
    .single();

  // Race backstop: another insert grabbed the slug between our check and this
  // write. Regenerate a fresh unique slug and try once more — never surface a
  // "username taken" error, since the slug is disposable and the account owns it.
  if (error?.code === "23505") {
    const retrySlug = await ensureUniqueUsername(`${normalizedUsername}`, admin);
    ({ data, error } = await admin
      .from("cards")
      .insert({ ...cardRow, username: retrySlug })
      .select()
      .single());
  }

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Couldn't create the card." }, { status: 500 });
  }

  // First card on the account → seed a sample contact so the dashboard/contacts
  // aren't empty and the guided tour has a real contact to demonstrate. Use the
  // slug that was actually inserted (may differ from our first pick after a race).
  if ((count ?? 0) === 0) {
    await seedDemoContact(data.username);
  }

  // Free chosen at the in-wizard plan gate (the wizard sends chosenPlan "free"
  // only from that gate). Record the plan as decided — the same marker
  // api/account/choose-plan writes for /welcome — so the welcome email is
  // released and the dashboard never asks them to choose again. Paid picks are
  // settled by Stripe/Apple, never here.
  if (!paid && chosenPlan === "free") {
    const { data: acct } = await admin.from("profiles").select("customization").eq("id", user.id).maybeSingle();
    const acctCust = (acct?.customization ?? {}) as Record<string, unknown>;
    if (!acctCust[PLAN_CHOSEN_KEY]) {
      await admin.from("profiles").update({ customization: { ...acctCust, [PLAN_CHOSEN_KEY]: "free" } }).eq("id", user.id);
    }
  }

  // "Your SwiftCard is live" — sent HERE, the first time this account has a
  // card, not at signup (owner, 2026-09-11). after() so a slow email provider
  // never holds up the card the person is waiting for, and the send itself is
  // idempotent per account, so the every-card call costs one cheap count on
  // every later card and sends nothing.
  after(() => sendWelcomeWhenCardLive(user.id, user.email));

  // Office seat 1: if the owner's office brand is still blank, seed it once
  // from this card (a plain copy — no primary card, no ongoing link; from then
  // on the Branding page is the only brand writer).
  try {
    const { data: owned } = await admin.from("offices").select("id").eq("owner_id", user.id).maybeSingle();
    if (owned?.id) await seedBrandFromOwnersFirstCard(owned.id as string, user.id);
  } catch {
    // Best-effort: never fail card creation because the brand seed hiccuped.
  }

  return NextResponse.json({ card: data });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = getAdminSupabase();
  const { data: cards } = await admin
    .from("cards")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ cards: cards ?? [] });
}
