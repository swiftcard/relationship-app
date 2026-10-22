import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { backToTab, field } from "@/lib/crew/admin-form";
import { SupabaseStore } from "@/lib/crew/store-supabase";
import type { CrewInput, Platform } from "@/lib/crew/types";

// "Paste a post": for the platforms with no API we may read (Facebook groups,
// Alignable, Instagram and LinkedIn posts), a person pastes what they saw and
// the matching agent drafts from it on its next run.
const PASTE_PLATFORMS: Platform[] = ["facebook", "alignable", "instagram", "linkedin", "threads", "bluesky", "quora", "indiehackers", "reddit", "web"];
const KINDS: CrewInput["kind"][] = ["post", "profile", "page"];

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const form = await req.formData();
  const platform = field(form, "platform") as Platform;
  const kind = (field(form, "kind") || "post") as CrewInput["kind"];
  const url = field(form, "url");
  const text = field(form, "text");
  if (!PASTE_PLATFORMS.includes(platform) || !KINDS.includes(kind)) return backToTab(req, "paste", "Pick where it's from.");
  if (text.length < 20) return backToTab(req, "paste", "Paste the whole post or profile text.");
  if (url && !/^https?:\/\//i.test(url)) return backToTab(req, "paste", "The link should start with https://");
  await new SupabaseStore().addInput({ platform, kind, url: url || null, text: text.slice(0, 8000) });
  return backToTab(req, "paste", "Got it. The agent will draft from it on its next run.");
}
