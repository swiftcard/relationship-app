import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { paddedLogoSrc } from "@/lib/prospect-preview/card";
import { UUID_RE } from "@/lib/prospect-preview/input";
import { getPreviewById } from "@/lib/prospect-preview/store";
import PreviewView from "@/app/p/[slug]/PreviewView";
import { BackLink } from "../../../_ui/links";
import { Stack } from "../../../_ui/layout";

export const metadata = { title: "Preview — SwiftCard Admin" };
export const dynamic = "force-dynamic";

// ── Card Builder: a preview as its prospect will see it, for staff ──────────
// The same markup as /p/<slug> (PreviewView), behind the admin check, so a
// DRAFT can be looked at before anyone outside can open it. No beacon: staff
// looking is never a view. The button is shown but goes nowhere from here.

export default async function StaffPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) notFound();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const p = await getPreviewById(id);
  if (!p) notFound();
  return (
    <Stack>
      <BackLink href={`/admin/card-builder/edit/${p.id}`}>Edit this preview</BackLink>
      <p className="adm-callout-warn sc-t-footnote rounded-xl px-4 py-3">
        {p.status === "live" ? "This is what the prospect sees at their link." : "Only SwiftCard staff can see this. The prospect's link doesn't open until the preview is published."}
      </p>
      <div className="rounded-2xl overflow-hidden" data-staff-preview>
        <PreviewView preview={p} calendarUrl="#" logoSrc={paddedLogoSrc(p, true)} />
      </div>
    </Stack>
  );
}
