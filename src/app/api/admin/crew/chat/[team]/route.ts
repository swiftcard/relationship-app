import { after, NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { backToTab, field } from "@/lib/crew/admin-form";
import { answerOwner, canSend } from "@/lib/crew/manager-chat";
import { liveProviders } from "@/lib/crew/providers";
import { DOOR_TEAMS } from "@/lib/crew/store";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import type { TeamId } from "@/lib/crew/types";

// The owner writes in a team's chat. The message and a "writing…" placeholder
// are saved at once and the page comes straight back; the manager answers in
// the background (after the response) and the room refreshes itself.
export const maxDuration = 300;

export async function POST(req: NextRequest, ctx: { params: Promise<{ team: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { team: raw } = await ctx.params;
  if (!(DOOR_TEAMS as string[]).includes(raw)) return backToTab(req, "lobby", "No such team.");
  const team = raw as TeamId;
  const form = await req.formData();
  const text = field(form, "text");
  const store = new SupabaseStore();
  const now = new Date();
  const problem = await canSend(store, team, text, now);
  if (problem) return backToTab(req, team, problem, undefined, "chat-end");
  await store.addChat({ team, author: "owner", body: text });
  const replyId = await store.addChat({ team, author: "manager", body: "", status: "pending" });
  after(async () => {
    try {
      await answerOwner({ store, providers: liveProviders(), team, text, replyId });
    } catch (e) {
      const { reportError } = await import("@/lib/report-error");
      await reportError(`crew:chat:${team}`, e).catch(() => undefined);
    }
  });
  return backToTab(req, team, "", undefined, "chat-end");
}
