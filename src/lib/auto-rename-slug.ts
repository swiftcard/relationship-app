import { getAdminSupabase } from "@/lib/supabase-admin";
import { cardSlug, isReservedSlug } from "@/lib/slug";
import { slugHeldAsAlias } from "@/lib/slug-alias";

// The card URL FOLLOWS the card (owner order 2026-08-26: "don't give options —
// just update it"). When a save changes the name or company, the slug moves to
// the FirstLast-Company canonical for the new identity, automatically:
//
//   • Only AUTO-MANAGED slugs move — a slug the owner hand-picked in the URL
//     editor (anything that isn't the canonical for the card's PREVIOUS
//     name/company) is theirs and is never touched.
//   • The rename runs through the rename_card_slug RPC, which migrates every
//     slug-keyed row (views, __links view rows, events, leads, analytics,
//     notifications) atomically — analytics never split across two slugs.
//   • The old slug is appended to customization._prevSlugs, so every link, QR
//     code, Wallet pass, and installed email signature already out in the
//     world 308-redirects to the new URL (src/lib/slug-alias.ts).
//   • The stored share/signature PNGs are COPIED to the new slug (old files
//     kept — signatures pasted into email clients embed the old path).
//
// Returns the new slug when a rename happened, null otherwise. Best-effort by
// contract: a rename that cannot be completed leaves the card on its current
// slug — a save must never fail over its URL.
export async function autoRenameCardSlug(opts: {
  cardId: string;
  userId: string;
  /** The card BEFORE this save. */
  before: { username: string; name: string | null; company: string | null };
  /** The values after the save (fall back to before when the field wasn't in the update). */
  afterName: string | null;
  afterCompany: string | null;
}): Promise<string | null> {
  const { before } = opts;
  try {
    // Hand-picked slug? The canonical for the PREVIOUS identity is what the
    // auto-manager would have set; anything else means the owner chose it.
    const prevAuto = cardSlug(before.name || "", before.company || "");
    if (!prevAuto || before.username !== prevAuto) return null;

    const target = cardSlug(opts.afterName || "", opts.afterCompany || "");
    if (!target || target === before.username || isReservedSlug(target)) return null;

    const admin = getAdminSupabase();
    // Try the canonical, then numbered variants if it's taken by someone else.
    for (let i = 0; i < 4; i++) {
      const candidate = i === 0 ? target : `${target}-${i + 1}`;
      // Another CARD's old address is taken (any account, this one included),
      // exactly as creation and the manual rename treat it. The RPC only checks live slugs, so
      // this path could claim "johnsmith-acme" while it still redirected to
      // another John Smith's card: their printed QR codes, NFC tags and Wallet
      // passes opened this card (isolation audit 2026-09-24).
      if (await slugHeldAsAlias(admin, candidate, opts.cardId)) continue;
      const { data, error } = await admin.rpc("rename_card_slug", {
        p_card_id: opts.cardId,
        p_user_id: opts.userId,
        p_new_slug: candidate,
      });
      if (error) return null; // RPC missing/unreachable — keep the current slug
      const result = (data ?? {}) as { ok?: boolean; error?: string; unchanged?: boolean };
      if (result.ok) {
        if (result.unchanged) return null;
        // The stored pictures are NOT copied to the new slug. A rename only
        // ever follows a name or company change, so the pictures at the old
        // slug show the OLD name or company: copied, the new address unfurled
        // in iMessage and Slack — and signed email — with the card the edit
        // was meant to fix (audit C02-004). With nothing stored at the new
        // slug, its preview and signature are drawn live from the card as it
        // is now, until the next exact capture. The save route clears both
        // slugs' pictures.
        // lead_messages.card_owner is denormalized and OUTSIDE the RPC's
        // table list — move it here so conversation logs stay scoped to the
        // card under its new slug.
        try {
          await admin.from("lead_messages").update({ card_owner: candidate }).eq("card_owner", before.username);
        } catch { /* scoping metadata; the thread itself is keyed by lead_id */ }
        // Record the old slug for the 308 redirect. Read fresh — this save may
        // have just written customization, and the RPC moved the row.
        try {
          const { data: fresh } = await admin.from("cards").select("customization").eq("id", opts.cardId).maybeSingle();
          const cust = { ...((fresh?.customization ?? {}) as Record<string, unknown>) };
          cust._prevSlugs = [...new Set([...(Array.isArray(cust._prevSlugs) ? (cust._prevSlugs as string[]) : []), before.username])];
          await admin.from("cards").update({ customization: cust }).eq("id", opts.cardId);
        } catch { /* redirect metadata is best-effort; the rename itself stands */ }
        return candidate;
      }
      if (result.error !== "taken") return null;
    }
    return null;
  } catch {
    return null;
  }
}
