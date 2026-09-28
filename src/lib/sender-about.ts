// What the sender does, as the AI follow-up writers see it.
//
// The Swift Links bio is required on every card and asks for exactly this —
// "who you help, what you do, and why they should reach out" — and the field
// tells people the AI follow-ups use it. So it leads. The older About fields
// (card-level, then profile-level) still count when they say something the bio
// doesn't, so nothing anyone wrote there is lost.
//
// Used by both AI writers: api/leads/[id]/generate-sequence (the automations)
// and api/ai/suggest-messages (the three drafts).

type Customization = { bio?: unknown; about?: unknown } | null | undefined;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function senderAbout(card: Customization, profile: Customization): string {
  const parts: string[] = [];
  for (const v of [text(card?.bio), text(card?.about), text(profile?.about)]) {
    if (v && !parts.includes(v)) parts.push(v);
  }
  return parts.join("\n");
}
